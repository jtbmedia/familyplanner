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
 * Controleert of een @type waarde overeenkomt met het Schema.org Recipe type.
 * Ondersteunt korte naam ("Recipe"), arrays (["Recipe", "Thing"]),
 * en volledige URI's ("http://schema.org/Recipe", "https://schema.org/Recipe").
 */
function isRecipeType(type) {
  if (!type) return false;
  const typeArr = Array.isArray(type) ? type : [type];
  return typeArr.some((t) => {
    if (typeof t !== 'string') return false;
    return t === 'Recipe' ||
           t === 'http://schema.org/Recipe' ||
           t === 'https://schema.org/Recipe';
  });
}

/**
 * Extraheert het eerste Recipe-object uit een JSON-LD waarde.
 * Ondersteunt:
 *  - Losse objecten met @type: "Recipe"
 *  - @type als array: ["Recipe", "Thing"]
 *  - Volledige URI's: "http://schema.org/Recipe"
 *  - @graph arrays
 *  - Geneste arrays
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

  if (isRecipeType(parsed['@type'])) return parsed;

  if (Array.isArray(parsed['@graph'])) {
    for (const item of parsed['@graph']) {
      const found = findRecipe(item);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Vlakt recipeInstructions plat — ondersteunt strings, HowToStep en HowToSection.
 * HowToSection kan geneste itemListElement bevatten.
 */
function flattenInstructions(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) result.push(text);
    } else if (item && typeof item === 'object') {
      const sectionType = Array.isArray(item['@type']) ? item['@type'][0] : item['@type'];
      if (sectionType === 'HowToSection' && Array.isArray(item.itemListElement)) {
        // Recursief uitvouwen van HowToSection → HowToStep
        result.push(...flattenInstructions(item.itemListElement));
      } else {
        const text = (item.text || item.name || '').trim();
        if (text) result.push(text);
      }
    }
  }
  return result;
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 403) throw new Error(`Toegang geweigerd (HTTP 403) — deze site blokkeert automatische imports.`);
      if (res.status === 404) throw new Error(`Pagina niet gevonden (HTTP 404).`);
      if (res.status === 429) throw new Error(`Te veel verzoeken (HTTP 429) — probeer het later opnieuw.`);
      throw new Error(`HTTP ${res.status}`);
    }

    // Handmatige 2MB limiet (node-fetch v3 ondersteunt de size-optie niet meer)
    const MAX_BYTES = 2 * 1024 * 1024;
    const chunks = [];
    let received = 0;
    for await (const chunk of res.body) {
      received += chunk.length;
      if (received > MAX_BYTES) {
        throw new Error('Pagina te groot (max 2MB).');
      }
      chunks.push(chunk);
    }
    html = Buffer.concat(chunks).toString('utf-8');
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

  // Stappen parsen — ondersteunt strings, HowToStep en HowToSection
  const instructions = flattenInstructions(
    Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : []
  );
  const steps = instructions.map((instruction, i) => ({
    step_number: i + 1,
    instruction,
  }));

  // Afbeelding — 1) JSON-LD image (string, array of ImageObject)
  //              2) JSON-LD thumbnailUrl als fallback
  //              3) og:image meta tag als laatste fallback
  const image = recipe.image;
  let imageUrl = null;
  if (typeof image === 'string') {
    imageUrl = image;
  } else if (Array.isArray(image)) {
    const first = image[0];
    imageUrl = typeof first === 'string' ? first : (first?.url || null);
  } else if (image && typeof image === 'object') {
    imageUrl = image.url || null;
  }

  if (!imageUrl && recipe.thumbnailUrl) {
    imageUrl = typeof recipe.thumbnailUrl === 'string'
      ? recipe.thumbnailUrl
      : null;
  }

  if (!imageUrl) {
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch) imageUrl = ogMatch[1];
  }

  return {
    title:       String(recipe.name || '').trim(),
    servings:    parseServings(recipe.recipeYield),
    ingredients,
    steps,
    imageUrl,
    sourceUrl:   url,
  };
}
