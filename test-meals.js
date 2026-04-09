/**
 * Modul: Essensplan-Test
 * Zweck: Validiert alle Meals-API-Abfragen, Zutaten-CRUD, Wochensortierung,
 *        Einkaufslisten-Integration
 * Ausführen: node --experimental-sqlite test-meals.js
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

// Test-Benutzer
const u1 = db.prepare(`INSERT INTO users (username, display_name, password_hash, role)
  VALUES ('admin', 'Admin', 'x', 'admin')`).run();
const uid = u1.lastInsertRowid;

// Einkaufsliste für Integration-Tests
const sl = db.prepare(`INSERT INTO shopping_lists (name, created_by) VALUES ('REWE', ?)`).run(uid);
const listId = sl.lastInsertRowid;

console.log('\n[Meals-Test] Wochenplan, Zutaten, Einkaufslisten-Integration\n');

let mealId1, mealId2, mealId3, ingId1, ingId2;

// --------------------------------------------------------
// Mahlzeit CRUD
// --------------------------------------------------------
test('Mahlzeit erstellen (Mittagessen)', () => {
  const r = db.prepare(`
    INSERT INTO meals (date, meal_type, title, notes, created_by)
    VALUES ('2026-03-23', 'lunch', 'Spaghetti Bolognese', 'Klassiker', ?)
  `).run(uid);
  mealId1 = r.lastInsertRowid;
  assert(mealId1 > 0);
});

test('Mahlzeit erstellen (Frühstück)', () => {
  const r = db.prepare(`
    INSERT INTO meals (date, meal_type, title, created_by)
    VALUES ('2026-03-23', 'breakfast', 'Müsli mit Früchten', ?)
  `).run(uid);
  mealId2 = r.lastInsertRowid;
  assert(mealId2 > 0);
});

test('Mahlzeit erstellen (andere Woche)', () => {
  const r = db.prepare(`
    INSERT INTO meals (date, meal_type, title, created_by)
    VALUES ('2026-03-30', 'dinner', 'Pizza Margherita', ?)
  `).run(uid);
  mealId3 = r.lastInsertRowid;
  assert(mealId3 > 0);
});

test('Mahlzeiten einer Woche abrufen', () => {
  const meals = db.prepare(`
    SELECT * FROM meals
    WHERE date BETWEEN '2026-03-23' AND '2026-03-29'
    ORDER BY date ASC,
      CASE meal_type
        WHEN 'breakfast' THEN 0
        WHEN 'lunch'     THEN 1
        WHEN 'dinner'    THEN 2
        WHEN 'snack'     THEN 3
        ELSE 4
      END ASC
  `).all();
  assert(meals.length === 2, `Erwartet 2, erhalten ${meals.length}`);
  assert(meals[0].meal_type === 'breakfast', 'Frühstück zuerst');
  assert(meals[1].meal_type === 'lunch', 'Mittagessen danach');
});

test('Andere Woche hat nur eigene Mahlzeiten', () => {
  const meals = db.prepare(`
    SELECT * FROM meals WHERE date BETWEEN '2026-03-30' AND '2026-04-05'
  `).all();
  assert(meals.length === 1, `Erwartet 1, erhalten ${meals.length}`);
  assert(meals[0].title === 'Pizza Margherita');
});

test('Mahlzeit aktualisieren', () => {
  db.prepare(`UPDATE meals SET title = 'Spaghetti Carbonara', notes = NULL WHERE id = ?`).run(mealId1);
  const m = db.prepare('SELECT title, notes FROM meals WHERE id = ?').get(mealId1);
  assert(m.title === 'Spaghetti Carbonara', 'Titel aktualisiert');
  assert(m.notes === null, 'Notizen gelöscht');
});

test('Mahlzeit-Typ-Constraint (ungültiger Wert)', () => {
  let threw = false;
  try {
    db.prepare(`INSERT INTO meals (date, meal_type, title, created_by) VALUES ('2026-03-24', 'brunch', 'Test', ?)`).run(uid);
  } catch { threw = true; }
  assert(threw, 'Constraint muss verletzt werden');
});

// --------------------------------------------------------
// Zutaten CRUD
// --------------------------------------------------------
test('Zutat hinzufügen', () => {
  const r = db.prepare(`
    INSERT INTO meal_ingredients (meal_id, name, quantity)
    VALUES (?, 'Hackfleisch', '500g')
  `).run(mealId1);
  ingId1 = r.lastInsertRowid;
  assert(ingId1 > 0);
});

test('Zweite Zutat hinzufügen', () => {
  const r = db.prepare(`
    INSERT INTO meal_ingredients (meal_id, name, quantity)
    VALUES (?, 'Spaghetti', '400g')
  `).run(mealId1);
  ingId2 = r.lastInsertRowid;
  assert(ingId2 > 0);
});

test('Zutaten einer Mahlzeit abrufen', () => {
  const ings = db.prepare(`
    SELECT * FROM meal_ingredients WHERE meal_id = ? ORDER BY id ASC
  `).all(mealId1);
  assert(ings.length === 2, `Erwartet 2, erhalten ${ings.length}`);
  assert(ings[0].name === 'Hackfleisch');
  assert(ings[1].name === 'Spaghetti');
});

test('Zutat aktualisieren (Menge ändern)', () => {
  db.prepare(`UPDATE meal_ingredients SET quantity = '600g' WHERE id = ?`).run(ingId1);
  const ing = db.prepare('SELECT quantity FROM meal_ingredients WHERE id = ?').get(ingId1);
  assert(ing.quantity === '600g', 'Menge aktualisiert');
});

test('on_shopping_list-Flag setzen', () => {
  db.prepare(`UPDATE meal_ingredients SET on_shopping_list = 1 WHERE id = ?`).run(ingId1);
  const ing = db.prepare('SELECT on_shopping_list FROM meal_ingredients WHERE id = ?').get(ingId1);
  assert(ing.on_shopping_list === 1, 'Flag gesetzt');
});

test('Nur offene Zutaten haben on_shopping_list = 0', () => {
  const open = db.prepare(`
    SELECT * FROM meal_ingredients WHERE meal_id = ? AND on_shopping_list = 0
  `).all(mealId1);
  assert(open.length === 1, `Erwartet 1 offene Zutat, erhalten ${open.length}`);
  assert(open[0].name === 'Spaghetti');
});

test('Zutat löschen', () => {
  db.prepare('DELETE FROM meal_ingredients WHERE id = ?').run(ingId2);
  const remaining = db.prepare('SELECT * FROM meal_ingredients WHERE meal_id = ?').all(mealId1);
  assert(remaining.length === 1, 'Nur noch eine Zutat');
});

// --------------------------------------------------------
// Cascade-Verhalten
// --------------------------------------------------------
test('Mahlzeit löschen entfernt Zutaten (CASCADE)', () => {
  // Neue Mahlzeit mit Zutat
  const m = db.prepare(`
    INSERT INTO meals (date, meal_type, title, created_by)
    VALUES ('2026-03-25', 'snack', 'Apfel', ?)
  `).run(uid);
  db.prepare(`INSERT INTO meal_ingredients (meal_id, name) VALUES (?, 'Apfel')`).run(m.lastInsertRowid);

  db.prepare('DELETE FROM meals WHERE id = ?').run(m.lastInsertRowid);
  const ings = db.prepare('SELECT * FROM meal_ingredients WHERE meal_id = ?').all(m.lastInsertRowid);
  assert(ings.length === 0, 'Zutaten nach Mahlzeit-Löschung entfernt');
});

// --------------------------------------------------------
// Einkaufslisten-Integration
// --------------------------------------------------------
test('Offene Zutaten einer Woche abfragen', () => {
  // Mahlzeit für Integration-Test anlegen
  const m = db.prepare(`
    INSERT INTO meals (date, meal_type, title, created_by)
    VALUES ('2026-03-24', 'dinner', 'Risotto', ?)
  `).run(uid);
  const mid = m.lastInsertRowid;

  db.prepare(`INSERT INTO meal_ingredients (meal_id, name, quantity) VALUES (?, 'Reis', '300g')`).run(mid);
  db.prepare(`INSERT INTO meal_ingredients (meal_id, name, quantity) VALUES (?, 'Parmesan', '100g')`).run(mid);

  const open = db.prepare(`
    SELECT mi.* FROM meal_ingredients mi
    JOIN meals mo ON mo.id = mi.meal_id
    WHERE mo.date BETWEEN '2026-03-23' AND '2026-03-29'
      AND mi.on_shopping_list = 0
  `).all();
  // Spaghetti (ingId1 wurde gelöscht), Hackfleisch (on_shopping_list=1 gesetzt), Reis, Parmesan
  assert(open.length >= 2, `Mindestens 2 offene Zutaten, erhalten ${open.length}`);
});

test('Zutaten → Einkaufsliste übertragen (INSERT + Flag setzen)', () => {
  // Frische Mahlzeit mit 2 Zutaten
  const m = db.prepare(`
    INSERT INTO meals (date, meal_type, title, created_by)
    VALUES ('2026-03-24', 'lunch', 'Suppe', ?)
  `).run(uid);
  const mid = m.lastInsertRowid;

  const i1 = db.prepare(`INSERT INTO meal_ingredients (meal_id, name, quantity) VALUES (?, 'Karotten', '3 Stück')`).run(mid).lastInsertRowid;
  const i2 = db.prepare(`INSERT INTO meal_ingredients (meal_id, name) VALUES (?, 'Zwiebeln')`).run(mid).lastInsertRowid;

  // Transfer-Logik aus server/routes/meals.js simulieren
  const ingredients = db.prepare(`
    SELECT * FROM meal_ingredients WHERE meal_id = ? AND on_shopping_list = 0
  `).all(mid);

  assert(ingredients.length === 2, `Erwartet 2, erhalten ${ingredients.length}`);

  const insertItem = db.prepare(`
    INSERT INTO shopping_items (list_id, name, quantity, category, added_from_meal)
    VALUES (?, ?, ?, 'Sonstiges', ?)
  `);
  const markDone = db.prepare(`UPDATE meal_ingredients SET on_shopping_list = 1 WHERE id = ?`);

  for (const ing of ingredients) {
    insertItem.run(listId, ing.name, ing.quantity, mid);
    markDone.run(ing.id);
  }

  // Prüfen: Artikel in Einkaufsliste
  const items = db.prepare(`
    SELECT * FROM shopping_items WHERE added_from_meal = ?
  `).all(mid);
  assert(items.length === 2, `Erwartet 2 Einkaufsartikel, erhalten ${items.length}`);
  assert(items[0].name === 'Karotten', `Erster Artikel: ${items[0].name}`);

  // Prüfen: Flags gesetzt
  const stillOpen = db.prepare(`
    SELECT * FROM meal_ingredients WHERE meal_id = ? AND on_shopping_list = 0
  `).all(mid);
  assert(stillOpen.length === 0, 'Alle Zutaten als übertragen markiert');
});

test('Zweiter Transfer überträgt nichts (alle bereits markiert)', () => {
  // Mahlzeit aus vorherigem Test - alle on_shopping_list = 1
  const suppe = db.prepare(`SELECT id FROM meals WHERE title = 'Suppe'`).get();
  const open = db.prepare(`
    SELECT * FROM meal_ingredients WHERE meal_id = ? AND on_shopping_list = 0
  `).all(suppe.id);
  assert(open.length === 0, 'Keine offenen Zutaten mehr');
});

test('added_from_meal FK auf meals(id) gesetzt', () => {
  const items = db.prepare(`
    SELECT si.*, m.title AS meal_title
    FROM shopping_items si
    JOIN meals m ON m.id = si.added_from_meal
    WHERE si.added_from_meal IS NOT NULL
    LIMIT 5
  `).all();
  assert(items.length > 0, 'Mindestens ein Artikel mit Mahlzeit-Referenz');
  assert(items[0].meal_title, 'meal_title verknüpft');
});

// --------------------------------------------------------
// Autocomplete-Simulation
// --------------------------------------------------------
test('Mahlzeit-Autocomplete nach Prefix', () => {
  const results = db.prepare(`
    SELECT DISTINCT title, meal_type FROM meals
    WHERE title LIKE ? COLLATE NOCASE
    ORDER BY title ASC LIMIT 10
  `).all('S%');
  assert(results.length >= 1, `Mindestens 1 Treffer, erhalten ${results.length}`);
  const titles = results.map((r) => r.title);
  assert(titles.some((t) => t.startsWith('S') || t.startsWith('s')), 'Treffer beginnt mit S');
});

test('Autocomplete ohne Treffer gibt leeres Array', () => {
  const results = db.prepare(`
    SELECT DISTINCT title FROM meals WHERE title LIKE ? COLLATE NOCASE
  `).all('XXXXXXXXXXX%');
  assert(results.length === 0, 'Leeres Ergebnis erwartet');
});

// --------------------------------------------------------
// Wochenhelfer-Logik (ohne Server)
// --------------------------------------------------------
test('Wochenberechnung: Montag der aktuellen Woche', () => {
  // 2026-03-24 ist ein Dienstag → Montag ist 2026-03-23
  function getMondayOf(dateStr) {
    const d   = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day);
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  assert(getMondayOf('2026-03-24') === '2026-03-23', 'Montag korrekt berechnet');
  assert(getMondayOf('2026-03-23') === '2026-03-23', 'Montag bleibt Montag');
  assert(getMondayOf('2026-03-29') === '2026-03-23', 'Sonntag → gleicher Montag');
  assert(getMondayOf('2026-03-30') === '2026-03-30', 'Nächster Montag');
});

// --------------------------------------------------------
// Ergebnis
// --------------------------------------------------------
console.log(`\n[Meals-Test] Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen\n`);
if (failed > 0) process.exit(1);
