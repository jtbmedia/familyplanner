/**
 * Modul: Budget-Tracker (Budget)
 * Zweck: REST-API-Routen für Einnahmen/Ausgaben, Monatsübersicht, CSV-Export
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, oneOf, date as validateDate, num, rrule, collectErrors, MAX_TITLE, MONTH_RE } from '../middleware/validate.js';

const log = createLogger('Budget');

const router  = express.Router();

// --------------------------------------------------------
// Wiederkehrende Einträge: fehlende Instanzen für einen Monat erzeugen
// --------------------------------------------------------

/**
 * Erstellt fehlende Instanzen wiederkehrender Budget-Einträge für den angefragten Monat.
 * Läuft idempotent - bereits vorhandene oder explizit übersprungene Instanzen werden ignoriert.
 * @param {import('better-sqlite3').Database} database
 * @param {string} month  YYYY-MM
 */
function generateRecurringInstances(database, month) {
  const [y, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd   = `${month}-31`;

  // Alle Serien-Originale, die vor diesem Monat begonnen haben
  const originals = database.prepare(`
    SELECT * FROM budget_entries
    WHERE is_recurring = 1 AND recurrence_parent_id IS NULL
      AND strftime('%Y-%m', date) < ?
  `).all(month);

  for (const orig of originals) {
    // Übersprungener Monat?
    const skipped = database.prepare(
      'SELECT 1 FROM budget_recurrence_skipped WHERE parent_id = ? AND month = ?'
    ).get(orig.id, month);
    if (skipped) continue;

    // Instanz schon vorhanden?
    const existing = database.prepare(`
      SELECT id FROM budget_entries
      WHERE recurrence_parent_id = ? AND date BETWEEN ? AND ?
    `).get(orig.id, monthStart, monthEnd);
    if (existing) continue;

    // Datum berechnen: gleicher Tag, am letzten Tag des Monats gekappt
    const origDay    = parseInt(orig.date.split('-')[2], 10);
    const lastDay    = new Date(y, m, 0).getDate();
    const instanceDay = Math.min(origDay, lastDay);
    const instanceDate = `${month}-${String(instanceDay).padStart(2, '0')}`;

    database.prepare(`
      INSERT INTO budget_entries
        (title, amount, category, date, is_recurring, recurrence_parent_id, created_by)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(orig.title, orig.amount, orig.category, instanceDate, orig.id, orig.created_by);
  }
}

const VALID_CATEGORIES = [
  'Lebensmittel', 'Miete', 'Versicherung', 'Mobilität',
  'Freizeit', 'Kleidung', 'Gesundheit', 'Bildung', 'Sonstiges',
];

// --------------------------------------------------------
// Statische Routen vor /:id
// --------------------------------------------------------

/**
 * GET /api/v1/budget/summary
 * Monatsübersicht: Einnahmen, Ausgaben, Saldo, Aufschlüsselung nach Kategorie.
 * Query: ?month=YYYY-MM  (default: aktueller Monat)
 * Response: { data: { month, income, expenses, balance, byCategory: [] } }
 */
router.get('/summary', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 7); // YYYY-MM
    const month = req.query.month || today;

    if (!MONTH_RE.test(month))
      return res.status(400).json({ error: 'month muss YYYY-MM sein', code: 400 });

    const from = `${month}-01`;
    const to   = `${month}-31`;

    const totals = db.get().prepare(`
      SELECT
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expenses,
        SUM(amount) AS balance
      FROM budget_entries
      WHERE date BETWEEN ? AND ?
    `).get(from, to);

    const byCategory = db.get().prepare(`
      SELECT category,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
             SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expenses,
             SUM(amount) AS total
      FROM budget_entries
      WHERE date BETWEEN ? AND ?
      GROUP BY category
      ORDER BY ABS(SUM(amount)) DESC
    `).all(from, to);

    res.json({
      data: {
        month,
        income:     totals.income   || 0,
        expenses:   totals.expenses || 0,
        balance:    totals.balance  || 0,
        byCategory,
      },
    });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * GET /api/v1/budget/export
 * Monatseinträge als CSV-Download.
 * Query: ?month=YYYY-MM
 * Response: text/csv
 */
router.get('/export', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 7);
    const month = req.query.month || today;

    if (!MONTH_RE.test(month))
      return res.status(400).json({ error: 'month muss YYYY-MM sein', code: 400 });

    const from    = `${month}-01`;
    const to      = `${month}-31`;
    const entries = db.get().prepare(`
      SELECT b.*, u.display_name AS creator_name
      FROM budget_entries b
      LEFT JOIN users u ON u.id = b.created_by
      WHERE b.date BETWEEN ? AND ?
      ORDER BY b.date ASC
    `).all(from, to);

    const header = 'Datum,Titel,Betrag,Kategorie,Wiederkehrend,Erstellt von\n';
    const csvSafe = (val) => {
      let s = String(val || '').replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s}"`;
    };
    const rows   = entries.map((e) =>
      [
        e.date,
        csvSafe(e.title),
        e.amount.toFixed(2).replace('.', ','),
        e.category,
        e.is_recurring ? 'Ja' : 'Nein',
        csvSafe(e.creator_name),
      ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="budget-${month}.csv"`);
    res.send('\uFEFF' + header + rows); // BOM für Excel
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * GET /api/v1/budget/meta
 * Kategorien-Liste für Dropdowns.
 * Response: { data: { categories } }
 */
router.get('/meta', (req, res) => {
  res.json({ data: { categories: VALID_CATEGORIES } });
});

// --------------------------------------------------------
// CRUD-Routen
// --------------------------------------------------------

/**
 * GET /api/v1/budget
 * Einträge eines Monats abrufen.
 * Query: ?month=YYYY-MM&category=<cat>
 * Response: { data: Entry[] }
 */
router.get('/', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 7);
    const month = req.query.month || today;

    if (!MONTH_RE.test(month))
      return res.status(400).json({ error: 'month muss YYYY-MM sein', code: 400 });

    generateRecurringInstances(db.get(), month);

    const from   = `${month}-01`;
    const to     = `${month}-31`;
    let sql      = `
      SELECT b.*, u.display_name AS creator_name
      FROM budget_entries b
      LEFT JOIN users u ON u.id = b.created_by
      WHERE b.date BETWEEN ? AND ?
    `;
    const params = [from, to];

    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      sql += ' AND b.category = ?';
      params.push(req.query.category);
    }

    sql += ' ORDER BY b.date DESC, b.created_at DESC';

    const entries = db.get().prepare(sql).all(...params);
    res.json({ data: entries });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/budget
 * Neuen Eintrag anlegen.
 * Body: { title, amount, category?, date, is_recurring?, recurrence_rule? }
 * Response: { data: Entry }
 */
router.post('/', (req, res) => {
  try {
    const vTitle  = str(req.body.title,    'Titel',  { max: MAX_TITLE });
    const vAmount = num(req.body.amount,  'Betrag', { required: true });
    const vCat    = oneOf(req.body.category || 'Sonstiges', VALID_CATEGORIES, 'Kategorie');
    const vDate   = validateDate(req.body.date,   'Datum',  true);
    const vRrule  = rrule(req.body.recurrence_rule, 'Wiederholung');
    const errors  = collectErrors([vTitle, vAmount, vCat, vDate, vRrule]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const result = db.get().prepare(`
      INSERT INTO budget_entries (title, amount, category, date, is_recurring, recurrence_rule, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      vTitle.value, vAmount.value, vCat.value || 'Sonstiges', vDate.value,
      req.body.is_recurring ? 1 : 0, vRrule.value,
      req.session.userId
    );

    const entry = db.get().prepare(`
      SELECT b.*, u.display_name AS creator_name
      FROM budget_entries b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: entry });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * PUT /api/v1/budget/:id
 * Eintrag bearbeiten.
 * Body: alle Felder optional
 * Response: { data: Entry }
 */
router.put('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const entry = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(id);
    if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden', code: 404 });

    const checks = [];
    if (req.body.title    !== undefined) checks.push(str(req.body.title,    'Titel',  { max: MAX_TITLE, required: false }));
    if (req.body.amount   !== undefined) checks.push(num(req.body.amount,   'Betrag'));
    if (req.body.category !== undefined) checks.push(oneOf(req.body.category, VALID_CATEGORIES, 'Kategorie'));
    if (req.body.date     !== undefined) checks.push(validateDate(req.body.date,    'Datum'));
    if (req.body.recurrence_rule !== undefined) checks.push(rrule(req.body.recurrence_rule, 'Wiederholung'));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });
    const { title, amount, category, date, is_recurring, recurrence_rule } = req.body;

    db.get().prepare(`
      UPDATE budget_entries
      SET title           = COALESCE(?, title),
          amount          = COALESCE(?, amount),
          category        = COALESCE(?, category),
          date            = COALESCE(?, date),
          is_recurring    = COALESCE(?, is_recurring),
          recurrence_rule = ?
      WHERE id = ?
    `).run(
      title?.trim() ?? null,
      amount !== undefined ? Number(amount) : null,
      category ?? null,
      date ?? null,
      is_recurring !== undefined ? (is_recurring ? 1 : 0) : null,
      recurrence_rule !== undefined ? (recurrence_rule || null) : entry.recurrence_rule,
      id
    );

    const updated = db.get().prepare(`
      SELECT b.*, u.display_name AS creator_name
      FROM budget_entries b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?
    `).get(id);

    res.json({ data: updated });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * DELETE /api/v1/budget/:id
 * Eintrag löschen.
 * Response: 204 No Content
 */
router.delete('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const entry = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(id);
    if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden', code: 404 });

    db.get().prepare('DELETE FROM budget_entries WHERE id = ?').run(id);

    // Wenn eine Instanz gelöscht wird: Monat als übersprungen markieren
    if (entry.recurrence_parent_id) {
      const month = entry.date.slice(0, 7);
      db.get().prepare(
        'INSERT OR IGNORE INTO budget_recurrence_skipped (parent_id, month) VALUES (?, ?)'
      ).run(entry.recurrence_parent_id, month);
    }

    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

export default router;
