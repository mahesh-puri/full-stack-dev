// const staticCacheName = "site-static-v1";
const staticCacheName = "static-cache-v2.1.0";

const assets = [
  "/",
  "./index.html",
  "./assets/js/main.js",
  "./assets/css/styles.css",
  "./assets/img/perfil.jpg",
  "./assets/img/logo/maskable_icon_x1.png",
  "./assets/img/logo/maskable_icon_x3.png",
  "./assets/img/about.jpg",
  "./assets/img/projectmind.jpg",
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

  if (evt.request.url.includes("mahesh-puri.github.io/resume/")) {
    evt.respondWith(
      caches.open(staticCacheName).then((cache) => {
        return cache.match(evt.request).then(
          (cacheResponse) =>
            cacheResponse ||
            fetch(evt.request).then((networkResponse) => {
              cache.put(evt.request, networkResponse.clone());
              return networkResponse;
            })
        );
      })
    );
  } else {
    evt.respondWith(fetch(evt.request));
  }

  // evt.respondWith(
  //   caches.match(evt.request).then((cacheRes) => {
  //     return cacheRes || fetch(evt.request);
  //   })
  // );
});
