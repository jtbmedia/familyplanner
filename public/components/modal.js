/**
 * Modul: Shared Modal-System
 * Zweck: Einheitliches Modal mit Focus-Trap, Escape-Handler, Overlay-Click,
 *        Focus-Restore, Scroll-Lock und aria-modal.
 *        Auf Mobile: Bottom Sheet mit Swipe-to-Close und Slide-out-Animation.
 * Abhängigkeiten: CSS-Klassen aus layout.css (.modal-overlay, .modal-panel, etc.)
 *                 i18n.js (t)
 *
 * API:
 *   openModal({ title, content, onSave, onDelete, size }) → void
 *   closeModal() → void
 */

import { t } from '/i18n.js';

let activeOverlay = null;
let previouslyFocused = null;
let focusTrapHandler = null;

// Overlay-Dimming: theme-color abdunkeln im Standalone-Modus
const OVERLAY_THEME_COLOR = '#1A1A1A';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// --------------------------------------------------------
// Focus-Trap (Spec §5.2)
// --------------------------------------------------------

function trapFocus(container) {
  focusTrapHandler = (e) => {
    // Tab-Trap: Fokus innerhalb des Modals halten
    if (e.key === 'Tab') {
      const focusable = container.querySelectorAll(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    // Enter in einzeiligen Inputs/Selects → zum nächsten Feld springen
    if (e.key === 'Enter') {
      const active = document.activeElement;
      const isInput = active.tagName === 'INPUT' && active.type !== 'submit' && active.type !== 'button';
      const isSelect = active.tagName === 'SELECT';

      if (isInput || isSelect) {
        const focusable = Array.from(container.querySelectorAll(FOCUSABLE));
        const idx = focusable.indexOf(active);
        const next = focusable[idx + 1];

        if (next && next.tagName !== 'BUTTON') {
          e.preventDefault();
          next.focus();
        }
        // Beim letzten Feld oder wenn Next ein Button ist: Submit auslösen
        if (!next || next.tagName === 'BUTTON') {
          const submitBtn = container.querySelector('button[type="submit"], .btn--primary');
          if (submitBtn && !submitBtn.disabled) {
            e.preventDefault();
            submitBtn.click();
          }
        }
      }
    }
  };
  container.addEventListener('keydown', focusTrapHandler);

  // Virtual Keyboard: Focused Input in sichtbaren Bereich scrollen
  function onInputFocus(e) {
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
  container.addEventListener('focusin', onInputFocus);
  container._onInputFocus = onInputFocus;

  // Focus first focusable element
  const first = container.querySelector(FOCUSABLE);
  if (first) {
    setTimeout(() => first.focus(), 50);
  }
}

// --------------------------------------------------------
// Escape-Handler
// --------------------------------------------------------

function onEscape(e) {
  if (e.key === 'Escape') closeModal();
}

// --------------------------------------------------------
// Swipe-to-Close (Mobile)
// --------------------------------------------------------

function _wireSheetSwipe(panel) {
  let startY = 0;
  let dragging = false;

  panel.addEventListener('touchstart', (e) => {
    // Nur von der Handle-Zone (obere 48px) oder wenn Panel ganz oben → Swipe erlauben
    const touchY = e.touches[0].clientY;
    const rect = panel.getBoundingClientRect();
    const isHandleZone = touchY - rect.top < 48;
    const isScrolledToTop = panel.scrollTop <= 0;
    if (!isHandleZone && !isScrolledToTop) return;
    startY = touchY;
    dragging = true;
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) { dragging = false; return; } // Aufwärts-Scroll: Swipe abbrechen
    panel.style.transform = `translateY(${dy * 0.6}px)`;
  }, { passive: true });

  panel.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    panel.style.transform = '';
    if (dy > 80) {
      closeModal();
    }
  });
}

// --------------------------------------------------------
// _doClose - gemeinsame Cleanup-Logik
// --------------------------------------------------------

function _doClose() {
  if (!activeOverlay) return;
  activeOverlay.remove();
  activeOverlay = null;

  // Scroll-Lock aufheben
  document.body.style.overflow = '';

  // Focus-Restore
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus();
    previouslyFocused = null;
  }

  // Standalone: Statusbar-Farbe zur aktuellen Route wiederherstellen
  if (window.oikos?.restoreThemeColor) {
    window.oikos.restoreThemeColor();
  }
}

