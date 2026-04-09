/**
 * Modul: Personal Calendar Sync — Test
 * Zweck: Schema-Validierung voor event_attendees, user_calendar_tokens, event_push_log
 * Uitvoeren: node --experimental-sqlite test-personal-calendar.js
 */

import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_SQL } from './server/db-schema-test.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(MIGRATIONS_SQL[1]);
db.exec(MIGRATIONS_SQL[7]);

// Seed users + events
const uid1 = db.prepare(`INSERT INTO users (username, display_name, password_hash, avatar_color)
  VALUES ('jan', 'Jan', 'x', '#007AFF')`).run().lastInsertRowid;
const uid2 = db.prepare(`INSERT INTO users (username, display_name, password_hash, avatar_color)
  VALUES ('lisa', 'Lisa', 'x', '#34C759')`).run().lastInsertRowid;
const evId = db.prepare(`INSERT INTO calendar_events
  (title, start_datetime, color, created_by) VALUES ('Teammeeting', '2026-04-10T10:00', '#007AFF', ?)`).run(uid1).lastInsertRowid;

console.log('\n[Personal Calendar] Schema — event_attendees, user_calendar_tokens, event_push_log\n');

// ── event_attendees ──
test('attendee toevoegen', () => {
  db.prepare(`INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)`).run(evId, uid1);
  db.prepare(`INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)`).run(evId, uid2);
  const rows = db.prepare(`SELECT user_id FROM event_attendees WHERE event_id = ?`).all(evId);
  assert(rows.length === 2, 'Expected 2 attendees');
});

test('duplicate attendee rejected', () => {
  let threw = false;
  try { db.prepare(`INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)`).run(evId, uid1); }
  catch { threw = true; }
  assert(threw, 'Duplicate should throw');
});

test('cascade delete: attendees verwijderd bij event delete', () => {
  const ev2 = db.prepare(`INSERT INTO calendar_events
    (title, start_datetime, color, created_by) VALUES ('Temp', '2026-04-11', '#FF0000', ?)`).run(uid1).lastInsertRowid;
  db.prepare(`INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)`).run(ev2, uid1);
  db.prepare(`DELETE FROM calendar_events WHERE id = ?`).run(ev2);
  const rows = db.prepare(`SELECT * FROM event_attendees WHERE event_id = ?`).all(ev2);
  assert(rows.length === 0, 'Attendees should be deleted');
});

// ── user_calendar_tokens ──
test('token opslaan (google)', () => {
  db.prepare(`INSERT INTO user_calendar_tokens
    (user_id, provider, access_token, refresh_token, token_expiry, needs_reconnect)
    VALUES (?, 'google', 'acc123', 'ref123', '2026-04-09T12:00:00Z', 0)`).run(uid1);
  const row = db.prepare(`SELECT * FROM user_calendar_tokens WHERE user_id = ? AND provider = 'google'`).get(uid1);
  assert(row.access_token === 'acc123', 'access_token mismatch');
  assert(row.needs_reconnect === 0, 'needs_reconnect should be 0');
});

test('token upsert werkt', () => {
  db.prepare(`INSERT INTO user_calendar_tokens (user_id, provider, access_token, needs_reconnect)
    VALUES (?, 'google', 'acc_new', 0)
    ON CONFLICT(user_id, provider) DO UPDATE SET access_token = excluded.access_token`).run(uid1);
  const row = db.prepare(`SELECT access_token FROM user_calendar_tokens WHERE user_id = ? AND provider = 'google'`).get(uid1);
  assert(row.access_token === 'acc_new', 'Upsert failed');
});

test('needs_reconnect flag zetten', () => {
  db.prepare(`UPDATE user_calendar_tokens SET needs_reconnect = 1 WHERE user_id = ? AND provider = 'google'`).run(uid1);
  const row = db.prepare(`SELECT needs_reconnect FROM user_calendar_tokens WHERE user_id = ? AND provider = 'google'`).get(uid1);
  assert(row.needs_reconnect === 1, 'Flag not set');
});

