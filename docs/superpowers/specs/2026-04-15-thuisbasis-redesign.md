# ThuisBasis.app — Herontwerp Design Spec

**Datum:** 2026-04-15
**Status:** Goedgekeurd
**Vervangt:** Oikos (alle versies)

---

## Doel

Volledige visuele herontwerp van de app: nieuwe naam (ThuisBasis.app), nieuw design system, nieuwe typografie, en een kleurrijker/levendiger karakter. De functionaliteit blijft ongewijzigd — alleen de look & feel verandert.

---

## Scope

- Hernoemen van "Oikos" naar "ThuisBasis" in alle teksten, titels, manifest, README
- Nieuw typografiesysteem: Plus Jakarta Sans
- Nieuw kleursysteem: warm-neutraal basis + fellere module-kleuren
- Component-upgrades: border-radius, kaart-tinting, pill-knoppen, micro-interacties
- Navigatie-updates: gekleurde actieve states, luchtiger sidebar
- Dark mode: aangepast aan nieuw palet
- CSS tokens volledig herwerken in `tokens.css`

**Buiten scope:**
- Functionaliteit wijzigen
- Nieuwe features toevoegen
- Backend aanpassen
- i18n-sleutels wijzigen (behalve app-naam)

---

## Brand

### Naam
**ThuisBasis.app**
- Tagline: *"Alles voor thuis, op één plek"*
- Afkorting intern: `TB`
- Vorige naam: Oikos

### Logo
- SVG Lucide `home` icoon als basis
- Geen emoji
- Kleur: primaire module-kleur (`#2563EB`) of neutraal wit op gekleurde achtergrond

---

## Typografie

**Font:** Plus Jakarta Sans (vervangt system-font stack)

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,opsz,wght@0,6..18,300;0,6..18,400;0,6..18,500;0,6..18,600;0,6..18,700;1,6..18,400&display=swap');

--font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

| Niveau | Weight | Grootte |
|--------|--------|---------|
| Page title | 700 | 24–30px |
| Section heading | 600 | 18–20px |
| Body | 400 | 14px (desktop) / 16px (mobile) |
| Label / meta | 500 | 12–13px |
| Caption | 400 | 12px |

**Regels:**
- Minimaal 16px body op mobile (voorkomt iOS auto-zoom)
- Line-height 1.5 voor body, 1.25 voor headings
- Letter-spacing: standaard (geen tight tracking op body)

---

## Kleursysteem

### Basis tokens (warm-neutraal)

```css
/* Achtergrond & Surfaces */
--color-bg:            #FAFAF7;   /* warm off-white */
--color-surface:       #FFFFFF;
--color-surface-2:     #F5F4EF;
--color-surface-3:     #EEECEA;

/* Borders */
--color-border:        #E8E6E0;
--color-border-subtle: #F0EEE8;

/* Tekst */
--color-text-primary:   #1A1917;
--color-text-secondary: #6B6A65;
--color-text-tertiary:  #9B9A96;
--color-text-disabled:  #C4C2BE;
--color-text-on-accent: #FFFFFF;

/* Semantisch */
--color-success:       #16A34A;
--color-success-light: #DCFCE7;
--color-warning:       #CA8A04;
--color-warning-light: #FEF9C3;
--color-danger:        #DC2626;
--color-danger-light:  #FEE2E2;
--color-info:          #0891B2;
--color-info-light:    #CFFAFE;

/* Accent (dashboard / default) */
--color-accent:        #2563EB;
--color-accent-hover:  #1D4ED8;
--color-accent-light:  #EFF6FF;
```

### Module-kleuren (feller dan voorheen)

```css
--module-dashboard:  #2563EB;   /* Blauw */
--module-tasks:      #16A34A;   /* Groen */
--module-calendar:   #7C3AED;   /* Paars */
--module-meals:      #EA580C;   /* Oranje */
--module-recipes:    #C2410C;   /* Rood-oranje */
--module-shopping:   #0891B2;   /* Cyaan */
--module-notes:      #CA8A04;   /* Amber */
--module-contacts:   #0284C7;   /* Hemelsblauw */
--module-budget:     #059669;   /* Smaragd */
--module-settings:   #64748B;   /* Leisteen */
```

### Kaart-tinting (Aanpak 2 kern)

In module-context krijgen kaarten een `8%` tint van de module-kleur:

```css
/* Voorbeeld voor taken */
.task-card {
  background-color: color-mix(in srgb, var(--module-tasks) 8%, var(--color-surface));
}
```

### Dark mode

