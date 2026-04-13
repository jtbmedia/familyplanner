/**
 * Modul: Microsoft 365 — Persoonlijke Sync (Graph API)
 * Zweck: Push Oikos-events naar de persoonlijke Outlook Calendar van een gebruiker.
 * Afhankelijkheden: node-fetch, node:crypto, server/db.js
 *
 * Benodigde omgevingsvariabelen:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_REDIRECT_URI
 *
 * Als niet geconfigureerd, is Microsoft verborgen in de UI (isConfigured() → false).
 */

import fetch from 'node-fetch';
import crypto from 'node:crypto';
import { createLogger } from '../../logger.js';
import * as db from '../../db.js';

const log = createLogger('MicrosoftPersonal');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL  = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTH_BASE  = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

export function isConfigured() {
  return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_REDIRECT_URI);
}

// ── Token ophalen + vernieuwen ─────────────────────────────────────────────

async function refreshTokens(userId, refreshToken) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) {
    // Alleen de foutcode loggen, niet de volledige body (kan client-details bevatten)
    let errorCode = res.status;
    try {
      const body = await res.json();
      errorCode = body.error || res.status;
    } catch { /* ignore parse failure */ }
    throw new Error(`[MicrosoftPersonal] Token-vernieuwen mislukt: ${errorCode}`);
  }
  const data = await res.json();

  const expiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  db.get().prepare(`
    UPDATE user_calendar_tokens
    SET access_token  = ?,
        refresh_token = COALESCE(?, refresh_token),
        token_expiry  = ?,
        needs_reconnect = 0
    WHERE user_id = ? AND provider = 'microsoft'
  `).run(data.access_token, data.refresh_token || null, expiry, userId);

  return data.access_token;
}

async function getAccessToken(userId) {
  const row = db.get().prepare(
    `SELECT * FROM user_calendar_tokens WHERE user_id = ? AND provider = 'microsoft'`
  ).get(userId);
  if (!row) throw new Error('[MicrosoftPersonal] Geen Microsoft-verbinding voor gebruiker ' + userId);
  if (!row.refresh_token) {
    db.get().prepare(
      `UPDATE user_calendar_tokens SET needs_reconnect = 1 WHERE user_id = ? AND provider = 'microsoft'`
    ).run(userId);
    throw new Error('[MicrosoftPersonal] Geen refresh token — opnieuw verbinden vereist voor gebruiker ' + userId);
  }

  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiry > Date.now() + 60_000) return { token: row.access_token, row };

  try {
    const token = await refreshTokens(userId, row.refresh_token);
    return { token, row };
  } catch (err) {
    db.get().prepare(
      `UPDATE user_calendar_tokens SET needs_reconnect = 1 WHERE user_id = ? AND provider = 'microsoft'`
    ).run(userId);
    throw err;
  }
}

// ── Graph API helpers ──────────────────────────────────────────────────────

