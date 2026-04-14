/**
 * Modul: OAuth Callbacks — Publieke routes (geen requireAuth)
 * Zweck: Verwerkt OAuth-callbacks van externe providers (Google, Microsoft).
 *        Deze routes zijn bewust publiek: ze worden aangeroepen via browser-redirect
 *        van een externe provider. De sessie-cookie is dan niet betrouwbaar aanwezig
 *        (cross-site navigatie). De userId wordt opgezocht via de oauth_pending tabel.
 * Basis-URL: /api/v1/oauth  (gemount VOOR requireAuth in index.js)
 */

import express from 'express';
import { createLogger } from '../logger.js';
import * as db from '../db.js';
import * as googlePersonal    from '../services/personal/google-personal.js';
import * as microsoftPersonal from '../services/personal/microsoft-personal.js';
import * as microsoftCalendar from '../services/microsoft-calendar.js';

const log    = createLogger('OAuthCallbacks');
const router = express.Router();

/**
 * Haal userId op uit oauth_pending via de state-waarde.
 * Verwijdert het record direct (eenmalig gebruik).
 * @returns {{ userId: number, provider: string } | null}
 */
function consumeOAuthState(state) {
  if (!state || typeof state !== 'string' || state.length !== 64) return null;
  const row = db.get().prepare(
    `SELECT user_id, provider FROM oauth_pending WHERE state = ? AND expires_at > ?`
  ).get(state, Date.now());
  if (!row) return null;
  db.get().prepare(`DELETE FROM oauth_pending WHERE state = ?`).run(state);
  return { userId: row.user_id, provider: row.provider };
}

// ── GET /google/callback ─────────────────────────────────────────────────────
// Google OAuth-callback. Geen sessie vereist — userId komt uit oauth_pending.

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    log.warn(`Google OAuth afgewezen: ${error}`);
    return res.redirect('/settings?personal_sync_error=google');
  }

  const pending = consumeOAuthState(state);
  if (!pending || pending.provider !== 'google') {
    log.warn('Google OAuth: ongeldige of verlopen state');
    return res.redirect('/settings?personal_sync_error=google');
  }

  if (!code) {
    return res.redirect('/settings?personal_sync_error=google');
  }

  try {
    await googlePersonal.handleCallback(code, pending.userId);
    res.redirect('/settings?personal_sync_ok=google&step=select_calendar');
  } catch (err) {
    log.error('Google OAuth callback mislukt', err);
    res.redirect('/settings?personal_sync_error=google');
  }
});

// ── GET /microsoft/callback ──────────────────────────────────────────────────
// Microsoft OAuth-callback. Geen sessie vereist — userId komt uit oauth_pending.

router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    log.warn(`Microsoft OAuth afgewezen: ${error}`);
    return res.redirect('/settings?personal_sync_error=microsoft');
  }

  const pending = consumeOAuthState(state);
  if (!pending || pending.provider !== 'microsoft') {
    log.warn('Microsoft OAuth: ongeldige of verlopen state');
    return res.redirect('/settings?personal_sync_error=microsoft');
  }

  if (!code) {
    return res.redirect('/settings?personal_sync_error=microsoft');
  }

  try {
    await microsoftPersonal.handleCallback(code, pending.userId);
    res.redirect('/settings?personal_sync_ok=microsoft&step=select_calendar');
  } catch (err) {
    log.error('Microsoft OAuth callback mislukt', err);
    res.redirect('/settings?personal_sync_error=microsoft');
  }
});

// ── GET /microsoft/shared/callback ───────────────────────────────────────────
// Gedeelde Microsoft Calendar OAuth-callback. Geen sessie vereist.

router.get('/microsoft/shared/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    log.warn(`Microsoft Shared OAuth afgewezen: ${error}`);
    return res.redirect('/settings?sync_error=microsoft');
  }

  const pending = consumeOAuthState(state);
  if (!pending || pending.provider !== 'microsoft_shared') {
    log.warn('Microsoft Shared OAuth: ongeldige of verlopen state');
    return res.redirect('/settings?sync_error=microsoft');
  }

  if (!code) {
    return res.redirect('/settings?sync_error=microsoft');
  }

  try {
    await microsoftCalendar.handleCallback(code);
    // Initiële sync in achtergrond starten (geen await)
    microsoftCalendar.sync().catch((e) => log.error('Initiële sync mislukt:', e.message));
    res.redirect('/settings?sync_ok=microsoft');
  } catch (err) {
    log.error('Microsoft Shared OAuth callback mislukt:', err);
    res.redirect('/settings?sync_error=microsoft');
  }
});

export default router;
