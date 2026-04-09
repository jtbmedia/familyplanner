/**
 * Modul: Kontakte (Contacts)
 * Zweck: REST-API-Routen für wichtige Familienkontakte
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, oneOf, collectErrors, MAX_TITLE, MAX_TEXT, MAX_SHORT } from '../middleware/validate.js';

const log = createLogger('Contacts');

const router  = express.Router();

const VALID_CATEGORIES = ['Arzt', 'Schule/Kita', 'Behörde', 'Versicherung',
                           'Handwerker', 'Notfall', 'Sonstiges'];

/**
 * GET /api/v1/contacts
 * Alle Kontakte, optional nach Kategorie gefiltert und nach Name gesucht.
 * Query: ?category=<cat>&q=<search>
 * Response: { data: Contact[] }
 */
router.get('/', (req, res) => {
  try {
    let sql    = 'SELECT * FROM contacts';
    const params = [];
    const where  = [];

    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      where.push('category = ?');
      params.push(req.query.category);
    }

    if (req.query.q) {
      where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY category ASC, name ASC';

    const contacts = db.get().prepare(sql).all(...params);
    res.json({ data: contacts });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/contacts
 * Neuen Kontakt anlegen.
 * Body: { name, category?, phone?, email?, address?, notes? }
 * Response: { data: Contact }
 */
router.post('/', (req, res) => {
  try {
    const vName    = str(req.body.name,     'Name',    { max: MAX_TITLE });
    const vCat     = oneOf(req.body.category || 'Sonstiges', VALID_CATEGORIES, 'Kategorie');
    const vPhone   = str(req.body.phone,   'Telefon', { max: MAX_SHORT, required: false });
    const vEmail   = str(req.body.email,   'E-Mail',  { max: MAX_TITLE, required: false });
    const vAddress = str(req.body.address, 'Adresse', { max: MAX_TEXT,  required: false });
    const vNotes   = str(req.body.notes,   'Notizen', { max: MAX_TEXT,  required: false });
    const errors   = collectErrors([vName, vCat, vPhone, vEmail, vAddress, vNotes]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const result = db.get().prepare(`
      INSERT INTO contacts (name, category, phone, email, address, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(vName.value, vCat.value || 'Sonstiges', vPhone.value, vEmail.value,
           vAddress.value, vNotes.value);

    const contact = db.get().prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: contact });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * PUT /api/v1/contacts/:id
 * Kontakt bearbeiten.
 * Body: alle Felder optional
 * Response: { data: Contact }
 */
router.put('/:id', (req, res) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const contact = db.get().prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!contact) return res.status(404).json({ error: 'Kontakt nicht gefunden', code: 404 });

    const checks = [];
    if (req.body.name     !== undefined) checks.push(str(req.body.name,     'Name',    { max: MAX_TITLE, required: false }));
    if (req.body.category !== undefined) checks.push(oneOf(req.body.category, VALID_CATEGORIES, 'Kategorie'));
    if (req.body.phone    !== undefined) checks.push(str(req.body.phone,    'Telefon', { max: MAX_SHORT, required: false }));
    if (req.body.email    !== undefined) checks.push(str(req.body.email,    'E-Mail',  { max: MAX_TITLE, required: false }));
    if (req.body.address  !== undefined) checks.push(str(req.body.address,  'Adresse', { max: MAX_TEXT,  required: false }));
    if (req.body.notes    !== undefined) checks.push(str(req.body.notes,    'Notizen', { max: MAX_TEXT,  required: false }));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    db.get().prepare(`
      UPDATE contacts
      SET name     = COALESCE(?, name),
          category = COALESCE(?, category),
          phone    = ?,
          email    = ?,
          address  = ?,
          notes    = ?
      WHERE id = ?
    `).run(
      req.body.name?.trim() ?? null,
      req.body.category ?? null,
      req.body.phone   !== undefined ? (req.body.phone?.trim()   || null) : contact.phone,
      req.body.email   !== undefined ? (req.body.email?.trim()   || null) : contact.email,
      req.body.address !== undefined ? (req.body.address?.trim() || null) : contact.address,
      req.body.notes   !== undefined ? (req.body.notes?.trim()   || null) : contact.notes,
      id
    );

    const updated = db.get().prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    res.json({ data: updated });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * DELETE /api/v1/contacts/:id
 * Kontakt löschen.
 * Response: 204 No Content
 */
router.delete('/:id', (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const result = db.get().prepare('DELETE FROM contacts WHERE id = ?').run(id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Kontakt nicht gefunden', code: 404 });
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * GET /api/v1/contacts/meta
 * Kategorien-Liste für Dropdowns.
 * Response: { data: { categories } }
 */
router.get('/meta', (_req, res) => {
  try {
    res.json({ data: { categories: VALID_CATEGORIES } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * GET /api/v1/contacts/:id/vcard
 * Kontakt als vCard 3.0 (.vcf) exportieren.
 * Response: text/vcard Dateidownload
 */
router.get('/:id/vcard', (req, res) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const contact = db.get().prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!contact) return res.status(404).json({ error: 'Kontakt nicht gefunden', code: 404 });

    const esc = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${esc(contact.name)}`,
      `N:${esc(contact.name)};;;;`,
    ];
    if (contact.phone)   lines.push(`TEL;TYPE=VOICE:${esc(contact.phone)}`);
    if (contact.email)   lines.push(`EMAIL:${esc(contact.email)}`);
    if (contact.address) lines.push(`ADR;TYPE=HOME:;;${esc(contact.address)};;;;`);
    if (contact.notes)   lines.push(`NOTE:${esc(contact.notes)}`);
    if (contact.category) lines.push(`CATEGORIES:${esc(contact.category)}`);
    lines.push('END:VCARD');

    const vcf      = lines.join('\r\n');
    const filename = encodeURIComponent(contact.name.replace(/[^a-zA-Z0-9-_ ]/g, '_')) + '.vcf';

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(vcf);
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

export default router;
