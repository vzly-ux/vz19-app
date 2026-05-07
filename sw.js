const CACHE = "vz19-v1778149417";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json", "./icon.svg"];

// Installation : mise en cache initiale
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // Active immédiatement sans attendre la fermeture des onglets
});

// Activation : supprime tous les anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // Prend le contrôle immédiatement
});

// Fetch : Network-first pour HTML/JS/CSS, cache-first pour les assets statiques
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Toujours réseau pour les API Netlify Functions
  if (url.pathname.startsWith("/.netlify/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first pour les fichiers principaux (toujours la dernière version)
  const isMainAsset = ASSETS.some(a => url.pathname.endsWith(a.replace("./", "")) || url.pathname === "/");
  if (isMainAsset) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request)) // fallback cache si offline
    );
    return;
  }

  // Cache-first pour le reste (icônes, fonts...)
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
