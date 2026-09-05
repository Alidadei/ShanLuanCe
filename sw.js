/* 山峦册 Service Worker：离线缓存
   策略：
   - 核心 shell（html/css/js/manifest）：stale-while-revalidate（先缓存秒开，后台更新）
   - 照片 img/：cache-first（体积大，命中即用）
   - api/recs.json：network-first（有网拿最新看天推荐，失败读缓存）
   - 导航请求：network-first，失败回退缓存的 index.html（山里无信号也能用）
   发布新版本时递增 VERSION。 */
const VERSION = 'shanluance-v3.4';
const CORE_CACHE = `${VERSION}-core`;
const IMG_CACHE = `${VERSION}-img`;
const API_CACHE = `${VERSION}-api`;

const CORE_ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/data.js',
  'js/photos.js',
  'js/app.js',
  'manifest.json',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/icon-maskable-512.png',
  'img/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CORE_CACHE)
      .then((c) => c.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 看天推荐：优先网络，失败读缓存
  if (url.pathname.endsWith('/api/recs.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.error()))
    );
    return;
  }

  // 照片：缓存优先
  if (url.pathname.includes('/img/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(IMG_CACHE).then((c) => c.put(req, copy));
          return res;
        })
      )
    );
    return;
  }

  // 导航请求：网络优先，离线回退壳页面
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 其余同源静态资源：stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const fetching = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CORE_CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit);
      return hit || fetching;
    })
  );
});
