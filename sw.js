/* Guarda la "carcasa" de la app para que abra rápido y aunque se caiga el internet un momento.
   Los datos NUNCA se guardan aquí: siempre vienen del servidor. */
const V = 'caja-v11';
const SHELL = ['./', 'index.html', 'config.js', 'js/db.js', 'vendor/supabase.js', 'vendor/qrcode.js', 'vendor/xlsx.full.min.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/logo.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;       // Supabase y fuentes: directo a la red
  e.respondWith(fetch(r, {cache:'no-cache'}).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(ch => ch.put(r, c)); } return res; }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
