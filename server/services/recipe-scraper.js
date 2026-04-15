/**
 * Modul: Recipe Scraper
 * Zweck: Schema.org JSON-LD extractie uit receptpagina's
 * Afhankelijkheden: node-fetch
 */

import fetch from 'node-fetch';
import { createLogger } from '../logger.js';

const log = createLogger('RecipeScraper');

// Eenheden die we herkennen bij het parsen van ingrediëntteksten
const UNIT_PATTERN = /^(\d+[,.]?\d*)\s*(gram|g|kg|ml|l|liter|el|eetlepel|tl|theelepel|stuks?|stuk|x|blikje|bos|teen|takje|snuf|snufje|mespunt|handvol|cup|oz|lb|tbsp|tsp)\.?\s+([\s\S]+)/i;

/**
 * Parst een ingrediënttekst naar { name, quantity, unit }.
 * "200 gram bloem" → { name: 'bloem', quantity: 200, unit: 'gram' }
 * "1 ui"          → { name: 'ui',    quantity: 1,   unit: null  }
 * "zout"          → { name: 'zout',  quantity: null, unit: null  }
 */
function parseIngredient(text) {
  const t = text.trim();

  // Probeer patroon met eenheid
  const unitMatch = t.match(UNIT_PATTERN);
  if (unitMatch) {
    return {
      name:     unitMatch[3].trim(),
      quantity: parseFloat(unitMatch[1].replace(',', '.')),
      unit:     unitMatch[2].toLowerCase(),
    };
  }

  // Probeer alleen getal + naam (bijv. "2 eieren")
  const numMatch = t.match(/^(\d+[,.]?\d*)\s+([\s\S]+)/);
  if (numMatch) {
    return {
      name:     numMatch[2].trim(),
      quantity: parseFloat(numMatch[1].replace(',', '.')),
      unit:     null,
    };
  }

  // Geen getal gevonden
  return { name: t, quantity: null, unit: null };
}

/**
 * Parseert recipeYield naar een integer aantal personen.
 * Accepteert: "4", "4 personen", "4-6 persons", ["4 servings"]
 */
function parseServings(raw) {
  if (!raw) return null;
  const s = Array.isArray(raw) ? raw[0] : String(raw);
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Extraheert het eerste Recipe-object uit een JSON-LD waarde.
 * Ondersteunt losse objecten en @graph arrays.
 */
function findRecipe(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findRecipe(item);
      if (found) return found;
    }
    return null;
  }
  if (parsed['@type'] === 'Recipe') return parsed;
  if (Array.isArray(parsed['@graph'])) {
    for (const item of parsed['@graph']) {
      if (item['@type'] === 'Recipe') return item;
    }
  }
  return null;
}

/**
 * Haalt een recept op van een URL via Schema.org JSON-LD.
 * @param {string} url
 * @returns {{ title, servings, ingredients, steps, imageUrl, sourceUrl }}
 * @throws {Error} Als er geen recept gevonden kan worden
 */
export async function scrape(url) {
  // SSRF-bescherming: alleen publieke HTTP(S) URLs toestaan
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    throw new Error('Ongeldige URL.');
  }
  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    throw new Error('Alleen HTTP(S) URLs zijn toegestaan.');
  }
  const host = urlObj.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' ||
      /^127\./.test(host) || /^10\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '::1' || /^fe80:/i.test(host) || host.endsWith('.local')) {
    throw new Error('Interne URLs zijn niet toegestaan.');
  }

  let html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OikosBot/1.0)' },
      signal:  AbortSignal.timeout(10_000),
      size:    2 * 1024 * 1024, // max 2MB
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    log.warn(`Fetch mislukt voor ${url}: ${err.message}`);
    throw new Error(`Kon de pagina niet ophalen: ${err.message}`);
  }

  // Zoek alle JSON-LD blokken
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let recipe = null;
  let match;

  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      recipe = findRecipe(parsed);
      if (recipe) break;
    } catch (parseErr) {
      log.debug(`Ongeldige JSON in JSON-LD blok: ${parseErr.message}`);
    }
  }

  if (!recipe) {
    throw new Error('Geen receptdata (Schema.org JSON-LD) gevonden op deze pagina.');
  }

  // Ingrediënten parsen
  const rawIngredients = Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [];
  const ingredients = rawIngredients.map((raw) => parseIngredient(String(raw)));

  // Stappen parsen
  const rawSteps = Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : [];
  const steps = rawSteps.map((s, i) => ({
    step_number: i + 1,
    instruction: typeof s === 'string' ? s.trim() : (s.text || s.name || '').trim(),
  })).filter((s) => s.instruction);

  // Afbeelding
  const image = recipe.image;
  const imageUrl = Array.isArray(image) ? image[0] : (typeof image === 'string' ? image : image?.url || null);

  return {
    title:       String(recipe.name || '').trim(),
    servings:    parseServings(recipe.recipeYield),
    ingredients,
    steps,
    imageUrl:    imageUrl || null,
    sourceUrl:   url,
  };
}
