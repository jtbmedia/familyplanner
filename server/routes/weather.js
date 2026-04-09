/**
 * Modul: Wetter-Proxy (Weather)
 * Zweck: Serverseitiger Proxy für OpenWeatherMap API (API-Key nie im Frontend)
 * Abhängigkeiten: express, node-fetch, dotenv
 */

import { createLogger } from '../logger.js';
import express from 'express';

const log = createLogger('Weather');

const router  = express.Router();

// Cache: Daten für 30 Minuten halten
let cache = { data: null, ts: 0 };
const CACHE_TTL_MS = 30 * 60 * 1000;

// --------------------------------------------------------
// GET /api/v1/weather
// Gibt aktuelles Wetter + 5-Tage-Vorschau zurück.
// Erfordert OPENWEATHER_API_KEY + OPENWEATHER_CITY in .env
// Response: { data: { current, forecast } } | { data: null }
// --------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    const city   = process.env.OPENWEATHER_CITY || 'Berlin';
    const units  = process.env.OPENWEATHER_UNITS || 'metric';
    const lang   = process.env.OPENWEATHER_LANG  || 'de';

    // Kein API-Key → leere Antwort (Widget wird ausgeblendet)
    if (!apiKey) {
      return res.json({ data: null });
    }

    // Cache prüfen
    if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
      return res.json({ data: cache.data });
    }

    // Dynamischer Import für node-fetch (ESM)
    const { default: fetch } = await import('node-fetch');

    // Aktuelles Wetter
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}&lang=${lang}`;
    const currentRes = await fetch(currentUrl, { signal: AbortSignal.timeout(8000) });
    if (!currentRes.ok) {
      log.warn(`API Fehler: ${currentRes.status}`);
      return res.json({ data: null });
    }
    const currentJson = await currentRes.json();

    // 5-Tage-Forecast (3h-Intervalle → wir nehmen Mittags-Werte für Tagesvorschau)
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}&lang=${lang}&cnt=40`;
    const forecastRes = await fetch(forecastUrl, { signal: AbortSignal.timeout(8000) });
    let forecastDays = [];
    if (forecastRes.ok) {
      const forecastJson = await forecastRes.json();
      // Ein Eintrag pro Tag: nächstgelegener Mittags-Wert (12:00 Uhr)
      const seen = new Set();
      for (const item of forecastJson.list ?? []) {
        const dateStr = item.dt_txt.slice(0, 10); // YYYY-MM-DD
        if (seen.has(dateStr)) continue;
        seen.add(dateStr);
        forecastDays.push({
          date:      dateStr,
          temp_min:  Math.round(item.main.temp_min),
          temp_max:  Math.round(item.main.temp_max),
          icon:      item.weather[0]?.icon,
          desc:      item.weather[0]?.description,
        });
        if (forecastDays.length >= 5) break;
      }
    }

    const data = {
      city: currentJson.name,
      current: {
        temp:       Math.round(currentJson.main.temp),
        feels_like: Math.round(currentJson.main.feels_like),
        humidity:   currentJson.main.humidity,
        icon:       currentJson.weather[0]?.icon,
        desc:       currentJson.weather[0]?.description,
        wind_speed: Math.round((currentJson.wind?.speed ?? 0) * 3.6), // m/s → km/h
      },
      forecast: forecastDays,
    };

    cache = { data, ts: Date.now() };
    res.json({ data });
  } catch (err) {
    log.warn('Fehler:', err.message);
    res.json({ data: null }); // Fallback: Widget ausblenden, kein Error-Screen
  }
});

// --------------------------------------------------------
// GET /api/v1/weather/icon/:code
// Proxy für OpenWeatherMap-Icons - vermeidet externe Bild-Requests
// im PWA-Standalone-Modus (CORS/CSP-Probleme auf Android Chrome).
// Erlaubte Codes: 2–4 alphanumerische Zeichen (z.B. "01d", "10n").
// Response: PNG-Bild mit 24h-Cache
// --------------------------------------------------------
router.get('/icon/:code', async (req, res) => {
  const { code } = req.params;
  if (!/^[a-zA-Z0-9]{2,4}$/.test(code)) {
    return res.status(400).json({ error: 'Ungültiger Icon-Code.', code: 400 });
  }

  try {
    const { default: fetch } = await import('node-fetch');
    const url = `https://openweathermap.org/img/wn/${code}@2x.png`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Icon nicht verfügbar.', code: 502 });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 Stunden
    upstream.body.pipe(res);
  } catch (err) {
    log.warn('Icon-Proxy Fehler:', err.message);
    res.status(502).json({ error: 'Icon-Proxy fehlgeschlagen.', code: 502 });
  }
});

export default router;
