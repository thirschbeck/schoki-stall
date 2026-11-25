// Ausschließlich synthetische Daten. Kein Browserstart, kein Netz, kein echter Speicher.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
process.env.TZ = 'UTC';
class TestDatum extends Date {
  constructor(...args){ super(...(args.length?args:['2035-04-05T10:00:00Z'])); }
  static now(){ return Date.parse('2035-04-05T10:00:00Z'); }
}
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const start = script.indexOf('/* ====== Start ====== */');
assert.ok(start > 0, 'Startmarkierung muss existieren: niemals Startup ausführen');

function app(){
  const nodes = new Map(), store = new Map(), alerts = [], requests = [];
  let elements=[],seq=0;
  const decode=s=>s.replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
  const key=s=>s.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  function all(selector,scope){
    const attr=selector.match(/^\[data-([\w-]+)\]$/);
    return elements.filter(e=>(!scope||e.scope===scope) && (attr?key(attr[1]) in e.dataset:selector==='.chip'&&e.classList.contains('chip')));
  }
  let handler = () => { throw new Error('Netzzugriff im Test gesperrt'); };
  function node(id){
    if(nodes.has(id)) return nodes.get(id);
    const classes = new Set(id === 'modal' ? ['hidden'] : []);
    const listeners = {};
    const n = {id, value:'', dataset:{}, textContent:'', onclick:null, disabled:false,
      classList:{add:c=>classes.add(c), remove:c=>classes.delete(c), contains:c=>classes.has(c),
        toggle:(c,on)=>on?classes.add(c):classes.delete(c)},
      addEventListener:(name,fn)=>{(listeners[name] ||= []).push(fn);},
      dispatch:async(name,event={})=>{
        if(n['on'+name]) await n['on'+name](event);
        for(const fn of listeners[name]||[]) await fn(event);
      },
      querySelectorAll:s=>all(s,id), focus:()=>{}, closest:s=>all(s).includes(n)?n:null,
    };
    let inner = '';
    Object.defineProperty(n,'innerHTML',{get:()=>inner,set:v=>{
      inner = v;
      elements=elements.filter(e=>e.scope!==id);
      for(const m of v.matchAll(/<[a-z]+\b([^>]*)>/g)){
        const attrs=m[1],ident=attrs.match(/\bid="([^"]+)"/),ds=[...attrs.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)];
        if(!ds.length) continue;
        const e=node(ident?ident[1]:'aktion-'+(++seq));e.scope=id;e.dataset={};
        ds.forEach(d=>e.dataset[key(d[1])]=decode(d[2]));
        ((attrs.match(/\bclass="([^"]*)"/)||[])[1]||'').split(/\s+/).forEach(c=>e.classList.add(c));
        elements.push(e);
      }
      if(id !== 'sheet') return;
      for(const [key] of nodes) if(!['main','sheet','modal','whoBtn','syncTxt','dot','btnNeu','btnReload'].includes(key)) nodes.delete(key);

      for(const m of v.matchAll(/<input\b([^>]*)>|<(textarea|select)\b([^>]*)>([\s\S]*?)<\/\2>/g)){
        const tag=m[2]||'input',attrs=m[1]||m[3],body=m[4]||'';
        const ident=attrs.match(/\bid="([^"]+)"/); if(!ident) continue;
        const field=node(ident[1]);
        if(tag==='select'){
          const options=[...body.matchAll(/<option\b([^>]*)>([^<]*)/g)].map(o=>({value:decode((o[1].match(/value="([^"]*)"/)||[])[1]??o[2]),selected:/\bselected\b/.test(o[1])}));
          field.selectedOptions=options.filter(o=>o.selected);
          field.value=(field.selectedOptions[0]||options[0]||{value:''}).value;
        }else field.value=decode(tag==='textarea'?body:(attrs.match(/\bvalue="([^"]*)"/)||[])[1]||'');
      }
    }});
    nodes.set(id,n); return n;
  }
  const nav = {};
  const context = vm.createContext({
    console, Date:TestDatum, Math, Set, Map, URL, URLSearchParams,
    crypto:webcrypto, TextEncoder, atob, btoa,
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    document:{querySelector:s=>node(s.replace(/^#/,'')),querySelectorAll:all,addEventListener:()=>{},hidden:false},
    window:{addEventListener:()=>{}, SCHOKI_PUSH:(()=>{const w={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','push-config.js'),'utf8'),{window:w});return w.SCHOKI_PUSH;})()}, navigator:nav,
    alert:s=>alerts.push(s),confirm:()=>true,prompt:()=>{throw new Error('Startup verboten');},
    fetch:async(...args)=>{requests.push(args); return handler(...args);},
    setInterval:()=>{throw new Error('Timer verboten');},setTimeout:()=>{throw new Error('Timer verboten');}
  });
  new vm.Script(script.slice(0,start),{filename:'index.html:script'}).runInContext(context);
  const run = code => vm.runInContext(code,context);
  return {run,node,nav,alerts,requests,store,aktion:(k,v)=>elements.find(e=>e.dataset[k]===v),network:fn=>{handler=fn;},json:code=>JSON.parse(run(`JSON.stringify(${code})`))};
}

test('Verschlüsseltes Geräte-Abo speichert keinen Klartext-Endpoint und ist nicht vorzeigbar ohne Erlaubnis',async()=>{
  const a=app();
  assert.equal(a.run('typeof aboBauen'),'function');
  const spki=a.run('PUSHK.subscriptionPublicKey');
  const sub={endpoint:'https://synthetisch.example/abc',keys:{p256dh:'SYNTH-P256DH',auth:'SYNTH-AUTH'}};
  const rec=await a.run(`(async()=>aboBauen({subscription:${JSON.stringify(sub)},person:'Marta',publicKey:PUSHK.subscriptionPublicKey,crypto}))()`);
  for(const f of ['id','person','ts','version','iv','ciphertext','wrappedKey'])
    assert.ok(rec[f]||rec[f]===0,`Feld ${f} fehlt`);
  assert.equal(rec.version,1);assert.equal(rec.person,'Marta');
  const roh=JSON.stringify(rec);
  assert.doesNotMatch(roh,/synthetisch\.example/);assert.doesNotMatch(roh,/p256dh/);assert.doesNotMatch(roh,/SYNTH/);
  assert.match(rec.iv,/^[A-Za-z0-9_-]+$/);assert.match(rec.ciphertext,/^[A-Za-z0-9_-]+$/);assert.match(rec.wrappedKey,/^[A-Za-z0-9_-]+$/);
  const zweit=await a.run(`(async()=>aboBauen({subscription:${JSON.stringify(sub)},person:'Marta',publicKey:PUSHK.subscriptionPublicKey,crypto}))()`);
  assert.notEqual(rec.ciphertext,zweit.ciphertext,'Jedes Abo bekommt neuen Zufallsschlüssel und IV');
  a.run(`me='Marta';doc.pushabos={};`);
  const ohneErlaubnis=await a.run(`(async()=>geraetAktivieren('Marta',{Notification:{permission:'default'}}))()`);
  assert.equal(ohneErlaubnis.aktiv,false);
  assert.equal(a.run('Object.keys(doc.pushabos).length'),0);
  assert.equal(a.run(`aboStatus('Marta')`),'');
  const env = `{
    Notification:{permission:'granted'}, crypto,
    navigator:{serviceWorker:{ready:Promise.resolve({pushManager:{
      getSubscription:async()=>null,
      subscribe:async()=>({toJSON:()=>JSON.parse(${JSON.stringify(JSON.stringify(sub))})})
    }})}}
  }`;
  const fremd=await a.run(`(async()=>geraetAktivieren('Vivienne', ${env}))()`);
  assert.equal(fremd.aktiv,true);
  assert.equal(a.run(`aboStatus('Vivienne')`),'Gerät angemeldet – Zustellung erst nach Test bestätigt');
  assert.equal(a.run(`aboStatus('Marta')`),'');
  const id=a.run(`Object.keys(doc.pushabos)[0]`);
  assert.equal(a.run(`aboAusschalten('${id}',{navigator:{}})`),false,'Fremdes Abo darf nicht gelöscht werden');
  assert.equal(a.run(`Object.keys(doc.pushabos).length`),1);
  a.run(`me='Vivienne'`);
  assert.equal(a.run(`aboAusschalten('${id}',{navigator:{}})`),true);
  assert.equal(a.run(`Object.keys(doc.pushabos).length`),0);
  assert.ok(a.run(`doc.tomb['${id}']>0`),'Rücknahme muss als Grabstein bleiben');
});

test('Wochenrhythmus ist von Heute erreichbar und keine automatische Annika-Vertretung',async()=>{
  const a=app();a.run(`me='Marta';doc.woche.do={personen:['Marie','Hanna'],zeit:'15:30–16:30',aktivitaet:'Unterricht',ts:1};render();`);
  assert.match(a.node('main').innerHTML,/Wochenrhythmus Montag bis Sonntag/);
  assert.doesNotMatch(a.run('vWoche()'),/dann übernimmt Annika/);
  await a.aktion('zusage','2035-04-05').dispatch('click');
  assert.equal(a.run(`betreuungsFuer('2035-04-05')[0].person`),'Marta');
  assert.match(a.node('main').innerHTML,/Betreuung offen – noch keine verbindliche Übernahme/);
  const id=a.run(`betreuungsFuer('2035-04-05')[0].id`);await a.aktion('zurueck',id).dispatch('click');
  assert.equal(a.run(`betreuungsFuer('2035-04-05').length`),0);
  await a.aktion('tagesfrage','2035-04-06').dispatch('click');assert.equal(a.node('qDatum').value,'2035-04-06');assert.equal(a.node('qThema').value,'betreuung');
});

test('Ausschalten entfernt nur das eigene Geräte-Abo dauerhaft, fremde bleiben erhalten',async()=>{
  const a=app();a.run(`me='Marta';doc.pushabos={a1:{id:'a1',person:'Marta',ts:1,version:1,iv:'i',ciphertext:'c',wrappedKey:'w'},a2:{id:'a2',person:'Vivienne',ts:2,version:1,iv:'i',ciphertext:'c',wrappedKey:'w'}};`);
  assert.equal(a.run(`aboAusschalten('a2',{navigator:{}})`),false,'Fremdes Abo darf nicht entfernt werden');
  assert.equal(a.run(`Object.keys(doc.pushabos).length`),2);
  assert.equal(a.run(`aboAusschalten('a1',{navigator:{}})`),true);
  assert.equal(a.run(`doc.pushabos.a1`),undefined);
  assert.ok(a.run(`doc.tomb.a1`),'Eigene Abmeldung braucht einen Grabstein');
  a.run(`doc.pushabos.a1={id:'a1',person:'Marta',ts:9,version:1,iv:'i',ciphertext:'c',wrappedKey:'w'};`);
  a.run(`merge({pushabos:doc.pushabos,stand:doc.stand});`);
  assert.equal(a.run(`doc.pushabos.a1`),undefined,'Grabstein verhindert Wiederauferstehung');
});

test('Vom Termin lassen sich seine Nachrichten öffnen und eine terminbezogene Frage verfassen',async()=>{
  const a=app();a.run(`me='Thomas';doc.termine.test={id:'test',art:'physio',datum:'2035-04-06',wer:['Annika'],erledigt:false,ts:1};tab='termine';render();`);
  assert.ok(a.aktion('tmsg','test'),'Termin braucht Nachrichten-Aktion');
  await a.aktion('tmsg','test').dispatch('click');assert.equal(a.run('tab'),'nachrichten');
  await a.aktion('neu','frage').dispatch('click');assert.equal(a.node('qTermin').value,'test');assert.equal(a.node('qDatum').value,'2035-04-06');
  a.run('closeSheet();tab="termine";render();');
  await a.aktion('tfrage','test').dispatch('click');assert.equal(a.node('qTermin').value,'test');
});

test('Medizinischer Termin fragt freie Belege ab, ohne Vorbelegung; nur belegter Folgetermin entsteht beim Abhaken',async()=>{
  const a=app(); a.run(`me='Thomas';fTermin({art:'impfung',wieder:52});`);
  assert.match(a.node('sheet').innerHTML,/id="tMedWochen"/);
  assert.equal(a.node('tDatum').value,'');assert.equal(a.node('tMedWochen').value,'');
  assert.equal(a.node('tNormal').classList.contains('hidden'),true);
  a.node('tDatum').value='2035-04-06';a.node('tFolge').value='2035-10-08';a.node('tFolgeBeleg').value='Synthetische tierärztliche Bestätigung';
  a.network(async(url,o)=>o?.method==='POST'?{ok:true}:{ok:true,json:async()=>({})});
  await a.node('tOk').dispatch('click');
  const t=a.json('Object.values(doc.termine)[0]');
  assert.equal(t.wieder,0);assert.equal(t.folgeDatum,'2035-10-08');
  a.run(`tab='termine';render();`);
  await a.aktion('erl',t.id).dispatch('click');
  assert.equal(a.json('Object.keys(doc.termine).length'),2);
  const folge=a.json(`Object.values(doc.termine).find(x=>x.vorher==='${t.id}')`);
  assert.equal(folge.datum,'2035-10-08');assert.equal(folge.status,'geplant');assert.equal(folge.folgeDatum,'');
  a.run(`doc.termine.altMed={id:'altMed',art:'wurmkur',datum:'2035-01-01',erledigt:false,wieder:26,ts:1};render();`);
  await a.aktion('erl','altMed').dispatch('click');
  assert.equal(a.json('Object.keys(doc.termine).length'),3);
  assert.doesNotMatch(a.run('vTermine()'),/Impfung, Beschlag, Wurmkur und Co. laufen als Wiederholung/);
});

test('Terminbearbeitung erhält ID, Anwesenheit und Erledigt; Organisation und Status sind getrennte Felder',async()=>{
  const a=app();
  assert.equal(a.run(`sTermin({art:'physio',datum:'2035-04-06',personen:['Annika'],organisation:'Marta',status:'angefragt'}).organisation`),'Marta');
  a.run(`me='Thomas';doc.termine.alt={id:'alt',art:'physio',datum:'2035-04-06',zeit:'19:00',wer:['Annika'],erledigt:false,info:'Synthetische Notiz',fremdesFeld:'behalten',ts:1};`);
  const original=a.json('doc.termine.alt');
  a.run(`tab='termine';render();fTermin('alt');`);
  assert.deepEqual(a.json('doc.termine.alt'),original);
  assert.equal(a.node('tDatum').value,'2035-04-06');
  assert.equal(a.node('tZeit').value,'19:00');
  assert.equal(a.node('tOrg').value,'');
  assert.equal(a.node('tStatus').value,'');
  a.node('tOrg').value='Marta'; a.node('tStatus').value='angefragt';a.node('tInfo').value='Synthetische Änderung';
  a.network(async(url,o)=>o?.method==='POST'?{ok:true}:{ok:true,json:async()=>({})});
  await a.node('tOk').dispatch('click');
  const t=a.json('doc.termine.alt');
  assert.equal(a.json('Object.keys(doc.termine).length'),1);
  assert.equal(t.id,'alt');assert.equal(t.erledigt,false);assert.equal(t.fremdesFeld,'behalten');
  assert.deepEqual(t.wer,['Annika']);assert.equal(t.organisation,'Marta');assert.equal(t.status,'angefragt');
  assert.match(a.run('vTermine()'),/Organisation.*Marta/);assert.match(a.run('vTermine()'),/Anwesenheit.*Annika/);
  assert.match(a.run('vTermine()'),/keine fremde Zusage/);assert.match(a.run('vTermine()'),/data-tedit="alt"/);
});

test('Nachrichtenformular, Antwort und Heute-Anzeige funktionieren; Poll lässt beide Entwürfe stehen',async()=>{
  const a=app();
  assert.equal(a.run('typeof fFrage'),'function');
  assert.match(html,/data-tab="nachrichten"/);
  a.run(`me='Thomas';fFrage({thema:'betreuung',datum:'2035-04-06'});`);
  assert.equal(a.node('qDatum').value,'2035-04-06');
  a.node('qText').value='Synthetische <Tagesfrage>';
  a.node('qAn').selectedOptions=[{value:'Annika'}];
  a.network(async(url,o)=>o?.method==='POST'?{ok:true}:{ok:true,json:async()=>({})});
  await a.run('pull()');
  assert.equal(a.node('qText').value,'Synthetische <Tagesfrage>');
  assert.equal(a.node('modal').classList.contains('hidden'),false);
  await a.node('qOk').dispatch('click');
  const q=a.json('Object.values(doc.fragen)[0]');
  assert.equal(q.thema,'betreuung');
  assert.deepEqual(q.an,['Annika']);
  a.run(`me='Annika';fAntwort('${q.id}');`);
  a.node('aText').value='Synthetische <Testantwort>';
  await a.run('pull()');
  assert.equal(a.node('aText').value,'Synthetische <Testantwort>');
  await a.node('aOk').dispatch('click');
  assert.match(a.run('vHeute()'),/Synthetische &lt;Tagesfrage&gt;/);
  assert.match(a.run('vHeute()'),/Synthetische &lt;Testantwort&gt;/);
  assert.match(a.run('vNachrichten()'),/beantwortet/);
  assert.match(a.run('vNachrichten()'),/außerhalb.*geöffneten App.*keine automatische WhatsApp-Nachricht/i);
  assert.doesNotMatch(a.run('vNachrichten()'),/wa\.me|api\.whatsapp|als gesendet/);
});

test('Fragen adressieren Team und Datum; parallele unveränderliche Antworten bleiben getrennt ohne Betreuungszusage',()=>{
  const a=app(),b=app();
  assert.equal(a.run('typeof sFrage'),'function');
  a.run(`me='Thomas';const q=sFrage({text:'Synthetische Testfrage',an:['Annika','Marta'],thema:'betreuung',datum:'2035-04-06'});doc.fragen[q.id]=q;`);
  const frage=a.json('Object.values(doc.fragen)[0]');
  assert.deepEqual(frage.an,['Annika','Marta']);
  assert.equal(frage.datum,'2035-04-06');
  b.run(`merge(${JSON.stringify(a.json('doc'))});me='Marta';antworte('${frage.id}','Synthetische Antwort B');`);
  a.run(`me='Annika';antworte('${frage.id}','Synthetische Antwort A');`);
  const original=a.json('Object.values(doc.antworten)[0]');
  a.run(`merge(${JSON.stringify(b.json('doc'))});merge({antworten:{'${original.id}':{...doc.antworten['${original.id}'],text:'verändert',ts:9999999999999}}});`);
  assert.equal(a.json('Object.keys(doc.antworten).length'),2);
  assert.equal(a.json(`doc.antworten['${original.id}'].text`),'Synthetische Antwort A');
  assert.equal(a.json(`frageStatus(doc.fragen['${frage.id}'])`),'beantwortet');
  a.run(`setFrageStatus('${frage.id}','erledigt')`);
  assert.equal(a.json(`frageStatus(doc.fragen['${frage.id}'])`),'erledigt');
  assert.equal(a.json('Object.keys(doc.betreuungszusagen).length'),0);
  assert.equal(a.json('Object.keys(doc.termine).length'),0);
  assert.equal(a.json('Object.keys(doc.plan).length'),0);
  assert.throws(()=>a.run(`sFrage({text:'Test',an:[],datum:''})`),/Empfänger/);
});

test('Heute/Morgen trennen Plan von Selbstzusage, zeigen Parallelkonflikt und dauerhafte eigene Rücknahme',()=>{
  const a=app(),b=app();
  assert.equal(a.run('typeof sageZu'),'function');
  a.run(`me='Annika';doc.plan['2035-04-05']={personen:['Marta'],ts:1};`);
  const leer=a.run('vHeute()');
  assert.match(leer,/HEUTE/); assert.match(leer,/MORGEN/);
  assert.match(leer,/Geplant.*Marta/); assert.match(leer,/Verbindliche Übernahme: offen/);
  a.run(`sageZu('2035-04-05')`);
  const id=a.json('Object.keys(doc.betreuungszusagen)[0]');
  assert.equal(a.json(`doc.betreuungszusagen['${id}'].person`),'Annika');
  assert.equal(a.json(`doc.betreuungszusagen['${id}'].datum`),'2035-04-05');
  assert.equal(a.json(`doc.betreuungszusagen['${id}'].ts`),Date.parse('2035-04-05T10:00:00Z'));
  b.run(`me='Marta';sageZu('2035-04-05');`);
  a.run(`merge(${JSON.stringify(b.json('doc'))});`);
  assert.match(a.run(`vBetreuung('2035-04-05','HEUTE')`),/Mehrere Zusagen/);
  assert.match(a.run(`vBetreuung('2035-04-05','HEUTE')`),/Marta/);
  const fremd=a.json(`Object.values(doc.betreuungszusagen).find(z=>z.person==='Marta').id`);
  assert.equal(a.run(`nimmZurueck('${fremd}')`),false);
  const vorher=a.json('doc');
  assert.equal(a.run(`nimmZurueck('${id}')`),true);
  a.run(`merge(${JSON.stringify(vorher)});`);
  assert.equal(a.run(`doc.betreuungszusagen['${id}']`),undefined);
  assert.equal(a.json(`doc.plan['2035-04-05'].personen`)[0],'Marta');
  assert.doesNotMatch(a.run(`vBetreuung('2035-04-05','HEUTE')`),/Mehrere Zusagen/);
});

test('Gesundheitsdaten lehnen ungültige Daten und unbelegte Fälligkeit ab',async()=>{
  const a=app();
  assert.throws(()=>a.run(`sGesundheit({art:'impfung',datum:'2035-02-31',bezeichnung:'Test',quelle:'Test'})`),/Datum/);
  assert.throws(()=>a.run(`sGesundheit({art:'impfung',bezeichnung:'Test',quelle:'Test',faellig:'2035-05-01'})`),/Bestätigung/);
  a.run(`fGesundheit('impfung');`);
  assert.match(a.node('sheet').innerHTML,/Fälligkeit laut Impfpass\/Tierarzt/);
  assert.match(a.node('sheet').innerHTML,/Thomas.*Zustimmung/);
  a.node('gName').value='Test'; a.node('gQuelle').value='Test'; a.node('gFaellig').value='2035-05-01';
  await a.node('gOk').dispatch('click');
  assert.equal(a.json('Object.keys(doc.gesundheit).length'),0);
  assert.equal(a.requests.length,0);
});

test('Gesundheitsformular beginnt ohne Daten und speichert belegte Maßnahmen im Laufzeitstand',async()=>{
  const a=app();
  assert.equal(a.run('typeof fGesundheit'),'function');
  assert.match(html,/data-tab="gesundheit"/);
  a.run(`me='Testperson'; fGesundheit();`);
  assert.equal(a.node('gDatum').value,'');
  assert.equal(a.node('gFaellig').value,'');
  assert.match(a.run('vGesundheit()'),/Fälligkeit unbekannt/);
  a.node('gArt').value='impfung';
  a.node('gName').value='Synthetische <Impfbezeichnung>';
  a.node('gDatum').value='2035-01-01';
  a.node('gQuelle').value='Synthetischer Impfpassbeleg';
  a.node('gFaellig').value='2035-05-02';
  a.node('gBeleg').value='Synthetische tierärztliche Bestätigung';
  a.network(async(url,o)=>o?.method==='POST'?{ok:true}:{ok:false,status:404});
  await a.node('gOk').dispatch('click');
  const g=a.json('Object.values(doc.gesundheit)[0]');
  assert.equal(g.bezeichnung,'Synthetische <Impfbezeichnung>');
  assert.equal(g.quelle,'Synthetischer Impfpassbeleg');
  assert.equal(g.faellig,'2035-05-02');
  assert.equal(a.json(`pflegeStand('impfung').faellig`),'2035-05-02');
  assert.match(a.run('vGesundheit()'),/Synthetische &lt;Impfbezeichnung&gt;/);
  assert.match(a.run('vGesundheit()'),/01\.01\.2035/);
  assert.equal(a.json('Object.keys(doc.termine).length'),0);
});

test('Impfung und Wurmkur erhalten keine pauschale Fälligkeit oder alte Standardwiederholung',()=>{
  const a=app();
  a.run(`doc.termine.i={id:'i',art:'impfung',datum:'2035-01-01',wieder:52,erledigt:true,ts:1};
    doc.termine.w={id:'w',art:'wurmkur',datum:'2035-01-01',wieder:12,erledigt:true,ts:1};`);
  assert.equal(a.json(`pflegeStand('impfung').faellig`),'');
  assert.equal(a.json(`pflegeStand('wurmkur').faellig`),'');
  assert.equal(a.run(`naechsterTermin(doc.termine.i,'2035-01-01')`),null);
  assert.equal(a.run(`naechsterTermin(doc.termine.w,'2035-01-01')`),null);
  assert.equal(a.json(`naechsterTermin({id:'h',art:'hufschmied',datum:'2035-01-01',wieder:6},'2035-01-01').datum`),'2035-02-12');
  assert.equal(a.json(`naechsterTermin({...doc.termine.i,wiederQuelle:'Tierärztlich belegtes Testintervall'},'2035-01-01').datum`),'2035-12-31');
  assert.equal(a.json(`naechsterTermin({...doc.termine.w,wieder:0,folgeDatum:'2035-05-02',folgeQuelle:'Tierärztlicher Testbeleg'},'2035-01-01').datum`),'2035-05-02');
});

test('Poll sichert gelesene Daten lokal und reicht offene Änderungen nach',async()=>{
  const a=app();
  a.run(`doc.termine.lokal={id:'lokal',datum:'2035-04-05',ts:5}; dirty=true;`);
  a.network(async(url,opts)=>opts?.method==='POST'?{ok:true}:{ok:true,json:async()=>({termine:{fern:{id:'fern',datum:'2035-04-05',ts:6}}})});
  await a.run('pull()');
  assert.equal(a.requests.filter(([,o])=>o?.method==='POST').length,1);
  assert.equal(JSON.parse(a.store.get('schoki_cache')).termine.fern.id,'fern');
  assert.equal(a.run('dirty'),false);
  const b=app();
  b.network(async()=>({ok:true,json:async()=>({termine:{fern:{id:'fern',datum:'2035-04-05',ts:6}}})}));
  await b.run('pull()');
  assert.equal(JSON.parse(b.store.get('schoki_cache')).termine.fern.id,'fern');
  assert.equal(b.requests.filter(([,o])=>o?.method==='POST').length,0);
});

test('Speichern liest zuerst Remote und überschreibt bei Lesefehler keinen fremden Stand',async()=>{
  const a=app();
  a.run(`doc.termine.lokal={id:'lokal',datum:'2035-04-05',ts:5};`);
  a.network(async(url,opts)=>opts?.method==='POST'?{ok:true}:{ok:true,json:async()=>({termine:{fern:{id:'fern',datum:'2035-04-05',ts:6}},neu:{x:{id:'x',ts:7}},tomb:{weg:8}})});
  await a.run('save()');
  const post=a.requests.find(([,o])=>o?.method==='POST');
  assert.equal(a.requests[0][1]?.method||'GET','GET');
  const body=JSON.parse(post[1].body);
  assert.equal(body.termine.fern.id,'fern');
  assert.equal(body.neu.x.id,'x');
  assert.equal(body.tomb.weg,8);
  const b=app(); b.network(async()=>{throw new Error('synthetisch offline');});
  b.run(`doc.termine.lokal={id:'lokal',datum:'2035-04-05',ts:5};`);
  await b.run('save()');
  assert.equal(b.requests.filter(([,o])=>o?.method==='POST').length,0);
  assert.equal(b.run('dirty'),true);
  assert.equal(JSON.parse(b.store.get('schoki_cache')).termine.lokal.id,'lokal');
});

test('Merge erhält unbekannte Collections und Grabsteine dauerhaft gegen alte Geräte',()=>{
  const a=app();
  a.run(`merge({stand:10,zukunft:{f:{id:'f',text:'synthetisch',ts:3}},tomb:{weg:9},termine:{weg:{id:'weg',ts:2}}});
    merge({stand:11,termine:{weg:{id:'weg',ts:4},bleibt:{id:'bleibt',ts:2}}});`);
  assert.equal(a.run('doc.zukunft?.f?.text'),'synthetisch');
  assert.equal(a.json('doc.tomb.weg'),9);
  assert.equal(a.run('doc.termine.weg'),undefined);
  assert.equal(a.json('doc.termine.bleibt.id'),'bleibt');
  a.run(`merge({zukunft:{f:{id:'f',text:'veraltet',ts:1}},tomb:{f:3}}); merge({zukunft:{f:{id:'f',ts:2}}});`);
  assert.equal(a.run('doc.zukunft.f'),undefined);
});
