/**
 * Modul: Essensplan (Meals)
 * Zweck: REST-API-Routen für Mahlzeiten, Zutaten und Einkaufslisten-Integration
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, oneOf, date, collectErrors, MAX_TITLE, MAX_TEXT, MAX_SHORT, DATE_RE } from '../middleware/validate.js';

const log = createLogger('Meals');

const router  = express.Router();

const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

/**
 * Gibt den ISO-Datumstring (YYYY-MM-DD) für den Montag einer Woche zurück.
 * @param {string} dateStr - beliebiges Datum der Woche (YYYY-MM-DD)
 */
function weekStart(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();          // 0 = So, 1 = Mo, …
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Gibt den ISO-Datumstring für den Sonntag einer Woche zurück.
 */
function weekEnd(dateStr) {
  const start = weekStart(dateStr);
  const d     = new Date(start + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// --------------------------------------------------------
// Routen - Mahlzeiten-Vorschläge (vor dynamischen Routen!)
// --------------------------------------------------------

/**
 * GET /api/v1/meals/suggestions
 * Autocomplete für Mahlzeit-Titel aus der Historie.
 * Query: ?q=<string>
 * Response: { data: [{ title, meal_type }] }
 */
router.get('/suggestions', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ data: [] });

    const rows = db.get().prepare(`
      SELECT DISTINCT title, meal_type
      FROM meals
      WHERE title LIKE ? COLLATE NOCASE
      ORDER BY title ASC
      LIMIT 10
    `).all(`${q}%`);

    res.json({ data: rows });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// Routen - Wochenübersicht
// --------------------------------------------------------

/**
 * GET /api/v1/meals
 * Alle Mahlzeiten einer Woche inkl. Zutaten.
 * Query: ?week=YYYY-MM-DD  (beliebiges Datum der gewünschten Woche; default: aktuelle Woche)
 * Response: { data: Meal[], weekStart: string, weekEnd: string }
 *
 * Meal: { id, date, meal_type, title, notes, created_by, ingredients: Ingredient[] }
 * Ingredient: { id, meal_id, name, quantity, on_shopping_list }
 */
router.get('/', (req, res) => {
  try {
    const refDate = req.query.week && DATE_RE.test(req.query.week)
      ? req.query.week
      : new Date().toISOString().slice(0, 10);

    const from = weekStart(refDate);
    const to   = weekEnd(refDate);

    const meals = db.get().prepare(`
      SELECT m.*, u.display_name AS creator_name, u.avatar_color AS creator_color
      FROM meals m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.date BETWEEN ? AND ?
      ORDER BY m.date ASC,
        CASE m.meal_type
          WHEN 'breakfast' THEN 0
          WHEN 'lunch'     THEN 1
          WHEN 'dinner'    THEN 2
          WHEN 'snack'     THEN 3
          ELSE 4
        END ASC
    `).all(from, to);

    // Zutaten für alle Mahlzeiten in einer Abfrage holen
    const mealIds = meals.map((m) => m.id);
    let ingredientMap = {};

    if (mealIds.length > 0) {
      const placeholders = mealIds.map(() => '?').join(',');
      const ingredients  = db.get().prepare(`
        SELECT * FROM meal_ingredients
        WHERE meal_id IN (${placeholders})
        ORDER BY id ASC
      `).all(...mealIds);

      for (const ing of ingredients) {
        if (!ingredientMap[ing.meal_id]) ingredientMap[ing.meal_id] = [];
        ingredientMap[ing.meal_id].push(ing);
      }
    }

    const result = meals.map((m) => ({
      ...m,
      ingredients: ingredientMap[m.id] || [],
    }));

    res.json({ data: result, weekStart: from, weekEnd: to });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// CRUD - Mahlzeiten
// --------------------------------------------------------

/**
 * POST /api/v1/meals
 * Neue Mahlzeit anlegen.
 * Body: { date, meal_type, title, notes?, ingredients?: [{ name, quantity? }] }
 * Response: { data: Meal }
 */
router.post('/', (req, res) => {
  try {
    const { ingredients = [] } = req.body;
    const vDate       = date(req.body.date, 'Datum', true);
    const vType       = oneOf(req.body.meal_type, VALID_MEAL_TYPES, 'Mahlzeit-Typ');
    const vTitle      = str(req.body.title, 'Titel', { max: MAX_TITLE });
    const vNotes      = str(req.body.notes, 'Notizen', { max: MAX_TEXT, required: false });
    const vRecipeUrl  = str(req.body.recipe_url, 'Rezept-URL', { max: MAX_TEXT, required: false });
    const errors = collectErrors([vDate, vType, vTitle, vNotes, vRecipeUrl]);
    if (!req.body.meal_type) errors.push('Mahlzeit-Typ ist erforderlich.');
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const recipeId = req.body.recipe_id != null ? parseInt(req.body.recipe_id, 10) : null;
    if (recipeId !== null && (!Number.isInteger(recipeId) || recipeId <= 0)) {
      return res.status(400).json({ error: 'recipe_id: ongeldig ID.', code: 400 });
    }
    if (recipeId !== null) {
      const exists = db.get().prepare('SELECT id FROM recipes WHERE id = ?').get(recipeId);
      if (!exists) return res.status(400).json({ error: 'recipe_id: recept niet gevonden.', code: 400 });
    }

    const meal = db.transaction(() => {
      const result = db.get().prepare(`
        INSERT INTO meals (date, meal_type, title, notes, recipe_url, recipe_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(vDate.value, vType.value, vTitle.value, vNotes.value, vRecipeUrl.value, recipeId, req.session.userId);

      const mealId = result.lastInsertRowid;

      const insertIng = db.get().prepare(`
        INSERT INTO meal_ingredients (meal_id, name, quantity) VALUES (?, ?, ?)
      `);

      for (const ing of ingredients) {
        const name = String(ing.name || '').trim().slice(0, MAX_TITLE);
        const qty  = String(ing.quantity || '').trim().slice(0, MAX_SHORT) || null;
        if (name) insertIng.run(mealId, name, qty);
      }

      return db.get().prepare(`
        SELECT m.*, u.display_name AS creator_name, u.avatar_color AS creator_color
        FROM meals m
        LEFT JOIN users u ON u.id = m.created_by
        WHERE m.id = ?
      `).get(mealId);
    });

    // Zutaten anhängen
    const ings = db.get().prepare(
      'SELECT * FROM meal_ingredients WHERE meal_id = ? ORDER BY id ASC'
    ).all(meal.id);

    res.status(201).json({ data: { ...meal, ingredients: ings } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * PUT /api/v1/meals/:id
 * Mahlzeit bearbeiten (Titel, Notizen, Datum, Typ).
 * Body: { date?, meal_type?, title?, notes? }
 * Response: { data: Meal }
 */
router.put('/:id', (req, res) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const meal = db.get().prepare('SELECT * FROM meals WHERE id = ?').get(id);
    if (!meal) return res.status(404).json({ error: 'Mahlzeit nicht gefunden', code: 404 });

    const checks = [];
    if (req.body.date       !== undefined) checks.push(date(req.body.date, 'Datum'));
    if (req.body.meal_type  !== undefined) checks.push(oneOf(req.body.meal_type, VALID_MEAL_TYPES, 'Mahlzeit-Typ'));
    if (req.body.title      !== undefined) checks.push(str(req.body.title, 'Titel', { max: MAX_TITLE, required: false }));
    if (req.body.notes      !== undefined) checks.push(str(req.body.notes, 'Notizen', { max: MAX_TEXT, required: false }));
    if (req.body.recipe_url !== undefined) checks.push(str(req.body.recipe_url, 'Rezept-URL', { max: MAX_TEXT, required: false }));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const newRecipeId = req.body.recipe_id !== undefined
      ? (req.body.recipe_id != null ? parseInt(req.body.recipe_id, 10) : null)
      : undefined;

    db.get().prepare(`
      UPDATE meals
      SET date       = COALESCE(?, date),
          meal_type  = COALESCE(?, meal_type),
          title      = COALESCE(?, title),
          notes      = ?,
          recipe_url = ?,
          recipe_id  = ?
      WHERE id = ?
    `).run(
      req.body.date      ?? null,
      req.body.meal_type ?? null,
      req.body.title?.trim() ?? null,
      req.body.notes       !== undefined ? (req.body.notes || null)       : meal.notes,
      req.body.recipe_url  !== undefined ? (req.body.recipe_url || null)  : meal.recipe_url,
      newRecipeId !== undefined ? newRecipeId : meal.recipe_id,
      id
    );

    const updated = db.get().prepare(`
      SELECT m.*, u.display_name AS creator_name, u.avatar_color AS creator_color
      FROM meals m LEFT JOIN users u ON u.id = m.created_by
      WHERE m.id = ?
    `).get(id);

    const ings = db.get().prepare(
      'SELECT * FROM meal_ingredients WHERE meal_id = ? ORDER BY id ASC'
    ).all(id);

    res.json({ data: { ...updated, ingredients: ings } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * DELETE /api/v1/meals/:id
 * Mahlzeit löschen (Zutaten werden per CASCADE mitgelöscht).
 * Response: 204 No Content
 */
router.delete('/:id', (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const result = db.get().prepare('DELETE FROM meals WHERE id = ?').run(id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Mahlzeit nicht gefunden', code: 404 });
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// CRUD - Zutaten
// --------------------------------------------------------

/**
 * POST /api/v1/meals/:id/ingredients
 * Zutat zur Mahlzeit hinzufügen.
 * Body: { name, quantity? }
 * Response: { data: Ingredient }
 */
router.post('/:id/ingredients', (req, res) => {
  try {
    const mealId = parseInt(req.params.id, 10);
    const meal   = db.get().prepare('SELECT id FROM meals WHERE id = ?').get(mealId);
    if (!meal) return res.status(404).json({ error: 'Mahlzeit nicht gefunden', code: 404 });

    const { name, quantity = null } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ error: 'Name ist erforderlich', code: 400 });

    const result = db.get().prepare(`
      INSERT INTO meal_ingredients (meal_id, name, quantity) VALUES (?, ?, ?)
    `).run(mealId, name.trim(), quantity?.trim() || null);

    const ing = db.get().prepare(
      'SELECT * FROM meal_ingredients WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.status(201).json({ data: ing });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * PATCH /api/v1/meals/ingredients/:ingId
 * Zutat bearbeiten (Name, Menge, on_shopping_list-Flag).
 * Body: { name?, quantity?, on_shopping_list? }
 * Response: { data: Ingredient }
 */
router.patch('/ingredients/:ingId', (req, res) => {
  try {
    const ingId = parseInt(req.params.ingId, 10);
    const ing   = db.get().prepare('SELECT * FROM meal_ingredients WHERE id = ?').get(ingId);
    if (!ing) return res.status(404).json({ error: 'Zutat nicht gefunden', code: 404 });

    const { name, quantity, on_shopping_list } = req.body;

    db.get().prepare(`
      UPDATE meal_ingredients
      SET name             = COALESCE(?, name),
          quantity         = ?,
          on_shopping_list = COALESCE(?, on_shopping_list)
      WHERE id = ?
    `).run(
      name?.trim() ?? null,
      quantity !== undefined ? (quantity?.trim() || null) : ing.quantity,
      on_shopping_list !== undefined ? (on_shopping_list ? 1 : 0) : null,
      ingId
    );

    const updated = db.get().prepare(
      'SELECT * FROM meal_ingredients WHERE id = ?'
    ).get(ingId);

    res.json({ data: updated });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * DELETE /api/v1/meals/ingredients/:ingId
 * Zutat löschen.
 * Response: 204 No Content
 */
router.delete('/ingredients/:ingId', (req, res) => {
  try {
    const ingId  = parseInt(req.params.ingId, 10);
    const result = db.get().prepare('DELETE FROM meal_ingredients WHERE id = ?').run(ingId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Zutat nicht gefunden', code: 404 });
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// Integration: Zutaten → Einkaufsliste (Phase 2, Schritt 12)
// --------------------------------------------------------

/**
 * POST /api/v1/meals/:id/to-shopping-list
 * Alle noch nicht übertragenen Zutaten einer Mahlzeit auf eine Einkaufsliste übernehmen.
 * Body: { listId: number, category?: string }
 * Response: { data: { transferred: number } }
 */
router.post('/:id/to-shopping-list', (req, res) => {
  try {
    const mealId = parseInt(req.params.id, 10);
    const meal   = db.get().prepare('SELECT id FROM meals WHERE id = ?').get(mealId);
    if (!meal) return res.status(404).json({ error: 'Mahlzeit nicht gefunden', code: 404 });

    const { listId, category = 'Sonstiges' } = req.body;
    if (!listId)
      return res.status(400).json({ error: 'listId ist erforderlich', code: 400 });

    const list = db.get().prepare('SELECT id FROM shopping_lists WHERE id = ?').get(listId);
    if (!list) return res.status(404).json({ error: 'Einkaufsliste nicht gefunden', code: 404 });

    const ingredients = db.get().prepare(`
      SELECT * FROM meal_ingredients
      WHERE meal_id = ? AND on_shopping_list = 0
    `).all(mealId);

    if (ingredients.length === 0)
      return res.json({ data: { transferred: 0 } });

    const transferred = db.transaction(() => {
      const insertItem = db.get().prepare(`
        INSERT INTO shopping_items (list_id, name, quantity, category, added_from_meal)
        VALUES (?, ?, ?, ?, ?)
      `);
      const markDone = db.get().prepare(`
        UPDATE meal_ingredients SET on_shopping_list = 1 WHERE id = ?
      `);

      let count = 0;
      for (const ing of ingredients) {
        insertItem.run(listId, ing.name, ing.quantity, category, mealId);
        markDone.run(ing.id);
        count++;
      }
      return count;
    });

    res.json({ data: { transferred } });
  } catch (err) {
    log.error('POST /:id/to-shopping-list', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/meals/week-to-shopping-list
 * Alle noch nicht übertragenen Zutaten einer ganzen Woche auf eine Einkaufsliste übernehmen.
 * Body: { listId, week: YYYY-MM-DD, category? }
 * Response: { data: { transferred: number } }
 */
router.post('/week-to-shopping-list', (req, res) => {
  try {
    const { listId, week, category = 'Sonstiges' } = req.body;

    if (!listId)
      return res.status(400).json({ error: 'listId ist erforderlich', code: 400 });
    if (!week || !DATE_RE.test(week))
      return res.status(400).json({ error: 'Gültiges Datum (YYYY-MM-DD) erforderlich', code: 400 });

    const list = db.get().prepare('SELECT id FROM shopping_lists WHERE id = ?').get(listId);
    if (!list) return res.status(404).json({ error: 'Einkaufsliste nicht gefunden', code: 404 });

    const from = weekStart(week);
    const to   = weekEnd(week);

    const ingredients = db.get().prepare(`
      SELECT mi.* FROM meal_ingredients mi
      JOIN meals m ON m.id = mi.meal_id
      WHERE m.date BETWEEN ? AND ?
        AND mi.on_shopping_list = 0
    `).all(from, to);

    if (ingredients.length === 0)
      return res.json({ data: { transferred: 0 } });

    const transferred = db.transaction(() => {
      const insertItem = db.get().prepare(`
        INSERT INTO shopping_items (list_id, name, quantity, category, added_from_meal)
        VALUES (?, ?, ?, ?, ?)
      `);
      const markDone = db.get().prepare(`
        UPDATE meal_ingredients SET on_shopping_list = 1 WHERE id = ?
      `);

      let count = 0;
      for (const ing of ingredients) {
        insertItem.run(listId, ing.name, ing.quantity, category, ing.meal_id);
        markDone.run(ing.id);
        count++;
      }
      return count;
    });

    res.json({ data: { transferred } });
  } catch (err) {
    log.error('POST /week-to-shopping-list', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/meals/:id/to-shopping
 * Voegt ingrediënten van het gekoppelde recept toe aan een boodschappenlijst.
 * Body: { list_id: number, servings: number }
 * Response: { ok: true, added: number, merged: number }
 */
router.post('/:id/to-shopping', (req, res) => {
  try {
    const mealId = parseInt(req.params.id, 10);
    const meal   = db.get().prepare('SELECT * FROM meals WHERE id = ?').get(mealId);
    if (!meal) return res.status(404).json({ error: 'Maaltijd niet gevonden.', code: 404 });
    if (!meal.recipe_id) return res.status(400).json({ error: 'Deze maaltijd heeft geen gekoppeld recept.', code: 400 });

    const listId   = parseInt(req.body.list_id, 10);
    const servings = parseInt(req.body.servings, 10);
    if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: 'list_id is vereist.', code: 400 });
    if (!Number.isInteger(servings) || servings < 1) return res.status(400).json({ error: 'servings moet ≥ 1 zijn.', code: 400 });

    const list = db.get().prepare('SELECT id FROM shopping_lists WHERE id = ?').get(listId);
    if (!list) return res.status(404).json({ error: 'Boodschappenlijst niet gevonden.', code: 404 });

    const recipe = db.get().prepare('SELECT * FROM recipes WHERE id = ?').get(meal.recipe_id);
    if (!recipe) return res.status(404).json({ error: 'Recept niet gevonden.', code: 404 });

    const recipeServings = recipe.servings || 4;
    const scale = servings / recipeServings;

    const ingredients = db.get().prepare(
      `SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order ASC`
    ).all(meal.recipe_id);

    let added = 0;
    let merged = 0;

    for (const ing of ingredients) {
      const normalizedName = ing.name.toLowerCase().trim();
      const scaledQty      = ing.quantity != null ? Math.round(ing.quantity * scale * 10) / 10 : null;

      const existing = db.get().prepare(`
        SELECT * FROM shopping_items
        WHERE list_id = ? AND LOWER(TRIM(name)) = ? AND is_checked = 0
        LIMIT 1
      `).get(listId, normalizedName);

      if (existing && scaledQty != null) {
        const existingUnit = existing.quantity ? String(existing.quantity).replace(/[\d.,\s]/g, '').trim().toLowerCase() : null;
        const newUnit      = ing.unit ? ing.unit.toLowerCase() : null;

        if (existingUnit === newUnit || (!existingUnit && !newUnit)) {
          const existingQtyNum = parseFloat(String(existing.quantity)) || 0;
          const newQty         = existingQtyNum + scaledQty;
          const qtyStr         = newUnit ? `${newQty} ${newUnit}` : String(newQty);
          db.get().prepare(`UPDATE shopping_items SET quantity = ? WHERE id = ?`).run(qtyStr, existing.id);
          merged++;
          continue;
        }
      }

      const qtyStr = scaledQty != null ? (ing.unit ? `${scaledQty} ${ing.unit}` : String(scaledQty)) : null;
      db.get().prepare(`
        INSERT INTO shopping_items (list_id, name, quantity, category) VALUES (?, ?, ?, ?)
      `).run(listId, ing.name, qtyStr, 'Sonstiges');
      added++;
    }

    res.json({ ok: true, added, merged });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

export default router;
