# Microsoft Gedeelde Agenda Sync — Design Spec

**Datum:** 2026-04-13
**Status:** Goedgekeurd

---

## Doel

Eén Microsoft/Outlook-account koppelen als gedeelde familie-agenda in Oikos. Bidirectionele sync via Microsoft Graph API delta-queries — zelfde patroon als de bestaande Google Calendar sync.

---

## Scope

- Eén gedeeld Microsoft-account per Oikos-installatie (admin koppelt het)
- Bidirectionele sync: Outlook → Oikos (inbound) en Oikos → Outlook (outbound)
- Handmatige sync trigger (zelfde als Google en Apple)
- Geen webhooks, geen cron (buiten scope)
- Persoonlijke Microsoft sync (per gebruiker) blijft ongewijzigd

---

## Azure App Registratie

Hergebruik van de bestaande Azure app-registratie (zelfde `MICROSOFT_CLIENT_ID` en `MICROSOFT_CLIENT_SECRET`).

**Nieuwe redirect-URI** toegevoegd aan Azure:
```
https://planner.paas.jtb.media/api/v1/oauth/microsoft/shared/callback
```

**Nieuwe env-variabele:**
```
MICROSOFT_SHARED_REDIRECT_URI=https://planner.paas.jtb.media/api/v1/oauth/microsoft/shared/callback
```

**Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts" — al correct ingesteld.

**Scopes:** `Calendars.ReadWrite offline_access` — zelfde als persoonlijke sync.

---

## Architectuur

### Nieuwe bestanden

| Bestand | Verantwoordelijkheid |
|---------|----------------------|
| `server/services/microsoft-calendar.js` | OAuth flow, token beheer, Graph API sync logica |

### Aangepaste bestanden

| Bestand | Wijziging |
|---------|-----------|
| `server/routes/calendar.js` | Routes: GET /microsoft/auth, GET /microsoft/status, POST /microsoft/sync, DELETE /microsoft/disconnect |
| `server/routes/oauth-callbacks.js` | Publieke callback: GET /microsoft/shared/callback |
| `server/db.js` | `oauth_pending` CHECK constraint uitbreiden met `'microsoft_shared'` |

---

## Token Opslag (sync_config)

| Key | Inhoud |
|-----|--------|
| `microsoft_shared_access_token` | OAuth access token |
| `microsoft_shared_refresh_token` | Refresh token (langlevend) |
| `microsoft_shared_token_expiry` | Verloopdatum in milliseconden (Unix timestamp als string) |
| `microsoft_shared_delta_link` | Volledige delta-URL voor incrementele sync |
| `microsoft_shared_last_sync` | ISO-8601 timestamp laatste succesvolle sync |

Opgeslagen als plaintext in `sync_config` — versleuteling op DB-niveau via SQLCipher.

---

## OAuth Flow

```
1. Admin → GET /api/v1/calendar/microsoft/auth
   → microsoft-calendar.js: getAuthUrl(session)
   → state opslaan in oauth_pending (provider='microsoft_shared', TTL 10 min)
   → state opslaan in req.session.microsoftSharedOAuthState (backup)
   → redirect naar Microsoft login

2. Microsoft → GET /api/v1/oauth/microsoft/shared/callback?code=...&state=...
   → oauth-callbacks.js: consumeOAuthState(state, 'microsoft_shared')
   → microsoft-calendar.js: handleCallback(code)
   → tokens opslaan in sync_config
   → initiële sync starten (background, no await)
   → redirect /settings?sync_ok=microsoft
```

**Foutafhandeling:** Bij elke fout → redirect `/settings?microsoft_sync_error=true`

---

## Sync Logica

### Inbound (Outlook → Oikos)

**Eerste sync (geen delta-link):**
```
GET /me/events
  ?$select=id,subject,body,start,end,location,isAllDay,isCancelled,recurrence
  &$filter=start/dateTime ge '{now-90d}' and end/dateTime le '{now+365d}'
  &$top=50
  &$orderby=start/dateTime
```
Pagineer via `@odata.nextLink` tot leeg. Sla `@odata.deltaLink` op als `microsoft_shared_delta_link`.

