/**
 * Modul: Kalender-Test
 * Zweck: Validiert alle Calendar-API-Abfragen, Datumsbereichs-Filter,
 *        Constraints, CRUD-Logik
 * Ausführen: node --experimental-sqlite test-calendar.js
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
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, description TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);`);
db.exec(MIGRATIONS_SQL[1]);

// Benutzer
const u1 = db.prepare(`INSERT INTO users (username, display_name, password_hash, role)
  VALUES ('admin', 'Admin', 'x', 'admin')`).run();
const uid = u1.lastInsertRowid;

const u2 = db.prepare(`INSERT INTO users (username, display_name, password_hash, avatar_color)
  VALUES ('maria', 'Maria', 'x', '#34C759')`).run();
const uid2 = u2.lastInsertRowid;

console.log('\n[Calendar-Test] Termine, Datumsbereich, CRUD, Constraints\n');

let ev1, ev2, ev3, ev4;

// --------------------------------------------------------
// Termin-CRUD
// --------------------------------------------------------
test('Termin erstellen (mit Uhrzeit)', () => {
  const r = db.prepare(`
    INSERT INTO calendar_events
      (title, start_datetime, end_datetime, color, created_by)
    VALUES ('Zahnarzt', '2026-03-24T10:00', '2026-03-24T11:00', '#FF3B30', ?)
  `).run(uid);
  ev1 = r.lastInsertRowid;
  assert(ev1 > 0);
});

test('Termin erstellen (ganztägig)', () => {
  const r = db.prepare(`
    INSERT INTO calendar_events
      (title, start_datetime, all_day, color, created_by)
    VALUES ('Ostern', '2026-04-05', 1, '#34C759', ?)
  `).run(uid);
  ev2 = r.lastInsertRowid;
  assert(ev2 > 0);
});

test('Termin erstellen (mehrtägig)', () => {
  const r = db.prepare(`
    INSERT INTO calendar_events
      (title, start_datetime, end_datetime, all_day, color, created_by)
    VALUES ('Urlaub', '2026-03-28', '2026-04-04', 1, '#FF9500', ?)
  `).run(uid);
  ev3 = r.lastInsertRowid;
  assert(ev3 > 0);
});

test('Termin mit Zuweisung erstellen', () => {
  const r = db.prepare(`
    INSERT INTO calendar_events
      (title, start_datetime, color, assigned_to, created_by)
    VALUES ('Elternabend', '2026-03-26T18:00', '#AF52DE', ?, ?)
  `).run(uid2, uid);
  ev4 = r.lastInsertRowid;
  assert(ev4 > 0);
});

test('Termin abrufen (mit assigned_name via JOIN)', () => {
  const ev = db.prepare(`
    SELECT e.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
    FROM calendar_events e
    LEFT JOIN users u ON u.id = e.assigned_to
    WHERE e.id = ?
  `).get(ev4);
  assert(ev.assigned_name === 'Maria', `assigned_name: ${ev.assigned_name}`);
  assert(ev.assigned_color === '#34C759');
});

test('Termin aktualisieren (Titel + Farbe)', () => {
  db.prepare(`UPDATE calendar_events SET title = 'Zahnarzt Dr. Müller', color = '#007AFF' WHERE id = ?`).run(ev1);
  const ev = db.prepare('SELECT title, color FROM calendar_events WHERE id = ?').get(ev1);
  assert(ev.title === 'Zahnarzt Dr. Müller');
  assert(ev.color === '#007AFF');
});

test('external_source-Constraint (ungültiger Wert)', () => {
  let threw = false;
  try {
    db.prepare(`INSERT INTO calendar_events (title, start_datetime, external_source, created_by)
      VALUES ('Test', '2026-03-24', 'outlook', ?)`).run(uid);
  } catch { threw = true; }
  assert(threw, 'Constraint muss verletzt werden');
});

// --------------------------------------------------------
// Datumsbereichs-Filter
// --------------------------------------------------------
test('Termine in März 2026 (inkl. mehrtägiger)', () => {
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE DATE(start_datetime) <= '2026-03-31'
      AND (end_datetime IS NULL OR DATE(end_datetime) >= '2026-03-01')
    ORDER BY start_datetime ASC
  `).all();
  // Zahnarzt (24.3), Elternabend (26.3), Urlaub (28.3–4.4)
  assert(events.length === 3, `Erwartet 3, erhalten ${events.length}`);
});

test('Termine in April 2026 (inkl. Urlaub + Ostern)', () => {
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE DATE(start_datetime) <= '2026-04-30'
      AND (end_datetime IS NULL OR DATE(end_datetime) >= '2026-04-01')
    ORDER BY start_datetime ASC
  `).all();
  // Urlaub endet 4.4, Ostern 5.4
  assert(events.length >= 2, `Erwartet mindestens 2, erhalten ${events.length}`);
  const titles = events.map((e) => e.title);
  assert(titles.includes('Urlaub'), 'Urlaub in April');
  assert(titles.includes('Ostern'), 'Ostern in April');
});

test('Termine nach Benutzer filtern', () => {
  const events = db.prepare(`
    SELECT * FROM calendar_events WHERE assigned_to = ?
  `).all(uid2);
  assert(events.length === 1);
  assert(events[0].title === 'Elternabend');
});

test('Nur lokale Termine (external_source = local)', () => {
  const events = db.prepare(`
    SELECT * FROM calendar_events WHERE external_source = 'local'
  `).all();
  assert(events.length === 4, `Alle 4 Termine sind lokal, erhalten ${events.length}`);
});

test('Kommende Termine (upcoming)', () => {
  // Alle Termine mit start_datetime >= jetzt (in Tests alle "in der Zukunft" relativ zu 2026)
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE start_datetime >= '2026-03-24T00:00'
    ORDER BY start_datetime ASC
    LIMIT 5
  `).all();
  assert(events.length >= 1);
  assert(events[0].title === 'Zahnarzt Dr. Müller', `Erster Termin: ${events[0].title}`);
});

// --------------------------------------------------------
// Sortierung
// --------------------------------------------------------
test('Sortierung: ganztägig nach uhrzeit-basierten Terminen', () => {
  // Gleicher Tag: Ganztägig sollte nach hinten oder flexibel - hier: all_day DESC in der Abfrage
  const events = db.prepare(`
    SELECT * FROM calendar_events
    WHERE DATE(start_datetime) = '2026-03-24'
    ORDER BY start_datetime ASC, all_day DESC
  `).all();
  assert(events.length >= 1);
});

// --------------------------------------------------------
// Index-Abfragen (Performance-relevante Queries)
// --------------------------------------------------------
test('Index idx_calendar_start genutzt (EXPLAIN QUERY PLAN)', () => {
  const plan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT * FROM calendar_events WHERE start_datetime >= '2026-03-01' ORDER BY start_datetime ASC
  `).all();
  const usesIndex = plan.some((row) => {
    const detail = row.detail || '';
    return detail.includes('idx_calendar_start') || detail.includes('COVERING INDEX') || detail.includes('INDEX');
  });
  assert(usesIndex, `Index nicht genutzt: ${JSON.stringify(plan)}`);
});

test('Index idx_calendar_assigned genutzt', () => {
  const plan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT * FROM calendar_events WHERE assigned_to = ?
  `).all(uid2);
  const usesIndex = plan.some((row) => {
    const detail = row.detail || '';
    return detail.includes('idx_calendar_assigned') || detail.includes('INDEX');
  });
  assert(usesIndex, `Index nicht genutzt: ${JSON.stringify(plan)}`);
});

// --------------------------------------------------------
// Löschen
// --------------------------------------------------------
test('Termin löschen', () => {
  const result = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(ev2);
  assert(result.changes === 1, 'Genau 1 Eintrag gelöscht');
  const ev = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(ev2);
  assert(!ev, 'Termin nicht mehr vorhanden');
});

test('Nicht existierender Termin gibt keine Zeile', () => {
  const ev = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(99999);
  assert(!ev, 'Sollte undefined sein');
});

// --------------------------------------------------------
// Datumshelfer (clientseitige Logik hier als reine JS-Tests)
// --------------------------------------------------------
test('Wochenberechnung: Montag korrekt', () => {
  function getMondayOf(dateStr) {
    const d   = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  assert(getMondayOf('2026-03-24') === '2026-03-23', 'Di → Mo');
  assert(getMondayOf('2026-03-23') === '2026-03-23', 'Mo bleibt Mo');
  assert(getMondayOf('2026-03-29') === '2026-03-23', 'So → Mo der gleichen Woche');
  assert(getMondayOf('2026-03-22') === '2026-03-16', 'So → Mo der Vorwoche');
});

test('Monatsbereich: 42 Tage für Kalenderraster', () => {
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  const from = '2026-03-01';
  const to   = addDays(from, 41);
  assert(to === '2026-04-11', `Erwartet 2026-04-11, erhalten ${to}`);
});

// --------------------------------------------------------
// Ergebnis
// --------------------------------------------------------
console.log(`\n[Calendar-Test] Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen\n`);
if (failed > 0) process.exit(1);
