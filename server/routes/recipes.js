/**
 * Modul: Recepten (Recipes)
 * Zweck: REST-API voor de receptenbibliotheek
 * Afhankelijkheden: express, server/db.js, multer upload middleware, recipe-scraper service
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, collectErrors, MAX_TITLE, MAX_TEXT } from '../middleware/validate.js';
import { uploadRecipePhoto } from '../middleware/upload.js';
import { scrape } from '../services/recipe-scraper.js';
import fs from 'node:fs';

const log    = createLogger('Recipes');
const router = express.Router();

// ── Module-toggle middleware ──────────────────────────────────────────────────

function requireRecipesEnabled(req, res, next) {
  const row = db.get().prepare(`SELECT value FROM sync_config WHERE key = 'recipes_enabled'`).get();
  if (row && row.value === 'false') {
    return res.status(404).json({ error: 'Receptenmodule is uitgeschakeld.', code: 404 });
  }
  next();
}

router.use(requireRecipesEnabled);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchRecipeWithDetails(id) {
  const recipe = db.get().prepare(`
    SELECT r.*, u.display_name AS creator_name
    FROM recipes r
    LEFT JOIN users u ON u.id = r.created_by
    WHERE r.id = ?
  `).get(id);
  if (!recipe) return null;

  recipe.ingredients = db.get().prepare(
    `SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order ASC, id ASC`
  ).all(id);

  recipe.steps = db.get().prepare(
    `SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY step_number ASC`
  ).all(id);

  return recipe;
}

function validateRecipeBody(body) {
  const vTitle   = str(body.title,       'Titel',        { max: MAX_TITLE });
  const vDesc    = str(body.description, 'Beschrijving', { max: MAX_TEXT, required: false });
  const vTags    = str(body.tags,        'Tags',         { max: 500, required: false });
  const vSrcUrl  = str(body.source_url,  'Bron-URL',     { max: MAX_TEXT, required: false });
  const vPhotoUrl= str(body.photo_url,   'Foto-URL',     { max: MAX_TEXT, required: false });
  const errors   = collectErrors([vTitle, vDesc, vTags, vSrcUrl, vPhotoUrl]);

  const servings = parseInt(body.servings, 10);
  if (!Number.isInteger(servings) || servings < 1 || servings > 100) {
    errors.push('Personen moet een geheel getal zijn tussen 1 en 100.');
  }
  if (vSrcUrl.value && !vSrcUrl.value.startsWith('http')) {
    errors.push('Bron-URL moet beginnen met http.');
  }
  if (vPhotoUrl.value && !vPhotoUrl.value.startsWith('http')) {
    errors.push('Foto-URL moet beginnen met http.');
  }

  return { vTitle, vDesc, vTags, vSrcUrl, vPhotoUrl, servings, errors };
}

function upsertIngredientsAndSteps(recipeId, ingredients = [], steps = []) {
  db.get().prepare(`DELETE FROM recipe_ingredients WHERE recipe_id = ?`).run(recipeId);
  db.get().prepare(`DELETE FROM recipe_steps WHERE recipe_id = ?`).run(recipeId);

  const insIng = db.get().prepare(
    `INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  ingredients.forEach((ing, i) => {
    const name = String(ing.name || '').trim().slice(0, MAX_TITLE);
    if (!name) return;
    const qty  = (ing.quantity != null && !isNaN(ing.quantity)) ? parseFloat(ing.quantity) : null;
    const unit = ing.unit ? String(ing.unit).trim().slice(0, 50) : null;
    insIng.run(recipeId, name, qty, unit, i);
  });

  const insStep = db.get().prepare(
    `INSERT INTO recipe_steps (recipe_id, step_number, instruction) VALUES (?, ?, ?)`
  );
  steps.forEach((step, i) => {
    const instruction = String(step.instruction || '').trim().slice(0, MAX_TEXT);
    if (!instruction) return;
    insStep.run(recipeId, i + 1, instruction);
  });
}

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    let sql    = `SELECT r.*, u.display_name AS creator_name FROM recipes r LEFT JOIN users u ON u.id = r.created_by`;
    const params = [];

    if (req.query.tag) {
      sql += ` WHERE (',' || r.tags || ',') LIKE ?`;
      params.push(`%,${req.query.tag.trim()},%`);
    } else if (req.query.q) {
      sql += ` WHERE (r.title LIKE ? OR r.tags LIKE ?)`;
      const q = `%${req.query.q.trim()}%`;
      params.push(q, q);
    }

    sql += ` ORDER BY r.created_at DESC`;

    const recipes = db.get().prepare(sql).all(...params);
    res.json({ data: recipes });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interne fout', code: 500 });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const recipe = fetchRecipeWithDetails(id);
    if (!recipe) return res.status(404).json({ error: 'Recept niet gevonden.', code: 404 });
    res.json({ data: recipe });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interne fout', code: 500 });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  try {
    const { vTitle, vDesc, vTags, vSrcUrl, vPhotoUrl, servings, errors } = validateRecipeBody(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const recipeId = db.get().transaction(() => {
      const result = db.get().prepare(`
        INSERT INTO recipes (title, description, servings, photo_url, source_url, tags, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(vTitle.value, vDesc.value, servings, vPhotoUrl.value, vSrcUrl.value, vTags.value, req.session.userId);
      upsertIngredientsAndSteps(result.lastInsertRowid, req.body.ingredients, req.body.steps);
      return result.lastInsertRowid;
    })();

    res.status(201).json({ data: fetchRecipeWithDetails(recipeId) });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interne fout', code: 500 });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!db.get().prepare('SELECT id FROM recipes WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'Recept niet gevonden.', code: 404 });
    }

    const { vTitle, vDesc, vTags, vSrcUrl, vPhotoUrl, servings, errors } = validateRecipeBody(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    db.get().transaction(() => {
      db.get().prepare(`
        UPDATE recipes
        SET title = ?, description = ?, servings = ?, photo_url = ?,
            source_url = ?, tags = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
      `).run(vTitle.value, vDesc.value, servings, vPhotoUrl.value, vSrcUrl.value, vTags.value, id);
      upsertIngredientsAndSteps(id, req.body.ingredients, req.body.steps);
    })();

    res.json({ data: fetchRecipeWithDetails(id) });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interne fout', code: 500 });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const recipe = db.get().prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!recipe) return res.status(404).json({ error: 'Recept niet gevonden.', code: 404 });

    if (recipe.photo_path) {
      try { fs.unlinkSync(recipe.photo_path); } catch { /* bestand al weg */ }
    }

    db.get().prepare('DELETE FROM recipes WHERE id = ?').run(id);
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interne fout', code: 500 });
  }
});

// ── POST /photo/:id ───────────────────────────────────────────────────────────

router.post('/photo/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.get().prepare('SELECT id FROM recipes WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Recept niet gevonden.', code: 404 });
  }

  uploadRecipePhoto(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message, code: 400 });
    if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen.', code: 400 });

    const filePath = req.file.path;
    const publicPath = `/uploads/recipes/${req.file.filename}`;

    const old = db.get().prepare('SELECT photo_path FROM recipes WHERE id = ?').get(id);
    if (old?.photo_path) {
      try { fs.unlinkSync(old.photo_path); } catch { /* al weg */ }
    }

    db.get().prepare(
      `UPDATE recipes SET photo_path = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).run(filePath, id);

    res.json({ ok: true, path: publicPath });
  });
});

// ── POST /scrape ──────────────────────────────────────────────────────────────

router.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Geldige URL is vereist.', code: 400 });
  }

  try {
    const result = await scrape(url);
    res.json({ data: result });
  } catch (err) {
    log.warn(`Scrape mislukt: ${err.message}`);
    res.status(422).json({ error: err.message, code: 422 });
  }
});

export default router;
