/**
 * Modul: Service Worker Registrierung
 * Zweck: Ausgelagert aus index.html um CSP-Inline-Script-Verletzung zu vermeiden.
 *        Handhabt nahtlose Updates via controllerchange.
 * Abhängigkeiten: keine
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] Registrierung fehlgeschlagen:', err);
    });
  });

  // Nahtloses Update: Neuer SW hat skipWaiting() + clients.claim() aufgerufen
  // → Controller wechselt → Seite neu laden für konsistenten Stand
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
