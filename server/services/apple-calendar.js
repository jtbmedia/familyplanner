/**
 * Modul: Apple Calendar Sync (CalDAV)
 * Zweck: Bidirektionaler Sync mit iCloud Calendar via CalDAV-Protokoll
 * Abhängigkeiten: tsdav (ESM - dynamisch importiert), server/db.js
 *
 * Konfiguration (.env):
 *   APPLE_CALDAV_URL              - z.B. https://caldav.icloud.com
 *   APPLE_USERNAME                - Apple-ID E-Mail
 *   APPLE_APP_SPECIFIC_PASSWORD   - App-spezifisches Passwort aus appleid.apple.com
 *
 * sync_config-Schlüssel:
 *   apple_last_sync - ISO-8601-Timestamp des letzten Syncs
 */

import { createLogger } from '../logger.js';
const log = createLogger('Apple');

import * as db from '../db.js';

const APPLE_COLOR = '#FC3C44';

// --------------------------------------------------------
// sync_config Helfer
// --------------------------------------------------------

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

// --------------------------------------------------------
// Credentials: sync_config hat Vorrang vor .env
// --------------------------------------------------------

function getCredentials() {
  const url      = cfgGet('apple_caldav_url')      || process.env.APPLE_CALDAV_URL;
  const username = cfgGet('apple_username')         || process.env.APPLE_USERNAME;
  const password = cfgGet('apple_app_password')     || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  if (!url || !username || !password) return null;
  return { url, username, password };
}

function saveCredentials(url, username, password) {
  // Warnung wenn DB-Verschluesselung nicht aktiv - Credentials liegen dann im Klartext
  if (!process.env.DB_ENCRYPTION_KEY) {
    log.warn('WARNUNG: DB_ENCRYPTION_KEY nicht gesetzt - CalDAV-Credentials werden unverschluesselt gespeichert.');
  }
  cfgSet('apple_caldav_url',  url);
  cfgSet('apple_username',    username);
  cfgSet('apple_app_password', password);
}

function clearCredentials() {
  ['apple_caldav_url', 'apple_username', 'apple_app_password', 'apple_last_sync'].forEach(cfgDel);
  log.info('Verbindung getrennt.');
}

// --------------------------------------------------------
// Verbindungsstatus
// --------------------------------------------------------

function getStatus() {
  const creds     = getCredentials();
  const configured = !!creds;
  const connected  = !!(cfgGet('apple_caldav_url')); // via UI gespeichert
  const lastSync   = cfgGet('apple_last_sync');
  return { configured, connected, lastSync };
}

/**
 * Verbindungstest: CalDAV-Client erstellen und Kalender abrufen.
 * Wirft einen Fehler wenn die Credentials ungültig sind.
 */
async function testConnection() {
  const creds = getCredentials();
  if (!creds) throw new Error('[Apple] Keine Credentials konfiguriert.');

  const { createDAVClient } = await import('tsdav');
  const client = await createDAVClient({
    serverUrl:          creds.url,
    credentials:        { username: creds.username, password: creds.password },
    authMethod:         'Basic',
    defaultAccountType: 'caldav',
  });

  const calendars = await client.fetchCalendars();
  if (!calendars.length) throw new Error('[Apple] Verbunden, aber keine Kalender gefunden.');
  return { ok: true, calendarCount: calendars.length };
}

// --------------------------------------------------------
// Minimaler ICS-Parser
// --------------------------------------------------------

/**
 * Entfaltet ICS-Zeilenfortsetzungen (RFC 5545 §3.1).
 * @param {string} ics
 * @returns {string}
 */
function unfoldLines(ics) {
  return ics.replace(/\r?\n[ \t]/g, '');
}

/**
 * Extrahiert alle VEVENT-Blöcke aus einem ICS-String.
 * @param {string} ics
 * @returns {Array<{uid, summary, description, location, dtstart, dtend, rrule, allDay}>}
 */
