// Offline support. Network-first so updates show up immediately when online;
// falls back to the cache when offline. Books themselves live in IndexedDB.
const CACHE = 'reader-v2'
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/util.js', 'js/library.js', 'js/settings.js', 'js/ui.js',
  'js/shelf.js', 'js/reader.js', 'js/notes.js',
  'js/formats/index.js', 'js/formats/ebook.js', 'js/formats/image.js', 'js/formats/json.js',
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.includes('/samples/')) return
  e.respondWith((async () => {
    try {
      // 'no-cache' = revalidate with the server (cheap 304s) so updates are never stale
      const res = await fetch(request, { cache: 'no-cache' })
      if (res.ok) {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(request, copy))
      }
      return res
    } catch {
      const cached = await caches.match(request, { ignoreSearch: true })
      if (cached) return cached
      if (request.mode === 'navigate') return caches.match('index.html')
      throw new Error('offline')
    }
  })())
})
