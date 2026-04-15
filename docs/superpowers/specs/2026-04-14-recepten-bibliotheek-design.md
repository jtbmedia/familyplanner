# Receptenbibliotheek — Design Spec

**Datum:** 2026-04-14
**Status:** Goedgekeurd

---

## Doel

Een volwaardige receptenbibliotheek toevoegen aan Oikos. Recepten zijn onafhankelijke entiteiten die gekoppeld kunnen worden aan de maaltijdplanning. Bij koppeling kunnen ingrediënten geschaald naar het gewenste aantal personen automatisch aan een boodschappenlijst worden toegevoegd. Recepten kunnen handmatig aangemaakt of geïmporteerd worden via een URL-scraper.

---

## Scope

- Receptenbibliotheek: CRUD, zoeken, filteren op tags
- Scraper: URL → Schema.org JSON-LD extractie → vooringevuld formulier
- Foto's: upload (lokaal Docker volume) én externe URL
- Maaltijdplanning: optioneel recept koppelen aan maaltijd
- Boodschappenlijst: ingrediënten toevoegen met schalen + samenvoegen
- Instellingen: module aan/uitzetten via `recipes_enabled` in sync_config
- Buiten scope: voedingswaarden, receptboeken/collecties, publiek delen van recepten

---

## Architectuur

### Nieuwe bestanden

| Bestand | Verantwoordelijkheid |
|---------|----------------------|
| `server/routes/recipes.js` | CRUD, foto-upload, scraper-endpoint |
| `server/services/recipe-scraper.js` | Schema.org JSON-LD extractie |
| `public/pages/recipes.js` | SPA-pagina: overzicht, detail, formulier |

### Aangepaste bestanden

| Bestand | Wijziging |
|---------|-----------|
| `server/db.js` | Nieuwe migratie: recipes, recipe_ingredients, recipe_steps tabellen; recipe_id op meals |
| `server/index.js` | recipesRouter mounten op `/api/v1/recipes` |
| `server/routes/meals.js` | recipe_id accepteren bij POST/PUT; `POST /:id/to-shopping` route |
| `public/pages/meals.js` | Receptenselector bij maaltijd aanmaken/bewerken; knop "Naar boodschappenlijst" |
| `public/pages/settings.js` | Toggle voor recipes_enabled |
| `public/locales/*.json` | Vertaalsleutels voor alle 6 talen |

---

## Datamodel

### Nieuwe tabel: `recipes`

