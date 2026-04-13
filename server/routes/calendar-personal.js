/**
 * Modul: Persoonlijke Agenda — Verbindingsbeheer
 * Zweck: REST-routes voor verbinden, kalenderselectie en verbreken per provider.
 * Basis-URL: /api/v1/calendar/personal
 * Afhankelijkheden: express, server/services/personal/*
 */

import express from 'express';
import { createLogger } from '../logger.js';
import * as db from '../db.js';
import * as googlePersonal    from '../services/personal/google-personal.js';
import * as applePersonal     from '../services/personal/apple-personal.js';
import * as microsoftPersonal from '../services/personal/microsoft-personal.js';

const log    = createLogger('CalendarPersonal');
const router = express.Router();

const VALID_PROVIDERS = ['google', 'apple', 'microsoft'];

// ── GET /status ──────────────────────────────────────────────────────────────
// Geeft verbindingsstatus per provider terug voor de ingelogde gebruiker.
// Response: { data: { google: { connected, calendarName, needsReconnect } | null, ... } }

router.get('/status', (req, res) => {
  try {
    const userId = req.session.userId;
    const rows   = db.get().prepare(
      `SELECT provider, calendar_name, needs_reconnect FROM user_calendar_tokens WHERE user_id = ?`
    ).all(userId);

    const status = { google: null, apple: null, microsoft: null };
    for (const row of rows) {
      status[row.provider] = {
        connected:      true,
        calendarName:   row.calendar_name || null,
        needsReconnect: !!row.needs_reconnect,
      };
    }

    // Microsoft verbergen als niet geconfigureerd
    if (!microsoftPersonal.isConfigured()) {
      delete status.microsoft;
    }

    res.json({ data: status });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// ── GET /calendars/:provider ─────────────────────────────────────────────────
// Haal lijst van beschikbare kalenders op na OAuth/connect.
// Response: { data: [{ id, name }] }

router.get('/calendars/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Ongeldige provider.', code: 400 });
  }

  try {
    const userId = req.session.userId;
    let calendars;
    if (provider === 'google') {
      calendars = await googlePersonal.listCalendars(userId);
    } else if (provider === 'apple') {
      // Apple: kalenders zijn al opgeslagen bij connect(); geef de opgeslagen kalender terug
      const row = db.get().prepare(
        `SELECT calendar_id, calendar_name FROM user_calendar_tokens WHERE user_id = ? AND provider = 'apple'`
      ).get(userId);
      calendars = row && row.calendar_id ? [{ id: row.calendar_id, name: row.calendar_name || row.calendar_id }] : [];
    } else {
      calendars = await microsoftPersonal.listCalendars(userId);
    }
    res.json({ data: calendars });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

// ── GET /connect/google ──────────────────────────────────────────────────────
// Start Google OAuth-flow. Browser navigeert hiernaartoe, redirect naar Google.

router.get('/connect/google', (req, res) => {
  try {
    const url = googlePersonal.getAuthUrl(req.session, req.session.userId);
    res.redirect(url);
  } catch (err) {
    log.error('', err);
    res.status(503).json({ error: err.message, code: 503 });
  }
});


// ── GET /connect/microsoft ───────────────────────────────────────────────────
// Start Microsoft OAuth-flow. Browser navigeert hiernaartoe.

router.get('/connect/microsoft', (req, res) => {
  try {
    if (!microsoftPersonal.isConfigured()) {
      return res.status(503).json({ error: 'Microsoft niet geconfigureerd.', code: 503 });
    }
    const url = microsoftPersonal.getAuthUrl(req.session, req.session.userId);
    res.redirect(url);
  } catch (err) {
    log.error('', err);
    res.status(503).json({ error: err.message, code: 503 });
  }
});


// ── POST /connect/apple ──────────────────────────────────────────────────────
// Sla iCloud CalDAV-credentials op, test de verbinding.
// Body: { url, username, password }
// Response: { data: [{ id, name }] }  (kalenderlijst na succesvolle verbinding)

router.post('/connect/apple', async (req, res) => {
  const { url, username, password } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'url moet een geldige HTTP(S)-URL zijn.', code: 400 });
  }
  if (!username || typeof username !== 'string' || username.length > 254) {
    return res.status(400).json({ error: 'username is verplicht (max 254 tekens).', code: 400 });
  }
  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ error: 'password is verplicht.', code: 400 });
  }

  try {
    const userId    = req.session.userId;
    const calendars = await applePersonal.connect(userId, url.trim(), username.trim(), password);
    res.json({ data: calendars });
  } catch (err) {
    log.error('', err);
    // Saniteer de foutmelding: verwijder prefix en zorg dat het wachtwoord nooit in de response landt
    const safeMsg = err.message.replace('[ApplePersonal] ', '').replace(password, '***');
    res.status(400).json({ error: safeMsg, code: 400 });
  }
});

// ── POST /select-calendar ────────────────────────────────────────────────────
// Sla de geselecteerde kalender op.
// Body: { provider, calendarId, calendarName }
// Response: { ok: true }

router.post('/select-calendar', (req, res) => {
  const { provider, calendarId, calendarName } = req.body;

  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Ongeldige provider.', code: 400 });
  }
  if (!calendarId || typeof calendarId !== 'string') {
    return res.status(400).json({ error: 'calendarId is verplicht.', code: 400 });
  }

  try {
    const userId = req.session.userId;
    const name   = typeof calendarName === 'string' ? calendarName : calendarId;
    if (provider === 'google')         googlePersonal.selectCalendar(userId, calendarId, name);
    else if (provider === 'apple')      applePersonal.selectCalendar(userId, calendarId, name);
    else if (provider === 'microsoft')  microsoftPersonal.selectCalendar(userId, calendarId, name);
    res.json({ ok: true });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// ── DELETE /disconnect/:provider ─────────────────────────────────────────────
// Verbreek verbinding met een provider voor de ingelogde gebruiker.
// Response: 204 No Content

router.delete('/disconnect/:provider', (req, res) => {
  const { provider } = req.params;
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Ongeldige provider.', code: 400 });
  }

  try {
    const userId = req.session.userId;
    if (provider === 'google')         googlePersonal.disconnect(userId);
    else if (provider === 'apple')      applePersonal.disconnect(userId);
    else if (provider === 'microsoft')  microsoftPersonal.disconnect(userId);
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

export default router;