// --------------------------------------------------------
// openModal
// --------------------------------------------------------

/**
 * Öffnet ein Modal mit dem Shared-System.
 *
 * @param {Object}   opts
 * @param {string}   opts.title    - Titel im Modal-Header
 * @param {string}   opts.content  - HTML-String für den Modal-Body
 * @param {Function} [opts.onSave]   - Callback, wird nach Einfügen in DOM aufgerufen
 *                                      (zum Binden von Form-Events)
 * @param {Function} [opts.onDelete] - Falls vorhanden, wird ein Löschen-Button eingebaut
 * @param {string}   [opts.size='md'] - 'sm' | 'md' | 'lg'
 */
export function openModal({ title, content, onSave, onDelete, size = 'md' } = {}) {
  // Vorheriges Modal schließen (kein Stacking)
  if (activeOverlay) closeModal();

  // Focus-Restore vorbereiten
  previouslyFocused = document.activeElement;

  // Scroll-Lock
  document.body.style.overflow = 'hidden';

  const sizeClass = size !== 'md' ? ` modal-panel--${size}` : '';

  const html = `
    <div class="modal-overlay" id="shared-modal-overlay">
      <div class="modal-panel${sizeClass}" role="dialog" aria-modal="true"
           aria-labelledby="shared-modal-title">
        <div class="modal-panel__header">
          <h2 class="modal-panel__title" id="shared-modal-title">${title}</h2>
          <button class="modal-panel__close" data-action="close-modal" aria-label="${t('modal.closeLabel')}">
            <i data-lucide="x" style="width:16px;height:16px" aria-hidden="true"></i>
          </button>
        </div>
        <div class="modal-panel__body">
          ${content}
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  activeOverlay = document.getElementById('shared-modal-overlay');

  // Lucide-Icons rendern
  if (window.lucide) window.lucide.createIcons();

  // Focus-Trap
  const panel = activeOverlay.querySelector('.modal-panel');
  trapFocus(panel);

  // Swipe-to-Close auf Mobile
  if (window.innerWidth < 768) {
    _wireSheetSwipe(panel);
  }

  // Overlay-Click schließt Modal
  activeOverlay.addEventListener('click', (e) => {
    if (e.target === activeOverlay) closeModal();
  });

  // iOS PWA: click-Events auf non-interactive divs sind unzuverlässig →
  // touchend als Fallback (passive, damit Scroll nicht blockiert wird)
  activeOverlay.addEventListener('touchend', (e) => {
    if (e.target === activeOverlay) closeModal();
  }, { passive: true });

  // Close-Button
  activeOverlay.querySelector('[data-action="close-modal"]')
    ?.addEventListener('click', closeModal);

  // Escape
  document.addEventListener('keydown', onEscape);

  // Callback für Aufrufer (Form-Events binden etc.)
  if (typeof onSave === 'function') onSave(panel);

  // Standalone: Statusbar abdunkeln (Overlay-Effekt)
  if (window.oikos?.setThemeColor) {
    window.oikos.setThemeColor(OVERLAY_THEME_COLOR, OVERLAY_THEME_COLOR);
  }
}

// --------------------------------------------------------
// closeModal
// --------------------------------------------------------

export function closeModal() {
  if (!activeOverlay) return;

  document.removeEventListener('keydown', onEscape);

  const panel = activeOverlay.querySelector('.modal-panel');

  // Focus-Trap-Handler und Virtual-Keyboard-Listener entfernen
  if (focusTrapHandler) {
    if (panel) panel.removeEventListener('keydown', focusTrapHandler);
    focusTrapHandler = null;
  }
  if (panel?._onInputFocus) {
    panel.removeEventListener('focusin', panel._onInputFocus);
  }

  // Sheet-Out-Animation auf Mobile, danach _doClose
  const isMobile = window.innerWidth < 768;
  if (isMobile && panel) {
    panel.classList.add('modal-panel--closing');
    // Fallback-Timer falls animationend nicht feuert (prefers-reduced-motion, Tab-Wechsel etc.)
    const fallback = setTimeout(_doClose, 300);
    panel.addEventListener('animationend', () => {
      clearTimeout(fallback);
      _doClose();
    }, { once: true });
    return;
  }

  _doClose();
}

// --------------------------------------------------------
// promptModal - Ersatz für native prompt()
// --------------------------------------------------------

/**
 * Öffnet ein Modal mit Textfeld als Ersatz für native prompt().
 * Gibt ein Promise zurück: string bei OK, null bei Cancel/Escape.
 *
 * @param {string} label   - Beschriftung / Frage
 * @param {string} [defaultValue=''] - Vorausgefüllter Wert
 * @returns {Promise<string|null>}
 */
export function promptModal(label, defaultValue = '') {
  return new Promise((resolve) => {
    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;
      closeModal();
      resolve(value);
    }

    openModal({
      title: label,
      size: 'sm',
      content: `
        <form id="prompt-modal-form" class="form-stack">
          <div class="form-field">
            <input class="form-input" id="prompt-modal-input" type="text"
                   value="${defaultValue.replace(/"/g, '&quot;')}" autocomplete="off">
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" id="prompt-modal-cancel">${t('common.cancel')}</button>
            <button type="submit" class="btn btn--primary" id="prompt-modal-ok">${t('common.save')}</button>
          </div>
        </form>`,
      onSave(panel) {
        const form  = panel.querySelector('#prompt-modal-form');
        const input = panel.querySelector('#prompt-modal-input');
        const cancel = panel.querySelector('#prompt-modal-cancel');

        form.addEventListener('submit', (e) => {
          e.preventDefault();
          finish(input.value.trim() || null);
        });

        cancel.addEventListener('click', () => finish(null));

        // Escape soll null liefern (closeModal wird über onEscape bereits ausgelöst)
        const escHandler = (e) => {
          if (e.key === 'Escape') {
            document.removeEventListener('keydown', escHandler);
            finish(null);
          }
        };
        document.addEventListener('keydown', escHandler);

        // Overlay-Click soll null liefern
        const overlay = panel.closest('.modal-overlay');
        if (overlay) {
          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) finish(null);
          });
        }

        // Input fokussieren und Text selektieren
        setTimeout(() => {
          input.focus();
          input.select();
        }, 50);
      },
    });
  });
}

// --------------------------------------------------------
// selectModal - Ersatz für native prompt() mit Auswahlliste
// --------------------------------------------------------

/**
 * Öffnet ein Modal mit Select-Dropdown als Ersatz für native prompt() bei Listenauswahl.
 *
 * @param {string} label - Beschriftung / Frage
 * @param {{ value: string|number, label: string }[]} options - Auswahloptionen
 * @returns {Promise<string|number|null>}
 */
export function selectModal(label, options) {
  return new Promise((resolve) => {
    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;
      closeModal();
      resolve(value);
    }

    const optionsHtml = options
      .map((o) => `<option value="${String(o.value).replace(/"/g, '&quot;')}">${o.label}</option>`)
      .join('');

    openModal({
      title: label,
      size: 'sm',
      content: `
        <form id="select-modal-form" class="form-stack">
          <div class="form-field">
            <select class="form-input" id="select-modal-input">${optionsHtml}</select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" id="select-modal-cancel">${t('common.cancel')}</button>
            <button type="submit" class="btn btn--primary" id="select-modal-ok">${t('common.save')}</button>
          </div>
        </form>`,
      onSave(panel) {
        const form   = panel.querySelector('#select-modal-form');
        const select = panel.querySelector('#select-modal-input');
        const cancel = panel.querySelector('#select-modal-cancel');

        form.addEventListener('submit', (e) => {
          e.preventDefault();
          finish(select.value);
        });

        cancel.addEventListener('click', () => finish(null));

        const escHandler = (e) => {
          if (e.key === 'Escape') {
            document.removeEventListener('keydown', escHandler);
            finish(null);
          }
        };
        document.addEventListener('keydown', escHandler);

        const overlay = panel.closest('.modal-overlay');
        if (overlay) {
          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) finish(null);
          });
        }
      },
    });
  });
}

