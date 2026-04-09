# Backlog

Feature requests and planned extensions. Entries here will **not** be implemented until explicitly prioritized and moved into a release branch.

New suggestion? → [Open an issue](https://github.com/ulsklyc/oikos/issues/new?template=feature_request.md) or add it here.

## Open Entries

| ID | Issue | Feature | Notes |
|----|-------|---------|-------|
| BL-11 | [#10](https://github.com/ulsklyc/oikos/issues/10) | Contacts: CardDAV (read-only) provider | Sync address book entries from phone/server; backend lib evaluation needed |
| BL-12 | — | Contacts: i18n-neutral category keys | VALID_CATEGORIES in server/routes/contacts.js are hardcoded German strings stored in DB; needs locale-agnostic keys (e.g. 'doctor') with server-side label mapping |

---

## Completed Features (Reference)

| ID | Feature | Version |
|----|---------|---------|
| BL-01 | Calendar: Expand recurring events (RRULE) | v0.3.0 |
| BL-02 | Budget: Monthly comparison (current vs. previous month) | v0.3.0 |
| BL-03 | Meal plan: Drag & drop between slots and days | v0.3.0 |
| BL-04 | Calendar sync: Wire up settings UI completely | v0.3.0 |
| BL-05 | Budget: Auto-generate recurring entries | v0.3.0 |
| BL-06 | Shopping: Quick-add autocomplete | v0.3.0 |
| BL-07 | Notes: Full-text search / filter | v0.4.0 |
| BL-08 | Dashboard: Weather widget refresh | v0.4.0 |
| BL-09 | Contacts: vCard import / export | v0.4.0 |
| BL-10 | PWA: Offline fallback for critical pages | v0.4.0 |
| - | UX Polish (animations, bottom sheet, FAB, stagger, vibration) | v0.2.0 |
| - | Event listener leaks, CSS gaps, modal tests | v0.2.1 |
| - | Internationalisation system (de + en), locale picker, formatDate/Time | v0.5.0 |
| - | PWA: Correct Oikos icons (192/512/maskable/apple-touch), service worker v22 | v0.5.1 |
| - | Calendar: Fix all-day RFC 5545 DTEND, DURATION support, birthday sync | v0.5.6 |
| - | Calendar: RRULE expansion fix (strip RRULE: prefix), YEARLY support | v0.5.7 |
| - | Italian (it) localization (497 keys) | v0.5.8 |
| - | Swedish (sv) localization (548 keys) - contributed by @olsson82 | v0.11.3 |
| - | Security hardening: XSS, rate limiter bypass, OAuth CSRF, CSV injection, session invalidation | v0.5.9 |
| - | Budget: Fix update failing when category changes | v0.6.0 |
| - | Upgrade bcrypt 5 → 6, ESM migration, structured logger, remove SESSION_SECRET fallback | v0.7.0 |
