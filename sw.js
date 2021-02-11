const staticCacheName = "site-static-v1";
const assets = [
  "https://mahesh-puri.github.io/resume/index.html",
  "https://mahesh-puri.github.io/resume/assets/js/main.js",
  "https://mahesh-puri.github.io/resume/assets/css/styles.css",
  "https://mahesh-puri.github.io/resume/assets/img/perfil.jpg",
  "https://mahesh-puri.github.io/resume/assets/img/logo/maskable_icon_x1.png",
  "https://mahesh-puri.github.io/resume/assets/img/about.jpg",
  "https://mahesh-puri.github.io/resume/assets/img/projectmind.jpg",
  "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap",
];
// install event
self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open(staticCacheName).then((cache) => {
      console.log("caching shell assets");
      cache.addAll(assets);
    })
  );
});
// activate event
self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== staticCacheName)
          .map((key) => caches.delete(key))
      );
    })
  );
});
// fetch event
self.addEventListener("fetch", (evt) => {
  console.log("[ServiceWorker] Fetch", evt.request.url);
  evt.respondWith(
    caches.match(evt.request).then((cacheRes) => {
      return cacheRes || fetch(evt.request);
    })
  );
});
