/**
 * Modul: Dashboard
 * Zweck: Aggregierter Endpoint - liefert Daten aller Dashboard-Widgets in einem Request
 * Abhängigkeiten: express, server/db.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';

const log = createLogger('Dashboard');

const router = express.Router();

/**
 * GET /api/v1/dashboard
 * Liefert aggregierte Daten für alle Dashboard-Widgets.
 * Jedes Widget-Objekt hat ein eigenes `error`-Feld falls die Abfrage fehlschlägt -
 * so bricht ein fehlerhaftes Widget nicht das gesamte Dashboard.
 *
 * Response: {
 *   upcomingEvents: CalendarEvent[],   // Nächste 5 Termine
 *   urgentTasks:    Task[],            // High/Urgent mit Fälligkeit ≤ 48h
 *   todayMeals:     Meal[],            // Mahlzeiten für heute
 *   pinnedNotes:    Note[],            // Angepinnte Notizen (max. 3)
 *   users:          User[]             // Alle User (für Avatar-Farben)
 * }
 */
router.get('/', (req, res) => {
  try {
  const d = db.get();
  const result = {};

  // Heute und +48h als ISO-Strings
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  // Anstehende Termine (nächste 5, ab jetzt)
  try {
    result.upcomingEvents = d.prepare(`
      SELECT
        ce.*,
        u.display_name  AS assigned_name,
        u.avatar_color  AS assigned_color
      FROM calendar_events ce
      LEFT JOIN users u ON ce.assigned_to = u.id
      WHERE ce.start_datetime >= ?
      ORDER BY ce.start_datetime ASC
      LIMIT 5
    `).all(now.toISOString());
  } catch (err) {
    log.error('upcomingEvents-Fehler:', err.message);
    result.upcomingEvents = [];
  }

  // Offene Aufgaben: alle nicht-erledigten, sortiert nach Priorität und Fälligkeit
  try {
    result.urgentTasks = d.prepare(`
      SELECT
        t.*,
        u.display_name AS assigned_name,
        u.avatar_color AS assigned_color
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.status != 'done'
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 3
          ELSE 4
        END,
        t.due_date ASC NULLS LAST
      LIMIT 5
    `).all();
  } catch (err) {
    log.error('urgentTasks-Fehler:', err.message);
    result.urgentTasks = [];
  }

  // Heutiges Essen (gefiltert nach haushaltweiten Mahlzeit-Typ-Einstellungen)
  try {
    const ALL_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
    const prefRow = d.prepare('SELECT value FROM sync_config WHERE key = ?').get('visible_meal_types');
    const visibleTypes = prefRow
      ? prefRow.value.split(',').filter((t) => ALL_MEAL_TYPES.includes(t))
      : ALL_MEAL_TYPES;
    const placeholders = visibleTypes.map(() => '?').join(', ');
    result.todayMeals = d.prepare(`
      SELECT * FROM meals
      WHERE date = ?
        AND meal_type IN (${placeholders})
      ORDER BY
        CASE meal_type
          WHEN 'breakfast' THEN 0
          WHEN 'lunch'     THEN 1
          WHEN 'dinner'    THEN 2
          WHEN 'snack'     THEN 3
        END
    `).all(todayStr, ...visibleTypes);
  } catch (err) {
    log.error('todayMeals-Fehler:', err.message);
    result.todayMeals = [];
  }

  // Neueste Notizen (gepinnte zuerst, dann aktuellste)
  try {
    result.pinnedNotes = d.prepare(`
      SELECT n.*, u.display_name AS author_name, u.avatar_color AS author_color
      FROM notes n
      LEFT JOIN users u ON n.created_by = u.id
      ORDER BY n.pinned DESC, n.updated_at DESC
      LIMIT 3
    `).all();
  } catch (err) {
    log.error('pinnedNotes-Fehler:', err.message);
    result.pinnedNotes = [];
  }

  // Einkaufslisten mit offenen Artikeln (max. 3 Listen, je bis zu 6 offene Items)
  try {
    const lists = d.prepare(`
      SELECT sl.id, sl.name,
        (SELECT COUNT(*) FROM shopping_items si WHERE si.list_id = sl.id AND si.is_checked = 0) AS open_count,
        (SELECT COUNT(*) FROM shopping_items si WHERE si.list_id = sl.id) AS total_count
      FROM shopping_lists sl
      HAVING open_count > 0
      ORDER BY sl.updated_at DESC
      LIMIT 3
    `).all();

    for (const list of lists) {
      list.items = d.prepare(`
        SELECT id, name, quantity, is_checked
        FROM shopping_items
        WHERE list_id = ? AND is_checked = 0
        ORDER BY id ASC
        LIMIT 6
      `).all(list.id);
    }
    result.shoppingLists = lists;
  } catch (err) {
    log.error('shoppingLists-Fehler:', err.message);
    result.shoppingLists = [];
  }

  // Neueste Rezepte (max. 4)
  try {
    result.recentRecipes = d.prepare(`
      SELECT id, title, tags, photo_url, photo_path
      FROM recipes
      ORDER BY updated_at DESC
      LIMIT 4
    `).all();
  } catch (err) {
    log.error('recentRecipes-Fehler:', err.message);
    result.recentRecipes = [];
  }

  // Alle User (für Avatar-Farben in Widgets)
  try {
    result.users = d.prepare(
      'SELECT id, display_name, avatar_color FROM users ORDER BY display_name'
    ).all();
  } catch (err) {
    result.users = [];
  }

  res.json(result);
  } catch (err) {
    log.error('Kritischer Fehler:', err.message);
    res.status(500).json({ error: 'Dashboard konnte nicht geladen werden.', code: 500 });
  }
});

export default router;
