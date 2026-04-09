# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.16.0] - 2026-04-06

### Added
- Settings: categorized tab navigation - six tabs (General, Meals, Budget, Shopping, Calendar, Account) replace the flat scrolling layout (#30)
- Settings: active tab persists across page navigations via sessionStorage
- Settings: Calendar tab is automatically activated when returning from a Google/Apple OAuth callback
- Settings: tab bar is sticky so it stays visible while scrolling through tab content
- Settings: all tab labels fully translated in de, en, es, it, sv

## [0.15.0] - 2026-04-06

### Changed
- Modal: two-column form layouts now use reusable `.modal-grid` and `.modal-grid--2` CSS classes instead of inline `style` attributes - applied across Calendar, Meals, and Tasks modals (#38)
- Modal: panel on mobile now has a subtle border and large shadow for better depth and visual separation (#38)
- Modal: form groups inside grid layouts no longer need inline `margin-bottom:0` overrides - handled by `.modal-grid > .form-group` rule (#38)

## [0.14.4] - 2026-04-06

### Fixed
- PWA iOS: pinch-to-zoom disabled - added `user-scalable=no, maximum-scale=1` to viewport meta tag for native-app feel (#16)
- PWA iOS: residual body scroll fully blocked - added `overflow: hidden` to `html, body` so any minimal content overflow can no longer make the page body scrollable (#16)
- Service worker cache bumped to v28/v27 (#16)

## [0.14.3] - 2026-04-06

### Fixed
- PWA iOS: scroll bleed fully resolved - `padding-top: env(safe-area-inset-top)` moved from `body` to `.app-shell`; body-padding was pushing `.app-shell` (height: 100dvh) beyond the viewport bottom, allowing the page body itself to scroll (#16)
- PWA iOS: all fixed-height page containers (Calendar, Shopping, Meals, Notes, Budget, Contacts) now subtract `--safe-area-inset-top` from their height calculation so they no longer overflow `.app-content` in standalone mode (#16)
- Added `--safe-area-inset-top` CSS token (mirrors `env(safe-area-inset-top, 0px)`) for consistent use across all page layout calculations (#16)
- Service worker cache bumped to v27/v26 to ensure CSS changes are picked up on next update (#16)

## [0.14.2] - 2026-04-06

### Fixed
- Modal: overlay tap now reliably closes the modal on iOS Safari / PWA - added `cursor: pointer` to the overlay (iOS requires this on non-interactive elements to fire click events) and a `touchend` fallback (#29)
- Modal: close button enlarged from 32px to 40px to meet Apple's 44px touch-target recommendation (#29)
- Modal: swipe-to-close no longer triggers when scrolling content inside the sheet - drag only activates from the top handle zone or when the panel is scrolled to the top (#29)

## [0.14.1] - 2026-04-06

### Fixed
- Calendar: toolbar no longer overflows on narrow screens (< 580px) - view buttons (Monat/Woche/Tag/Agenda) now wrap to a second row so navigation and label remain fully visible (#31)
- Tasks: page title no longer visually overlaps action buttons on narrow screens - title now truncates with ellipsis when space is constrained (#31)
- Shopping: list name no longer overlaps action buttons when the name is long or the "clear checked" button is visible - name now truncates cleanly (#31)

## [0.14.0] - 2026-04-05

### Added
- Spanish (Español) translation - all sections fully translated (tasks, calendar, meals, shopping, budget, notes, contacts, settings) (#28)

## [0.13.0] - 2026-04-05

### Added
- Meals: optional recipe link per meal - add a URL in the meal modal and a link icon appears on the card for one-tap access to the recipe (#18)
- Meals: `recipe_url` field stored in the database (migration v6)

## [0.12.0] - 2026-04-05

### Added
- Shopping: custom categories - add, rename, delete and reorder shopping list categories in Settings → Shopping (#26)
- Shopping: categories are now stored in the database (`shopping_categories` table, migration v5) and fully customizable per household
- Shopping: category order in the shopping list reflects the custom sort order from Settings
- Shopping: items belonging to a deleted category are automatically moved to the next available category

## [0.11.9] - 2026-04-05

### Changed
- README: updated highlights to mention Kanban quick-status buttons and configurable budget currency; replaced docker badge with GHCR link
- docs/installation.md: restructured setup into Option A (pre-built GHCR image, no clone needed) and Option B (build from source); updated Updates section accordingly; added tip to SQLCipher troubleshooting entry
- docs/index.html (GitHub Pages): updated Get Started code block to show pre-built image path; updated task and budget feature descriptions (EN + DE) to reflect new features

## [0.11.8] - 2026-04-05

### Changed
- `docker-compose.yml` now references the pre-built GHCR image (`ghcr.io/ulsklyc/oikos:latest`) by default - no local build needed to get started (#25)
- README Quick Start now shows both the pre-built image path (no clone required) and the build-from-source path

## [0.11.7] - 2026-04-05

### Added
- Kanban view: quick-status button on each card to advance status without drag-and-drop (open → in progress → done → open) - useful for touch devices and kiosk browsers (#24)

## [0.11.6] - 2026-04-05

### Fixed
- Swedish translation: added missing rrule keys (recurrence frequency, weekday abbreviations, unit labels) - contributed by @olsson82 (#23)

## [0.11.5] - 2026-04-05

### Fixed
- Shopping list category dropdown now shows translated labels instead of hardcoded German strings (#21)
- Recurrence fields in task and calendar modals now fully translated (labels, frequency options, weekday abbreviations, unit labels) (#21)

## [0.11.3] - 2026-04-05

### Added
- Swedish (Svenska) translation - contributed by @olsson82 (#19)
- Italian (Italiano) is now explicitly listed as a language option in Settings

## [0.11.2] - 2026-04-05

### Added
- Configurable currency for the budget section: choose from 13 currencies (EUR, USD, GBP, SEK, NOK, DKK, CHF, PLN, CZK, HUF, JPY, AUD, CAD) in Settings → Budget (#20)
- Currency preference is stored household-wide via the preferences API and applied to all budget amounts and formatting

## [0.11.1] - 2026-04-05

### Fixed
- Fix dashboard meal widget ignoring meal type visibility settings - todayMeals query now reads visible_meal_types from sync_config and filters accordingly, consistent with the Meals page (#14)

## [0.11.0] - 2026-04-05

### Added
- Microinteraction improvements: subtle entrance animations, hover/active feedback, and transition polish across cards, buttons, FABs, and nav items

### Fixed
- Fix touch scroll on dashboard and all pages - use `height` instead of `min-height` on app-shell to prevent overflow blocking touch scroll on iOS/Android
- Add `inputmode` and `autocomplete` attributes to form inputs for better mobile keyboard and autofill UX
- Resolve design system audit violations: align spacing, color, border-radius, and shadow usage to tokens throughout all pages and components
- Fix touch scrolling regression in calendar, budget, and contacts introduced by layout refactor

## [0.10.0] - 2026-04-04

### Added
- Customizable meal type visibility: toggle breakfast, lunch, dinner, snack on/off in Settings (#14)
- New household-wide preferences API (`GET/PUT /api/v1/preferences`) using existing `sync_config` table
- New "Meal Plan" section in Settings page with checkbox toggles per meal type
- Meals page filters displayed slots based on household preference
- i18n keys for meal visibility settings in DE, EN, IT

## [0.9.1] - 2026-04-04

### Added
- Persist task view mode (list/kanban) across sessions via localStorage (#17)
- Support URL parameter `?view=kanban` to open tasks directly in Kanban view - ideal for tablet kiosk setups
- View toggle button reflects the persisted/URL-driven view on page load

## [0.9.0] - 2026-04-04

### Added
- Optional task priority: new "None" level allows tasks without urgency, reducing visual noise for routine tasks (#15)
- "None" is now the default priority for new tasks
- Tasks with no priority hide the priority badge entirely in list and dashboard views
- DB migration v4 extends priority CHECK constraint to include 'none'
- i18n keys for "None" priority in de, en, it locales

## [0.8.2] - 2026-04-04

### Fixed
- Fix UI overlap and scroll bleed on iOS PWA - remove double safe-area padding from body that caused content to shift under status bar (#16)
- Fix page containers using wrong nav height token (56px instead of 68px including dot indicator), causing content to render behind bottom nav on all pages
- Add `overflow: hidden` to all fixed-height page containers (shopping, meals, notes, budget, contacts) to prevent scroll bleed
- Add `overscroll-behavior-y: contain` to app-content to prevent rubber-banding scroll propagation
- Fix FAB position on all pages to account for full bottom nav height including dot indicator
- Bump service worker cache version to v23

## [0.8.1] - 2026-04-04

### Fixed
- Replace native `prompt()` dialogs with custom modals in shopping (create/rename list), tasks (add subtask), and meals (choose shopping list) - native prompts were unreliable on mobile/PWA, requiring multiple clicks to close (#12)

## [0.8.0] - 2026-04-04

### Added
- Shopping list widget on dashboard - shows lists with open items, progress bar, and item preview (discussion #9)

## [0.7.7] - 2026-04-04

### Fixed
- Fix modal not closing on mobile when tapping Cancel or Save - add fallback timer for cases where CSS animationend event does not fire (prefers-reduced-motion, tab switch, etc.)

## [0.7.6] - 2026-04-04

### Fixed
- Fix untranslated category names in tasks (group headers), budget (bar chart labels, transaction meta) - all displayed category strings now go through i18n mapping (#11)

## [0.7.5] - 2026-04-04

### Fixed
- Fix flash of unstyled content (FOUC) during page transitions - old module stylesheet is now kept until old content is removed from DOM, new content hidden until render completes
- Smooth nav-item tap transition (0.12s ease) instead of abrupt scale snap
- Add `:focus-visible` outline to interactive cards, buttons, FABs, and toggles for keyboard navigation

### Added
- Custom iOS-style toggle switch component (`.toggle`) replacing native checkboxes in calendar, notes, and budget modals
- Toast notification icons - SVG checkmark (success), alert circle (danger), warning triangle (warning) alongside color coding
- Empty-state fade-in animation (0.4s ease-out, respects `prefers-reduced-motion`)
- Swipe haptic feedback at threshold - `vibrate(15)` fires when swipe reaches 80px during touchmove in tasks and shopping
- Interface design system documentation (`.interface-design/system.md`)

## [0.7.4] - 2026-04-04

### Fixed
- Replace hardcoded `box-shadow` values in `.btn--primary` with `--shadow-sm` / `--shadow-md` tokens
- Replace `border-radius: 50%` with `var(--radius-full)` in layout and calendar styles
- Align ~25 off-grid spacing values (5px, 6px, 7px, 14px, 15px, 22px, 26px, 34px) to 4px grid using `--space-*` tokens

### Changed
- Extract 8 hardcoded `rgba()` colors from dashboard, shopping, and weather styles into new design tokens (`--color-glass`, `--color-glass-hover`, `--color-glass-border`, `--color-danger-translucent`)

## [0.7.3] - 2026-04-04

### Accessibility
- Increase font-size to 16px (`--text-md`) on mobile for `quick-add__input`, `quick-add__qty`, `quick-add__cat` (shopping), `notes-toolbar__search-input`, and `contacts-toolbar__search-input` - prevents iOS auto-zoom on input focus (WCAG touch-friendly inputs)

### Performance
- Lazy-load page-specific stylesheets on route change instead of loading all 10 upfront in `index.html` - reduces initial CSS payload; only tokens, reset, pwa, layout, and login styles are render-blocking

## [0.7.2] - 2026-04-04

### Accessibility
- Rename `#page-content` to `#main-content` so the existing skip-to-content link targets the semantic `<main>` landmark correctly
- Add `sr-only` priority labels to dashboard task items - screen readers now announce priority level instead of relying on color alone (WCAG 1.4.1)

### Fixed
- Replace hardcoded hex values in greeting widget gradient with `--color-accent-active` / `--color-accent` tokens - dark mode now correctly themes the greeting banner
- Replace hardcoded `gap: 2px` with `--space-0h` token in greeting widget

## [0.7.1] - 2026-04-04

### Security
- Fix stored XSS across all pages - extract shared `esc()` utility (`public/utils/html.js`) and apply HTML escaping to all user-controlled data in innerHTML templates (titles, names, locations, descriptions, colors, notes content, autocomplete suggestions)
- Remove `user-scalable=no` and `maximum-scale=1` from viewport meta tag - restores pinch-to-zoom accessibility (WCAG 1.4.4)

### Changed
- Deduplicate 8 identical `escHtml()` functions (tasks, shopping, calendar, notes, meals, contacts, budget, settings) into single shared `esc()` import from `utils/html.js`
- Shared `esc()` also escapes single quotes (`'` to `&#39;`) for safer attribute contexts

## [0.7.0] - 2026-04-04

### Security
- Upgrade bcrypt from 5.1.1 to 6.0.0 - resolves 4 HIGH path traversal CVEs in transitive `tar` dependency via `@mapbox/node-pre-gyp`
- Remove hardcoded fallback session secret - server now always throws if `SESSION_SECRET` is unset, regardless of `NODE_ENV`

### Changed
- **Breaking:** Migrate entire server and test suite from CommonJS to ESM - all `require()`/`module.exports` replaced with `import`/`export`; `"type": "module"` added to `package.json`
- Replace 40+ unstructured `console.*` calls with `server/logger.js` - thin wrapper supporting `LOG_LEVEL` env var (debug/info/warn/error), zero new dependencies
- Translate `package.json` description to English for consistency with all other documentation
- Translate `.env.example` comments from German to English for international contributors
- Translate `.gitignore` comments to English

### Removed
- Remove internal audit documents (`docs/claude-md-audit.md`, `docs/repo-audit-2026-04-02.md`) from tracked files
- Remove empty `.worktrees/` leftover directory

### Added
- Add `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- Add `.gitignore` patterns for audit report files (`docs/audit-report-*.md`, `docs/*-audit.md`)

## [0.6.0] - 2026-04-03

### Fixed
- Fix budget entry update failing with "Internal Error" when changing category - `date` validator import shadowed the `date` field from the request body, causing SQLite to receive a function reference instead of a string value (fixes #8)

## [0.5.9] - 2026-04-03

### Security
- Fix stored XSS in task titles and subtask titles - all user-provided text in tasks.js is now escaped via `escHtml()` before insertion into innerHTML templates
- Fix stored XSS in settings page member list - display_name and username are now escaped via `escHtml()` in `memberHtml()`
- Fix rate limiter bypass via X-Forwarded-For IP spoofing - `trust proxy` now defaults to `loopback` instead of unconditional `1`; configurable via `TRUST_PROXY` env var
- Fix Google OAuth CSRF - add cryptographic `state` parameter to OAuth flow, validated on callback
- Fix CSV injection in budget export - fields starting with `=`, `+`, `-`, `@`, tab, or carriage return are now prefixed with apostrophe
- Fix missing session invalidation on user deletion - all active sessions of deleted users are now destroyed
- Restrict username to `[a-zA-Z0-9._-]` with minimum 3 characters, preventing HTML/script injection via usernames
- Restrict Google Calendar sync trigger (`POST /google/sync`) and Apple Calendar sync trigger (`POST /apple/sync`) to admin role
- Add warning log when Apple CalDAV credentials are stored without DB encryption enabled

## [0.5.8] - 2026-04-03

### Added
- Add Italian (Italiano) localization - full translation of all 497 i18n keys (thanks @albanobattistella, PR #7)
- Add Italian as selectable language in Settings locale picker

## [0.5.7] - 2026-04-03

### Fixed
- Fix recurring calendar events not expanding - RRULE parser now strips the `RRULE:` prefix used by ICS/CalDAV, which previously caused all recurrence rules to be silently ignored
- Fix recurring multi-day events not appearing when their start date falls before the view window but the event spans into it
- Fix all-day recurring event instances getting datetime end values instead of date-only format
- Add YEARLY recurrence frequency support for birthday and anniversary events

## [0.5.6] - 2026-04-03

### Fixed
- Fix all-day calendar events appearing on the correct day and the following day - ICS DTEND for DATE values is exclusive per RFC 5545, now correctly adjusted (fixes #5)
- Fix multi-day events not showing when using DURATION instead of DTEND - add ICS DURATION property support in CalDAV parser
- Fix birthdays from Apple Calendar not syncing - birthday calendars are no longer excluded from sync
- Fix outbound ICS builder using inclusive DTEND for all-day events - now correctly emits exclusive DTEND per RFC 5545

## [0.5.5] - 2026-04-03

### Fixed
- Fix iCloud Calendar sync failing with FOREIGN KEY constraint error - `created_by` was hardcoded to user ID 1 instead of resolving dynamically (fixes #4)
- Sync all iCloud calendars instead of only the first one - previously only a single calendar was imported, ignoring Family, subscribed, and other calendars
- Add missing `cfgDel` helper function used by `clearCredentials` - disconnecting Apple Calendar would crash
- Skip unreachable or broken calendars gracefully instead of aborting the entire sync

## [0.5.4] - 2026-04-03

### Fixed
- Fix SQLCipher PRAGMA key syntax error on fresh install - hex-encoded key must be wrapped in double quotes for valid PRAGMA syntax (fixes #3)

## [0.5.3] - 2026-04-03

### Security
- Fix SQLCipher PRAGMA key interpolation - encryption keys containing single quotes no longer crash on startup; key is now hex-encoded
- Enforce minimum password length (8 characters) when admin creates new users - previously any 1-character password was accepted
- Add length bounds on username (64 chars) and display_name (128 chars) to prevent unbounded input
- Add input length bounds on login (username 64 chars, password 1024 chars)
- Invalidate all other sessions when a user changes their password - previously active sessions survived password reset
- Session and CSRF cookies now have `secure: true` by default; HTTP is only allowed when `SESSION_SECURE=false` is explicitly set in `.env` - previously cookies were sent without `Secure` flag in non-production environments
- Document authorization model in SECURITY.md - clarify that all family members share read/write access to all data by design

### Changed
- Use multi-stage Docker build to exclude build tools (python3, make, g++) from runtime image
- Exclude `docs/` directory from Docker image via `.dockerignore`
- Consolidate `dotenv.config()` to single call in `server/index.js` - remove duplicate calls from `server/db.js` and `server/auth.js`

## [0.5.2] - 2026-04-01

### Security
- Add rate limiting to SPA fallback route to prevent file system hammering via unauthenticated wildcard requests
- Add CSRF protection to auth routes that change state (logout, create user, change password, delete user) - previously bypassed global CSRF middleware due to router registration order
- Fix incomplete vCard escaping in contacts export - backslash characters are now escaped first before other special characters (`,`, `;`, newline), preventing injection via contact fields
- Restrict CI workflow GITHUB_TOKEN to `contents: read` (principle of least privilege)

## [0.5.1] - 2026-04-01

### Fixed
- Meals: fixed crash when dragging a meal slot - `dragging` state is now destructured before `cleanup()` runs, preventing a null-reference error on drop
- i18n: `t()` now resolves dot-notation keys against nested locale JSON objects (e.g. `t('nav.tasks')` correctly returns `"Aufgaben"` instead of the raw key string); affects all pages, components, and navigation
- PWA: replaced placeholder "O" icons with the actual Oikos house logo across all icon variants (192, 512, maskable 192, maskable 512, apple-touch-icon, favicon); maskable variants use full-bleed background with logo within the 80% safe zone - fixes Android home screen showing only a blue circle
- PWA: weather widget icons (OpenWeatherMap) now render correctly in installed PWA on Android; service worker no longer intercepts cross-origin image requests (opaque responses caused silent rendering failures in standalone mode)
- Settings: language selector replaced from cramped radio buttons to a native `<select>` dropdown using the standard `form-input` style

### Changed
- PWA manifest: added `id` field and `display_override` array for reliable Chrome Android PWA recognition; `manifest.json` is now served with `Content-Type: application/manifest+json`
- Service worker (v22): `/i18n.js` and locale files added to app-shell cache; cross-origin asset requests excluded from cache-first strategy

## [0.5.0] - 2026-03-31

### Added
- i18n: full internationalisation system (`public/i18n.js`) with German (de) and English (en) support; language auto-detected from `navigator.language`, overridable via Settings
- i18n: all user-facing strings moved to locale files (`public/locales/de.json`, `public/locales/en.json`); 489 translation keys covering all modules
- i18n: locale switch without page reload - all pages, components and navigation re-render via `locale-changed` custom event
- i18n: `oikos-locale-picker` Web Component in Settings - three options: System (follows browser language), Deutsch, English
- i18n: dates and times formatted with `Intl.DateTimeFormat` using the active locale; `formatDate()` and `formatTime()` exported from `i18n.js`
- i18n: fallback chain (active locale → German → key) ensures no untranslated keys are shown even if a future locale file is incomplete
- i18n: adding a new language requires only one JSON file (`public/locales/xx.json`) and one line in `SUPPORTED_LOCALES`

## [0.4.0] - 2026-03-31

### Fixed
- Mobile: toast notifications no longer overlap with the bottom navigation bar - introduced `--nav-bottom-height` token (scroll area 56px + dots indicator 12px) used consistently by toast container and app content padding
- Mobile: FAB and page-FAB are now hidden when the virtual keyboard is open, preventing them from covering form inputs; detection uses `visualViewport.resize` with a 75% height threshold
- UI: added missing dark-mode colour overrides for shopping, notes, contacts, budget, and settings module tokens - accent stripes now render at readable pastel values in dark theme
- UI: meals week-navigation bar now shows module accent top-border stripe; settings page now declares --module-accent for consistency with all other modules

### Added
- Shopping: swipe-left to toggle checked/unchecked, swipe-right to delete items on mobile; × delete button hidden on mobile in favour of swipe gesture
- Notes: client-side full-text search bar in toolbar - filters by title and content instantly; shows "Keine Treffer" empty state when no match
- Dashboard: weather widget refresh button (top-right corner) + automatic 30-minute refresh interval; interval is cleared when navigating away
- Contacts: vCard export button per contact (downloads .vcf file); vCard import via file input in toolbar (parses FN, TEL, EMAIL, ADR, NOTE, CATEGORIES fields)
- PWA: offline fallback page (`/offline.html`) served by service worker when network is unavailable and index.html is not cached; page includes a reload button
- UI: module accent colours now applied to three visual layers - active nav tab (bottom bar + sidebar), toolbar top-border stripe, and list/card left-border stripe - giving each module a distinct colour identity

## [0.3.0] - 2026-03-31

### Added
- Calendar: recurring events are now expanded in GET /api/v1/calendar - all occurrences within the requested date window are returned as virtual instances; duration is preserved; instances are marked with is_recurring_instance=1 and shown with a ↻ icon in the agenda view; /upcoming also expands recurring events within a 90-day window
- Budget: recurring entries auto-generate instances for each viewed month; instances deleted by the user are skipped permanently via `budget_recurrence_skipped` table; generated instances are marked with ↩ in the transaction list
- Budget: month-over-month comparison in summary cards - each card (Einnahmen, Ausgaben, Saldo) shows a trend line (▲/▼ + delta amount vs. previous month); previous month summary is fetched in parallel with current month
- Meals: drag & drop between slots and days using Pointer Events (touch + mouse); ghost element follows pointer; drop on occupied slot swaps meals; reduced-motion: no ghost animation, interaction still works
- Settings: Apple CalDAV credentials form (URL, Apple-ID, app-specific password) with live connection test; admin can connect and disconnect via UI without restarting the server; DB-stored credentials take precedence over .env vars; auto-sync runs every 15 min (configurable via SYNC_INTERVAL_MINUTES)

## [0.2.1] - 2026-03-30

### Fixed
- Accumulating click listeners on `#notes-grid`: listener is now registered once in `render()` via event delegation instead of re-registered in every `renderGrid()` call
- Accumulating anonymous `document` click listener in dashboard FAB: `initFab()` now accepts an AbortSignal; `render()` aborts the previous signal before creating a new one, eliminating listener leaks across navigation cycles
- Add `btnError()` shake feedback to notes.js save error handler for consistency with other modules
- Calendar event popup `closePopup` listener now checks `popup.isConnected` to self-remove correctly after navigation without a click

### Added
- CSS alias `.form-label` alongside `.label` to cover usage in `notes.js` and `settings.js` without requiring a mass-rename
- Tests for `wireBlurValidation`, `btnSuccess`, and `btnError` (12 cases) in `test-modal-utils.js`

## [0.2.0] - 2026-03-30

### Changed
- Directional slide-x page transitions (forward = right, backward = left) with race condition guard
- PWA install prompt delayed until 2 user interactions; dismiss window reduced from 30 to 7 days; interaction counter resets on dismiss
- Unified card padding to 16px (`--space-4`) across tasks, contacts, budget, and meals modules

### Added
- Staggered fade-in animation for list items on page load across all modules (tasks, shopping, meals, contacts, budget, notes, calendar agenda)
- Unified empty states using shared `.empty-state` class across all modules (replaces per-module CSS)
- `stagger()` and `vibrate()` UX utilities in `public/utils/ux.js` with full test coverage
- Proportional opacity on swipe-reveal action areas in tasks (already implemented, confirmed)
- FAB colors tied to per-module accent tokens via CSS custom properties
- `scrollIntoView` for focused inputs when virtual keyboard opens in modals (300ms delay)
- Consistent vibration feedback via `vibrate()` utility across tasks, shopping, contacts, budget, and notes
- Bottom sheet modal on mobile (< 768px) with drag handle, slide-in animation, and swipe-to-close
- Enter-key navigation between form fields in modals; Enter on last field triggers submit
- Blur-triggered inline validation for required fields with error/success border states
- `wireBlurValidation()`, `btnSuccess()`, and `btnError()` exported from `modal.js`
- Submit button checkmark-success (700ms) and shake-error feedback animations

## [0.1.0] - 2026-03-29

Initial release of Oikos - a self-hosted family planner for 2–6 person households. Runs as a Docker container behind Nginx with SSL, no cloud dependency.

### Added

- **Dashboard** with time-of-day greeting, urgent tasks, upcoming events, today's meals, pinned notes, and weather widget (OpenWeatherMap integration with 3–5 day forecast scaling by screen size)
- **Task management** with categories, priorities, due dates, subtasks (max 2 levels), list and Kanban views, swipe gestures on mobile (swipe left = toggle done, swipe right = edit), and recurring tasks via iCal RRULE
- **Shopping lists** with multiple named lists, supermarket-aisle sorting, autocomplete from history, optimistic checkbox toggle, and bulk-clear of checked items
- **Weekly meal planner** with breakfast/lunch/dinner/snack grid (Mon–Sun), ingredient tracking per meal, and one-click transfer of ingredients to shopping lists
- **Calendar** with month, week, day, and agenda views, multi-day event support, color-coded entries, and family member assignment
- **Google Calendar sync** via OAuth 2.0 with incremental sync tokens and **Apple CalDAV sync** via tsdav, both bidirectional
- **Pinboard** (notes) with color-coded sticky notes, pin-to-top, Markdown formatting toolbar (bold, italic, lists, headings, code, links), and automatic text contrast based on background color
- **Contacts** directory with category filtering (doctor, emergency, trades, etc.), full-text search, and direct tel:/mailto:/maps: links
- **Budget tracker** with income/expense logging, monthly navigation, category breakdown bar charts (pure CSS), and CSV export
- **Settings page** for password change, calendar sync status, and family member management
- **Authentication** with session-based login (bcrypt, httpOnly/secure/sameSite cookies, 7-day TTL), admin-only user creation, and rate-limited login (5 attempts/min with 15-min lockout)
- **CSRF protection** using Double Submit Cookie pattern with timing-safe comparison
- **Progressive Web App** with app-shell caching (service worker with stale-while-revalidate for static assets, network-first for navigation, network-only for API), custom install prompt for Android and iOS, dynamic theme-color per module, safe area inset handling, and offline fallback
- **Responsive design** with mobile bottom navigation (swipeable pages with dot indicator), collapsible sidebar on tablet, and full sidebar on desktop
- **Dark mode** with system preference detection and manual toggle, warm-tinted neutral color scale
- **Design system** with CSS custom properties (tokens for colors, spacing, typography, shadows, radii, z-indices), module-specific accent colors, and consistent component patterns
- **Accessibility** improvements: skip link, sr-only headings on all pages, aria-hidden decorative icons, aria-label on icon-only buttons, token-based touch targets (44–48px), 12px minimum font size, and prefers-reduced-motion support
- **Docker deployment** with docker-compose, optional SQLCipher encryption (AES-256), and nginx.conf example
- **Setup script** (`node setup.js`) for initial admin account creation with LAN-reachable URL display
- **Input validation** middleware with centralized rules (string length, date/time format, enum, color) across all API routes
- **Content Security Policy** via Helmet with strict CSP, self-hosted Lucide Icons (no CDN at runtime)
- **Lazy loading** with per-page ES module imports cached in memory, Cache-Control headers (immutable for assets, must-revalidate for code), and service worker update notification

### Security

- Fail-fast on missing `SESSION_SECRET` in production
- Rate limiting on login endpoint and global API limiter (300 req/min/IP)
- No user data cached by service worker (API requests are network-only)
- Hardened `.gitignore` and `.dockerignore` to prevent accidental secret or binary leakage

[Unreleased]: https://github.com/ulsklyc/oikos/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ulsklyc/oikos/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ulsklyc/oikos/compare/v0.5.9...v0.6.0
[0.5.9]: https://github.com/ulsklyc/oikos/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/ulsklyc/oikos/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/ulsklyc/oikos/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/ulsklyc/oikos/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/ulsklyc/oikos/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/ulsklyc/oikos/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/ulsklyc/oikos/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/ulsklyc/oikos/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ulsklyc/oikos/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ulsklyc/oikos/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ulsklyc/oikos/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ulsklyc/oikos/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/ulsklyc/oikos/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ulsklyc/oikos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ulsklyc/oikos/releases/tag/v0.1.0