Warm donker basis (`#1C1B19`). Module-kleuren krijgen `+25% lightness` variant. Kaart-tinting blijft `8%` maar op donkere surface.

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg:      #1C1B19;
    --color-surface: #242320;
    /* Module-kleuren: lichtere varianten */
    --module-tasks:    #4ADE80;
    --module-calendar: #A78BFA;
    --module-meals:    #FB923C;
    /* etc. */
  }
}
```

---

## Border-radius systeem

```css
--radius-xs:   4px;   /* badges intern */
--radius-sm:   10px;  /* inputs, kleine elementen */
--radius-md:   16px;  /* kaarten, dropdowns */
--radius-lg:   20px;  /* modals, panels */
--radius-xl:   28px;  /* grote kaarten */
--radius-full: 9999px; /* pills, primary buttons, tags */
```

---

## Navigatie

### Desktop sidebar
- Collapsed breedte: 64px (was 56px)
- Expanded breedte: 220px (ongewijzigd)
- Actief item: module-kleur achtergrond-tint (12%) + module-kleur icoon
- Inactief item: module-kleur icoon op 45% opacity — levendig maar rustig
- Hover: 6% module-kleur tint

### Mobile bottom nav
- Actief item: module-kleur icoon + gekleurde pill-indicator (4px) boven label
- Inactief: neutraal grijs icoon + label
- Swipe tussen pagina's: ongewijzigd

### Page header patroon
Elke pagina: `4px` gekleurde top-border in module-kleur (was 3px, nu iets dikker).

---

## Componenten

### Knoppen

```css
/* Primary — pill, module-kleur */
.btn--primary {
  border-radius: var(--radius-full);
  background: var(--module-accent, var(--color-accent));
  color: var(--color-text-on-accent);
  font-weight: 600;
  transition: transform 150ms ease-out, box-shadow 150ms ease-out;
}
.btn--primary:active { transform: scale(0.97); }

/* Secondary — border, transparant */
.btn--secondary {
  border-radius: var(--radius-sm);
  border: 1.5px solid currentColor;
  background: transparent;
}

/* Ghost */
.btn--ghost {
  border-radius: var(--radius-sm);
  background: transparent;
}
.btn--ghost:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
```

### Kaarten

```css
.card {
  border-radius: var(--radius-md);   /* 16px */
  border: 1px solid var(--color-border);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: transform 200ms ease-out, box-shadow 200ms ease-out;
}
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.10);
}
```

### Inputs

```css
.form-input {
  border-radius: var(--radius-sm);   /* 10px */
  border: 1.5px solid var(--color-border);
  font-family: var(--font-sans);
  font-size: var(--text-base);
}
.form-input:focus {
  border-color: var(--module-accent, var(--color-accent));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
}
```

### Badges & tags

```css
.badge {
  border-radius: var(--radius-full);
  padding: 2px 10px;
  font-size: var(--text-xs);
  font-weight: 500;
}
```

### Modals / panels

```css
.modal {
  border-radius: var(--radius-lg);   /* 20px */
  /* slide-up + fade-in animatie: 250ms */
}
```

### Micro-interacties

| Element | Interactie | Duur | Easing |
|---------|-----------|------|--------|
| Primary button | `scale(0.97)` on press | 150ms | ease-out |
| Kaart | `translateY(-2px)` on hover | 200ms | ease-out |
| Modal open | slide-up + fade-in | 250ms | ease-out |
| Modal sluit | slide-down + fade-out | 180ms | ease-in |
| Toast in | slide-in rechts | 200ms | ease-out |
| Toast uit | fade-out | 150ms | ease-in |
| Nav-item | kleur-transitie | 150ms | ease |

Alle animaties: `@media (prefers-reduced-motion: reduce)` → geen transforms/slides, alleen opacity-fade.

---

## Hernoemen: Oikos → ThuisBasis

| Bestand | Wijziging |
|---------|-----------|
| `public/index.html` | `<title>`, `<meta name="application-name">`, `<meta name="apple-mobile-web-app-title">` |
| `public/manifest.json` | `name`, `short_name` |
| `public/router.js` | Logo-tekst in sidebar: "ThuisBasis" |
| `README.md` | Alle vermeldingen van "Oikos" |
| `CHANGELOG.md` | Header-tekst |
| `server/logger.js` | App-naam in log-prefix (indien aanwezig) |

---

## Implementatievolgorde

1. **tokens.css** — alle CSS tokens herschrijven (basis + module-kleuren + radius)
2. **layout.css** — sidebar breedte, nav-actieve states
3. **reset.css / index.html** — Plus Jakarta Sans importeren, font-stack instellen
4. **layout.css** — button-stijlen (pill primary, radius updates)
5. **Per module CSS** — kaart-tinting, module-accent variabelen
6. **Hernoemen** — index.html, manifest.json, router.js, docs
7. **Dark mode** — tokens aanpassen voor nieuw palet

---

## Toegankelijkheid

- Alle module-kleuren getest op `4.5:1` contrast op witte achtergrond ✓
- Focus rings: 3px in module-kleur (zichtbaar en opvallend)
- `prefers-reduced-motion`: alle transforms/slides uitgeschakeld, alleen opacity
- Touch targets: minimum 44×44px gehandhaafd
- Geen emoji als iconen — Lucide SVG throughout

---

## Buiten Scope

- Nieuwe features of functionaliteit
- Wijzigingen aan de database of API
- Nieuwe talen of i18n-sleutels (behalve app-naam strings)
- Redesign van specifieke pagina-layouts (alleen tokens/componenten)
