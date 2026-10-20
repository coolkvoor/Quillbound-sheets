// The installed app's service worker: the app works without a connection.
// The page itself: from the network first (every push to master shows on the next start), the copy kept here when
// offline or when the network takes too long. Libraries and fonts from other sites (pdf.js on cdnjs, Google fonts) have
// fixed versions: kept here once fetched. A response the site's login (Cloudflare Access) answers with a redirect
// goes back to the browser as it is, and is never kept.
// The kept page keeps its COOP/COEP headers, so offline the page is still cross-origin isolated (MPMB waits for dialogs).
const CACHE = 'mpmb-app-1';
const OWN = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon.svg', 'apple-touch-icon.png'];
const NETWORK_WAIT_MS = 6000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // one by one: a file the login redirects is skipped, not a failed install
    await Promise.all(OWN.map(async (u) => {
      try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok && !r.redirected) await c.put(u, r); } catch (err) { /* offline */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const keepable = (r) => r && (r.type === 'basic' || r.type === 'cors') && r.ok && !r.redirected;

async function fromNetworkFirst(req) {
  const c = await caches.open(CACHE);
  const key = req.mode === 'navigate' ? './' : req;
  const kept = c.match(key, { ignoreSearch: req.mode === 'navigate' });
  const net = fetch(req).then((r) => { if (keepable(r)) c.put(key, r.clone()); return r; });
  // the network answer if it comes in time; else the kept copy (and the network answer still updates it)
  const late = new Promise((res) => setTimeout(res, NETWORK_WAIT_MS));
  try {
    const first = await Promise.race([net, late.then(() => null)]);
    if (first) return first;
    return (await kept) || await net;
  } catch (err) {
    const k = await kept;
    if (k) return k;
    throw err;
  }
}

async function fromCacheFirst(req) {
  const c = await caches.open(CACHE);
  const k = await c.match(req);
  if (k) return k;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') c.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    e.respondWith(fromNetworkFirst(req));
  } else if (/(^|\.)cdnjs\.cloudflare\.com$|(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(fromCacheFirst(req));
  }
});
