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
  if (recurrence.range?.endDate)                 rule += `;UNTIL=${recurrence.range.endDate.replace(/-/g, '')}T000000Z`;
  if (recurrence.range?.numberOfOccurrences > 0) rule += `;COUNT=${recurrence.range.numberOfOccurrences}`;

  return `RRULE:${rule}`;
}
