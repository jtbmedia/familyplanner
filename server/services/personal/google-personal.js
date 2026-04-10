/**
 * Modul: Google Calendar — Persoonlijke Sync
 * Zweck: Push Oikos-events naar de persoonlijke Google Calendar van een gebruiker.
 * Afhankelijkheden: googleapis, server/db.js
 *
 * Benodigde omgevingsvariabelen:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_PERSONAL_REDIRECT_URI  (bijv. https://your-domain.com/api/v1/calendar/google/personal/callback)
 */

import { google } from 'googleapis';
import crypto from 'node:crypto';
import { createLogger } from '../../logger.js';
import * as db from '../../db.js';

const log = createLogger('GooglePersonal');

// ── Kleurmapping: Oikos hex → Google Calendar colorId ──────────────────────
// Google ondersteunt 11 kleur-IDs; we kiezen de dichtstbijzijnde.
const GOOGLE_COLORS = [
  { id: '9',  hex: '#3F51B5' }, // Blueberry
  { id: '7',  hex: '#039BE5' }, // Peacock
  { id: '1',  hex: '#7986CB' }, // Lavender
  { id: '2',  hex: '#33B679' }, // Sage
  { id: '10', hex: '#0B8043' }, // Basil
  { id: '5',  hex: '#F6BF26' }, // Banana
  { id: '6',  hex: '#F4511E' }, // Tangerine
  { id: '11', hex: '#D50000' }, // Tomato
  { id: '4',  hex: '#E67C73' }, // Flamingo
  { id: '3',  hex: '#8E24AA' }, // Grape
  { id: '8',  hex: '#616161' }, // Graphite
];

export function hexToColorId(hex) {
  if (!hex || hex.length !== 7) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let best = GOOGLE_COLORS[0];
  let bestDist = Infinity;
  for (const entry of GOOGLE_COLORS) {
    const er = parseInt(entry.hex.slice(1, 3), 16) - r;
    const eg = parseInt(entry.hex.slice(3, 5), 16) - g;
    const eb = parseInt(entry.hex.slice(5, 7), 16) - b;
    const dist = er * er + eg * eg + eb * eb;
    if (dist < bestDist) { bestDist = dist; best = entry; }
  }
  return best.id;
}

// ── OAuth2 client ───────────────────────────────────────────────────────────

function createOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_PERSONAL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('[GooglePersonal] GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en GOOGLE_PERSONAL_REDIRECT_URI vereist.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── Token laden + vernieuwen indien nodig ───────────────────────────────────

async function getAuthorizedClient(userId) {
  const row = db.get().prepare(
    `SELECT * FROM user_calendar_tokens WHERE user_id = ? AND provider = 'google'`
  ).get(userId);
  if (!row) throw new Error('[GooglePersonal] Geen Google-verbinding voor gebruiker ' + userId);

  if (!row.refresh_token) {
    db.get().prepare(
      `UPDATE user_calendar_tokens SET needs_reconnect = 1 WHERE user_id = ? AND provider = 'google'`
    ).run(userId);
    throw new Error('[GooglePersonal] Geen refresh token — opnieuw verbinden vereist voor gebruiker ' + userId);
  }

  const client = createOAuth2Client();
  client.setCredentials({
    access_token:  row.access_token,
    refresh_token: row.refresh_token,
    expiry_date:   row.token_expiry ? new Date(row.token_expiry).getTime() : undefined,
  });

  // Vernieuwen als token binnen 1 minuut verloopt
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiry < Date.now() + 60_000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      db.get().prepare(`
        UPDATE user_calendar_tokens
        SET access_token  = ?,
            refresh_token = COALESCE(?, refresh_token),
            token_expiry  = ?,
            needs_reconnect = 0
        WHERE user_id = ? AND provider = 'google'
      `).run(
        credentials.access_token,
        credentials.refresh_token || null,
        credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
        userId
      );
      client.setCredentials(credentials);
      log.info(`Token vernieuwd voor gebruiker ${userId}`);
    } catch (err) {
      db.get().prepare(
        `UPDATE user_calendar_tokens SET needs_reconnect = 1 WHERE user_id = ? AND provider = 'google'`
      ).run(userId);
      throw new Error('[GooglePersonal] Token-vernieuwen mislukt: ' + err.message);
    }
  }

  return { client, row };
}

// ── Push ────────────────────────────────────────────────────────────────────

/**
 * Push een event naar de persoonlijke Google Calendar van de gebruiker.
 * @param {object} event   - Oikos calendar_events rij (heeft id, title, start_datetime, etc.)
 * @param {number} userId  - ID van de gebruiker
 * @param {'create'|'update'|'delete'} action
 */
