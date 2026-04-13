/**
 * Modul: Personal Calendar Push — Centrale Dispatcher
 * Zweck: Verdeelt push-operaties naar de juiste provider per gebruiker.
 *        Fouten per gebruiker/provider worden verzameld; lokale opslag wordt nooit geblokkeerd.
 * Afhankelijkheden: server/services/personal/{google,apple,microsoft}-personal.js, server/db.js
 */

import { createLogger } from '../../logger.js';
import * as db from '../../db.js';
import * as googlePersonal    from './google-personal.js';
import * as applePersonal     from './apple-personal.js';
import * as microsoftPersonal from './microsoft-personal.js';

const log = createLogger('PersonalPush');

const SERVICES = {
  google:    googlePersonal,
  apple:     applePersonal,
  microsoft: microsoftPersonal,
};

/**
 * Push een event-wijziging naar alle persoonlijke agenda's van de opgegeven gebruikers.
 *
 * @param {object}                        event   - Oikos calendar_events rij (heeft event.id)
 * @param {number[]}                      userIds - Array van user IDs om naar te pushen
 * @param {'create'|'update'|'delete'}    action
 * @returns {{ ok: boolean, failed?: Array<{userId, provider, error}> }}
 */
export async function push(event, userIds, action) {
  if (!userIds || userIds.length === 0) return { ok: true };

  const errors = [];

  // Batch: één query voor alle gebruikers tegelijk
  const placeholders = userIds.map(() => '?').join(',');
  const tokens = db.get().prepare(`
    SELECT user_id, provider FROM user_calendar_tokens
    WHERE user_id IN (${placeholders})
      AND needs_reconnect = 0
      AND (
        (provider != 'apple' AND calendar_id IS NOT NULL)
        OR
        (provider = 'apple' AND caldav_url IS NOT NULL AND caldav_username IS NOT NULL AND caldav_password IS NOT NULL AND calendar_id IS NOT NULL)
      )
  `).all(...userIds);

  // Parallel: alle pushes tegelijk uitvoeren
  await Promise.allSettled(
    tokens.map(({ user_id: userId, provider }) => {
      const service = SERVICES[provider];
      if (!service) return Promise.resolve();
      return service.push(event, userId, action).catch((err) => {
        log.error(`Push mislukt (user ${userId}, provider ${provider}): ${err.message}`);
        errors.push({ userId, provider, error: err.message });
      });
    })
  );

  return errors.length > 0 ? { ok: false, failed: errors } : { ok: true };
}
