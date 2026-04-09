/**
 * Modul: HTML Utilities
 * Zweck: XSS-Schutz fuer innerHTML-basiertes Rendering
 * Abhaengigkeiten: keine
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_RE = /[&<>"']/g;

/**
 * Escapet einen String fuer die sichere Einbettung in HTML.
 * Gibt fuer null/undefined einen Leerstring zurueck.
 *
 * @param {*} str - Beliebiger Wert (wird zu String konvertiert)
 * @returns {string} HTML-sicherer String
 */
export function esc(str) {
  if (str == null) return '';
  return String(str).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}