test('apple token (caldav) opslaan', () => {
  db.prepare(`INSERT INTO user_calendar_tokens
    (user_id, provider, caldav_url, caldav_username, caldav_password, calendar_id, needs_reconnect)
    VALUES (?, 'apple', 'https://caldav.icloud.com', 'lisa@icloud.com', 'app-password', 'https://caldav.icloud.com/123/calendars/home/', 0)`).run(uid2);
  const row = db.prepare(`SELECT * FROM user_calendar_tokens WHERE user_id = ? AND provider = 'apple'`).get(uid2);
  assert(row.caldav_username === 'lisa@icloud.com', 'caldav_username mismatch');
  assert(row.calendar_id === 'https://caldav.icloud.com/123/calendars/home/', 'calendar_id mismatch');
});

test('cascade delete: tokens verwijderd bij user delete', () => {
  const uid3 = db.prepare(`INSERT INTO users (username, display_name, password_hash)
    VALUES ('temp', 'Temp', 'x')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO user_calendar_tokens (user_id, provider, needs_reconnect) VALUES (?, 'google', 0)`).run(uid3);
  db.prepare(`DELETE FROM users WHERE id = ?`).run(uid3);
  const rows = db.prepare(`SELECT * FROM user_calendar_tokens WHERE user_id = ?`).all(uid3);
  assert(rows.length === 0, 'Tokens should be cascade deleted');
});

// ── event_push_log ──
test('push log entry opslaan', () => {
  db.prepare(`INSERT INTO event_push_log (event_id, user_id, provider, external_event_id)
    VALUES (?, ?, 'google', 'google-ext-id-001')`).run(evId, uid1);
  const row = db.prepare(`SELECT * FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'google'`).get(evId, uid1);
  assert(row.external_event_id === 'google-ext-id-001', 'external_event_id mismatch');
});

test('push log upsert werkt', () => {
  db.prepare(`INSERT INTO event_push_log (event_id, user_id, provider, external_event_id)
    VALUES (?, ?, 'google', 'google-ext-id-002')
    ON CONFLICT(event_id, user_id, provider) DO UPDATE SET external_event_id = excluded.external_event_id`).run(evId, uid1);
  const row = db.prepare(`SELECT external_event_id FROM event_push_log WHERE event_id = ? AND user_id = ? AND provider = 'google'`).get(evId, uid1);
  assert(row.external_event_id === 'google-ext-id-002', 'Upsert failed');
});

test('cascade delete: push log verwijderd bij event delete', () => {
  const ev3 = db.prepare(`INSERT INTO calendar_events
    (title, start_datetime, color, created_by) VALUES ('TempLog', '2026-04-12', '#FF0000', ?)`).run(uid1).lastInsertRowid;
  db.prepare(`INSERT INTO event_push_log (event_id, user_id, provider, external_event_id) VALUES (?, ?, 'google', 'ext-999')`).run(ev3, uid1);
  db.prepare(`DELETE FROM calendar_events WHERE id = ?`).run(ev3);
  const rows = db.prepare(`SELECT * FROM event_push_log WHERE event_id = ?`).all(ev3);
  assert(rows.length === 0, 'Push log should be cascade deleted');
});

test('attendees query voor push', () => {
  const attendees = db.prepare(`SELECT user_id FROM event_attendees WHERE event_id = ?`).all(evId);
  assert(attendees.length === 2, 'Should have 2 attendees for push');
  assert(attendees.some(r => r.user_id === uid1), 'uid1 missing');
  assert(attendees.some(r => r.user_id === uid2), 'uid2 missing');
});

test('cascade delete: push log verwijderd bij user delete', () => {
  const uid4 = db.prepare(`INSERT INTO users (username, display_name, password_hash)
    VALUES ('temp_push', 'TempPush', 'x')`).run().lastInsertRowid;
  const ev4 = db.prepare(`INSERT INTO calendar_events
    (title, start_datetime, color, created_by) VALUES ('TempLogUser', '2026-04-13', '#0000FF', ?)`).run(uid1).lastInsertRowid;
  db.prepare(`INSERT INTO event_push_log (event_id, user_id, provider, external_event_id) VALUES (?, ?, 'google', 'ext-user-cascade')`).run(ev4, uid4);
  db.prepare(`DELETE FROM users WHERE id = ?`).run(uid4);
  const rows = db.prepare(`SELECT * FROM event_push_log WHERE user_id = ?`).all(uid4);
  assert(rows.length === 0, 'Push log should be cascade deleted on user delete');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
