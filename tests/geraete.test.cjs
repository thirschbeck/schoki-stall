/* Verhaltenstests für die Nutzungsbestätigung je Person (doc.geraete).
   Ausschließlich synthetische Daten, kein Netz, kein echter Speicher, kein Push. */
const { test, assert, app } = require('./harness.cjs');

const OK = async (url, o) => o?.method === 'POST' ? { ok: true } : { ok: true, json: async () => ({}) };
const HEUTE = Date.parse('2035-04-05T10:00:00Z');

test('Nutzungsbestätigung entsteht nur durch aktives Speichern des Namens, nicht durch reines Öffnen', async () => {
  const a = app();
  a.network(OK);
  await a.run('pull()');
  assert.equal(a.run('Object.keys(doc.geraete).length'), 0, 'Reines Öffnen darf keine Bestätigung erzeugen');
  // Nicht bestätigte, aber gewählte Person bleibt ohne Record.
  a.run(`me='Thomas';`);
  await a.run('pull()');
  assert.equal(a.run('Object.keys(doc.geraete).length'), 0, 'Wählen ohne Speichern zählt nicht');
  // Aktives Wählen und Speichern des eigenen Namens.
  a.run(`me='';fWer();`);
  const chip = a.aktion('w', 'Marta');
  assert.ok(chip, 'Namenswahl-Chip muss über data-w erreichbar sein');
  await a.node('sheet').dispatch('click', { target: chip });
  await a.node('werOk').dispatch('click');
  assert.equal(a.run('me'), 'Marta');
  assert.equal(a.run('Object.keys(doc.geraete).length'), 1, 'Speichern des Namens muss bestätigen');
  const g = a.json('Object.values(doc.geraete)[0]');
  assert.equal(g.person, 'Marta');
  assert.equal(g.quelle, 'app');
  assert.equal(g.mitteilung, false);
  assert.equal(g.ts, HEUTE);
  assert.ok(g.id, 'Record braucht eigene ID');
  assert.ok(g.letzteNutzung, 'letzteNutzung muss gesetzt sein');
});

test('Bestätigte Nutzer erscheinen mit Haken und Datum, offene mit leerem Kreis; Zählung stimmt', () => {
  const a = app();
  a.run(`doc.geraete={g1:{id:'g1',person:'Marta',ts:Date.parse('2035-04-01T09:00:00Z'),quelle:'app',mitteilung:false,letzteNutzung:1}};`);
  const h = a.run('vGeraete()');
  assert.match(h, /Wer nutzt die App/);
  assert.match(h, /Bestätigt: 1 von 6/);
  assert.match(h, /\u2713/, 'sichtbarer Haken für bestätigte Person');
  assert.match(h, /Marta/);
  assert.match(h, /01\.04\.2035/, 'Datum der Bestätigung');
  assert.match(h, /\u25CB/, 'offener Kreis für noch nicht bestätigte Personen');
  for (const p of ['Annika', 'Vivienne', 'Marie', 'Hanna', 'Thomas']) assert.match(h, new RegExp(p));
  assert.match(h, /eigenen Namen bestätigt/, 'ehrlicher Hinweistext fehlt');
  assert.match(h, /NICHT[^.]*installiert/, 'Hinweis muss „nicht installiert" klarstellen');
  assert.match(a.run('vTeam()'), /Wer nutzt die App/, 'Übersicht muss im Team-Bereich erreichbar sein');
});

test('Erstbestätigung bleibt erhalten; Mitteilungsfreigabe wird ergänzt; kein Doppel-Record je Person', () => {
  const a = app();
  a.run(`doc.geraete={g1:{id:'g1',person:'Marta',ts:111,quelle:'app',mitteilung:false,letzteNutzung:111}};`);
  const r = a.json(`(()=>{bestaetigeNutzung('Marta',{mitteilung:true});return doc.geraete.g1;})()`);
  assert.equal(r.ts, 111, 'Erstbestätigung darf nicht überschrieben werden');
  assert.equal(r.mitteilung, true, 'Mitteilungsfreigabe wird ergänzt');
  assert.equal(r.letzteNutzung, HEUTE);
  assert.equal(a.run('Object.keys(doc.geraete).length'), 1, 'kein Doppel-Record je Person');
});