function parseICS(ics) {
  const unfolded = unfoldLines(ics);
  const events   = [];
  const vEventRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match;

  while ((match = vEventRe.exec(unfolded)) !== null) {
    const block = match[1];
    const get   = (prop) => {
      const re = new RegExp(`^${prop}(?:;[^:]*)?:(.*)$`, 'im');
      const m  = re.exec(block);
      return m ? m[1].trim() : null;
    };

    const uid         = get('UID');
    const summary     = get('SUMMARY') || '(kein Titel)';
    const description = get('DESCRIPTION') || null;
    const location    = get('LOCATION')    || null;
    const rrule       = get('RRULE')       ? `RRULE:${get('RRULE')}` : null;

    // DTSTART - mit optionalem TZID oder VALUE=DATE
    const dtStartRaw  = (() => {
      const m = /^DTSTART(?:;[^:]*)?:(.*)$/im.exec(block);
      return m ? m[1].trim() : null;
    })();
    const dtEndRaw    = (() => {
      const m = /^DTEND(?:;[^:]*)?:(.*)$/im.exec(block);
      return m ? m[1].trim() : null;
    })();

    const allDay  = /^DTSTART;VALUE=DATE:/im.test(block);
    const dtstart = dtStartRaw ? formatICSDate(dtStartRaw, allDay) : null;
    let   dtend   = dtEndRaw   ? formatICSDate(dtEndRaw,   allDay) : null;

    // RFC 5545: DTEND for VALUE=DATE is exclusive - subtract one day
    if (allDay && dtend) {
      const d = new Date(dtend + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      dtend = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // DURATION fallback when DTEND is missing (e.g. DURATION:P3D)
    if (!dtend && dtstart) {
      const durMatch = /^DURATION(?:;[^:]*)?:(.*)$/im.exec(block);
      if (durMatch) {
        dtend = applyDuration(dtstart, durMatch[1].trim(), allDay);
      }
    }

    if (!uid || !dtstart) continue;

    events.push({ uid, summary, description, location, dtstart, dtend, rrule, allDay });
  }

  return events;
}

/**
 * Konvertiert ICS-Datumswert in ISO-8601-String.
 * Unterstützt: DATE (20240101), DATE-TIME lokal (20240101T120000),
 *              DATE-TIME UTC (20240101T120000Z), DATE-TIME mit TZID (ignoriert TZID, behandelt als lokal).
 * @param {string} val
 * @param {boolean} allDay
 * @returns {string}
 */
function formatICSDate(val, allDay) {
  if (allDay || /^\d{8}$/.test(val)) {
    // DATE: YYYYMMDD → YYYY-MM-DD
    return `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
  }
  // DATE-TIME: YYYYMMDDTHHMMSS[Z]
  const y  = val.slice(0, 4);
  const mo = val.slice(4, 6);
  const d  = val.slice(6, 8);
  const h  = val.slice(9, 11);
  const mi = val.slice(11, 13);
  const s  = val.slice(13, 15) || '00';
  const z  = val.endsWith('Z') ? 'Z' : '';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${z}`;
}

/**
 * Berechnet ein Enddatum aus Start + ICS-DURATION (P-Format, Subset: PnW, PnD, PnDTnHnMnS).
 * Für all-day Events gibt es YYYY-MM-DD zurück (inklusive, bereits um 1 Tag reduziert),
 * für timed Events einen ISO-DateTime-String.
 */
function applyDuration(dtstart, dur, allDay) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur);
  if (!m) return null;

  const weeks = parseInt(m[1] || '0', 10);
  const days  = parseInt(m[2] || '0', 10);
  const hours = parseInt(m[3] || '0', 10);
  const mins  = parseInt(m[4] || '0', 10);
  const secs  = parseInt(m[5] || '0', 10);

  const base = new Date(dtstart.includes('T') ? dtstart : dtstart + 'T00:00:00');
  base.setDate(base.getDate() + weeks * 7 + days);
  base.setHours(base.getHours() + hours, base.getMinutes() + mins, base.getSeconds() + secs);

  if (allDay) {
    // Duration end is exclusive for DATE values - subtract one day for inclusive storage
    base.setDate(base.getDate() - 1);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  }

  return base.toISOString().replace('.000Z', 'Z');
}

// --------------------------------------------------------
// Minimaler ICS-Builder
// --------------------------------------------------------

/**
 * Erstellt einen minimalen ICS-String für ein lokales Event.
 * @param {{ id, title, description, start_datetime, end_datetime, all_day, location, recurrence_rule }} event
 * @returns {string}
 */
function buildICS(event) {
  const uid   = `oikos-${event.id}@oikos.local`;
  const now   = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Oikos//Familienplaner//DE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICS(event.title)}`,
  ];

  if (event.all_day) {
    const startDate = event.start_datetime.slice(0, 10).replace(/-/g, '');
    // RFC 5545: DTEND for VALUE=DATE is exclusive - add one day
    const endSrc = (event.end_datetime || event.start_datetime).slice(0, 10);
    const endD   = new Date(endSrc + 'T00:00:00');
    endD.setDate(endD.getDate() + 1);
    const endDate = `${endD.getFullYear()}${String(endD.getMonth() + 1).padStart(2, '0')}${String(endD.getDate()).padStart(2, '0')}`;
    lines.push(`DTSTART;VALUE=DATE:${startDate}`);
    lines.push(`DTEND;VALUE=DATE:${endDate}`);
  } else {
    const startDt = event.start_datetime.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const endDt   = (event.end_datetime || event.start_datetime).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    lines.push(`DTSTART:${startDt}`);
    lines.push(`DTEND:${endDt}`);
  }

  if (event.description) lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  if (event.location)    lines.push(`LOCATION:${escapeICS(event.location)}`);
  if (event.recurrence_rule) lines.push(event.recurrence_rule); // z.B. RRULE:FREQ=WEEKLY;BYDAY=MO

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function escapeICS(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// --------------------------------------------------------
// Sync
// --------------------------------------------------------

/**
 * Bidirektionaler CalDAV-Sync mit iCloud.
 * Inbound:  iCloud → lokale DB (Upsert via external_calendar_id = UID)
 * Outbound: lokale Termine (external_source='local', external_calendar_id IS NULL) → iCloud
 */
async function sync() {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('[Apple] Keine Credentials konfiguriert (weder in DB noch in .env).');
  }

  // tsdav ist eine optionale Abhängigkeit - dynamischer Import für graceful degradation
  const { createDAVClient } = await import('tsdav');

  const client = await createDAVClient({
    serverUrl:          creds.url,
    credentials:        { username: creds.username, password: creds.password },
    authMethod:         'Basic',
    defaultAccountType: 'caldav',
  });

  const calendars = await client.fetchCalendars();
  if (!calendars.length) {
    log.warn('Keine Kalender gefunden.');
    return;
  }

  // created_by: ersten existierenden User verwenden (nicht hardcoded ID 1)
  const owner = db.get().prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (!owner) {
    log.warn('Kein User in der Datenbank - Sync übersprungen.');
    return;
  }
  const createdBy = owner.id;

  // Alle Kalender synchen (inklusive Geburtstags-Kalender)
  const syncCalendars = calendars;

  let totalObjects = 0;

  for (const cal of syncCalendars) {
    let calObjects;
    try {
      calObjects = await client.fetchCalendarObjects({ calendar: cal });
    } catch (err) {
      log.warn(`Kalender "${cal.displayName || '(unbenannt)'}" nicht abrufbar: ${err.message}`);
      continue;
    }

    totalObjects += calObjects.length;

    // --------------------------------------------------------
    // Inbound: iCloud → lokal
    // --------------------------------------------------------
    for (const obj of calObjects) {
      const parsed = parseICS(obj.data || '');
      for (const ev of parsed) {
        try {
          const existing = db.get().prepare(
            `SELECT id FROM calendar_events WHERE external_calendar_id = ? AND external_source = 'apple'`
          ).get(ev.uid);

          if (existing) {
            db.get().prepare(`
              UPDATE calendar_events
              SET title = ?, description = ?, start_datetime = ?, end_datetime = ?,
                  all_day = ?, location = ?, recurrence_rule = ?
              WHERE id = ?
            `).run(
              ev.summary, ev.description, ev.dtstart, ev.dtend,
              ev.allDay ? 1 : 0, ev.location, ev.rrule, existing.id
            );
          } else {
            db.get().prepare(`
              INSERT INTO calendar_events
                (title, description, start_datetime, end_datetime, all_day,
                 location, color, external_calendar_id, external_source, recurrence_rule, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'apple', ?, ?)
            `).run(
              ev.summary, ev.description, ev.dtstart, ev.dtend,
              ev.allDay ? 1 : 0, ev.location, APPLE_COLOR, ev.uid, ev.rrule, createdBy
            );
          }
        } catch (err) {
          log.error(`Upsert-Fehler für UID ${ev.uid}:`, err.message);
        }
      }
    }
  }

  // --------------------------------------------------------
  // Outbound: lokal → iCloud (erster verfügbarer Kalender)
  // --------------------------------------------------------
  const defaultCal = syncCalendars[0];
  const localEvents = db.get().prepare(`
    SELECT * FROM calendar_events
    WHERE external_source = 'local' AND external_calendar_id IS NULL
  `).all();

  for (const event of localEvents) {
    try {
      const icsData  = buildICS(event);
      const uid      = `oikos-${event.id}@oikos.local`;
      const filename = `${uid}.ics`;

      await client.createCalendarObject({
        calendar:     defaultCal,
        filename,
        iCalString:   icsData,
      });

      db.get().prepare(`
        UPDATE calendar_events SET external_calendar_id = ?, external_source = 'apple' WHERE id = ?
      `).run(uid, event.id);
    } catch (err) {
      log.error(`Outbound-Fehler für Event ${event.id}:`, err.message);
    }
  }

  cfgSet('apple_last_sync', new Date().toISOString());
  log.info(`Sync abgeschlossen - ${totalObjects} Objekte aus ${syncCalendars.length} Kalendern inbound, ${localEvents.length} lokal → iCloud.`);
}

export { sync, getStatus, saveCredentials, clearCredentials, testConnection };
