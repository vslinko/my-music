const cacheName = "my-music-v1";
const contentToCache = [
  "/",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/app.js",
  "/apple-touch-icon.png",
  "/browserconfig.xml",
  "/cover.webp",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon.ico",
  "/mstile-144x144.png",
  "/mstile-150x150.png",
  "/mstile-310x150.png",
  "/mstile-310x310.png",
  "/mstile-70x70.png",
  "/safari-pinned-tab.svg",
  "/site.webmanifest",
  "/style.css",
  "/vue.esm-browser.prod.js",
];

async function addResourcesToCache() {
  console.log("[Service Worker] Caching all: app shell and content");
  const cache = await caches.open(cacheName);
  await cache.addAll(contentToCache);
}

async function fetchAlbumCover(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const fallbackResponse = await caches.match("/cover.webp");
    if (fallbackResponse) {
      return fallbackResponse;
    }

    return new Response("Network error happened", {
      status: 408,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function fetchAndCache(request, { cacheUrl }) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(cacheName);
    await cache.put(cacheUrl, response.clone());
    return response;
  } catch (err) {
    const fallbackResponse = await caches.match(cacheUrl);

    if (fallbackResponse) {
      console.log(`[Service Worker] Found in cache ${request.url}`);
      return fallbackResponse;
    }

    return new Response("Network error happened", {
      status: 408,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

self.addEventListener("install", (event) => {
  console.log("[Service Worker] Install");
  event.waitUntil(addResourcesToCache());
});

self.addEventListener("fetch", async (event) => {
  const { pathname } = new URL(event.request.url);

  if (contentToCache.includes(pathname)) {
    event.respondWith(fetchAndCache(event.request, { cacheUrl: pathname }));
  } else if (pathname === "/data/albums.json") {
    event.respondWith(
      fetchAndCache(event.request, { cacheUrl: "/data/albums.json" })
    );
  } else if (pathname.startsWith("/data/images/")) {
    event.respondWith(fetchAlbumCover(event.request));
  } else {
    event.respondWith(fetch(event.request));
  }
});
