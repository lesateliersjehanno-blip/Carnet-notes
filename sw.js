// Service worker du Carnet — met l'appli en cache pour qu'elle continue de fonctionner sans
// connexion internet une fois ouverte au moins une fois. C'est aussi CE qui permet au collage
// (presse-papier) de fonctionner de façon fiable : une page servie en https:// (via GitHub Pages,
// par exemple) reste un "contexte sécurisé" aux yeux du navigateur même hors-ligne, contrairement
// à un fichier ouvert depuis un lecteur réseau (file://), qui bloque l'accès complet au
// presse-papier — voir les échanges dans le carnet pour le détail de ce diagnostic.
const CACHE_NAME = 'carnet-cache-v1';

// Le fichier principal : sans lui, pas de mode hors-ligne possible, donc son échec doit faire
// échouer toute l'installation (comportement par défaut de cache.add).
const CORE_URL = './carnet.html';

// Ressources externes "au mieux" : polices et SDK Firebase. Si l'une d'elles échoue à se mettre
// en cache (pas de réseau au tout premier chargement, blocage CORS...), on continue quand même —
// l'appli reste utilisable hors-ligne, juste sans forcément ces extras (Firebase, en particulier,
// n'est utilisé QUE par les boutons de synchro manuelle "Envoyer/Récupérer", pas par le
// dessin/l'écriture/le collage, qui reposent sur le stockage local du navigateur).
const EXTRA_URLS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-database-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.add(CORE_URL);
    await Promise.all(EXTRA_URLS.map((url) =>
      fetch(url, { mode: 'no-cors' }).then((res) => cache.put(url, res)).catch(() => {})
    ));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Stratégie "cache d'abord, réseau en secours" : sert immédiatement la version déjà en cache si
// elle existe (rapide, et fonctionne hors-ligne), tout en la rafraîchissant discrètement en tâche
// de fond dès qu'une connexion est disponible, pour la prochaine visite.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const network = fetch(event.request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(event.request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('Hors ligne et pas encore en cache.', { status: 503 });
  })());
});

// Mise à jour manuelle, déclenchée par le bouton "🔄" de la barre du haut (voir carnet.html) :
// va chercher la toute dernière version de carnet.html (et des extras) sur le réseau, avec
// cache:'reload' pour être sûr de contourner le cache HTTP du navigateur lui-même, et écrase
// l'entrée existante dans le cache de l'appli. Répond ensuite sur le port fourni pour que la
// page sache si ça a marché (et puisse se recharger) ou non (pas de réseau).
self.addEventListener('message', (event) => {
  if (event.data !== 'FORCE_UPDATE') return;
  const replyPort = event.ports && event.ports[0];
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const res = await fetch(CORE_URL, { cache: 'reload' });
      if (!res.ok) throw new Error('network response not ok');
      await cache.put(CORE_URL, res.clone());
      // Extras rafraîchis "au mieux" au passage, sans faire échouer la mise à jour si l'un d'eux capote.
      await Promise.all(EXTRA_URLS.map((url) =>
        fetch(url, { mode: 'no-cors', cache: 'reload' }).then((r) => cache.put(url, r)).catch(() => {})
      ));
      if (replyPort) replyPort.postMessage({ ok: true });
    } catch (e) {
      if (replyPort) replyPort.postMessage({ ok: false });
    }
  })());
});