export async function push(event, userId, action) {
  const { client, row } = await getAuthorizedClient(userId);
  const cal        = google.calendar({ version: 'v3', auth: client });
  const calendarId = row.calendar_id || 'primary';

  // ── Delete ──
  if (action === 'delete') {
    const logRow = db.get().prepare(
      `SELECT external_event_id FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'google'`
    ).get(event.id, userId);
    if (!logRow) return; // Nooit gepusht
    await cal.events.delete({ calendarId, eventId: logRow.external_event_id }).catch(
      (err) => log.warn(`Google delete genegeerd (event ${logRow.external_event_id}): ${err.message}`)
    );
    db.get().prepare(
      `DELETE FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'google'`
    ).run(event.id, userId);
    return;
  }

  // ── Event body bouwen ──
  const body = {
    summary:     event.title,
    description: event.description  || undefined,
    location:    event.location     || undefined,
    colorId:     hexToColorId(event.color),
  };

  if (event.all_day) {
    const startDate = event.start_datetime.slice(0, 10);
    const endDate   = event.end_datetime
      ? (() => {
          const d = new Date(event.end_datetime.slice(0, 10) + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        })()
      : (() => {
          const d = new Date(startDate + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        })();
    body.start = { date: startDate };
    body.end   = { date: endDate };
  } else {
    const toUtc = (dt) => dt.endsWith('Z') ? dt : dt + 'Z';
    body.start = { dateTime: toUtc(event.start_datetime) };
    body.end   = { dateTime: event.end_datetime ? toUtc(event.end_datetime) : toUtc(event.start_datetime) };
  }

  // ── Create of Update ──
  const logRow = db.get().prepare(
    `SELECT external_event_id FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'google'`
  ).get(event.id, userId);

  let externalId;
  if (action === 'update' && logRow) {
    const response = await cal.events.update({
      calendarId,
      eventId: logRow.external_event_id,
      requestBody: body,
    });
    externalId = response.data.id;
  } else {
    const response = await cal.events.insert({ calendarId, requestBody: body });
    externalId = response.data.id;
  }

  db.get().prepare(`
    INSERT INTO event_push_log (event_id, user_id, provider, external_event_id)
    VALUES (?, ?, 'google', ?)
    ON CONFLICT(event_id, user_id, provider) DO UPDATE SET external_event_id = excluded.external_event_id
  `).run(event.id, userId, externalId);

  log.info(`Event ${event.id} ${action} → Google Calendar (user ${userId})`);
}

// ── OAuth flow ───────────────────────────────────────────────────────────────

/**
 * Genereer Google OAuth-URL. Sla state op in sessie voor CSRF-bescherming.
 * @param {object} session  - req.session
 * @returns {string} Auth URL
 */
export function getAuthUrl(session) {
  const client = createOAuth2Client();
  const state = crypto.randomBytes(32).toString('hex');
  session.googlePersonalOAuthState = state;
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state,
    prompt: 'consent',
  });
}

/**
 * Verwerk OAuth-callback: wissel code in voor tokens en sla op.
 * @param {string} code    - OAuth authorization code
 * @param {number} userId  - Ingelogde gebruiker
 */
export async function handleCallback(code, userId) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  db.get().prepare(`
    INSERT INTO user_calendar_tokens
      (user_id, provider, access_token, refresh_token, token_expiry, needs_reconnect)
    VALUES (?, 'google', ?, ?, ?, 0)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      access_token    = excluded.access_token,
      refresh_token   = COALESCE(excluded.refresh_token, refresh_token),
      token_expiry    = excluded.token_expiry,
      needs_reconnect = 0
  `).run(
    userId,
    tokens.access_token,
    tokens.refresh_token || null,
    tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
  );
  log.info(`OAuth tokens opgeslagen voor gebruiker ${userId}`);
}

/**
 * Haal lijst van Google Calendars op na OAuth.
 * @param {number} userId
 * @returns {Array<{id: string, name: string}>}
 */
export async function listCalendars(userId) {
  const { client } = await getAuthorizedClient(userId);
  const cal = google.calendar({ version: 'v3', auth: client });
  const response = await cal.calendarList.list();
  return (response.data.items || []).map(c => ({ id: c.id, name: c.summary }));
}

/**
 * Sla geselecteerde kalender op.
 */
export function selectCalendar(userId, calendarId, calendarName) {
  db.get().prepare(`
    UPDATE user_calendar_tokens SET calendar_id = ?, calendar_name = ?
    WHERE user_id = ? AND provider = 'google'
  `).run(calendarId, calendarName, userId);
}

/**
 * Verbreek verbinding: verwijder tokens en push-log voor deze gebruiker.
 */
export function disconnect(userId) {
  db.get().prepare(`DELETE FROM user_calendar_tokens WHERE user_id = ? AND provider = 'google'`).run(userId);
  db.get().prepare(`DELETE FROM event_push_log WHERE user_id = ? AND provider = 'google'`).run(userId);
  log.info(`Google-verbinding verbroken voor gebruiker ${userId}`);
}
