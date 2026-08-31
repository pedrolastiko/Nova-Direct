/* Service worker : met en cache la coque de l'app pour un démarrage instantané.
 *
 * Il ne doit JAMAIS intercepter :
 *  - les flux audio Icecast (requêtes infinies, elles rempliraient le cache) ;
 *  - l'API des titres en cours (une donnée live mise en cache serait fausse) ;
 *  - les pochettes distantes.
 * D'où le filtrage strict sur l'origine dans le gestionnaire `fetch`.
 */

const CACHE = 'nova-shell-v4';

const STATION_IDS = [
  'nova', 'nouvo', 'classics', 'danse', 'hiphop', 'nuit', 'reggae', 'soul', 'plage',
];
const STATION_LOGOS = [
  ...STATION_IDS.map((id) => `logos/${id}.png`),
  ...STATION_IDS.map((id) => `thumbs/${id}.png`),
];

const SHELL = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  ...STATION_LOGOS,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // flux, API, pochettes : réseau direct

  // Navigation : réseau d'abord pour récupérer une mise à jour, cache en secours.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('.')))
    );
    return;
  }

  // Assets : cache d'abord, puis rafraîchissement en arrière-plan.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