// --------------------------------------------------------
// confirmModal - Ersatz für native confirm()
// --------------------------------------------------------

/**
 * Zeigt ein Bestätigungs-Modal als Ersatz für native confirm().
 * Gibt ein Promise zurück: true bei OK, false bei Cancel/Escape/Overlay-Klick.
 *
 * @param {string} message   - Frage / Meldung im Titel
 * @param {Object} [opts]
 * @param {string}  [opts.confirmLabel]   - Text des Bestätigungs-Buttons (default: t('common.confirm'))
 * @param {boolean} [opts.danger=false]   - Roten Danger-Button statt Primary verwenden
 * @returns {Promise<boolean>}
 */
export function confirmModal(message, { confirmLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;
      closeModal();
      resolve(value);
    }

    openModal({
      title: message,
      size: 'sm',
      content: `
        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" id="confirm-modal-cancel">${t('common.cancel')}</button>
          <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" id="confirm-modal-ok">
            ${confirmLabel ?? t('common.confirm')}
          </button>
        </div>`,
      onSave(panel) {
        panel.querySelector('#confirm-modal-ok')?.addEventListener('click', () => finish(true));
        panel.querySelector('#confirm-modal-cancel')?.addEventListener('click', () => finish(false));

        const escHandler = (e) => {
          if (e.key === 'Escape') {
            document.removeEventListener('keydown', escHandler);
            finish(false);
          }
        };
        document.addEventListener('keydown', escHandler);

        const overlay = panel.closest('.modal-overlay');
        if (overlay) {
          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) finish(false);
          });
        }
      },
    });
  });
}

