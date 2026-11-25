// Gemeinsame Test-Harness für Schoki-Tests.
// Ausschließlich synthetische Daten. Kein Browserstart, kein Netz, kein echter Speicher.
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
module.exports = { test:require('node:test').test, assert, app, html };
