# Personal Calendar Sync — Design Spec
**Date:** 2026-04-09
**Status:** Approved

---

## Overview

Each family member can connect their own personal calendar (Google, Apple, or Microsoft 365) to Oikos. When an event is created, updated, or deleted in Oikos and a user is assigned to it, the change is immediately pushed to their connected personal calendar. Push is one-way: Oikos → personal calendar only.

---

## Scope

**In scope:**
- Per-user calendar connections (Google OAuth, Apple CalDAV, Microsoft OAuth)
- Calendar selection per user (choose which of their calendars to push to)
- Push on create, update, delete
- Color sync (user's Oikos avatar color sent as event color)
- External event ID tracking (to enable update/delete)
- Automatic token refresh (Google, Microsoft)
- Connection status + reconnect flow in Settings
- Multi-attendee events (multiple users per event)

**Out of scope:**
- Pull from personal calendar into Oikos
- Backfill of existing events on connect
- Webhook-based real-time sync
- Conflict detection
- Per-event push toggle

---

## Data Model

### New: `event_attendees`
Replaces the single `assigned_to` column on `calendar_events` for multi-person assignment.

| Column | Type | Constraint |
|--------|------|-----------|
| `event_id` | INTEGER | FK → calendar_events, NOT NULL |
| `user_id` | INTEGER | FK → users, NOT NULL |
| PRIMARY KEY | | (event_id, user_id) |

`calendar_events.assigned_to` is kept for backwards compatibility but no longer written to.

### New: `user_calendar_tokens`
Per-user, per-provider credentials and selected calendar.

| Column | Type | Constraint |
|--------|------|-----------|
| `user_id` | INTEGER | FK → users, NOT NULL |
| `provider` | TEXT | 'google', 'apple', 'microsoft' |
| `access_token` | TEXT | encrypted at rest (SQLCipher) |
| `refresh_token` | TEXT | encrypted at rest (SQLCipher) |
| `token_expiry` | TEXT | ISO 8601, nullable |
| `calendar_id` | TEXT | selected calendar ID |
| `calendar_name` | TEXT | display name of selected calendar |
| `caldav_url` | TEXT | Apple only |
| `caldav_password` | TEXT | Apple only, encrypted |
| PRIMARY KEY | | (user_id, provider) |

### New: `event_push_log`
Tracks external event IDs per user per event, enabling update and delete.

| Column | Type | Constraint |
|--------|------|-----------|
| `event_id` | INTEGER | FK → calendar_events, NOT NULL |
| `user_id` | INTEGER | FK → users, NOT NULL |
| `provider` | TEXT | 'google', 'apple', 'microsoft' |
| `external_event_id` | TEXT | ID returned by external API |
| PRIMARY KEY | | (event_id, user_id, provider) |

---

## Architecture

### New service files

```
server/services/personal/
  google-personal.js    — Google Calendar API push (per-user OAuth)
  apple-personal.js     — Apple CalDAV push (per-user credentials)
  microsoft-personal.js — Microsoft Graph API push (per-user OAuth)
  push.js               — Central dispatcher
```

The existing `server/services/google-calendar.js` and `server/services/apple-calendar.js` (household-level sync) remain unchanged.

### `push.js` — Central dispatcher

```
push(event, userIds, action)   action = 'create' | 'update' | 'delete'
  for each userId:
    fetch provider from user_calendar_tokens
    call appropriate service (google/apple/microsoft-personal)
    on create/update: upsert external_event_id in event_push_log
    on delete: remove from event_push_log
    on error: collect error, return partial success result
```

Returns `{ ok: true }` or `{ ok: false, failed: [{ userId, provider, error }] }`.

### Token refresh

Google and Microsoft tokens expire after ~1 hour. Each personal service checks `token_expiry` before making API calls and refreshes if needed, updating `user_calendar_tokens` in place.

If refresh fails (revoked token): mark connection as `needs_reconnect` and return error to dispatcher.

---

## API Routes

### Calendar connection (`/api/v1/calendar/personal`)

```
GET    /status                    → own connection status per provider
GET    /calendars/:provider       → list available calendars after OAuth (for selection UI)
POST   /connect/google            → initiate Google OAuth flow
POST   /connect/apple             → save CalDAV credentials + test connection + list calendars
POST   /connect/microsoft         → initiate Microsoft OAuth flow
DELETE /disconnect/:provider      → delete tokens + push log entries for this user
```

### OAuth callbacks

```
GET /api/v1/calendar/google/personal/callback    → process OAuth code, store tokens, redirect to settings
GET /api/v1/calendar/microsoft/callback          → process OAuth code, store tokens, redirect to settings
```

Google personal callback is separate from the existing household Google callback.

### Existing calendar routes (extended)

```
POST   /api/v1/calendar/events      → after DB save: call push.js('create')
PUT    /api/v1/calendar/events/:id  → after DB update: call push.js('update')
DELETE /api/v1/calendar/events/:id  → before DB delete: call push.js('delete')
```

Push errors do not block the local operation. Event is saved/deleted locally regardless.

---

## Frontend / UI

### Settings → Account tab
Each user sees a "Persoonlijke agenda" section with three providers (Google, Apple, Microsoft). Per provider:
- **Not connected:** Connect button → starts OAuth flow or shows CalDAV form
- **Connected:** Calendar name shown, Disconnect button, option to change calendar
- **Needs reconnect:** Warning state with Reconnect button

Calendar selection: after OAuth completes, a dropdown shows the user's available calendars. Selection is saved immediately.

### Event form
`assigned_to` (single select) replaced by a multi-select attendee picker showing all family members as avatar chips. Tapping a chip toggles assignment. Selected = colored avatar, deselected = grey.

### Error feedback
If push fails for one or more users after saving an event, a toast appears:
> "Opgeslagen, maar push naar [naam] mislukt. Verbinding verlopen?"

The toast links to Settings → Account.

---

## Color sync

When pushing an event to a personal calendar, the user's `avatar_color` from Oikos is sent as the event color. Google Calendar and Microsoft Graph both support color IDs — the hex color is mapped to the closest supported color. Apple CalDAV events support `COLOR` property (RFC 7986).

---

## Error handling

| Scenario | Behaviour |
|----------|-----------|
| Push fails (network) | Local save succeeds, toast shown, no retry |
| Token expired, refresh succeeds | Transparent, push proceeds |
| Token expired, refresh fails | Connection marked needs_reconnect, toast shown |
| User has no calendar connected | Push skipped silently |
| External API returns duplicate | Ignored (idempotent upsert via event_push_log) |

---

## Microsoft 365 setup

Requires an Azure AD app registration with:
- Scopes: `Calendars.ReadWrite`, `offline_access`
- Redirect URI: `https://[domain]/api/v1/calendar/microsoft/callback`

Env vars: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`

Optional — if not configured, Microsoft option is hidden in the UI.

---

## Out of scope (future)

- CardDAV contacts sync (BL-11)
- i18n-neutral contact categories (BL-12)
- Pull from personal calendar into Oikos