async function graphRequest(method, path, token, body) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`[MicrosoftPersonal] Graph ${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Event body bouwen voor Graph API ──────────────────────────────────────

function buildGraphEvent(event) {
  const body = { subject: event.title };

  if (event.description) {
    body.body = { contentType: 'text', content: event.description };
  }
  if (event.location) {
    body.location = { displayName: event.location };
  }

  if (event.all_day) {
    body.isAllDay = true;
    body.start = { dateTime: event.start_datetime.slice(0, 10) + 'T00:00:00', timeZone: 'UTC' };
    const endDate = event.end_datetime
      ? event.end_datetime.slice(0, 10)
      : (() => {
          const d = new Date(event.start_datetime.slice(0, 10) + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        })();
    body.end = { dateTime: endDate + 'T00:00:00', timeZone: 'UTC' };
  } else {
    const toUtc = (dt) => {
      if (dt.endsWith('Z')) return dt.slice(0, -1); // Graph API wants no Z, uses timeZone field
      return dt.includes('T') ? dt : dt + 'T00:00:00';
    };
    body.start = { dateTime: toUtc(event.start_datetime), timeZone: 'UTC' };
    body.end   = {
      dateTime: event.end_datetime ? toUtc(event.end_datetime) : toUtc(event.start_datetime),
      timeZone: 'UTC',
    };
  }

  return body;
}

// ── Push ─────────────────────────────────────────────────────────────────────

/**
 * Push een event naar de persoonlijke Outlook Calendar van de gebruiker.
 * @param {object} event   - Oikos calendar_events rij (heeft id, title, start_datetime, etc.)
 * @param {number} userId  - ID van de gebruiker
 * @param {'create'|'update'|'delete'} action
 */
export async function push(event, userId, action) {
  const { token, row } = await getAccessToken(userId);
  const calendarId = row.calendar_id;

  if (action === 'delete') {
    const logRow = db.get().prepare(
      `SELECT external_event_id FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'microsoft'`
    ).get(event.id, userId);
    if (!logRow) return;
    await graphRequest('DELETE', `/me/events/${logRow.external_event_id}`, token).catch(
      (err) => log.warn(`Microsoft delete genegeerd (${logRow.external_event_id}): ${err.message}`)
    );
    db.get().prepare(
      `DELETE FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'microsoft'`
    ).run(event.id, userId);
    return;
  }

  const graphBody = buildGraphEvent(event);

  const logRow = db.get().prepare(
    `SELECT external_event_id FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'microsoft'`
  ).get(event.id, userId);

  let externalId;
  if (action === 'update' && logRow) {
    await graphRequest('PATCH', `/me/events/${logRow.external_event_id}`, token, graphBody);
    externalId = logRow.external_event_id;
  } else {
    const path = calendarId ? `/me/calendars/${calendarId}/events` : '/me/calendar/events';
    const data = await graphRequest('POST', path, token, graphBody);
    externalId = data.id;
  }

  db.get().prepare(`
    INSERT INTO event_push_log (event_id, user_id, provider, external_event_id)
    VALUES (?, ?, 'microsoft', ?)
    ON CONFLICT(event_id, user_id, provider) DO UPDATE SET external_event_id = excluded.external_event_id
  `).run(event.id, userId, externalId);

  log.info(`Event ${event.id} ${action} → Microsoft Calendar (user ${userId})`);
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

/**
 * Genereer Microsoft OAuth-URL. Sla state op in sessie voor CSRF-bescherming.
 * @param {object} session  - req.session
 * @returns {string} Auth URL
 */
export function getAuthUrl(session, userId) {
  const state = crypto.randomBytes(32).toString('hex');
  session.microsoftOAuthState = state;
  // Sla state ook op in DB zodat de callback geen sessie-cookie nodig heeft
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minuten
  db.get().prepare(
    `INSERT OR REPLACE INTO oauth_pending (state, user_id, provider, expires_at) VALUES (?, ?, 'microsoft', ?)`
  ).run(state, userId, expiresAt);
  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  process.env.MICROSOFT_REDIRECT_URI,
    scope:         'Calendars.ReadWrite offline_access',
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

/**
 * Verwerk OAuth-callback: wissel code in voor tokens en sla op.
 * @param {string} code    - OAuth authorization code
 * @param {number} userId  - Ingelogde gebruiker
 */
export async function handleCallback(code, userId) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    redirect_uri:  process.env.MICROSOFT_REDIRECT_URI,
    code,
  });

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('[MicrosoftPersonal] OAuth callback mislukt: ' + text);
  }
  const tokens = await res.json();

  const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  db.get().prepare(`
    INSERT INTO user_calendar_tokens
      (user_id, provider, access_token, refresh_token, token_expiry, needs_reconnect)
    VALUES (?, 'microsoft', ?, ?, ?, 0)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      access_token    = excluded.access_token,
      refresh_token   = COALESCE(excluded.refresh_token, refresh_token),
      token_expiry    = excluded.token_expiry,
      needs_reconnect = 0
  `).run(userId, tokens.access_token, tokens.refresh_token || null, expiry);

  log.info(`Microsoft tokens opgeslagen voor gebruiker ${userId}`);
}

/**
 * Haal lijst van Outlook Calendars op na OAuth.
 * @param {number} userId
 * @returns {Array<{id: string, name: string}>}
 */
export async function listCalendars(userId) {
  const { token } = await getAccessToken(userId);
  const data = await graphRequest('GET', '/me/calendars', token);
  return (data.value || []).map(c => ({ id: c.id, name: c.name }));
}

/**
 * Sla geselecteerde kalender op.
 */
export function selectCalendar(userId, calendarId, calendarName) {
  db.get().prepare(`
    UPDATE user_calendar_tokens SET calendar_id = ?, calendar_name = ?
    WHERE user_id = ? AND provider = 'microsoft'
  `).run(calendarId, calendarName, userId);
}

/**
 * Verbreek verbinding: verwijder tokens en push-log voor deze gebruiker.
 */
export function disconnect(userId) {
  db.get().prepare(`DELETE FROM user_calendar_tokens WHERE user_id = ? AND provider = 'microsoft'`).run(userId);
  db.get().prepare(`DELETE FROM event_push_log WHERE user_id = ? AND provider = 'microsoft'`).run(userId);
  log.info(`Microsoft-verbinding verbroken voor gebruiker ${userId}`);
}