**Incrementele sync (delta-link aanwezig):**
```
GET {microsoft_shared_delta_link}
```
Verwerk alleen gewijzigde/verwijderde events. Sla nieuwe delta-link op.

**Upsert logica (zelfde als Google):**
```sql
INSERT INTO calendar_events (external_calendar_id, external_source, title, ...)
VALUES (msEvent.id, 'microsoft_shared', msEvent.subject, ...)
ON CONFLICT(external_calendar_id) WHERE external_source='microsoft_shared'
DO UPDATE SET title=excluded.title, ...
```
Geannuleerde events (`@removed` aanwezig of `isCancelled=true`) → `DELETE FROM calendar_events WHERE external_calendar_id = ?`.

**Veld mapping (Graph → Oikos):**

| Graph | Oikos |
|-------|-------|
| `id` | `external_calendar_id` |
| `subject` | `title` |
| `body.content` | `description` (HTML gestript naar plain text) |
| `start.dateTime` / `start.date` | `start_datetime` |
| `end.dateTime` / `end.date` | `end_datetime` |
| `location.displayName` | `location` |
| `isAllDay` | `all_day` |
| `recurrence.pattern` | `recurrence_rule` (RRULE-formaat) |

Kleur: hardcoded `#0078D4` (Microsoft blauw) voor inbound events.

### Outbound (Oikos → Outlook)

```sql
SELECT * FROM calendar_events
WHERE (external_source = 'local' OR external_source IS NULL)
  AND external_calendar_id IS NULL
```

Per event:
```
POST /me/events
Body: { subject, body, start, end, location, isAllDay }
→ response.id opslaan als external_calendar_id
→ UPDATE calendar_events SET external_calendar_id=?, external_source='microsoft_shared'
```

**Conflict resolution:** last-write-wins via `external_calendar_id` upsert — zelfde als Google.

---

## API Routes

Alle routes vereisen `requireAdmin` (zelfde als Google/Apple routes in `calendar.js`).

| Method | Path | Beschrijving |
|--------|------|--------------|
| `GET` | `/api/v1/calendar/microsoft/auth` | Start OAuth flow, redirect naar Microsoft |
| `GET` | `/api/v1/calendar/microsoft/status` | Geeft verbindingsstatus + laatste sync terug |
| `POST` | `/api/v1/calendar/microsoft/sync` | Triggert handmatige sync |
| `DELETE` | `/api/v1/calendar/microsoft/disconnect` | Verwijdert tokens uit sync_config |

---

## Token Refresh

Graph API access tokens verlopen na ~1 uur. Refresh via:
```
POST https://login.microsoftonline.com/common/oauth2/v2.0/token
  grant_type=refresh_token
  client_id, client_secret, refresh_token
```

Refresh automatisch voor elke API-call als `microsoft_shared_token_expiry < Date.now() + 60s`.

---

## Error Handling

| Situatie | Actie |
|----------|-------|
| Token verlopen, refresh mislukt | Log error, sync afbreken, admin melding via status endpoint |
| Delta-link verlopen (410 Gone) | Fallback naar volledige sync, delta-link wissen |
| Rate limit (429) | Log warning, sync afbreken (volgende handmatige trigger) |
| Netwerk/Graph fout | Log error, sync afbreken |

---

## Env Variabelen (nieuw)

```env
MICROSOFT_SHARED_REDIRECT_URI=https://planner.paas.jtb.media/api/v1/oauth/microsoft/shared/callback
```

`MICROSOFT_CLIENT_ID` en `MICROSOFT_CLIENT_SECRET` zijn al aanwezig.

---

## Buiten Scope

- Cron/automatische sync
- Webhooks / push-notificaties
- Kalender-selectie (sync altijd naar primaire `/me/events`)
- Per-gebruiker Microsoft sync (al apart geïmplementeerd)
- Update/delete synchronisatie outbound (alleen nieuwe lokale events worden gepusht)