```sql
CREATE TABLE recipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT,
  servings    INTEGER NOT NULL DEFAULT 4,
  photo_path  TEXT,                          -- lokaal geüpload bestand
  photo_url   TEXT,                          -- externe URL
  source_url  TEXT,                          -- oorspronkelijke receptpagina
  tags        TEXT,                          -- komma-gescheiden: "vegetarisch,pasta,snel"
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

### Nieuwe tabel: `recipe_ingredients`

```sql
CREATE TABLE recipe_ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  quantity    REAL,                          -- null = "naar smaak"
  unit        TEXT,                          -- "gram", "el", "tl", "stuks", "ml", etc.
  sort_order  INTEGER NOT NULL DEFAULT 0
);
```

### Nieuwe tabel: `recipe_steps`

```sql
CREATE TABLE recipe_steps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_number  INTEGER NOT NULL,
  instruction  TEXT    NOT NULL
);
```

### Aangepaste tabel: `meals`

```sql
ALTER TABLE meals ADD COLUMN recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL;
```

Bestaande maaltijden zonder recept werken ongewijzigd. `recipe_id` is altijd optioneel.

### Instellingen

`sync_config` sleutel: `recipes_enabled` (waarde `'true'` of `'false'`, standaard `'true'`).

---

## Foto-opslag

- Geüploade foto's: opgeslagen in Docker volume, gemount op `/data/uploads/recipes/`
- Geserveerd via Express static: `app.use('/uploads/recipes', express.static('/data/uploads/recipes'))`
- Bestandsnaam: `{recipe_id}-{timestamp}.{ext}` (UUID niet nodig, ID + timestamp is uniek genoeg)
- Max grootte: 5 MB
- Toegestane MIME-types: `image/jpeg`, `image/png`, `image/webp`
- Externe URL: gewoon als tekst opgeslagen, geen validatie van de afbeelding
- Prioriteit bij weergave: `photo_path` voor `photo_url` (upload wint van URL)

---

## Scraper

### Endpoint

```
POST /api/v1/recipes/scrape
Body: { url: string }
Response: { title, servings, ingredients: [{name, quantity, unit}], steps: [string], imageUrl, sourceUrl }
```

### Werking

1. Server fetcht de URL (node-fetch, timeout 10s, max 2MB response)
2. Zoek `<script type="application/ld+json">` blokken in de HTML
3. Parse JSON, zoek object met `@type: "Recipe"` (ook genest in `@graph`)
4. Extraheer velden:

| Schema.org veld | Oikos veld |
|-----------------|------------|
| `name` | title |
| `recipeYield` | servings (parse getal uit "4 personen" etc.) |
| `recipeIngredient[]` | ingredients (parse hoeveelheid + eenheid uit tekst) |
| `recipeInstructions[]` | steps (HowToStep.text of plain string) |
| `image` | imageUrl (eerste als array) |

5. Ingrediënten parsen: `"200 gram bloem"` → `{ name: "bloem", quantity: 200, unit: "gram" }`
   - Regex: `^(\d+[,.]?\d*)\s*(gram|g|kg|ml|l|el|tl|stuks?|stuk|x|blikje|bos|teen|takje|snuf|mespunt)?\s+(.+)$`
   - Geen match → volledige tekst als naam, quantity/unit null

6. Bij fout (geen JSON-LD, geen Recipe type, netwerk): HTTP 422 met beschrijvende foutmelding

### Frontend flow

1. Gebruiker opent "Nieuw recept" → tabblad "Importeren via URL"
2. Plakt URL → klikt "Importeren"
3. Formulier wordt vooringevuld met scraped data
4. Gebruiker past aan waar nodig → slaat op als normaal recept

---

## API Routes

Alle routes vereisen authenticatie (via bestaande `requireAuth` middleware). Aanmaken, bewerken en verwijderen vereisen geen admin-rol — alle gezinsleden kunnen recepten beheren.

### `GET /api/v1/recipes`

Query params:
- `?q=` — zoek in titel en tags (LIKE)
- `?tag=` — filter op één tag (exact match in komma-gescheiden tags veld)

Response: `{ data: Recipe[] }` — inclusief eerste ingredient (voor preview), zonder stappen

### `GET /api/v1/recipes/:id`

Response: `{ data: Recipe }` — inclusief alle `ingredients` en `steps` arrays

### `POST /api/v1/recipes`

Body:
```json
{
  "title": "Spaghetti Bolognese",
  "description": "Klassiek Italiaans gerecht",
  "servings": 4,
  "photo_url": "https://...",
  "source_url": "https://...",
  "tags": "pasta,vlees,italiaans",
  "ingredients": [
    { "name": "gehakt", "quantity": 500, "unit": "gram", "sort_order": 0 },
    { "name": "ui", "quantity": 1, "unit": "stuks", "sort_order": 1 }
  ],
  "steps": [
    { "step_number": 1, "instruction": "Fruit de ui in olijfolie." },
    { "step_number": 2, "instruction": "Voeg het gehakt toe." }
  ]
}
```

Response: `{ data: Recipe }` met 201

### `PUT /api/v1/recipes/:id`

Zelfde body als POST, volledig vervangen (inclusief ingrediënten en stappen — delete + re-insert in transactie).

### `DELETE /api/v1/recipes/:id`

Verwijdert recept + ingrediënten + stappen (CASCADE). Maaltijden krijgen `recipe_id = NULL`.
Response: 204

### `POST /api/v1/recipes/photo/:id`

Multipart form upload. Slaat bestand op, update `photo_path` in DB.
Response: `{ ok: true, path: "/uploads/recipes/..." }`

### `POST /api/v1/recipes/scrape`

Zie Scraper sectie.

### `POST /api/v1/meals/:id/to-shopping`

Body:
```json
{
  "list_id": 3,
  "servings": 6
}
```

Logica:
1. Haal recept op via `meals.recipe_id`
2. Schaal ingrediënten: `scaled_qty = ingredient.quantity * (servings / recipe.servings)`
3. Per ingrediënt: zoek bestaand item in lijst op genormaliseerde naam (lowercase, trim)
   - Zelfde naam + zelfde eenheid → hoeveelheden optellen (`UPDATE`)
   - Zelfde naam + andere eenheid → apart item toevoegen (`INSERT`)
   - Niet gevonden → nieuw item toevoegen (`INSERT`)
4. Response: `{ ok: true, added: N, merged: M }`

---

## Frontend

### Navigatie

Recepten krijgen een eigen item in de sidebar, tussen Maaltijden en Boodschappen. Verborgen als `recipes_enabled = 'false'`.

### Pagina `/recepten` — Overzicht

- Zoekbalk bovenaan
- Tag-filter als chips (unieke tags uit alle recepten)
- Receptkaartjes: foto (of placeholder), titel, tags, "voor X personen"
- Knop "+ Recept toevoegen"
- Klik op kaartje → detailweergave

### Pagina `/recepten/:id` — Detail

- Foto (upload of URL)
- Titel, beschrijving, bron-URL (klikbaar)
- "Voor X personen" badge
- Tags
- Ingrediëntenlijst met hoeveelheden
- Stap-voor-stap instructies (genummerd)
- Knoppen: "Bewerken", "Verwijderen", "Toevoegen aan maaltijdplanning"

"Toevoegen aan maaltijdplanning" opent een modal:
- Datumkiezer
- Maaltijdtype (ontbijt/lunch/diner/snack)
- Aantal personen (standaard: recept-standaard)
- Checkbox: "Ingrediënten ook naar boodschappenlijst"
  - Zo ja: dropdown met beschikbare lijsten
- Knop "Toevoegen"

### Formulier (nieuw/bewerken)

Twee tabbladen:
1. **Handmatig** — velden: titel, beschrijving, personen, tags, foto (upload + URL), bron-URL, ingrediënten (dynamisch), stappen (dynamisch)
2. **Importeren via URL** — URL-invoer + "Importeren" knop → vult tabblad 1 voor

Ingrediënten: per rij naam + hoeveelheid + eenheid + verwijderknop, knop "Ingredient toevoegen"
Stappen: per rij tekstveld + verwijderknop, drag-to-reorder (optioneel, anders handmatige nummering)

### Integratie in maaltijdplanning (`/maaltijden`)

Bij aanmaken/bewerken maaltijd: zoek-dropdown "Recept koppelen (optioneel)".
Als recept geselecteerd én maaltijd opgeslagen: knop "Ingrediënten naar boodschappenlijst" verschijnt op de maaltijdkaart.
Klik → modal: aantal personen + lijstkeuze → `POST /api/v1/meals/:id/to-shopping`.

### Instellingen

Sectie "Modules" in instellingen (admin only):
- Toggle "Receptenbibliotheek" → slaat `recipes_enabled` op in sync_config
- Als uitgeschakeld: navigatie-item verborgen, routes geven 404

---

## Validatie

| Veld | Regel |
|------|-------|
| `title` | Verplicht, max 200 tekens |
| `servings` | Verplicht, integer ≥ 1, max 100 |
| `description` | Optioneel, max 2000 tekens |
| `tags` | Optioneel, max 500 tekens totaal |
| `photo_url` | Optioneel, moet beginnen met `http` |
| `source_url` | Optioneel, moet beginnen met `http` |
| `ingredient.name` | Verplicht, max 200 tekens |
| `ingredient.quantity` | Optioneel, getal ≥ 0 |
| `ingredient.unit` | Optioneel, max 50 tekens |
| `step.instruction` | Verplicht, max 2000 tekens |
| Foto upload | Max 5MB, MIME: jpeg/png/webp |
| `list_id` (to-shopping) | Verplicht, moet bestaan |
| `servings` (to-shopping) | Verplicht, integer ≥ 1 |

---

## Vertalingen (4 nieuwe sleutels per taal)

Toe te voegen aan alle 6 locale-bestanden:

```
"recipes": "Recepten"
"addRecipe": "Recept toevoegen"
"importFromUrl": "Importeren via URL"
"addToMealPlan": "Toevoegen aan maaltijdplanning"
"ingredientsToShoppingList": "Ingrediënten naar boodschappenlijst"
"scrapeUrl": "URL importeren"
"scrapeFailed": "Kon recept niet importeren van deze URL."
"servings": "Personen"
"recipeSteps": "Bereidingswijze"
"recipeIngredients": "Ingrediënten"
"recipeTags": "Tags"
"recipeSource": "Bron"
"modulesSection": "Modules"
"recipesEnabled": "Receptenbibliotheek"
```

---

## Buiten Scope

- Voedingswaarden / calorieën
- Receptboeken / collecties
- Recepten publiek delen
- Automatische eenheidsconversie (gram ↔ kg) bij samenvoegen
- Stap-voor-stap kookmodus (scherm-aan, timer per stap)
- Receptaanbevelingen op basis van beschikbare ingrediënten
