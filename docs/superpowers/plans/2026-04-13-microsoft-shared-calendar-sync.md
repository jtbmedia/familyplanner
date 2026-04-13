# Microsoft Gedeelde Agenda Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eén Microsoft/Outlook-account koppelen als gedeelde familie-agenda met bidirectionele Graph API delta-sync.

**Architecture:** Nieuwe service `server/services/microsoft-calendar.js` volgt exact het patroon van `google-calendar.js`. OAuth-callback gaat via de publieke `oauth-callbacks.js` router (geen sessie-cookie nodig). Tokens in `sync_config` tabel met prefix `microsoft_shared_*`.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, node-fetch, Microsoft Graph API v1.0, OAuth 2.0.

---

## File Structure

| Bestand | Actie | Verantwoordelijkheid |
|---------|-------|----------------------|
| `server/services/microsoft-calendar.js` | Aanmaken | OAuth, token refresh, Graph API delta-sync |
| `server/db.js` | Wijzigen | CHECK constraint oauth_pending uitbreiden met `'microsoft_shared'` |
| `server/routes/calendar.js` | Wijzigen | Routes: auth, status, sync, disconnect + VALID_SOURCES |
| `server/routes/oauth-callbacks.js` | Wijzigen | Publieke callback `/microsoft/shared/callback` |
| `public/pages/settings.js` | Wijzigen | Microsoft sync-kaart, event binding, URL-param handling |
| `public/locales/*.json` | Wijzigen | 4 nieuwe vertaalsleutels in 6 taalbestanden |

---

## Task 1: DB + VALID_SOURCES voorbereiden

**Files:**
- Modify: `server/db.js` (regels ~57-63 en ~427-432)
- Modify: `server/routes/calendar.js` (regel 24)

### Context
`oauth_pending` heeft een CHECK constraint die bepaalt welke providers toegestaan zijn. `microsoft_shared` moet toegevoegd worden. Ook in `calendar.js` staat `VALID_SOURCES` — de lijst van geldige `external_source` waarden.

- [ ] **Stap 1: Pas db.js aan — init() CHECK constraint**

In `server/db.js`, zoek de `CREATE TABLE IF NOT EXISTS oauth_pending` in de `init()` functie (rond regel 57) en vervang de CHECK constraint:

```js
// Oud:
provider   TEXT    NOT NULL CHECK(provider IN ('google', 'microsoft')),

// Nieuw:
provider   TEXT    NOT NULL CHECK(provider IN ('google', 'microsoft', 'microsoft_shared')),
```

- [ ] **Stap 2: Pas db.js aan — migratie v2 CHECK constraint**

Zoek de `CREATE TABLE IF NOT EXISTS oauth_pending` in de `MIGRATIONS` array (migration version 2, rond regel 427) en pas dezelfde CHECK constraint aan:

```js
// Oud:
provider   TEXT    NOT NULL CHECK(provider IN ('google', 'microsoft')),

// Nieuw:
provider   TEXT    NOT NULL CHECK(provider IN ('google', 'microsoft', 'microsoft_shared')),
```

- [ ] **Stap 3: Pas calendar.js aan — VALID_SOURCES**

In `server/routes/calendar.js` regel 24:

```js
// Oud:
const VALID_SOURCES = ['local', 'google', 'apple'];

// Nieuw:
const VALID_SOURCES = ['local', 'google', 'apple', 'microsoft_shared'];
```

- [ ] **Stap 4: Commit**

```bash
git add server/db.js server/routes/calendar.js
git commit -m "feat: microsoft_shared toevoegen aan oauth_pending CHECK + VALID_SOURCES"
```

---

## Task 2: microsoft-calendar.js service aanmaken

**Files:**
- Create: `server/services/microsoft-calendar.js`

### Context
Volgt exact het patroon van `server/services/google-calendar.js`. Gebruikt `node-fetch` (al in package.json via microsoft-personal.js). Graph API delta-endpoint voor incrementele sync. Token refresh voor tokens ouder dan 60 seconden voor verloop.

- [ ] **Stap 1: Maak het bestand aan**

Maak `server/services/microsoft-calendar.js` met onderstaande volledige inhoud:

```js
/**
 * Modul: Microsoft Calendar Sync (gedeeld)
 * Zweck: OAuth 2.0 + bidirectionele sync met Microsoft Graph API (delta-queries)
 * Afhankelijkheden: node-fetch, node:crypto, server/db.js
 *
 * sync_config-sleutels:
 *   microsoft_shared_access_token   - OAuth access token
 *   microsoft_shared_refresh_token  - Refresh token (langlevend)
 *   microsoft_shared_token_expiry   - Verloopdatum (ms als string)
 *   microsoft_shared_delta_link     - Volledige delta-URL voor incrementele sync
 *   microsoft_shared_last_sync      - ISO-8601 timestamp laatste sync
 *
 * Benodigde omgevingsvariabelen:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_SHARED_REDIRECT_URI
 */

import fetch from 'node-fetch';
import crypto from 'node:crypto';
import { createLogger } from '../logger.js';
import * as db from '../db.js';

const log        = createLogger('MicrosoftShared');
const MS_COLOR   = '#0078D4';
const AUTH_BASE  = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL  = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ── sync_config helpers ───────────────────────────────────────────────────────

function cfgGet(key) {
  const row = db.get().prepare('SELECT value FROM sync_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function cfgSet(key, value) {
  db.get().prepare(`
    INSERT INTO sync_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  `).run(key, value);
}

function cfgDel(key) {
  db.get().prepare('DELETE FROM sync_config WHERE key = ?').run(key);
}

// ── Configuratie check ────────────────────────────────────────────────────────

export function isConfigured() {
  return !!(process.env.MICROSOFT_CLIENT_ID &&
            process.env.MICROSOFT_CLIENT_SECRET &&
            process.env.MICROSOFT_SHARED_REDIRECT_URI);
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

/**
 * Genereer Microsoft OAuth-URL. Sla state op in oauth_pending (geen sessie nodig op callback).
 * @param {object} session - req.session (voor userId)
 * @returns {string} Auth URL
 */
export function getAuthUrl(session) {
  if (!isConfigured()) throw new Error('[MicrosoftShared] Omgevingsvariabelen niet ingesteld.');
  const state     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minuten
  db.get().prepare(
    `INSERT OR REPLACE INTO oauth_pending (state, user_id, provider, expires_at) VALUES (?, ?, 'microsoft_shared', ?)`
  ).run(state, session.userId, expiresAt);
  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  process.env.MICROSOFT_SHARED_REDIRECT_URI,
    scope:         'Calendars.ReadWrite offline_access',
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

/**
 * Verwerk OAuth-callback: wissel code in voor tokens en sla op.
 * @param {string} code - OAuth authorization code
 */
export async function handleCallback(code) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    redirect_uri:  process.env.MICROSOFT_SHARED_REDIRECT_URI,
    code,
  });
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) throw new Error('[MicrosoftShared] OAuth callback mislukt: ' + await res.text());
  const tokens = await res.json();
  if (!tokens.refresh_token) {
    throw new Error('[MicrosoftShared] Geen refresh token ontvangen — verbinding verbreken en opnieuw verbinden.');
  }
  cfgSet('microsoft_shared_access_token',  tokens.access_token);
  cfgSet('microsoft_shared_refresh_token', tokens.refresh_token);
  cfgSet('microsoft_shared_token_expiry',  String(Date.now() + (tokens.expires_in || 3600) * 1000));
  log.info('OAuth succesvol — tokens opgeslagen.');
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function ensureFreshToken() {
  const expiry = parseInt(cfgGet('microsoft_shared_token_expiry') || '0', 10);
  if (Date.now() < expiry - 60_000) return; // nog geldig

  const refreshToken = cfgGet('microsoft_shared_refresh_token');
  if (!refreshToken) throw new Error('[MicrosoftShared] Geen refresh token — opnieuw verbinden.');

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    refresh_token: refreshToken,
    scope:         'Calendars.ReadWrite offline_access',
  });
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) throw new Error('[MicrosoftShared] Token refresh mislukt: ' + await res.text());
  const tokens = await res.json();
  cfgSet('microsoft_shared_access_token', tokens.access_token);
  if (tokens.refresh_token) cfgSet('microsoft_shared_refresh_token', tokens.refresh_token);
  cfgSet('microsoft_shared_token_expiry', String(Date.now() + (tokens.expires_in || 3600) * 1000));
  log.info('Access token vernieuwd.');
}

// ── Graph API helper ──────────────────────────────────────────────────────────

async function graphFetch(path, options = {}) {
  await ensureFreshToken();
  const token = cfgGet('microsoft_shared_access_token');
  const url   = path.startsWith('https://') ? path : `${GRAPH_BASE}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization:   `Bearer ${token}`,
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getStatus() {
  return {
    configured: isConfigured(),
    connected:  !!(cfgGet('microsoft_shared_access_token') && cfgGet('microsoft_shared_refresh_token')),
    lastSync:   cfgGet('microsoft_shared_last_sync'),
  };
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export function disconnect() {
  ['microsoft_shared_access_token', 'microsoft_shared_refresh_token',
   'microsoft_shared_token_expiry', 'microsoft_shared_delta_link',
   'microsoft_shared_last_sync'].forEach(cfgDel);
  log.info('Verbinding verbroken.');
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/**
 * Bidirectionele sync.
 * Inbound:  Outlook → Oikos (delta-query, incrementeel)
 * Outbound: Oikos → Outlook (lokale events zonder external_calendar_id)
 */
export async function sync() {
  // ── Inbound: Outlook → Oikos ────────────────────────────────────────────────
  const SELECT = 'id,subject,bodyPreview,start,end,location,isAllDay,isCancelled,recurrence';
  let nextUrl  = cfgGet('microsoft_shared_delta_link') ||
    `${GRAPH_BASE}/me/events/delta?$select=${SELECT}&$top=50`;
  let newDeltaLink = null;

  while (nextUrl) {
    const res = await graphFetch(nextUrl);

    if (res.status === 410) {
      // Delta-link verlopen — volledige resync
      log.warn('Delta-link verlopen — volledige resync.');
      cfgDel('microsoft_shared_delta_link');
      nextUrl = `${GRAPH_BASE}/me/events/delta?$select=${SELECT}&$top=50`;
      newDeltaLink = null;
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[MicrosoftShared] Graph API fout ${res.status}: ${text}`);
    }

    const data = await res.json();
    upsertMicrosoftEvents(data.value || []);
    newDeltaLink = data['@odata.deltaLink'] || newDeltaLink;
    nextUrl      = data['@odata.nextLink']  || null;
  }

  if (newDeltaLink) cfgSet('microsoft_shared_delta_link', newDeltaLink);

  // ── Outbound: Oikos → Outlook ───────────────────────────────────────────────
  const localEvents = db.get().prepare(`
    SELECT * FROM calendar_events
    WHERE (external_source = 'local' OR external_source IS NULL)
      AND external_calendar_id IS NULL
  `).all();

  for (const event of localEvents) {
    try {
      const res = await graphFetch('/me/events', {
        method: 'POST',
        body:   JSON.stringify(localEventToMicrosoft(event)),
      });
      if (!res.ok) {
        log.error(`Outbound fout event ${event.id}: ${res.status} ${await res.text()}`);
        continue;
      }
      const created = await res.json();
      db.get().prepare(
        `UPDATE calendar_events SET external_calendar_id = ?, external_source = 'microsoft_shared' WHERE id = ?`
      ).run(created.id, event.id);
    } catch (err) {
      log.error(`Outbound fout event ${event.id}: ${err.message}`);
    }
  }

  cfgSet('microsoft_shared_last_sync', new Date().toISOString());
  log.info(`Sync klaar — ${localEvents.length} lokaal → Outlook, inbound via delta.`);
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

function upsertMicrosoftEvents(items) {
  const del = db.get().prepare(
    `DELETE FROM calendar_events WHERE external_calendar_id = ? AND external_source = 'microsoft_shared'`
  );

  const insertOrUpdate = db.get().transaction((item) => {
    if (item['@removed'] || item.isCancelled) {
      del.run(item.id);
      return;
    }

    const allDay      = !!item.isAllDay;
    const startDt     = allDay ? item.start?.date      : item.start?.dateTime;
    const endDt       = allDay ? item.end?.date        : item.end?.dateTime;
    const title       = item.subject                   || '(geen titel)';
    const description = item.bodyPreview               || null;
    const location    = item.location?.displayName     || null;
    const rrule       = msRecurrenceToRrule(item.recurrence);

    if (!startDt) return;

    const existing = db.get().prepare(
      `SELECT id FROM calendar_events WHERE external_calendar_id = ? AND external_source = 'microsoft_shared'`
    ).get(item.id);

    if (existing) {
      db.get().prepare(`
        UPDATE calendar_events
        SET title = ?, description = ?, start_datetime = ?, end_datetime = ?,
            all_day = ?, location = ?, recurrence_rule = ?
        WHERE id = ?
      `).run(title, description, startDt, endDt, allDay ? 1 : 0, location, rrule, existing.id);
    } else {
      db.get().prepare(`
        INSERT INTO calendar_events
          (title, description, start_datetime, end_datetime, all_day,
           location, color, external_calendar_id, external_source, recurrence_rule, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'microsoft_shared', ?, 1)
      `).run(title, description, startDt, endDt, allDay ? 1 : 0, location, MS_COLOR, item.id, rrule);
    }
  });

  for (const item of items) {
    try { insertOrUpdate(item); }
    catch (err) { log.error(`Upsert fout event ${item.id}: ${err.message}`); }
  }
}

// ── Formaat converters ────────────────────────────────────────────────────────

function localEventToMicrosoft(event) {
  const allDay  = !!event.all_day;
  const msEvent = {
    subject:  event.title,
    body:     { contentType: 'text', content: event.description || '' },
    isAllDay: allDay,
  };
  if (event.location) msEvent.location = { displayName: event.location };

  if (allDay) {
    const startDate = event.start_datetime.slice(0, 10);
    const endDate   = event.end_datetime ? event.end_datetime.slice(0, 10) : startDate;
    msEvent.start = { date: startDate, timeZone: 'UTC' };
    msEvent.end   = { date: endDate,   timeZone: 'UTC' };
  } else {
    const endDt = event.end_datetime || event.start_datetime;
    msEvent.start = { dateTime: event.start_datetime, timeZone: 'Europe/Amsterdam' };
    msEvent.end   = { dateTime: endDt,                timeZone: 'Europe/Amsterdam' };
  }
  return msEvent;
}

/**
 * Converteert Microsoft recurrence pattern naar RRULE string.
 * Ondersteunt: daily, weekly, absoluteMonthly, absoluteYearly.
 */
function msRecurrenceToRrule(recurrence) {
  if (!recurrence?.pattern) return null;
  const p = recurrence.pattern;
  const freqMap = {
    daily:           'FREQ=DAILY',
    weekly:          'FREQ=WEEKLY',
    absoluteMonthly: 'FREQ=MONTHLY',
    absoluteYearly:  'FREQ=YEARLY',
  };
  const freq = freqMap[p.type];
  if (!freq) return null;

  let rule = freq;
  if (p.interval > 1) rule += `;INTERVAL=${p.interval}`;
  if (p.daysOfWeek?.length) {
    const dayMap = { sunday:'SU', monday:'MO', tuesday:'TU', wednesday:'WE', thursday:'TH', friday:'FR', saturday:'SA' };
    rule += `;BYDAY=${p.daysOfWeek.map(d => dayMap[d]).filter(Boolean).join(',')}`;
  }
  if (recurrence.range?.endDate)              rule += `;UNTIL=${recurrence.range.endDate.replace(/-/g, '')}T000000Z`;
  if (recurrence.range?.numberOfOccurrences > 0) rule += `;COUNT=${recurrence.range.numberOfOccurrences}`;

  return `RRULE:${rule}`;
}
```

- [ ] **Stap 2: Verify het bestand bestaat**

```bash
ls server/services/microsoft-calendar.js
```

Verwacht: bestand zichtbaar.

- [ ] **Stap 3: Commit**

```bash
git add server/services/microsoft-calendar.js
git commit -m "feat: microsoft-calendar.js service — OAuth + Graph delta-sync"
```

---

## Task 3: oauth-callbacks.js — shared callback route

**Files:**
- Modify: `server/routes/oauth-callbacks.js`

### Context
De bestaande `oauth-callbacks.js` verwerkt persoonlijke OAuth-callbacks via `consumeOAuthState`. Voor de gedeelde Microsoft sync voegen we een nieuwe route toe: `GET /microsoft/shared/callback`. Deze heeft geen `userId` nodig — `handleCallback(code)` in de service slaat de tokens op in `sync_config`.

- [ ] **Stap 1: Voeg import toe**

Bovenaan `server/routes/oauth-callbacks.js`, voeg de import toe na de bestaande imports:

```js
import * as microsoftCalendar from '../services/microsoft-calendar.js';
```

De volledige import-sectie wordt dan:

```js
import express from 'express';
import { createLogger } from '../logger.js';
import * as db from '../db.js';
import * as googlePersonal    from '../services/personal/google-personal.js';
import * as microsoftPersonal from '../services/personal/microsoft-personal.js';
import * as microsoftCalendar from '../services/microsoft-calendar.js';
```

- [ ] **Stap 2: Voeg de callback route toe**

Voeg de volgende route toe voor `export default router;` in `server/routes/oauth-callbacks.js`:

```js
// ── GET /microsoft/shared/callback ───────────────────────────────────────────
// Gedeelde Microsoft Calendar OAuth-callback. Geen sessie vereist.

router.get('/microsoft/shared/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    log.warn(`Microsoft Shared OAuth afgewezen: ${error}`);
    return res.redirect('/settings?sync_error=microsoft');
  }

  const pending = consumeOAuthState(state);
  if (!pending || pending.provider !== 'microsoft_shared') {
    log.warn('Microsoft Shared OAuth: ongeldige of verlopen state');
    return res.redirect('/settings?sync_error=microsoft');
  }

  if (!code) {
    return res.redirect('/settings?sync_error=microsoft');
  }

  try {
    await microsoftCalendar.handleCallback(code);
    // Initiële sync in achtergrond starten (geen await)
    microsoftCalendar.sync().catch((e) => log.error('Initiële sync mislukt:', e.message));
    res.redirect('/settings?sync_ok=microsoft');
  } catch (err) {
    log.error('Microsoft Shared OAuth callback mislukt:', err);
    res.redirect('/settings?sync_error=microsoft');
  }
});
```

- [ ] **Stap 3: Controleer dat `export default router;` nog als laatste staat**

Het einde van het bestand moet zijn:

```js
export default router;
```

- [ ] **Stap 4: Commit**

```bash
git add server/routes/oauth-callbacks.js
git commit -m "feat: publieke callback route voor gedeelde Microsoft Calendar OAuth"
```

---

## Task 4: calendar.js — Microsoft routes

**Files:**
- Modify: `server/routes/calendar.js`

### Context
Voeg de Microsoft sync-routes toe direct na de Apple-routes (rond regel 380). Patroon is identiek aan de Google-routes: `requireAdmin` guard, zelfde response-structuur.

- [ ] **Stap 1: Voeg import toe**

Voeg bovenaan `server/routes/calendar.js` de import toe na de bestaande service-imports:

```js
import * as microsoftCalendar from '../services/microsoft-calendar.js';
```

De import-sectie ziet er dan zo uit (relevante regels):

```js
import * as googleCalendar from '../services/google-calendar.js';
import * as appleCalendar from '../services/apple-calendar.js';
import * as microsoftCalendar from '../services/microsoft-calendar.js';
```

- [ ] **Stap 2: Voeg Microsoft routes toe**

Zoek in `server/routes/calendar.js` het einde van de Apple-routes. Voeg daarna het volgende blok in (voor de persoonlijke sync callback-routes die al in het bestand staan):

```js
// --------------------------------------------------------
// Microsoft Calendar Sync-Routen
// --------------------------------------------------------

/**
 * GET /api/v1/calendar/microsoft/auth
 * Admin only. Leidt naar Microsoft OAuth-consent-scherm.
 */
router.get('/microsoft/auth', requireAdmin, (req, res) => {
  try {
    if (!microsoftCalendar.isConfigured()) {
      return res.status(503).json({ error: 'Microsoft niet geconfigureerd (ontbrekende .env-variabelen).', code: 503 });
    }
    const url = microsoftCalendar.getAuthUrl(req.session);
    res.redirect(url);
  } catch (err) {
    log.error('', err);
    res.status(503).json({ error: err.message, code: 503 });
  }
});

/**
 * GET /api/v1/calendar/microsoft/status
 * Response: { configured, connected, lastSync }
 */
router.get('/microsoft/status', (req, res) => {
  try {
    res.json(microsoftCalendar.getStatus());
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/calendar/microsoft/sync
 * Admin only. Manuele sync trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/microsoft/sync', requireAdmin, async (req, res) => {
  try {
    await microsoftCalendar.sync();
    const { lastSync } = microsoftCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

/**
 * DELETE /api/v1/calendar/microsoft/disconnect
 * Admin only. Tokens verwijderen.
 * Response: { ok: true }
 */
router.delete('/microsoft/disconnect', requireAdmin, (req, res) => {
  try {
    microsoftCalendar.disconnect();
    res.json({ ok: true });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});
```

- [ ] **Stap 3: Commit**

```bash
git add server/routes/calendar.js
git commit -m "feat: Microsoft Calendar sync-routes (auth/status/sync/disconnect)"
```

---

## Task 5: settings.js + vertalingen — Microsoft sync-kaart

**Files:**
- Modify: `public/pages/settings.js`
- Modify: `public/locales/nl.json`
- Modify: `public/locales/en.json`
- Modify: `public/locales/de.json`
- Modify: `public/locales/es.json`
- Modify: `public/locales/it.json`
- Modify: `public/locales/sv.json`

### Context
De settings-pagina heeft sync-kaarten voor Google en Apple. Microsoft volgt hetzelfde patroon. De bestaande `syncOk` / `syncErr` whitelists moeten `'microsoft'` bevatten. Er zijn 4 nieuwe vertaalsleutels nodig.

- [ ] **Stap 1: Voeg vertaalsleutels toe aan alle 6 locales**

Voeg in elk locale-bestand, direct na `"syncErrorApple"`, de volgende 4 sleutels toe:

**`public/locales/nl.json`:**
```json
"microsoftCalendar": "Microsoft / Outlook",
"connectMicrosoft": "Verbinden met Microsoft",
"syncSuccessMicrosoft": "Kalendersync met Microsoft succesvol verbonden.",
"syncErrorMicrosoft": "Verbinding met Microsoft mislukt. Probeer opnieuw.",
"microsoftDisconnectConfirm": "Microsoft Calendar loskoppelen? Gesynchroniseerde events blijven lokaal bewaard."
```

**`public/locales/en.json`:**
```json
"microsoftCalendar": "Microsoft / Outlook",
"connectMicrosoft": "Connect with Microsoft",
"syncSuccessMicrosoft": "Calendar sync with Microsoft connected successfully.",
"syncErrorMicrosoft": "Connection with Microsoft failed. Please try again.",
"microsoftDisconnectConfirm": "Disconnect Microsoft Calendar? Synced events will remain locally."
```

**`public/locales/de.json`:**
```json
"microsoftCalendar": "Microsoft / Outlook",
"connectMicrosoft": "Mit Microsoft verbinden",
"syncSuccessMicrosoft": "Kalendersynchronisation mit Microsoft erfolgreich verbunden.",
"syncErrorMicrosoft": "Verbindung mit Microsoft fehlgeschlagen. Bitte erneut versuchen.",
"microsoftDisconnectConfirm": "Microsoft Calendar trennen? Synchronisierte Termine bleiben lokal erhalten."
```

**`public/locales/es.json`:**
```json
"microsoftCalendar": "Microsoft / Outlook",
"connectMicrosoft": "Conectar con Microsoft",
"syncSuccessMicrosoft": "Sincronización de calendario con Microsoft conectada correctamente.",
"syncErrorMicrosoft": "Error al conectar con Microsoft. Inténtalo de nuevo.",
"microsoftDisconnectConfirm": "¿Desconectar Microsoft Calendar? Los eventos sincronizados permanecerán localmente."
```

**`public/locales/it.json`:**
```json
"microsoftCalendar": "Microsoft / Outlook",
"connectMicrosoft": "Connetti con Microsoft",
"syncSuccessMicrosoft": "Sincronizzazione calendario con Microsoft connessa con successo.",
"syncErrorMicrosoft": "Connessione con Microsoft fallita. Riprova.",
"microsoftDisconnectConfirm": "Disconnettere Microsoft Calendar? Gli eventi sincronizzati rimarranno in locale."
```

**`public/locales/sv.json`:**
```json
"microsoftCalendar": "Microsoft / Outlook",
"connectMicrosoft": "Anslut till Microsoft",
"syncSuccessMicrosoft": "Kalendersynkronisering med Microsoft ansluten.",
"syncErrorMicrosoft": "Anslutning till Microsoft misslyckades. Försök igen.",
"microsoftDisconnectConfirm": "Koppla bort Microsoft Calendar? Synkade händelser finns kvar lokalt."
```

- [ ] **Stap 2: Pas settings.js aan — data-laag**

Zoek in `public/pages/settings.js` het begin van de `render` functie. Vervang de bestaande `syncOk`/`syncErr` regels én voeg `microsoftStatus` toe:

```js
// Oud (regels ~36-39):
const _syncOk  = params.get('sync_ok');
const _syncErr = params.get('sync_error');
const syncOk   = ['google', 'apple'].includes(_syncOk)  ? _syncOk  : null;
const syncErr  = ['google', 'apple'].includes(_syncErr) ? _syncErr : null;

// Nieuw:
const _syncOk  = params.get('sync_ok');
const _syncErr = params.get('sync_error');
const syncOk   = ['google', 'apple', 'microsoft'].includes(_syncOk)  ? _syncOk  : null;
const syncErr  = ['google', 'apple', 'microsoft'].includes(_syncErr) ? _syncErr : null;
```

Voeg ook toe bij de status-variabelen (na `appleStatus`):

```js
// Na:
let appleStatus  = { configured: false, lastSync: null };

// Voeg toe:
let microsoftStatus = { configured: false, connected: false, lastSync: null };
```

- [ ] **Stap 3: Voeg API-call voor Microsoft status toe**

Zoek het `Promise.allSettled` blok dat de statussen ophaalt. Het haalt nu `/calendar/google/status` en `/calendar/apple/status` op. Voeg Microsoft toe:

```js
// Oud (vereenvoudigd):
const [usersRes, gStatus, aStatus, prefsRes, catsRes, personalRes, calsRes] = await Promise.allSettled([
  // ...
  api.get('/calendar/google/status'),
  api.get('/calendar/apple/status'),
  // ...
]);

// Nieuw — voeg mStatus toe:
const [usersRes, gStatus, aStatus, mStatus, prefsRes, catsRes, personalRes, calsRes] = await Promise.allSettled([
  // ... (zelfde volgorde, maar mStatus na aStatus)
  api.get('/calendar/google/status'),
  api.get('/calendar/apple/status'),
  api.get('/calendar/microsoft/status'),
  // ...
]);
```

En verwerk het resultaat (na de bestaande `appleStatus` regel):

```js
if (mStatus.status === 'fulfilled') microsoftStatus = mStatus.value;
```

- [ ] **Stap 4: Voeg Microsoft statusText toe**

Na de `appleStatusText` berekening, voeg toe:

```js
const microsoftStatusText = microsoftStatus.connected
  ? (microsoftStatus.lastSync ? t('settings.connectedLastSync', { date: formatDateTime(microsoftStatus.lastSync) }) : t('settings.connected'))
  : microsoftStatus.configured ? t('settings.notConnected') : t('settings.notConfigured');
```

- [ ] **Stap 5: Voeg Microsoft banner toe aan syncOk/syncErr**

Zoek het HTML-blok met de banners (rond regel 100):

```js
// Oud:
${syncOk  ? `<div class="settings-banner settings-banner--success">${syncOk === 'google' ? t('settings.syncSuccessGoogle') : t('settings.syncSuccessApple')}</div>` : ''}
${syncErr ? `<div class="settings-banner settings-banner--error">${syncErr === 'google' ? t('settings.syncErrorGoogle') : t('settings.syncErrorApple')}</div>` : ''}

// Nieuw:
${syncOk  ? `<div class="settings-banner settings-banner--success">${
  syncOk === 'google' ? t('settings.syncSuccessGoogle') :
  syncOk === 'microsoft' ? t('settings.syncSuccessMicrosoft') :
  t('settings.syncSuccessApple')
}</div>` : ''}
${syncErr ? `<div class="settings-banner settings-banner--error">${
  syncErr === 'google' ? t('settings.syncErrorGoogle') :
  syncErr === 'microsoft' ? t('settings.syncErrorMicrosoft') :
  t('settings.syncErrorApple')
}</div>` : ''}
```

- [ ] **Stap 6: Voeg Microsoft sync-kaart toe aan HTML**

Zoek het `<!-- Apple Calendar -->` kaart-blok. Voeg direct erna (na het sluitende `</div>` van de Apple-kaart) de Microsoft-kaart toe:

```js
          <!-- Microsoft Calendar -->
          <div class="settings-card">
            <div class="settings-sync-header">
              <div class="settings-sync-logo settings-sync-logo--microsoft">
                <svg viewBox="0 0 21 21" width="24" height="24"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
              </div>
              <div class="settings-sync-info">
                <div class="settings-sync-info__name">${t('settings.microsoftCalendar')}</div>
                <div class="settings-sync-info__status ${microsoftStatus.connected ? 'settings-sync-info__status--connected' : ''}">
                  ${microsoftStatusText}
                </div>
              </div>
            </div>
            ${microsoftStatus.configured ? `
              <div class="settings-sync-actions">
                ${microsoftStatus.connected ? `
                  <button class="btn btn--secondary" id="microsoft-sync-btn">${t('settings.syncNow')}</button>
                  ${user?.role === 'admin' ? `<button class="btn btn--danger-outline" id="microsoft-disconnect-btn">${t('settings.disconnect')}</button>` : ''}
                ` : user?.role === 'admin' ? `
                  <a href="/api/v1/calendar/microsoft/auth" class="btn btn--primary">${t('settings.connectMicrosoft')}</a>
                ` : `<span class="form-hint">${t('settings.googleOnlyAdmin')}</span>`}
              </div>
            ` : ''}
          </div>
```

- [ ] **Stap 7: Voeg Microsoft event binding toe**

Zoek in `public/pages/settings.js` het `// Apple Disconnect` blok (rond regel 748). Voeg direct daarna de Microsoft handlers toe:

```js
  // Microsoft Sync
  const microsoftSyncBtn = container.querySelector('#microsoft-sync-btn');
  if (microsoftSyncBtn) {
    microsoftSyncBtn.addEventListener('click', async () => {
      microsoftSyncBtn.disabled = true;
      microsoftSyncBtn.textContent = t('settings.synchronizing');
      try {
        await api.post('/calendar/microsoft/sync', {});
        window.oikos?.showToast(t('settings.syncSuccess', { provider: 'Microsoft / Outlook' }), 'success');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      } finally {
        microsoftSyncBtn.disabled = false;
        microsoftSyncBtn.textContent = t('settings.syncNow');
      }
    });
  }

  // Microsoft Disconnect (Admin)
  const microsoftDisconnectBtn = container.querySelector('#microsoft-disconnect-btn');
  if (microsoftDisconnectBtn) {
    microsoftDisconnectBtn.addEventListener('click', async () => {
      if (!await confirmModal(t('settings.microsoftDisconnectConfirm'), { danger: true })) return;
      try {
        await api.delete('/calendar/microsoft/disconnect');
        window.oikos?.showToast(t('settings.disconnectedToast', { provider: 'Microsoft / Outlook' }), 'default');
        window.oikos?.navigate('/settings');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      }
    });
  }
```

- [ ] **Stap 8: Commit**

```bash
git add public/pages/settings.js public/locales/nl.json public/locales/en.json public/locales/de.json public/locales/es.json public/locales/it.json public/locales/sv.json
git commit -m "feat: Microsoft Calendar sync-kaart in settings UI + vertalingen"
```

---

## Task 6: Push + deploy

- [ ] **Stap 1: Push naar GitHub**

```bash
git push
```

- [ ] **Stap 2: Server herbouwen**

Op de productieserver:

```bash
git pull && docker-compose up -d --build
```

- [ ] **Stap 3: MICROSOFT_SHARED_REDIRECT_URI toevoegen aan .env**

Op de productieserver, voeg toe aan `.env`:

```
MICROSOFT_SHARED_REDIRECT_URI=https://planner.paas.jtb.media/api/v1/oauth/microsoft/shared/callback
```

Herstart de container daarna:

```bash
docker-compose restart oikos
```

- [ ] **Stap 4: Handmatig testen**

1. Ga naar `/settings` → tabblad "Synchronisatie"
2. Controleer dat de Microsoft-kaart zichtbaar is
3. Klik "Verbinden met Microsoft" als admin
4. Doorloop de Microsoft OAuth-flow
5. Controleer redirect naar `/settings?sync_ok=microsoft`
6. Klik "Nu synchroniseren" — controleer dat er geen fout verschijnt
7. Maak een lokaal event aan en sync opnieuw — check dat het in Outlook verschijnt

---

## Self-Review Checklist

- [x] **Spec coverage:** OAuth flow ✓, delta-sync inbound ✓, outbound ✓, token refresh ✓, 410 fallback ✓, status ✓, disconnect ✓, routes ✓, UI ✓, vertalingen ✓
- [x] **Geen placeholders:** Alle code volledig uitgeschreven
- [x] **Type consistentie:** `getAuthUrl(session)`, `handleCallback(code)`, `getStatus()`, `disconnect()`, `sync()` — consistent door alle taken
- [x] **oauth_pending CHECK:** Bijgewerkt in zowel init() als migratie v2
- [x] **Redirect params:** `/settings?sync_ok=microsoft` en `?sync_error=microsoft` — whitelist in settings.js bijgewerkt
