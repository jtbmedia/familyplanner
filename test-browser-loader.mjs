/**
 * test-browser-loader.mjs - Node.js Custom Loader für Tests
 * Zweck: Browser-absolute Pfade (/foo.js) auf Stubs umleiten, damit
 *        Frontend-Module im Node-Test-Kontext importierbar sind.
 * Verwendung: node --loader ./test-browser-loader.mjs test-xxx.js
 * Dependencies: none
 */

const STUBS = {
  '/i18n.js': `
    export const t = (key) => key;
    export const initI18n = async () => {};
    export const setLocale = async () => {};
    export const getLocale = () => 'de';
    export const getSupportedLocales = () => ['de', 'en'];
    export const formatDate = (d) => String(d);
    export const formatTime = (d) => String(d);
  `,
};

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`,
    };
  }
  return nextResolve(specifier, context);
}
