/**
 * Modul: Einkaufslisten-Test
 * Zweck: Validiert alle Shopping-API-Abfragen, Sortierung, Constraints
 * Ausführen: node --experimental-sqlite test-shopping.js
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

const u1 = db.prepare(`INSERT INTO users (username, display_name, password_hash, role)
  VALUES ('admin', 'Admin', 'x', 'admin')`).run();
const uid = u1.lastInsertRowid;

console.log('\n[Shopping-Test] Listen, Artikel, Sortierung\n');

let listId, list2Id, itemId1, itemId2, itemId3;

// --------------------------------------------------------
// Listen-CRUD
// --------------------------------------------------------
test('Liste erstellen', () => {
  const r = db.prepare(`INSERT INTO shopping_lists (name, created_by) VALUES ('REWE', ?)`).run(uid);
  listId = r.lastInsertRowid;
  assert(listId > 0);
});

test('Zweite Liste erstellen', () => {
  const r = db.prepare(`INSERT INTO shopping_lists (name, created_by) VALUES ('dm', ?)`).run(uid);
  list2Id = r.lastInsertRowid;
  assert(list2Id > 0);
});

test('Alle Listen mit Zähler abrufbar', () => {
  const lists = db.prepare(`
    SELECT sl.*,
      COUNT(si.id) AS item_total,
      SUM(CASE WHEN si.is_checked = 1 THEN 1 ELSE 0 END) AS item_checked
    FROM shopping_lists sl
    LEFT JOIN shopping_items si ON si.list_id = sl.id
    GROUP BY sl.id ORDER BY sl.created_at ASC
  `).all();
  assert(lists.length === 2, `Erwartet 2, erhalten ${lists.length}`);
  assert(lists[0].name === 'REWE');
  assert(lists[0].item_total === 0, 'Noch keine Artikel');
});

test('Liste umbenennen', () => {
  db.prepare(`UPDATE shopping_lists SET name = 'REWE Wocheneinkauf' WHERE id = ?`).run(listId);
  const l = db.prepare('SELECT name FROM shopping_lists WHERE id = ?').get(listId);
  assert(l.name === 'REWE Wocheneinkauf', 'Name aktualisiert');
});

// --------------------------------------------------------
// Artikel-CRUD
// --------------------------------------------------------
test('Artikel hinzufügen - Obst & Gemüse', () => {
  const r = db.prepare(`INSERT INTO shopping_items (list_id, name, quantity, category)
    VALUES (?, 'Äpfel', '1 kg', 'Obst & Gemüse')`).run(listId);
  itemId1 = r.lastInsertRowid;
  assert(itemId1 > 0);
});

test('Artikel hinzufügen - Milchprodukte', () => {
  const r = db.prepare(`INSERT INTO shopping_items (list_id, name, quantity, category)
    VALUES (?, 'Milch', '1 Liter', 'Milchprodukte')`).run(listId);
  itemId2 = r.lastInsertRowid;
  assert(itemId2 > 0);
});

test('Artikel hinzufügen - Backwaren', () => {
  const r = db.prepare(`INSERT INTO shopping_items (list_id, name, category)
    VALUES (?, 'Brot', 'Backwaren')`).run(listId);
  itemId3 = r.lastInsertRowid;
  assert(itemId3 > 0);
});

// --------------------------------------------------------
// Supermarkt-Gang-Sortierung
// --------------------------------------------------------
test('Sortierung nach Supermarkt-Gang-Logik', () => {
  const categories = [
    'Obst & Gemüse', 'Backwaren', 'Milchprodukte', 'Fleisch & Fisch',
    'Tiefkühl', 'Getränke', 'Haushalt', 'Drogerie', 'Sonstiges',
  ];
  const caseExpr = categories.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');

  const items = db.prepare(`
    SELECT * FROM shopping_items
    WHERE list_id = ?
    ORDER BY CASE category ${caseExpr} ELSE 9 END, is_checked ASC, created_at ASC
  `).all(listId);

  assert(items.length === 3, `Erwartet 3, erhalten ${items.length}`);
  assert(items[0].category === 'Obst & Gemüse', `Erste Kategorie: ${items[0].category}`);
  assert(items[1].category === 'Backwaren',     `Zweite Kategorie: ${items[1].category}`);
  assert(items[2].category === 'Milchprodukte', `Dritte Kategorie: ${items[2].category}`);
});

test('Abgehakte Artikel ans Ende innerhalb der Kategorie', () => {
  // Zweiten Artikel in Obst einfügen
  db.prepare(`INSERT INTO shopping_items (list_id, name, category, is_checked)
    VALUES (?, 'Bananen', 'Obst & Gemüse', 1)`).run(listId);

  const categories = [
    'Obst & Gemüse', 'Backwaren', 'Milchprodukte', 'Fleisch & Fisch',
    'Tiefkühl', 'Getränke', 'Haushalt', 'Drogerie', 'Sonstiges',
  ];
  const caseExpr = categories.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');

  const items = db.prepare(`
    SELECT * FROM shopping_items WHERE list_id = ?
    ORDER BY CASE category ${caseExpr} ELSE 9 END, is_checked ASC, created_at ASC
  `).all(listId);

  const obst = items.filter((i) => i.category === 'Obst & Gemüse');
  assert(obst[0].name === 'Äpfel',   'Nicht abgehakt zuerst');
  assert(obst[1].name === 'Bananen', 'Abgehakt danach');
  assert(obst[1].is_checked === 1,   'Bananen ist abgehakt');
});

// --------------------------------------------------------
// Artikel abhaken
// --------------------------------------------------------
test('Artikel abhaken (toggle)', () => {
  db.prepare(`UPDATE shopping_items SET is_checked = 1 WHERE id = ?`).run(itemId1);
  const item = db.prepare('SELECT is_checked FROM shopping_items WHERE id = ?').get(itemId1);
  assert(item.is_checked === 1, 'Artikel abgehakt');
});

test('Artikel wieder aktivieren', () => {
  db.prepare(`UPDATE shopping_items SET is_checked = 0 WHERE id = ?`).run(itemId1);
  const item = db.prepare('SELECT is_checked FROM shopping_items WHERE id = ?').get(itemId1);
  assert(item.is_checked === 0, 'Artikel wieder aktiv');
});

// --------------------------------------------------------
// Abgehakte löschen
// --------------------------------------------------------
test('"Abgehakte löschen" entfernt nur is_checked=1', () => {
  db.prepare(`UPDATE shopping_items SET is_checked = 1 WHERE id IN (?, ?)`).run(itemId1, itemId2);

  // Äpfel (itemId1) + Milch (itemId2) + Bananen (bereits checked aus vorherigem Test) = 3
  const result = db.prepare(`DELETE FROM shopping_items WHERE list_id = ? AND is_checked = 1`).run(listId);
  assert(result.changes === 3, `Gelöscht: ${result.changes}, erwartet: 3`);

  const remaining = db.prepare(`SELECT * FROM shopping_items WHERE list_id = ?`).all(listId);
  assert(remaining.every((i) => i.is_checked === 0), 'Nur nicht-abgehakte verbleiben');
  assert(remaining.length === 1, `Verbleibend: ${remaining.length} (nur Brot)`);
});

// --------------------------------------------------------
// Autocomplete
// --------------------------------------------------------
test('Autocomplete-Suggestions nach Prefix', () => {
  db.prepare(`INSERT INTO shopping_items (list_id, name, category) VALUES (?, 'Joghurt', 'Milchprodukte')`).run(listId);
  db.prepare(`INSERT INTO shopping_items (list_id, name, category) VALUES (?, 'Käse', 'Milchprodukte')`).run(listId);

  const results = db.prepare(`
    SELECT DISTINCT name FROM shopping_items
    WHERE name LIKE ? COLLATE NOCASE
    ORDER BY name ASC LIMIT 8
  `).all('J%');

  assert(results.length >= 1, 'Mindestens 1 Vorschlag');
  assert(results[0].name === 'Joghurt', `Erwartet Joghurt, erhalten: ${results[0].name}`);
});

test('Autocomplete - kein Match gibt leeres Array', () => {
  const results = db.prepare(`
    SELECT DISTINCT name FROM shopping_items WHERE name LIKE ? COLLATE NOCASE
  `).all('XXXXXXXX%');
  assert(results.length === 0, 'Kein Match erwartet');
});

// --------------------------------------------------------
// Zähler-Abfrage
// --------------------------------------------------------
test('Listen-Zähler korrekt nach Änderungen', () => {
  const list = db.prepare(`
    SELECT sl.*,
      COUNT(si.id) AS item_total,
      SUM(CASE WHEN si.is_checked = 1 THEN 1 ELSE 0 END) AS item_checked
    FROM shopping_lists sl
    LEFT JOIN shopping_items si ON si.list_id = sl.id
    WHERE sl.id = ?
    GROUP BY sl.id
  `).get(listId);
  assert(list.item_total > 0, `item_total=${list.item_total}`);
  assert(list.item_checked === 0, 'Keine abgehakten mehr');
});

// --------------------------------------------------------
// Cascade-Löschung
// --------------------------------------------------------
test('Liste löschen entfernt alle Artikel (CASCADE)', () => {
  db.prepare('DELETE FROM shopping_lists WHERE id = ?').run(list2Id);
  const items = db.prepare('SELECT * FROM shopping_items WHERE list_id = ?').all(list2Id);
  assert(items.length === 0, 'Keine Artikel nach Listen-Löschung');
});

test('Nicht existierende Liste gibt keine Zeile', () => {
  const list = db.prepare('SELECT * FROM shopping_lists WHERE id = ?').get(99999);
  assert(!list, 'Sollte undefined sein');
});

// --------------------------------------------------------
// Ergebnis
// --------------------------------------------------------
console.log(`\n[Shopping-Test] Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen\n`);
if (failed > 0) process.exit(1);