test('Mehrere Personen bestätigen gleichzeitig ohne sich gegenseitig zu überschreiben', () => {
  const a = app();
  const r = a.json(`(()=>{const x=bestaetigeNutzung('Marta');const y=bestaetigeNutzung('Annika');return [x.id,y.id,x.person,y.person];})()`);
  assert.notEqual(r[0], r[1], 'je Person eigener Record');
  assert.deepEqual(r.slice(2), ['Marta', 'Annika']);
  assert.equal(a.run('Object.keys(doc.geraete).length'), 2);
  assert.equal(a.run('anzahlBestaetigt()'), 2);
});

test('Merge erhält die Nutzungsbestätigung gegen ältere Geräte und Grabsteine', () => {
  const a = app();
  a.run(`merge({stand:1,geraete:{g1:{id:'g1',person:'Marta',ts:5,quelle:'app',mitteilung:false,letzteNutzung:5}}})`);
  // Älteres Gerät ohne die neue Collection darf sie nicht löschen.
  a.run(`merge({stand:2,termine:{x:{id:'x',ts:3}}})`);
  assert.equal(a.run(`doc.geraete.g1.person`), 'Marta');
  assert.equal(a.run('Object.keys(doc.geraete).length'), 1);
  a.run(`merge({geraete:{g2:{id:'g2',person:'Annika',ts:6,quelle:'app',mitteilung:false,letzteNutzung:6}}})`);
  assert.equal(a.run('Object.keys(doc.geraete).length'), 2);
  a.run(`merge({tomb:{g1:99}})`);
  assert.equal(a.run('doc.geraete.g1'), undefined, 'Grabstein muss auch die neue Collection erfassen');
});

test('doc.geraete enthält nur Name, Zeitstempel und Freigabestatus – ohne Endpunkte, Geräte-IDs und Push-Schlüssel', () => {
  const a = app();
  a.run(`me='Vivienne';bestaetigeNutzung('Vivienne');bestaetigeNutzung('Vivienne',{mitteilung:true});`);
  const roh = a.run('JSON.stringify(doc.geraete)');
  assert.doesNotMatch(roh, /endpoint/i);
  assert.doesNotMatch(roh, /p256dh|vapid|subscription|ciphertext|wrappedKey|schluessel/i);
  assert.doesNotMatch(roh, /https?:|@|\+/);
  const rec = a.json('Object.values(doc.geraete)[0]');
  assert.deepEqual(Object.keys(rec).sort(), ['id', 'letzteNutzung', 'mitteilung', 'person', 'quelle', 'ts']);
});

test('Antworten zählen nicht als Bestätigung; letzteNutzung wird nur für bestätigte Personen aktualisiert', async () => {
  const a = app();
  a.run(`doc.fragen.q1={id:'q1',text:'Test',an:['Annika'],by:'Thomas',ts:1,status:'offen',statusTs:0};me='Annika';`);
  a.run(`antworte('q1','Synthetische Antwort')`);
  assert.equal(a.run('Object.keys(doc.geraete).length'), 0, 'Eine Antwort darf nicht bestätigen');
  // Öffnen aktualisiert letzteNutzung, verändert aber die Erstbestätigung nicht.
  const b = app();
  b.network(OK);
  b.run(`doc.geraete={g1:{id:'g1',person:'Thomas',ts:111,quelle:'app',mitteilung:false,letzteNutzung:111}};me='Thomas';`);
  await b.run('pull()');
  assert.equal(b.json('doc.geraete.g1.ts'), 111);
  assert.equal(b.json('doc.geraete.g1.letzteNutzung'), HEUTE);
  const c = app();
  c.network(OK);
  c.run(`me='Marie';`);
  await c.run('pull()');
  assert.equal(c.run('Object.keys(doc.geraete).length'), 0, 'Nicht bestätigte Person bekommt beim Öffnen keinen Record');
});

test('Die Startseite (Heute) zeigt knapp, wer bestätigt hat, mit ehrlichem Hinweistext', () => {
  const a = app();
  a.run(`doc.geraete={g1:{id:'g1',person:'Marta',ts:1,quelle:'app',mitteilung:false,letzteNutzung:1}};me='Thomas';tab='heute';`);
  const h = a.run('vHeute()');
  assert.match(h, /Bestätigt: 1 von 6/);
  assert.match(h, /Marta/);
  assert.match(h, /eigenen Namen bestätigt/);
  assert.match(h, /NICHT[^.]*installiert/);
});