// --------------------------------------------------------
// Inline Blur-Validierung
// --------------------------------------------------------

function _validateField(input) {
  const group = input.closest('.form-field') ?? input.parentElement;
  const hasValue = input.value.trim().length > 0;
  group?.classList.toggle('form-field--error', !hasValue);
  group?.classList.toggle('form-field--valid', hasValue);
  return hasValue;
}

/**
 * Aktiviert Blur-Validierung für alle required-Inputs in einem Container.
 * @param {HTMLElement} formContainer
 */
export function wireBlurValidation(formContainer) {
  formContainer.querySelectorAll('input[required], select[required], textarea[required]').forEach((input) => {
    input.addEventListener('blur', () => _validateField(input));
  });
}

/**
 * Validiert alle required-Inputs sofort (z.B. beim Submit ohne vorangehendes Blur).
 * Markiert Fehler inline und fokussiert das erste ungültige Feld.
 *
 * @param {HTMLElement} formContainer
 * @returns {boolean} true wenn alle Felder valide sind
 */
export function validateAll(formContainer) {
  let firstInvalid = null;
  let allValid = true;

  formContainer.querySelectorAll('input[required], select[required], textarea[required]').forEach((input) => {
    const valid = _validateField(input);
    if (!valid && !firstInvalid) firstInvalid = input;
    if (!valid) allValid = false;
  });

  if (firstInvalid) firstInvalid.focus();
  return allValid;
}

// --------------------------------------------------------
// Submit-Feedback (Checkmark + Shake)
// --------------------------------------------------------

/**
 * Zeigt Erfolgs-Feedback auf einem Button (Checkmark für 700ms).
 * Respektiert prefers-reduced-motion: zeigt nur Farb-Feedback ohne Icon-Wechsel.
 * @param {HTMLButtonElement} btn
 * @param {string} [originalLabel]
 */
export function btnSuccess(btn, originalLabel) {
  const label = originalLabel ?? btn.textContent;
  btn.classList.add('btn--success');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('aria-hidden', 'true');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '20 6 9 17 4 12');
    svg.appendChild(poly);
    btn.replaceChildren(svg);
  }
  setTimeout(() => {
    btn.classList.remove('btn--success');
    btn.textContent = label;
  }, 700);
}

/**
 * Versetzt einen Button in den Lade-Zustand (Spinner, nicht klickbar).
 * Gibt eine Cleanup-Funktion zurück, die den Originalzustand wiederherstellt.
 *
 * @param {HTMLButtonElement} btn
 * @returns {() => void} cleanup
 */
export function btnLoading(btn) {
  btn.classList.add('btn--loading');
  btn.disabled = true;
  return () => {
    btn.classList.remove('btn--loading');
    btn.disabled = false;
  };
}

/**
 * Zeigt Fehler-Feedback auf einem Button (Shake-Animation).
 * Respektiert prefers-reduced-motion: kein visuelles Schütteln, nur Farb-Feedback.
 * @param {HTMLButtonElement} btn
 */
export function btnError(btn) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    btn.classList.add('btn--error-static');
    setTimeout(() => btn.classList.remove('btn--error-static'), 700);
    return;
  }
  btn.classList.remove('btn--shaking');
  void btn.offsetWidth; // Reflow für Animation-Restart
  btn.classList.add('btn--shaking');
  btn.addEventListener('animationend', () => btn.classList.remove('btn--shaking'), { once: true });
}
