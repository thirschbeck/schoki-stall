/* Tests für den Service Worker (sw.js): Geräte-Push sicher und offline-tauglich.
   Ausführen: node --test tests/
   Es wird kein echter Push ausgelöst und nichts veröffentlicht. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function sw(){
  const h = new Map(), notizen = [], geoeffnet = [];
  const kontext = {
    console,
    URL, Promise, Object, String, Error,
    self: {
      location: { origin: 'https://thirschbeck.github.io' },
      registration: {
        scope: 'https://thirschbeck.github.io/schoki-stall/',
        showNotification: (t, o) => { notizen.push({ titel: t, optionen: o }); return Promise.resolve(); }
      },
      clients: {
        matchAll: async () => [{ url: 'https://thirschbeck.github.io/schoki-stall/index.html', focus(){ geoeffnet.push('focus'); return Promise.resolve(); } }],
        openWindow: u => { geoeffnet.push(u); return Promise.resolve(); }
      },
      addEventListener: (n, f) => h.set(n, f),
      skipWaiting: () => Promise.resolve(),
      caches: null
    }
  };
  kontext.self.addEventListener = (n, f) => h.set(n, f);
  vm.runInNewContext(QUELLE, kontext);
  return { feuer: (n, e) => { const w = []; const rr = h.get(n)(Object.assign({ waitUntil: p => w.push(p) }, e)); return Promise.all(w.concat(rr ? [rr] : [])); }, h, notizen, geoeffnet, kontext };
}

test('Service Worker kennt Push- und Klick-Behandlung und liefert die neue App-Version aus', () => {
  const s = sw();
  assert.ok(s.h.has('push'), 'push-Handler fehlt');
  assert.ok(s.h.has('notificationclick'), 'notificationclick-Handler fehlt');
  assert.match(QUELLE, /schoki-v11/, 'Cache-Version muss erhöht sein');
  assert.match(QUELLE, /push-config\.js/, 'push-config.js muss offline mitgecacht werden');
});

test('Push zeigt Titel, Text und Tag der Nachricht an', async () => {
  const s = sw();
  await s.feuer('push', { data: { json: () => ({ title: 'Neue Frage', body: 'Wer kann heute?', url: './', tag: 'frage-1' }) } });
  assert.equal(s.notizen.length, 1);
  assert.equal(s.notizen[0].titel, 'Neue Frage');
  assert.equal(s.notizen[0].optionen.body, 'Wer kann heute?');
  assert.equal(s.notizen[0].optionen.tag, 'frage-1');
});

test('Push ohne Nutzdaten und fremde Links werden nie zu fremden Zielen', async () => {
  const s = sw();
  await s.feuer('push', { data: null });
  assert.equal(s.notizen[0].titel, 'Schoki');
  assert.match(s.notizen[0].optionen.data.url, /^https:\/\/thirschbeck\.github\.io\/schoki-stall\//);
  await s.feuer('push', { data: { json: () => ({ title: 'x', body: 'y', url: 'https://boese.example/steal' }) } });
  const ziel = s.notizen[1].optionen.data.url;
  assert.ok(!/boese\.example/.test(ziel), 'Fremde URL darf nicht übernommen werden');
  assert.match(ziel, /^https:\/\/thirschbeck\.github\.io\/schoki-stall\//);
});

test('Klick öffnet nur eine App-URL derselben Herkunft', async () => {
  const s = sw();
  await s.feuer('notificationclick', { notification: { data: { url: 'https://boese.example/weg' }, close(){} } });
  assert.ok(s.geoeffnet.every(x => !/boese\.example/.test(String(x))), 'Fremde URL darf nicht geöffnet werden');
  assert.equal(s.geoeffnet.length, 0);
  await s.feuer('notificationclick', { notification: { data: { url: 'https://thirschbeck.github.io/schoki-stall/index.html' }, close(){} } });
  assert.ok(s.geoeffnet.includes('focus'), 'Eigene App-URL fokussieren');
});
