/**
 * Modul: Apple Calendar — Persoonlijke Sync (CalDAV)
 * Zweck: Push Oikos-events naar de persoonlijke iCloud Calendar van een gebruiker.
 * Afhankelijkheden: tsdav (dynamisch), node:crypto, server/db.js
 *
 * Verbindingsgegevens worden opgeslagen in user_calendar_tokens:
 *   caldav_url       — bijv. https://caldav.icloud.com
 *   caldav_username  — Apple ID (e-mailadres)
 *   caldav_password  — App-specifiek wachtwoord
 *   calendar_id      — Volledige CalDAV-collectie-URL van de gekozen kalender
 */

import crypto from 'node:crypto';
import { createLogger } from '../../logger.js';
import * as db from '../../db.js';

const log = createLogger('ApplePersonal');

// ── iCal-builder ─────────────────────────────────────────────────────────────

function toICalDateTime(isoStr) {
  return isoStr.replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function buildVCalendar(event, uid) {
  const dtStamp = toICalDateTime(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Oikos//Oikos//NL',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `SUMMARY:${event.title.replace(/\n/g, '\\n')}`,
  ];

  if (event.all_day) {
    lines.push(`DTSTART;VALUE=DATE:${event.start_datetime.slice(0, 10).replace(/-/g, '')}`);
    const d = new Date(event.start_datetime.slice(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    lines.push(`DTEND;VALUE=DATE:${d.toISOString().slice(0, 10).replace(/-/g, '')}`);
  } else {
    const startUtc = event.start_datetime.endsWith('Z') ? event.start_datetime : event.start_datetime + ':00Z';
    const endUtc   = event.end_datetime
      ? (event.end_datetime.endsWith('Z') ? event.end_datetime : event.end_datetime + ':00Z')
      : startUtc;
    lines.push(`DTSTART:${toICalDateTime(startUtc)}`);
    lines.push(`DTEND:${toICalDateTime(endUtc)}`);
  }

  if (event.description) lines.push(`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`);
  if (event.location)    lines.push(`LOCATION:${event.location.replace(/\n/g, '\\n')}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// ── Push ─────────────────────────────────────────────────────────────────────

export async function push(event, userId, action) {
  const row = db.get().prepare(
    `SELECT * FROM user_calendar_tokens WHERE user_id = ? AND provider = 'apple'`
  ).get(userId);
  if (!row) throw new Error('[ApplePersonal] Geen Apple-verbinding voor gebruiker ' + userId);
  if (!row.caldav_url || !row.caldav_username || !row.caldav_password) {
    throw new Error('[ApplePersonal] Onvolledige CalDAV-credentials voor gebruiker ' + userId);
  }

  const { createDAVClient } = await import('tsdav');
  const client = await createDAVClient({
    serverUrl:          row.caldav_url,
    credentials:        { username: row.caldav_username, password: row.caldav_password },
    authMethod:         'Basic',
    defaultAccountType: 'caldav',
  });

  const calendarUrl = row.calendar_id;
  if (!calendarUrl) {
    throw new Error('[ApplePersonal] Geen kalender geselecteerd voor gebruiker ' + userId + '. Selecteer eerst een kalender in Instellingen.');
  }

  if (action === 'delete') {
    const logRow = db.get().prepare(
      `SELECT external_event_id FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'apple'`
    ).get(event.id, userId);
    if (!logRow) return;
    const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
    const eventUrl = `${base}${logRow.external_event_id}.ics`;
    await client.deleteCalendarObject({
      calendarObject: { url: eventUrl, etag: '' },
    }).catch((err) => log.warn(`Apple delete genegeerd: ${err.message}`));
    db.get().prepare(
      `DELETE FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'apple'`
    ).run(event.id, userId);
    return;
  }

  const logRow = db.get().prepare(
    `SELECT external_event_id FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'apple'`
  ).get(event.id, userId);

  const uid      = logRow ? logRow.external_event_id : crypto.randomUUID();
  const icalData = buildVCalendar(event, uid);
  const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
  const eventUrl = `${base}${uid}.ics`;

  if (action === 'update' && logRow) {
    await client.updateCalendarObject({
      calendarObject: { url: eventUrl, data: icalData, etag: '' },
    });
  } else {
    await client.createCalendarObject({
      calendar:   { url: calendarUrl },
      filename:   `${uid}.ics`,
      iCalString: icalData,
    });
    db.get().prepare(`
      INSERT INTO event_push_log (event_id, user_id, provider, external_event_id)
      VALUES (?, ?, 'apple', ?)
      ON CONFLICT(event_id, user_id, provider) DO UPDATE SET external_event_id = excluded.external_event_id
    `).run(event.id, userId, uid);
  }

  log.info(`Event ${event.id} ${action} → Apple Calendar (user ${userId})`);
}

// ── Verbinding testen + kalenders ophalen ─────────────────────────────────────

export async function connect(userId, caldavUrl, username, password) {
  if (!process.env.DB_ENCRYPTION_KEY) {
    log.warn('WAARSCHUWING: DB_ENCRYPTION_KEY niet ingesteld — CalDAV-wachtwoord wordt onversleuteld opgeslagen.');
  }

  const { createDAVClient } = await import('tsdav');
  const client = await createDAVClient({
    serverUrl:          caldavUrl,
    credentials:        { username, password },
    authMethod:         'Basic',
    defaultAccountType: 'caldav',
  });

  const calendars = await client.fetchCalendars();
  if (!calendars.length) throw new Error('[ApplePersonal] Verbonden, maar geen kalenders gevonden.');

  db.get().prepare(`
    INSERT INTO user_calendar_tokens
      (user_id, provider, caldav_url, caldav_username, caldav_password, needs_reconnect)
    VALUES (?, 'apple', ?, ?, ?, 0)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      caldav_url      = excluded.caldav_url,
      caldav_username = excluded.caldav_username,
      caldav_password = excluded.caldav_password,
      needs_reconnect = 0
  `).run(userId, caldavUrl, username, password);

  return calendars.map(c => ({ id: c.url, name: c.displayName || c.url }));
}

export function selectCalendar(userId, calendarId, calendarName) {
  db.get().prepare(`
    UPDATE user_calendar_tokens SET calendar_id = ?, calendar_name = ?
    WHERE user_id = ? AND provider = 'apple'
  `).run(calendarId, calendarName, userId);
}

export function disconnect(userId) {
  db.get().prepare(`DELETE FROM user_calendar_tokens WHERE user_id = ? AND provider = 'apple'`).run(userId);
  db.get().prepare(`DELETE FROM event_push_log WHERE user_id = ? AND provider = 'apple'`).run(userId);
  log.info(`Apple-verbinding verbroken voor gebruiker ${userId}`);
}
