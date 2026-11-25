/* Schoki-Stallplan – Service Worker: App-Hülle offline halten, Daten immer live */
const CACHE = "schoki-v11";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg", "push-config.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.hostname === "kvdb.io") return;
  if (u.pathname.includes("/vertraege/")) return;   /* Vertrags-PDFs nicht cachen */                     /* Daten nie cachen */
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match("index.html")))
  );
});

/* Geräte-Benachrichtigungen: Der Sender schickt JSON {title, body, url, tag}.
   Es wird niemals eine beliebige externe URL geöffnet – nur eine App-URL
   auf derselben Herkunft. */
function erlaubteZiel(url){
  try{
    const z = new URL(url || "./", self.registration.scope);
    if(z.origin !== self.location.origin) return null;
    if(!z.pathname.startsWith(new URL(self.registration.scope).pathname)) return null;
    return z.href;
  }catch(e){ return null; }
}
self.addEventListener("push", e => {
  let d = { title: "Schoki", body: "Neue Mitteilung in der Schoki-App.", url: "./", tag: "schoki" };
  try{ const p = e.data && e.data.json(); if(p) d = Object.assign(d, p); }catch(err){}
  const ziel = erlaubteZiel(d.url);
  e.waitUntil(self.registration.showNotification(String(d.title || "Schoki"), {
    body: String(d.body || ""),
    tag: String(d.tag || "schoki"),
    data: { url: ziel || new URL(self.registration.scope).href }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const ziel = erlaubteZiel(e.notification.data && e.notification.data.url);
  if(!ziel) return;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for(const c of list){ if(c.url === ziel && "focus" in c) return c.focus(); }
    if(self.clients.openWindow) return self.clients.openWindow(ziel);
  }));
});
