/*
  GENNEPS GEWIEKSTE — UITSLAGEN-APP (hoofdbestand)

  Indeling van dit bestand:
  - DEF ............ standaardrubrieken als er nog niets is ingesteld
  - helpers ........ kleine hulpfuncties (esc, num, ...)
  - scores ......... rekenen: punten per regel, vraag, rubriek, team, joker, ranglijst
  - opslaan ........ alles wordt direct opgeslagen via db (zie js/opslag.js)
  - render ......... de pagina wordt steeds opnieuw opgebouwd uit de gegevens (S)
  - v... functies .. de tabbladen: vNakijken, vVragen, vOverzicht, vUitslag, vTeams, vJokers, vInst
  - invoer ......... wat er gebeurt bij typen en klikken (data-act="...")
  - opstarten ...... kiest Firebase (online) of lokaal en start het luisteren naar wijzigingen

  Gegevens in de database:
  beheer/config   naam, editie, jury (aantal), rubrieken[]      (alleen beheerder)
  beheer/teams    teams: { "1": "Teamnaam", ... }               (alleen beheerder)
  beheer/jokers   j: { "1": "r6", ... }  teamnummer -> rubriek  (alleen beheerder)
  beheer/toegang  emails: [ ... ]  extra Google-adressen         (alleen beheerder)
  beheer/bestuur  uid, ww  het gezamenlijke bestuursaccount     (alleen beheerder)
  publiek/bestuur namen: [ ... ]  namenlijst op het inlogscherm (iedereen leest)
  aanmeldingen/<id> naam, tijd  wie heeft ingelogd              (alleen beheerder leest)
  vragen/<rubriek> v: { v1: {titel, punten, soort, nummering, regels[]}, ... }
  scores/<rubriek> s: { t1: { <regelId>: punten | {j1,j2,j3} }, ... }
*/
(function(){
"use strict";
const $app=document.getElementById('app');
const OWL='<img class="owl" src="img/uil.png" alt="Logo Genneps Gewiekste">';

const DEF={naam:'Genneps Gewiekste',editie:'6e editie',jury:3,rubrieken:[
  {id:'sp',naam:'Sponsorrubriek',soort:'sponsor',vragen:7,max:1000},
  ...Array.from({length:10},(_,i)=>({id:'r'+(i+1),naam:'Rubriek '+(i+2),soort:'normaal',vragen:7,max:1000})),
  {id:'gh',naam:'Geheime opdracht',soort:'geheim',vragen:1,max:1000},
  {id:'ov',naam:'Overige',soort:'overig',vragen:1,max:1000}
]};
// vaste rubriek Overige (extra punten) altijd achteraan, ook in oudere opgeslagen instellingen
function metOverig(c){if(c&&Array.isArray(c.rubrieken)&&!c.rubrieken.some(r=>r.soort==='overig'))c.rubrieken.push({id:'ov',naam:'Overige',soort:'overig',vragen:1,max:1000});return c}
const TABS=[['vragen','Vragen & antwoorden'],['nakijken','Nakijken'],['overzicht','Totaaloverzicht'],['uitslag','Uitslag'],['stats','Statistieken']];
const BTABS=[['teams','Teams'],['jokers','Jokers'],['instellingen','Instellingen']];

const S={config:null,teams:{},jokers:{},vragen:{},scores:{},seen:{},fresh:false,
  isOwner:false,canWrite:true,backend:null,email:'',needLogin:false,noAccess:false,toegang:[],namen:[],naam:'',isBestuur:false,bestuur:{},aanm:[],dbOk:null,loadSlow:false,saving:0,
  tab:'nakijken',rid:null,mode:'raster',team:null,confirm:null,pf:null};
const dirty=new Set(), Q={};
let db=null,VC={},subscribed=false;

try{S.naam=localStorage.getItem('gg_naam')||'';S.rid=localStorage.getItem('gg_rid');S.mode=localStorage.getItem('gg_mode')||'raster';S.uj=localStorage.getItem('gg_uj')||'met';const t=+localStorage.getItem('gg_team');if(t)S.team=t;}catch(e){}
const h0=location.hash.slice(1); if([...TABS,...BTABS].some(t=>t[0]===h0))S.tab=h0;

/* ---------- helpers ---------- */
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o==null?{}:o));
const num=x=>{x=Number(x);return isFinite(x)&&x>0?Math.round(x):0};
const fmt=w=>w==null?'':String(w);
const newId=()=>'g'+Math.random().toString(36).slice(2,9);
function store(k,v){try{localStorage.setItem(k,v)}catch(e){}}

function cfg(){return S.config||DEF}
function rubs(){return Array.isArray(cfg().rubrieken)?cfg().rubrieken:DEF.rubrieken}
function rub(id){return rubs().find(r=>r.id===id)}
// rubrieknummer: de sponsorrubriek telt mee (die is rubriek 1), de geheime opdracht is G, overige is O
const VAST={geheim:'G',overig:'O'};
function code(r){if(!r)return'?';if(VAST[r.soort])return VAST[r.soort];let n=0;for(const x of rubs()){if(!VAST[x.soort]){n++;if(x.id===r.id)return String(n)}}return'?'}
function jury(){return Math.max(1,Math.min(6,+cfg().jury||3))}
function teams(){return Object.entries(S.teams||{}).map(([nr,naam])=>({nr:+nr,naam:String(naam||'')})).filter(t=>t.nr>0).sort((a,b)=>a.nr-b.nr)}
function teamLabel(t){return 'Team '+t.nr+(t.naam?' – '+t.naam:'')}
function ensureRid(){if(!rub(S.rid))S.rid=(rubs()[0]||{}).id}

function defVraag(i){return{titel:'',punten:0,soort:'antwoord',nummering:'enkel',regels:[{id:'v'+i+'r1',tekst:'',punten:0}]}}
function norm(v,i){if(!v||typeof v!=='object')return defVraag(i);
  return{titel:String(v.titel||''),punten:num(v.punten),soort:v.soort==='creatief'?'creatief':'antwoord',
    nummering:['enkel','abc','123'].includes(v.nummering)?v.nummering:'enkel',
    regels:Array.isArray(v.regels)?v.regels.filter(x=>x&&x.id).map(x=>({id:String(x.id),tekst:String(x.tekst||''),punten:num(x.punten)})):[]}}
function vragen(rid){if(VC[rid])return VC[rid];const r=rub(rid);if(!r)return[];const n=Math.max(1,Math.min(20,+r.vragen||7));
  const st=(S.vragen[rid]&&S.vragen[rid].v)||{};const out=[];for(let i=1;i<=n;i++)out.push(norm(st['v'+i],i));return VC[rid]=out}
function lab(v,k){if(v.nummering==='abc')return String.fromCharCode(65+k);if(v.nummering==='123')return String(k+1);return v.regels.length>1?String.fromCharCode(65+k):''}

/* ---------- scores ---------- */
function raw(rid,nr,rg){const d=S.scores[rid];const t=d&&d.s&&d.s['t'+nr];return t?t[rg]:undefined}
function juryVals(o){const a=[];if(o&&typeof o==='object')for(let j=1;j<=jury();j++){const x=o['j'+j];if(typeof x==='number'&&isFinite(x))a.push(x)}return a}
function waarde(rid,nr,v,g){const x=raw(rid,nr,g.id);
  if(v.soort==='creatief'){if(typeof x==='number')return x;const a=juryVals(x);if(!a.length)return null;
    return Math.min(g.punten,Math.ceil(a.reduce((s,y)=>s+y,0)/a.length-1e-9))}
  return typeof x==='number'&&isFinite(x)?x:null}
function vraagScore(rid,nr,v){let s=null;for(const g of v.regels){const w=waarde(rid,nr,v,g);if(w!=null)s=(s||0)+w}return s}
function rubTot(rid,nr){let s=0;for(const v of vragen(rid))for(const g of v.regels){const w=waarde(rid,nr,v,g);if(w!=null)s+=w}return s}
function creaTot(nr){let s=0;for(const r of rubs())for(const v of vragen(r.id))if(v.soort==='creatief')for(const g of v.regels){const w=waarde(r.id,nr,v,g);if(w!=null)s+=w}return s}
function jokerOf(nr){const j=(S.jokers||{})[String(nr)];const r=j&&rub(j);return r&&r.soort==='normaal'?r.id:null}
function teamTot(nr,zonderJ){let t=0;for(const r of rubs())t+=rubTot(r.id,nr)*(!zonderJ&&jokerOf(nr)===r.id?2:1);return t}
function progress(rid,nr){let d=0,a=0;for(const v of vragen(rid))for(const g of v.regels){a++;if(waarde(rid,nr,v,g)!=null)d++}return[d,a]}
function cls(w,max){if(w==null)return'';if(max>0&&w>=max)return'v-max';if(w===0)return'v-zero';return'v-part'}
function ranking(zonderJ){const L=teams().map(t=>({...t,tot:teamTot(t.nr,zonderJ),crea:creaTot(t.nr)}));
  L.sort((a,b)=>b.tot-a.tot||b.crea-a.crea||a.nr-b.nr);let p=0;
  L.forEach((x,i)=>{if(i===0||x.tot!==L[i-1].tot||x.crea!==L[i-1].crea)p=i+1;x.place=p});return L}

/* ---------- opslaan ---------- */
function setStatus(){const el=document.getElementById('status');if(el)el.textContent=statusTxt()}
function statusTxt(){if(S.needLogin)return'Niet ingelogd';if(S.noAccess)return'Geen toegang';if(S.saving>0)return'Opslaan…';if(S.backend==='lokaal')return'Opgeslagen op deze computer ✓';if(S.saving>0)return'Opslaan…';return S.fresh?'':'Laden…'}
function enqueue(path,fn){if(!db)return;S.saving++;setStatus();
  Q[path]=(Q[path]||Promise.resolve()).then(fn).catch(onErr).finally(()=>{S.saving--;setStatus()})}
function onErr(e){const c=e&&e.code;
  if(c==='permission-denied'||c==='invalid_argument'){S.canWrite=false;toast('Opslaan lukte niet: je hebt geen rechten om dit te wijzigen. Vraag de beheerder om toegang.',true);schedule()}
  else if(c==='resource-exhausted'||c==='quota_exceeded')toast('De opslag zit (tijdelijk) aan zijn limiet. Probeer het later opnieuw.',true);
  else if(c==='unauthenticated'){S.needLogin=true;schedule()}
  else toast('Opslaan lukte niet door een verbindingsprobleem. Vul de laatste waarde opnieuw in.',true)}
function applyScore(rid,nr,rg,val){const d=clone(S.scores[rid]||{s:{}});d.s=d.s||{};const t=d.s['t'+nr]=d.s['t'+nr]||{};
  if(val&&typeof val==='object'){const o=(t[rg]&&typeof t[rg]==='object')?t[rg]:{};Object.assign(o,val);t[rg]=o}else t[rg]=val;S.scores[rid]=d}
function saveScore(rid,nr,rg,val){applyScore(rid,nr,rg,val);schedule();const p='scores/'+rid;
  enqueue(p,()=>db.doc(p).update({s:{['t'+nr]:{[rg]:val}}}))}
function saveVraag(rid,i,v){const d=clone(S.vragen[rid]||{v:{}});d.v=d.v||{};d.v['v'+i]=v;S.vragen[rid]=d;VC={};schedule();
  const p='vragen/'+rid;enqueue(p,()=>db.doc(p).update({v:{['v'+i]:v}}))}
function saveToegang(list){S.toegang=list;schedule();saveDoc('beheer/toegang',{emails:list})}
function saveNamen(list){S.namen=list;schedule();saveDoc('publiek/bestuur',{namen:list})}
// algemeen wachtwoord: het bestuursaccount aanmaken of het wachtwoord wijzigen,
// via een tweede Firebase-app zodat de beheerder zelf ingelogd blijft
async function zetBestuurWw(ww){const F=window.GG_FIREBASE;
  const app2=firebase.apps.find(a=>a.name==='bestuur')||firebase.initializeApp(F.config,'bestuur');
  const a2=app2.auth();await a2.setPersistence(firebase.auth.Auth.Persistence.NONE);
  const oud=S.bestuur&&S.bestuur.ww;let cred;
  try{cred=await a2.createUserWithEmailAndPassword(F.bestuurAccount,ww)}
  catch(e){if(!e||e.code!=='auth/email-already-in-use')throw e;if(!oud)throw{code:'geen-oud'};
    cred=await a2.signInWithEmailAndPassword(F.bestuurAccount,oud);if(oud!==ww)await cred.user.updatePassword(ww)}
  const uid=cred.user.uid;await a2.signOut();
  await db.doc('beheer/bestuur').set({uid,ww})}
function loginFout(e){const c=e&&e.code;
  if(['auth/wrong-password','auth/invalid-credential','auth/invalid-login-credentials','auth/user-not-found'].includes(c))return'Dat wachtwoord klopt niet. Probeer het nog eens.';
  if(c==='auth/too-many-requests')return'Te vaak geprobeerd. Wacht een paar minuten en probeer het opnieuw.';
  if(c==='auth/network-request-failed')return'Geen internetverbinding. Controleer je verbinding.';
  return'Inloggen lukte niet: '+((e&&(e.message||e.code))||'onbekende fout')}
function loginBestuur(){const F=window.GG_FIREBASE;const naam=S.naam;const ww=(document.getElementById('ln_ww')||{}).value||'';
  if(!naam){toast('Kies eerst je naam.',true);return}if(!ww){toast('Vul het wachtwoord in.',true);return}
  store('gg_naam',naam);
  firebase.auth().signInWithEmailAndPassword(F.bestuurAccount,ww)
    .then(()=>db.doc('aanmeldingen/'+Date.now()+'-'+Math.random().toString(36).slice(2,7)).set({naam,tijd:Date.now()}).catch(()=>{}))
    .catch(e=>toast(loginFout(e),true))}
function saveDoc(path,data){enqueue(path,()=>db.doc(path).set(data))}
function saveTeams(t){S.teams=t;schedule();saveDoc('beheer/teams',{teams:t})}
function saveJokers(j){S.jokers=j;schedule();saveDoc('beheer/jokers',{j:j})}
function saveConfig(c){S.config=c;VC={};schedule();saveDoc('beheer/config',c)}

/* ---------- toast & bevestigen ---------- */
let tt=0;function toast(msg,bad){const el=document.getElementById('toast');el.textContent=msg;el.className='show'+(bad?' bad':'');clearTimeout(tt);tt=setTimeout(()=>{el.className=''},bad?5200:2600)}
function askConfirm(key){if(S.confirm===key){S.confirm=null;return true}S.confirm=key;schedule();setTimeout(()=>{if(S.confirm===key){S.confirm=null;schedule()}},4000);return false}

/* ---------- render ---------- */
// nakijktabel loopt door tot de onderkant van het scherm; alleen de tabel scrollt
function fitGrid(){const g=$app.querySelector('.grid-wrap.nk');if(!g)return;
  const top=g.getBoundingClientRect().top+window.scrollY;g.style.maxHeight=Math.max(320,window.innerHeight-top-16)+'px'}
window.addEventListener('resize',fitGrid);
let raf=0;function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;render()})}
function render(){VC={};
  const a=document.activeElement;let f=null;
  if(a&&a.id&&$app.contains(a))f={id:a.id,val:a.value,s:null,e:null,tag:a.tagName};
  if(f&&f.tag==='INPUT'){try{f.s=a.selectionStart;f.e=a.selectionEnd}catch(e){}}
  const gw=$app.querySelector('.grid-wrap');const sc=gw?{l:gw.scrollLeft,t:gw.scrollTop}:null;
  $app.innerHTML=html();fitGrid();
  const gw2=$app.querySelector('.grid-wrap');if(gw2&&sc){gw2.scrollLeft=sc.l;gw2.scrollTop=sc.t}
  if(S.pf){const el=document.getElementById(S.pf);S.pf=null;if(el){el.focus({preventScroll:false});if(el.select)el.select()}return}
  if(f){const el=document.getElementById(f.id);if(el){
    if(dirty.has(f.id)&&el.value!==f.val)el.value=f.val;
    el.focus({preventScroll:true});if(f.s!=null){try{el.setSelectionRange(f.s,f.e)}catch(e){}}}}}

function html(){return header()+'<main class="wrap main">'+notices()+view()+'</main>'}
function header(){const c=cfg();
  const role=S.backend==='lokaal'?'Lokaal testen':S.isOwner?'Beheerder':(S.dbOk&&S.canWrite?'Bestuurslid':'Alleen lezen');
  const tb=([k,l],lock)=>`<button class="tab" data-act="tab" data-tab="${k}"${S.tab===k?' aria-current="page"':''}>${lock?'<span class="lock" aria-hidden="true">🔒</span>':''}${l}</button>`;
  return `<header class="band"><div class="wrap top"><div class="brand">${OWL}<div><h1>${esc(c.naam||'Genneps Gewiekste')}</h1><p>${esc(c.editie||'')}${c.editie?' · ':''}Uitslagen &amp; nakijken</p></div></div>
  <div class="head-r"><div class="top-right"><span class="role">${role}</span><span id="status" class="status" aria-live="polite">${statusTxt()}</span>${S.email?`<span class="who" title="Ingelogd">${esc(S.isBestuur?(S.naam||'Bestuur'):S.email)}</span><button class="btn ghost" data-act="logout">Uitloggen</button>`:''}</div>
  ${S.needLogin?'':`<nav class="tabs" aria-label="Onderdelen">`}${S.needLogin?'':TABS.map(t=>tb(t)).join('')}${S.isOwner?'<span class="tabsep" aria-hidden="true"></span>'+BTABS.map(t=>tb(t,1)).join(''):''}${S.needLogin?'':'</nav>'}</div></div></header>`}
function notices(){let h='';
  if(S.backend==='lokaal')h+='<div class="notice"><b>Lokaal testen.</b> Firebase is nog niet ingesteld (js/firebase-config.js). Alles wordt alleen in deze browser bewaard.</div>';
  if(S.noAccess)h+=S.isBestuur?'<div class="notice bad"><b>Nog geen toegang.</b> Het bestuursaccount is nog niet goedgekeurd. Vraag de beheerder om bij Instellingen het wachtwoord opnieuw in te stellen. Daarna herlaad je de pagina.</div>'
    :`<div class="notice bad"><b>Nog geen toegang.</b> Je bent ingelogd als ${esc(S.email)}, maar dit adres staat nog niet op de lijst. Vraag de beheerder om je e-mailadres toe te voegen. Daarna herlaad je de pagina.</div>`;
  else if(S.loadSlow&&!S.fresh)h+='<div class="notice">De gegevens zijn nog niet bereikbaar. Controleer je internetverbinding. De pagina probeert het zelf opnieuw.</div>';
  else if(S.dbOk&&!S.canWrite)h+='<div class="notice">Je kunt meekijken, maar niets wijzigen.</div>';
  return h}
function vLogin(){const N=S.namen||[];
  const kies=N.length?`<p class="mut">Kies je naam en vul het wachtwoord van het bestuur in. Alles wordt direct opgeslagen.</p>
    <label class="fld"><span>Je naam</span><select class="inp" id="ln_naam" data-act="ln-naam"><option value="">Kies je naam…</option>${N.map(n=>`<option value="${esc(n)}"${n===S.naam?' selected':''}>${esc(n)}</option>`).join('')}</select></label>
    <div class="fld"><label for="ln_ww">Wachtwoord</label>${wwVeld('ln_ww','','autocomplete="current-password"')}</div>
    <button class="btn primary big" data-act="login-bestuur">Inloggen</button>`
    :'<p class="mut">De beheerder heeft nog geen bestuursleden ingesteld.</p>';
  return `<div class="login">${OWL}<h2>Welkom bij de uitslagen</h2>${kies}<div class="login-beh"><p class="mut">Ben je de beheerder?</p><button class="btn" data-act="login">Inloggen met Google</button></div></div>`}
function view(){if(S.needLogin)return vLogin();if(S.noAccess)return '';let t=S.tab;if(BTABS.some(x=>x[0]===t)&&!S.isOwner)t='nakijken';
  return({nakijken:vNakijken,vragen:vVragen,overzicht:vOverzicht,uitslag:vUitslag,stats:vStats,teams:vTeams,jokers:vJokers,instellingen:vInst}[t]||vNakijken)()}
function empty(t,p){return `<div class="empty"><h3>${t}</h3><p>${p}</p></div>`}
// wachtwoordvak met een knop om te wisselen tussen bolletjes en leesbare tekst
const toonWw={};
function wwVeld(id,val,extra){const t=!!toonWw[id];
  return `<div class="ww-rij"><input class="inp" id="${id}" type="${t?'text':'password'}" value="${esc(val)}" spellcheck="false" ${extra}><button type="button" class="btn" data-act="toon-ww" data-for="${id}" aria-pressed="${t}">${t?'Verbergen':'Tonen'}</button></div>`}
// rubriekkeuze: één uitklapmenu in plaats van een rij knoppen
function rubSelect(){ensureRid();return `<label class="rubsel"><span>Rubriek</span><select class="inp sel-rub" id="rubsel" data-act="rub">${rubs().map(r=>`<option value="${r.id}"${r.id===S.rid?' selected':''}>${code(r)} · ${esc(r.naam)}</option>`).join('')}</select></label>`}
const dis=()=>S.canWrite&&S.dbOk?'':' disabled';

/* ---------- Nakijken ---------- */
function vNakijken(){ensureRid();const r=rub(S.rid);const T=teams();
  let h=`<div class="toolbar">${rubSelect()}<div class="seg" role="group" aria-label="Weergave"><button data-act="mode" data-m="raster" aria-pressed="${S.mode!=='team'}">Alle teams (raster)</button><button data-act="mode" data-m="team" aria-pressed="${S.mode==='team'}">Per team</button></div>
  <p class="hint">Typ een getal, of <kbd>g</kbd> = goed (alle punten) en <kbd>f</kbd> = fout (0). Met <kbd>Enter</kbd> ga je naar de volgende regel, met de <kbd>pijltjes</kbd> naar elk vakje.</p></div>`;
  if(!T.length)return h+empty('Er zijn nog geen teams','De beheerder maakt de teams aan onder Teams. Daarna verschijnen ze hier.');
  return h+(S.mode==='team'?perTeam(r,T):raster(r,T))}

function scoreInput(pre,r,t,v,g,j,extra){const x=raw(r.id,t.nr,g.id);
  let val='';if(j){if(x&&typeof x==='object'&&typeof x['j'+j]==='number')val=x['j'+j]}else if(typeof x==='number')val=x;
  const id=`${pre}_${r.id}_${t.nr}_${g.id}${j?'_j'+j:''}`;
  return `<input class="${extra}" id="${id}" data-act="score" data-rid="${r.id}" data-nr="${t.nr}" data-rg="${g.id}"${j?` data-j="${j}"`:''} data-max="${g.punten}" inputmode="numeric" autocomplete="off" value="${val}" aria-label="Team ${t.nr}, ${esc(g.tekst||v.titel||'regel')}${j?', jury '+j:''}"${dis()}>`}

function raster(r,T){const V=vragen(r.id);const J=jury();const isN=r.soort==='normaal';const pc=code(r);
  // smalle blauwe kolom die vast blijft staan, als scheiding tussen de vragen en de teams
  const SP='<td class="stk c4 sp" aria-hidden="true"></td>';
  let h=`<div class="grid-wrap nk"><table class="grid nk" style="--nt:${T.length}"><colgroup><col class="w1"><col class="w2"><col class="w3"><col class="wsp">${T.map(()=>'<col class="wt">').join('')}</colgroup>
  <thead><tr><th class="stk c1">#</th><th class="stk c2 tl">Vraag / opdracht</th><th class="stk c3">Punten</th><th class="stk c4 sp" aria-hidden="true"></th>${T.map(t=>`<th class="ct" title="Team ${t.nr}"><span class="tnm">Team</span><span class="tn">${t.nr}${jokerOf(t.nr)===r.id?' <span class="jk" title="Joker op deze rubriek">★</span>':''}</span></th>`).join('')}</tr></thead><tbody>`;
  V.forEach((v,i)=>{
    h+=`<tr class="rq"><td class="stk c1">${pc}.${i+1}</td><td class="stk c2 tl" title="${esc(v.titel)}">${v.titel?esc(v.titel):'<i>Nog geen titel</i>'}</td><td class="stk c3">${v.punten}</td>${SP}${T.map(t=>`<td>${fmt(vraagScore(r.id,t.nr,v))}</td>`).join('')}</tr>`;
    v.regels.forEach((g,k)=>{const L=lab(v,k);
      if(v.soort==='creatief'){
        h+=`<tr class="rg"><td class="stk c1">${L}</td><td class="stk c2 tl" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Beoordeling</i>'} <span class="mut">· gemiddelde</span></td><td class="stk c3">0–${g.punten}</td>${SP}${T.map(t=>{const w=waarde(r.id,t.nr,v,g);return `<td class="${cls(w,g.punten)}">${fmt(w)}</td>`}).join('')}</tr>`;
        for(let j=1;j<=J;j++)h+=`<tr class="rj"><td class="stk c1"></td><td class="stk c2 tl">Jury ${j}</td><td class="stk c3">0–${g.punten}</td>${SP}${T.map(t=>`<td>${scoreInput('s',r,t,v,g,j,'gi')}</td>`).join('')}</tr>`;
      }else{
        h+=`<tr><td class="stk c1">${L}</td><td class="stk c2 tl" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Antwoord nog niet ingevuld</i>'}</td><td class="stk c3">${g.punten}</td>${SP}${T.map(t=>{const w=waarde(r.id,t.nr,v,g);return `<td class="${cls(w,g.punten)}">${scoreInput('s',r,t,v,g,0,'gi')}</td>`}).join('')}</tr>`;
      }});
  });
  const anyJ=isN&&T.some(t=>jokerOf(t.nr)===r.id);
  h+=`</tbody><tfoot><tr class="trow${anyJ?'':' solo'}"><td class="stk c1"></td><td class="stk c2 tl">Totaal rubriek</td><td class="stk c3">${r.max}</td>${SP}${T.map(t=>`<td>${rubTot(r.id,t.nr)}</td>`).join('')}</tr>`;
  if(anyJ)h+=`<tr class="jrow"><td class="stk c1">★</td><td class="stk c2 tl">Met joker (×2)</td><td class="stk c3"></td>${SP}${T.map(t=>`<td>${jokerOf(t.nr)===r.id?rubTot(r.id,t.nr)*2:''}</td>`).join('')}</tr>`;
  return h+'</tfoot></table></div>'}

function perTeam(r,T){if(!T.some(t=>t.nr===S.team))S.team=T[0].nr;const t=T.find(x=>x.nr===S.team);const idx=T.indexOf(t);
  const V=vragen(r.id);const J=jury();const isJ=jokerOf(t.nr)===r.id;const[d,a]=progress(r.id,t.nr);const pc=code(r);
  let h=`<div class="teambar"><button class="btn" data-act="team-prev"${idx===0?' disabled':''} aria-label="Vorig team">◀ Vorige</button>
  <select id="teamsel" class="inp sel-team" data-act="teamsel" aria-label="Kies team">${T.map(x=>`<option value="${x.nr}"${x.nr===t.nr?' selected':''}>Team ${x.nr}</option>`).join('')}</select>
  <button class="btn" data-act="team-next"${idx===T.length-1?' disabled':''} aria-label="Volgend team">Volgende ▶</button>
  <span class="badge ${d===a?'ok':'warn'}">${d} van ${a} ingevuld</span>${isJ?'<span class="badge joker">★ Joker: deze rubriek telt dubbel</span>':''}</div>`;
  V.forEach((v,i)=>{const vs=vraagScore(r.id,t.nr,v);
    h+=`<section class="qcard"><div class="qhead"><span class="qc">${pc}.${i+1}</span><span class="qt" title="${esc(v.titel)}">${v.titel?esc(v.titel):'<i>Nog geen titel</i>'}</span><span class="qs">${vs==null?'–':vs} / ${v.punten}</span></div>`;
    v.regels.forEach((g,k)=>{const L=lab(v,k)||'•';const w=waarde(r.id,t.nr,v,g);
      if(v.soort==='creatief'){let ins='';for(let j=1;j<=J;j++)ins+=scoreInput('p',r,t,v,g,j,'inp num jy').replace('<input ',`<input placeholder="J${j}" `);
        h+=`<div class="qrow"><span class="ql">${L}</span><span class="qa" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Beoordeling</i>'}</span><span class="qm">0–${g.punten}</span><span class="qctl">${ins}<span class="gem" title="Gemiddelde, naar boven afgerond">= ${w==null?'–':w}</span></span></div>`;
      }else{const dd=dis();
        h+=`<div class="qrow"><span class="ql">${L}</span><span class="qa" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Antwoord nog niet ingevuld</i>'}</span><span class="qm">${g.punten} pnt</span><span class="qctl">
        <button class="btn sm bad${w===0?' on':''}" data-act="set" data-v="0" data-rid="${r.id}" data-nr="${t.nr}" data-rg="${g.id}"${dd}>Fout</button>
        <button class="btn sm good${g.punten>0&&w===g.punten?' on':''}" data-act="set" data-v="${g.punten}" data-rid="${r.id}" data-nr="${t.nr}" data-rg="${g.id}"${dd||(g.punten?'':' disabled')}>Goed</button>
        ${scoreInput('p',r,t,v,g,0,'inp sc '+cls(w,g.punten))}</span></div>`}});
    h+='</section>'});
  const tot=rubTot(r.id,t.nr);
  h+=`<div class="tcard"><span>Totaal ${esc(r.naam)}: <b>${tot}</b> / ${r.max}</span>${isJ?`<span class="badge joker">Met joker: ${tot*2}</span>`:''}</div>`;
  return h}

/* ---------- Vragen & antwoorden ---------- */
function somBadge(som,max){if(som===max)return `<span class="badge ok">Totaal ${som} / ${max} ✓</span>`;
  if(som<max)return `<span class="badge warn">Totaal ${som} / ${max} · nog ${max-som} te verdelen</span>`;
  return `<span class="badge bad">Totaal ${som} / ${max} · ${som-max} te veel</span>`}
function regelBadge(rs,p){if(!p)return '<span class="badge warn">Vul eerst de punten van deze vraag in</span>';
  if(rs===p)return `<span class="badge ok">Regels samen ${rs} / ${p} ✓</span>`;
  return `<span class="badge ${rs>p?'bad':'warn'}">Regels samen ${rs} / ${p}</span>`}
function vVragen(){ensureRid();const r=rub(S.rid);const V=vragen(r.id);const som=V.reduce((s,v)=>s+v.punten,0);const max=+r.max||1000;const pc=code(r);const d=dis();
  let h=`<div class="toolbar">${rubSelect()}${somBadge(som,max)}</div>`;
  V.forEach((v,i)=>{const q=i+1;const rs=v.regels.reduce((s,g)=>s+g.punten,0);const base=`data-rid="${r.id}" data-q="${q}"`;
    const sel=(f,opts,cur)=>`<select class="inp" id="e_${r.id}_${q}_${f}" data-act="vf" data-f="${f}" ${base}${d}>${opts.map(([k,l])=>`<option value="${k}"${k===cur?' selected':''}>${l}</option>`).join('')}</select>`;
    h+=`<section class="qcard"><div class="ehead"><span class="qc">${pc}.${q}</span>
      <label class="fld"><span>Titel</span><input class="inp" id="e_${r.id}_${q}_titel" data-act="vf" data-f="titel" ${base} value="${esc(v.titel)}" placeholder="Titel van de vraag of opdracht"${d}></label>
      <div class="flds"><label class="fld"><span>Nakijken</span>${sel('soort',[['antwoord','Goed / fout (antwoorden)'],['creatief','Creatief (jury)']],v.soort)}</label>
      <label class="fld"><span>Nummering</span>${sel('nummering',[['enkel','Eén antwoord'],['abc','A  B  C'],['123','1  2  3']],v.nummering)}</label>
      <label class="fld"><span>Punten</span><input class="inp num" id="e_${r.id}_${q}_punten" data-act="vf" data-f="punten" ${base} inputmode="numeric" value="${v.punten||''}" placeholder="0"${d}></label></div></div>
      <div class="colh"><span></span><span class="tx">${v.soort==='creatief'?'Wat wordt beoordeeld':'Juiste antwoord'}</span><span>Punten</span><span></span></div>`;
    v.regels.forEach((g,k)=>{const ck='dr_'+r.id+'_'+q+'_'+g.id;const on=S.confirm===ck;
      h+=`<div class="erow"><span class="ql">${lab(v,k)||'•'}</span>
        <input class="inp tx" id="e_${r.id}_${q}_${g.id}_t" data-act="rf" data-f="tekst" data-k="${k}" ${base} value="${esc(g.tekst)}" placeholder="${v.soort==='creatief'?'Bijv. filmpje, tekening, creativiteit':'Het juiste antwoord'}" aria-label="Antwoord ${lab(v,k)}"${d}>
        <input class="inp num" id="e_${r.id}_${q}_${g.id}_p" data-act="rf" data-f="punten" data-k="${k}" ${base} inputmode="numeric" value="${g.punten||''}" placeholder="0" aria-label="Punten ${lab(v,k)}"${d}>
        <button class="ibtn${on?' danger':''}" data-act="del-regel" data-k="${k}" data-ck="${ck}" ${base} aria-label="Regel verwijderen"${d||(v.regels.length<2?' disabled':'')}>${on?'Zeker?':'✕'}</button></div>`});
    h+=`<div class="efoot"><button class="btn" data-act="add-regel" ${base}${d}>+ Antwoordregel</button><button class="btn" data-act="verdeel" ${base}${d}>Verdeel ${v.punten||0} punten gelijk</button>${regelBadge(rs,v.punten)}</div></section>`});
  return h}

/* ---------- Overzicht & uitslag ---------- */
// vaste tabelbreedte, zodat alle rubriekkolommen even breed blijven (lange rubrieknamen worden afgekapt)
function vOverzicht(){const T=teams();const R=rubs();
  if(!T.length)return empty('Nog geen teams','Zodra er teams zijn, zie je hier per team de punten van elke rubriek.');
  let h=`<div class="rhead"><div><h2>Totaaloverzicht</h2><p class="mut">Punten per team per rubriek, op teamnummer</p></div><div class="legend"><span class="badge joker">★ Joker: score ×2</span></div></div>
  <div class="grid-wrap"><table class="grid" style="width:calc(var(--w1) + 200px + ${R.length+1} * 76px)"><colgroup><col class="w1"><col class="wn">${R.map(()=>'<col class="wr">').join('')}<col class="wr"></colgroup>
  <thead><tr><th class="stk c1">Team</th><th class="stk tl" style="left:var(--w1)">Naam</th>${R.map(r=>`<th title="${esc(r.naam)}">${code(r)}<span class="tnm">${esc(r.naam)}</span></th>`).join('')}<th>Totaal</th></tr></thead><tbody>`;
  T.forEach(t=>{const jk=jokerOf(t.nr);
    h+=`<tr><td class="stk c1"><b>${t.nr}</b></td><td class="stk tl" style="left:var(--w1)" title="${esc(t.naam)}">${esc(t.naam)}</td>${R.map(r=>{const s=rubTot(r.id,t.nr);return jk===r.id?`<td class="jc" title="Joker: ${s} × 2">★ ${s*2}</td>`:`<td>${s}</td>`}).join('')}<td><b>${teamTot(t.nr)}</b></td></tr>`});
  return h+'</tbody></table></div>'}
// alleen plaats, teamnaam en totaal; met de knoppen kies je met of zonder joker
function vUitslag(){const zj=S.uj==='zonder';const L=ranking(zj);
  if(!L.length)return empty('Nog geen uitslag','Er zijn nog geen teams aangemaakt.');
  let filled=0,all=0;for(const r of rubs())for(const t of L){const[d,a]=progress(r.id,t.nr);filled+=d;all+=a}
  const pct=all?Math.round(filled/all*100):0;
  const nm=x=>esc(x.naam||'Team '+x.nr);
  // eerst dicht: alleen de beheerder kan de winnaar onthullen, daarna ziet iedereen de tabel
  if(!cfg().onthuld)return `<div class="gate">${OWL}<h2>Wie wordt de winnaar?</h2>${S.isOwner?`<p>Klaar met nakijken? Zet het scherm groot en druk op de knop.</p>${pct<100?`<p class="gate-let">Let op: nog niet alles is nagekeken (${pct}%).</p>`:''}<button class="btn primary huge" data-act="winnaar">🏆 Toon de winnaar!</button>`:'<p>De uitslag wordt straks samen bekendgemaakt. Even geduld…</p>'}</div>`;
  let notes='';for(let i=0;i<Math.min(3,L.length-1);i++){const a=L[i],b=L[i+1];
    if(a.tot===b.tot){if(a.crea!==b.crea)notes+=`<div class="notice">${nm(a)} en ${nm(b)} hebben allebei ${a.tot} punten. Beslist op de creatieve opdrachten: ${a.crea} tegen ${b.crea}.</div>`;
      else notes+=`<div class="notice bad">${nm(a)} en ${nm(b)} staan precies gelijk, ook op de creatieve opdrachten (${a.crea}). Het bestuur moet zelf beslissen.</div>`}}
  let h=`<div class="rhead"><span class="badge ${pct===100?'ok':'warn'}" style="margin-left:auto">Nakijken ${pct}% ingevuld</span></div>
  <div class="uitslag"><div class="seg" role="group" aria-label="Uitslag"><button data-act="uj" data-m="met" aria-pressed="${!zj}">Met joker</button><button data-act="uj" data-m="zonder" aria-pressed="${zj}">Zonder joker</button></div>${notes}
  <div class="grid-wrap"><table class="grid"><colgroup><col class="wr"><col class="wu"><col class="wr"></colgroup>
  <thead><tr><th>Plaats</th><th class="tl">Team</th><th>Punten</th></tr></thead><tbody>`;
  L.forEach(x=>{h+=`<tr><td><b>${x.place}</b></td><td class="tl" title="${nm(x)}">${nm(x)}</td><td><b>${x.tot}</b></td></tr>`});
  h+='</tbody></table></div>';
  if(S.isOwner)h+=`<div class="toolbar"><button class="btn" data-act="winnaar">🏆 Winnaar nog een keer tonen</button><button class="btn" data-act="verberg">Uitslag weer verbergen</button></div>`;
  return h+'</div>'}

/* ---------- Statistieken ---------- */
// per vraag: gescoorde punten (w) tegen maximaal haalbaar (m) over alle ingevulde regels, en hoeveel teams hem helemaal goed hadden
function statVragen(T){const out=[];
  for(const r of rubs())vragen(r.id).forEach((v,i)=>{let w=0,m=0,vol=0,klaar=0;const goed=[];
    for(const t of T){let tw=0,tm=0,alles=true;
      for(const g of v.regels){if(!g.punten)continue;const x=waarde(r.id,t.nr,v,g);if(x==null){alles=false;continue}tw+=x;tm+=g.punten}
      w+=tw;m+=tm;if(alles&&tm>0){klaar++;if(tw>=tm){vol++;goed.push(t.nr)}}}
    out.push({r,v,i,w,m,pct:m?w/m:null,vol,klaar,goed})});
  return out}
function vStats(){const T=teams();if(!T.length)return empty('Nog geen statistieken','Er zijn nog geen teams aangemaakt.');
  const Q=statVragen(T),B=Q.filter(q=>q.m>0),Z=Q.filter(q=>q.v.regels.some(g=>g.punten));
  const pc=p=>p==null?'–':Math.round(p*100)+'%',nl=n=>Number(n).toLocaleString('nl-NL'),nm=t=>esc(t.naam||'Team '+t.nr);
  const qn=q=>`Vraag ${code(q.r)}.${q.i+1}${q.v.titel?' · '+esc(q.v.titel):' · '+esc(q.r.naam)}`;
  const kaart=(v,l,d)=>`<div class="stat"><span class="sv">${v}</span><span class="sl">${l}</span>${d?`<span class="sd" title="${d}">${d}</span>`:''}</div>`;
  const lijst=(l,a)=>`<div class="stat"><span class="sl">${l}</span>${a.length?`<ol>${a.map(q=>`<li><b>${pc(q.pct)}</b> ${qn(q)}</li>`).join('')}</ol>`:'<span class="sd">Nog niets nagekeken</span>'}</div>`;
  const kop=t=>`<h3 class="stitle">${t}</h3>`;
  // nakijken
  let fd=0,fa=0;for(const r of rubs())for(const t of T){const[d,a]=progress(r.id,t.nr);fd+=d;fa+=a}
  const vk=Z.filter(q=>q.klaar===T.length).length,nj=T.filter(t=>jokerOf(t.nr)).length;
  let h=`<div class="rhead"><div><h2>Statistieken</h2><p class="mut">Percentage = gemiddeld behaalde punten van het maximum.</p></div></div>`+kop('Nakijken')+'<div class="stats">'+
    kaart(pc(fa?fd/fa:0),'Nagekeken',`${nl(fd)} van ${nl(fa)} regels`)+
    kaart(`${vk} / ${Z.length}`,'Vragen helemaal klaar','Voor alle teams ingevuld')+
    kaart(T.length,'Teams',`${nj} met een joker`)+
    kaart(rubs().length,'Rubrieken',`${Q.length} vragen in totaal`)+'</div>';
  // vragen
  const S2=B.slice().sort((a,b)=>a.pct-b.pct||b.m-a.m),ms=S2[0],mk=S2[S2.length-1];
  const nooit=B.filter(q=>q.klaar&&q.vol===0).length,ieder=B.filter(q=>q.klaar===T.length&&q.vol===T.length).length;
  const meest=B.slice().sort((a,b)=>b.vol-a.vol)[0];
  h+=kop('Vragen')+'<div class="stats">'+
    kaart(ms?pc(ms.pct):'–','Moeilijkste vraag',ms?qn(ms):'Nog niets nagekeken')+
    kaart(mk?pc(mk.pct):'–','Makkelijkste vraag',mk?qn(mk):'Nog niets nagekeken')+
    kaart(meest?meest.vol:0,'Vaakst helemaal goed',meest&&meest.vol?qn(meest):'')+
    kaart(nooit,'Door niemand goed','Geen enkel team alle punten')+
    kaart(ieder,'Door iedereen goed','Alle teams alle punten')+
    kaart(pc(B.reduce((s,q)=>s+q.w,0)/(B.reduce((s,q)=>s+q.m,0)||1)),'Gemiddelde score','Over alle vragen')+'</div>'+
    '<div class="stats lists">'+lijst('Top 5 moeilijkste',S2.slice(0,5))+lijst('Top 5 makkelijkste',S2.slice(-5).reverse())+'</div>';
  // rubrieken en soorten vragen
  const agg=f=>{const o={};for(const q of B){const k=f(q);o[k]=o[k]||{w:0,m:0};o[k].w+=q.w;o[k].m+=q.m}return o};
  const R=agg(q=>q.r.id),RS=Object.entries(R).map(([id,x])=>({r:rub(id),p:x.w/x.m})).sort((a,b)=>a.p-b.p),SO=agg(q=>q.v.soort);
  const rn=x=>`${code(x.r)} · ${esc(x.r.naam)}`;
  const jt={};T.forEach(t=>{const j=jokerOf(t.nr);if(j)jt[j]=(jt[j]||0)+1});const pj=Object.entries(jt).sort((a,b)=>b[1]-a[1])[0];
  h+=kop('Rubrieken')+'<div class="stats">'+
    kaart(RS[0]?pc(RS[0].p):'–','Moeilijkste rubriek',RS[0]?rn(RS[0]):'')+
    kaart(RS.length?pc(RS[RS.length-1].p):'–','Makkelijkste rubriek',RS.length?rn(RS[RS.length-1]):'')+
    kaart(pc(SO.antwoord&&SO.antwoord.w/SO.antwoord.m),'Antwoordvragen','Gemiddelde score')+
    kaart(pc(SO.creatief&&SO.creatief.w/SO.creatief.m),'Creatieve opdrachten','Gemiddelde score')+
    kaart(pj?pj[1]+'×':'–','Populairste joker',pj?`${code(rub(pj[0]))} · ${esc(rub(pj[0]).naam)}`:'Nog geen jokers')+'</div>';
  // punten
  const totZ=T.reduce((s,t)=>s+teamTot(t.nr,true),0),totJ=T.reduce((s,t)=>s+teamTot(t.nr),0);
  h+=kop('Punten')+'<div class="stats">'+
    kaart(nl(totZ),'Punten uitgedeeld','Zonder joker')+
    kaart(nl(totJ-totZ),'Extra door jokers','Bovenop de gewone punten')+
    kaart(nl(Math.round(totJ/T.length)),'Gemiddeld per team','Met joker')+'</div>';
  // teams: pas na het tonen van de winnaar, anders verklappen we de uitslag
  if(!cfg().onthuld)return h+kop('Teams')+'<p class="mut">De teamstatistieken verschijnen zodra de winnaar is getoond.</p>';
  const L=ranking(false),mx=(a,f)=>a.reduce((b,x)=>f(x)>f(b)?x:b,a[0]);
  let hr=null;for(const r of rubs())for(const t of T){const s=rubTot(r.id,t.nr);if(!hr||s>hr.s)hr={r,t,s}}
  const jw=mx(T,t=>{const j=jokerOf(t.nr);return j?rubTot(j,t.nr):-1}),jwj=jokerOf(jw.nr);
  const vg=mx(T,t=>B.filter(q=>q.goed.includes(t.nr)).length),vgn=B.filter(q=>q.goed.includes(vg.nr)).length;
  const cr=mx(T,t=>creaTot(t.nr));
  h+=kop('Teams')+'<div class="stats">'+
    kaart(L.length>1?nl(L[0].tot-L[1].tot):'–','Verschil 1 en 2',L.length>1?`${nm(L[0])} vóór ${nm(L[1])}`:'')+
    kaart(hr?nl(hr.s):'–','Hoogste rubriekscore',hr?`${nm(hr.t)} · ${esc(hr.r.naam)}`:'')+
    kaart(jwj?'+'+nl(rubTot(jwj,jw.nr)):'–','Slimste joker',jwj?`${nm(jw)} · ${esc(rub(jwj).naam)}`:'Nog geen jokers')+
    kaart(vgn,'Meeste vragen helemaal goed',nm(vg))+
    kaart(nl(creaTot(cr.nr)),'Meest creatief',nm(cr))+'</div>';
  return h}

/* ---------- winnaar tonen (alleen beheerder) ---------- */
// schermvullende show bovenop de pagina: aftellen 10 → 1, plaats 3 en 2, tromgeroffel, winnaar met confetti
let SH=null;
const wacht=ms=>new Promise(r=>setTimeout(r,ms));
// geluiden zelf opgewekt met de Web Audio API, er zijn geen geluidsbestanden nodig
function geluid(){const niks=()=>{};try{const C=new (window.AudioContext||window.webkitAudioContext)();const T=()=>C.currentTime;
  const toon=(f,t,d,type,v)=>{const o=C.createOscillator(),g=C.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(0,T()+t);g.gain.linearRampToValueAtTime(v,T()+t+.01);g.gain.exponentialRampToValueAtTime(.001,T()+t+d);o.connect(g).connect(C.destination);o.start(T()+t);o.stop(T()+t+d+.05)};
  const ruis=(t,d,v)=>{const b=C.createBuffer(1,Math.ceil(C.sampleRate*d),C.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*(1-i/a.length);
    const s=C.createBufferSource(),f=C.createBiquadFilter(),g=C.createGain();f.type='lowpass';f.frequency.value=1600;g.gain.value=v;s.buffer=b;s.connect(f).connect(g).connect(C.destination);s.start(T()+t)};
  return{
    tik:n=>{toon(320+(10-n)*70,0,.16,'square',.1);if(n<=3){toon(70,0,.3,'sine',.6);toon(58,.2,.3,'sine',.45)}}, // laatste drie: hartslag
    roffel:sec=>{const n=Math.floor(sec*20);for(let i=0;i<n;i++)ruis(i/20,.07,.1+.4*i/n)},
    boem:()=>{toon(55,0,1.4,'sine',.8);ruis(0,.9,.7)},
    fanfare:()=>{[[523,0],[659,.14],[784,.28],[1047,.42],[784,.7],[1047,.84]].forEach(([f,t])=>{toon(f,t,.45,'sawtooth',.07);toon(f/2,t,.45,'triangle',.12)});[523,659,784,1047].forEach(f=>toon(f,1.05,2,'sawtooth',.05))},
    stil:()=>{try{C.close()}catch(e){}}}}
  catch(e){return{tik:niks,roffel:niks,boem:niks,fanfare:niks,stil:niks}}}
function confetti(cv){const ctx=cv.getContext('2d'),d=window.devicePixelRatio||1,css=getComputedStyle(document.documentElement);
  const kl=['--accent','--joker','--good','--bad','--warn','--night-ink'].map(k=>css.getPropertyValue(k).trim());
  const rustig=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let P=[],id=0,regen=false;const fit=()=>{cv.width=innerWidth*d;cv.height=innerHeight*d};fit();addEventListener('resize',fit);
  const deel=(x,y,vx,vy)=>({x,y,vx,vy,w:(7+Math.random()*7)*d,h:(10+Math.random()*12)*d,c:kl[Math.floor(Math.random()*kl.length)],r:Math.random()*6,vr:(Math.random()-.5)*.35});
  const kanon=(links,n)=>{if(rustig)n=Math.round(n/4);for(let i=0;i<n;i++){const a=(links?-62:-118)*Math.PI/180+(Math.random()-.5)*.7,s=(18+Math.random()*20)*d;P.push(deel(links?0:cv.width,cv.height,Math.cos(a)*s,Math.sin(a)*s))}};
  const stap=()=>{ctx.clearRect(0,0,cv.width,cv.height);
    if(regen&&P.length<900)for(let i=0;i<(rustig?1:4);i++)P.push(deel(Math.random()*cv.width,-30*d,(Math.random()-.5)*3*d,(1+Math.random()*3)*d));
    P=P.filter(p=>p.y<cv.height+50*d);
    for(const p of P){p.vx*=.97;p.vy=p.vy*.96+.25*d;p.x+=p.vx+Math.sin(p.r)*.6*d;p.y+=p.vy;p.r+=p.vr;
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.scale(Math.cos(p.r*1.7),1);ctx.fillStyle=p.c;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore()}
    id=requestAnimationFrame(stap)};stap();
  return{kanon,regen:v=>{regen=v},stop:()=>{cancelAnimationFrame(id);removeEventListener('resize',fit)}}}
async function toonWinnaar(){if(SH||!S.isOwner)return;const L=ranking(false);if(!L.length)return;
  const c=cfg(),nm=x=>esc(x.naam||'Team '+x.nr),kop=`<div class="sh-kop">${esc(c.naam||'Genneps Gewiekste')}${c.editie?' · '+esc(c.editie):''}</div>`;
  const win=L.filter(x=>x.place===1),rest=win.length>1?[]:L.slice(1,3).reverse(); // eerst plaats 3, dan 2
  const el=document.createElement('div');el.id='show';el.className='show';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','De winnaar bekendmaken');
  el.innerHTML='<div class="sh-licht" aria-hidden="true"></div><canvas class="sh-conf" aria-hidden="true"></canvas><button class="sh-x" aria-label="Show stoppen">✕</button><div class="sh-stage" aria-live="assertive"></div>';
  document.body.appendChild(el);document.body.classList.add('show-open');SH=el;
  const G=geluid(),K=confetti(el.querySelector('canvas')),st=el.querySelector('.sh-stage');
  let stop=false,iv=0;
  const toets=e=>{if(e.key==='Escape')sluit()};
  const sluit=()=>{stop=true;clearInterval(iv);G.stil();K.stop();el.remove();document.body.classList.remove('show-open');removeEventListener('keydown',toets);SH=null};
  addEventListener('keydown',toets);el.querySelector('.sh-x').onclick=sluit;
  const fase=(f,html)=>{el.dataset.fase=f;st.innerHTML=html};
  const w=async ms=>{await wacht(ms);if(stop)throw 0};
  try{
    fase('intro',kop+'<div class="sh-titel">Wie wordt de winnaar?</div>');await w(2400);
    fase('tel',kop+'<div class="sh-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="sh-rb" cx="100" cy="100" r="90"/><circle class="sh-rv" cx="100" cy="100" r="90"/></svg><span class="sh-num"></span></div><div class="sh-sub"></div>');
    const num=st.querySelector('.sh-num'),rv=st.querySelector('.sh-rv'),sub=st.querySelector('.sh-sub');
    const zin={10:'Daar gaan we…',7:'Het wordt spannend…',5:'Nog even volhouden…',3:'Adem in…',1:'!!!'};
    for(let n=10;n>=1;n--){const ms=n<=3?1400:1000;
      num.textContent=n;num.classList.remove('pop');void num.offsetWidth;num.classList.add('pop');
      rv.style.transitionDuration=ms+'ms';rv.style.strokeDashoffset=String(565.5*(1-(n-1)/10));
      if(zin[n])sub.textContent=zin[n];el.classList.toggle('spannend',n<=3);G.tik(n);await w(ms)}
    el.classList.remove('spannend');
    for(const x of rest){fase('plek',`<div class="sh-plaats">Op de ${x.place}e plaats…</div>`);G.roffel(1.8);await w(2000);
      fase('plek',`<div class="sh-plaats">Op de ${x.place}e plaats</div><div class="sh-naam">${nm(x)}</div><div class="sh-pnt">${x.tot} punten</div>`);G.boem();K.kanon(true,40);K.kanon(false,40);await w(4000)}
    fase('drum',`<div class="sh-titel">En de winnaar van ${esc(c.naam||'Genneps Gewiekste')} is…</div>`);el.classList.add('spannend');G.roffel(4.2);await w(4400);
    el.classList.remove('spannend');
    fase('winnaar',`<div class="sh-flits" aria-hidden="true"></div>${OWL}<div class="sh-kop">${win.length>1?'De winnaars zijn':'De winnaar is'}</div>${win.map(x=>`<div class="sh-naam groot">${nm(x)}</div>`).join('')}<div class="sh-pnt">${win[0].tot} punten</div><button class="btn primary big sh-door">Bekijk de hele uitslag</button>`);
    G.boem();G.fanfare();K.kanon(true,180);K.kanon(false,180);K.regen(true);iv=setInterval(()=>K.kanon(Math.random()<.5,90),2200);
    st.querySelector('.sh-door').onclick=sluit;
    if(!c.onthuld){const cc=clone(c);cc.onthuld=true;saveConfig(cc)}
  }catch(e){if(e!==0)throw e}}

/* ---------- Beheer ---------- */
function vTeams(){const T=teams();
  let h=`<div class="rhead"><div><h2>Teams</h2><p class="mut">${T.length} teams · nummers worden automatisch gegeven (maximaal 99)</p></div><button class="btn primary" data-act="team-add">+ Team toevoegen</button></div>
  <div class="cols2"><div class="panel"><div class="lrow lhead"><span style="text-align:center">Nr</span><span>Teamnaam</span><span></span></div>`;
  if(!T.length)h+=`<div class="lrow"><span></span><span class="mut">Nog geen teams. Voeg ze toe met de knop, of plak een lijst rechts.</span><span></span></div>`;
  T.forEach(t=>{const ck='dt_'+t.nr;const on=S.confirm===ck;
    h+=`<div class="lrow"><span class="ln">${t.nr}</span><input class="inp" id="tn_${t.nr}" data-act="team-naam" data-nr="${t.nr}" value="${esc(t.naam)}" placeholder="Teamnaam" aria-label="Naam team ${t.nr}"><button class="ibtn${on?' danger':''}" data-act="team-del" data-nr="${t.nr}" data-ck="${ck}" aria-label="Team ${t.nr} verwijderen">${on?'Zeker?':'✕'}</button></div>`});
  h+=`</div><div class="panel"><h3>Lijst plakken</h3><div class="pad"><p class="mut" style="margin:0">Eén teamnaam per regel. Ze krijgen de volgende vrije nummers.</p><textarea class="inp" id="bulk" rows="8" placeholder="De Nije Mixers&#10;Schele Waazel&#10;…"></textarea><button class="btn primary" data-act="team-bulk">Toevoegen</button></div></div></div>`;
  return h}
function vJokers(){const T=teams();const N=rubs().filter(r=>r.soort==='normaal');const n=T.filter(t=>jokerOf(t.nr)).length;
  let h=`<div class="rhead"><div><h2>Jokers</h2><p class="mut">Elk team zet vóór de kwis één joker in. De score van die rubriek telt dubbel. Niet mogelijk op de sponsorrubriek, de geheime opdracht en Overige.</p></div><span class="badge ${n===T.length&&T.length?'ok':'warn'}">${n} van ${T.length} teams hebben een joker</span></div>`;
  if(!T.length)return h+empty('Nog geen teams','Maak eerst de teams aan onder Teams.');
  h+=`<div class="panel"><div class="lrow jk lhead"><span style="text-align:center">Nr</span><span>Team</span><span>Joker op rubriek</span></div>`;
  T.forEach(t=>{const cur=jokerOf(t.nr)||'';
    h+=`<div class="lrow jk"><span class="ln">${t.nr}</span><span class="qa">${t.naam?esc(t.naam):'<i>Geen naam</i>'}</span><select class="inp" id="jk_${t.nr}" data-act="joker" data-nr="${t.nr}" aria-label="Joker team ${t.nr}"><option value="">Geen joker</option>${N.map(r=>`<option value="${r.id}"${r.id===cur?' selected':''}>${code(r)} · ${esc(r.naam)}</option>`).join('')}</select></div>`});
  return h+'</div>'}
function vInst(){const c=cfg();const R=rubs();
  let h=`<div class="rhead"><div><h2>Instellingen</h2><p class="mut">Alleen jij kunt dit wijzigen. Wijzigingen zijn direct zichtbaar voor iedereen.</p></div></div>
  <div class="panel"><h3>Kwis</h3><div class="pad"><div class="formgrid">
    <label class="fld"><span>Naam</span><input class="inp" id="c_naam" data-act="cfg" data-f="naam" value="${esc(c.naam)}"></label>
    <label class="fld"><span>Editie</span><input class="inp" id="c_editie" data-act="cfg" data-f="editie" value="${esc(c.editie)}" placeholder="Bijv. Editie 6 (2026)"></label>
    <label class="fld"><span>Aantal juryleden (creatief)</span><select class="inp" id="c_jury" data-act="cfg" data-f="jury">${[1,2,3,4,5,6].map(n=>`<option${n===jury()?' selected':''}>${n}</option>`).join('')}</select></label>
  </div></div></div>
  ${S.backend==='firebase'?vToegang():''}
  <div class="panel"><h3>Rubrieken</h3><div class="lrow rb lhead"><span style="text-align:center">#</span><span>Naam</span><span class="soort">Soort</span><span>Vragen</span><span>Max punten</span><span></span></div>`;
  R.forEach((r,i)=>{const ck='drb_'+r.id;const on=S.confirm===ck;
    h+=`<div class="lrow rb"><span class="ln">${code(r)}</span><input class="inp" id="rn_${r.id}" data-act="rb" data-f="naam" data-i="${i}" value="${esc(r.naam)}" aria-label="Naam rubriek ${code(r)}"><span class="soort mut">${{sponsor:'Sponsor · geen joker',geheim:'Geheim · geen joker',overig:'Extra punten · geen joker',normaal:'Normaal'}[r.soort]||''}</span>
    <input class="inp num" id="rv_${r.id}" data-act="rb" data-f="vragen" data-i="${i}" inputmode="numeric" value="${r.vragen}" aria-label="Aantal vragen"><input class="inp num" id="rm_${r.id}" data-act="rb" data-f="max" data-i="${i}" inputmode="numeric" value="${r.max}" aria-label="Maximaal aantal punten">
    ${r.soort==='normaal'?`<button class="ibtn${on?' danger':''}" data-act="rb-del" data-i="${i}" data-ck="${ck}" aria-label="Rubriek verwijderen">${on?'Zeker?':'✕'}</button>`:'<span></span>'}</div>`});
  h+=`<div class="efoot" style="padding-left:12px"><button class="btn" data-act="rb-add">+ Rubriek toevoegen</button><span class="mut">Een verwijderde rubriek verdwijnt uit de uitslag. Ingevulde punten blijven bewaard.</span></div></div>`;
  return h}

const tijdTxt=t=>new Date(t).toLocaleString('nl-NL',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
function vToegang(){const B=S.bestuur||{};const A=(S.aanm||[]).slice().sort((a,b)=>b.tijd-a.tijd).slice(0,50);
  return `<div class="panel"><h3>Toegang bestuur</h3><div class="pad">
    <p class="mut" style="margin:0">Bestuursleden kiezen op het inlogscherm hun naam en vullen het algemene wachtwoord in.</p>
    <label class="fld"><span>Namen van bestuursleden (één per regel)</span><textarea class="inp" id="namen" data-act="namen" rows="6" placeholder="Piet&#10;Marieke&#10;…">${esc((S.namen||[]).join('\n'))}</textarea></label>
    <div class="fld"><label for="bww">Algemeen wachtwoord (minstens 6 tekens)</label>${wwVeld('bww',B.ww||'','autocomplete="new-password"')}</div>
    <div class="efoot" style="padding:0;border:0"><button class="btn primary" data-act="bww">Wachtwoord instellen</button><span class="mut">${B.uid?'Het wachtwoord is ingesteld. Wijzig je het, dan moet iedereen opnieuw inloggen.':'Nog geen wachtwoord ingesteld: bestuursleden kunnen nog niet inloggen.'}</span></div>
    <label class="fld"><span>Extra: Google-adressen met toegang (mag leeg blijven)</span><textarea class="inp" id="toegang" data-act="toegang" rows="3" placeholder="naam@gmail.com">${esc((S.toegang||[]).join('\n'))}</textarea></label>
  </div></div>
  <div class="panel"><h3>Wie heeft ingelogd</h3><div class="pad">${A.length?`<ul class="aanm">${A.map(x=>`<li><b>${esc(x.naam)}</b><span class="mut">${esc(tijdTxt(x.tijd))}</span></li>`).join('')}</ul>`:'<p class="mut" style="margin:0">Nog niemand heeft met naam en wachtwoord ingelogd.</p>'}</div></div>`}

/* ---------- invoer ---------- */
function parseScore(str,max){str=String(str).trim().toLowerCase();if(str==='')return{v:null};
  if(!max)return{err:'Bij deze regel staan nog geen punten. Vul die eerst in bij Vragen & antwoorden.'};
  if(str==='g'||str==='+')return{v:max};if(str==='f'||str==='-'||str==='x')return{v:0};
  const n=Number(str.replace(',','.'));if(!isFinite(n))return{err:'Vul een getal in, of g (goed) of f (fout).'};
  if(n<0)return{err:'Een score kan niet lager zijn dan 0.'};if(n>max)return{err:'Te hoog: deze regel is maximaal '+max+' punten waard.'};
  return{v:Math.round(n)}}
function commitScore(el){const rid=el.dataset.rid,nr=+el.dataset.nr,rg=el.dataset.rg,j=el.dataset.j,max=+el.dataset.max;dirty.delete(el.id);
  const x=raw(rid,nr,rg);const cur=j?(x&&typeof x==='object'&&typeof x['j'+j]==='number'?x['j'+j]:null):(typeof x==='number'?x:null);
  const p=parseScore(el.value,max);
  if(p.err){toast(p.err,true);el.value=cur==null?'':cur;return false}
  if(p.v===cur){el.value=cur==null?'':cur;return true}
  saveScore(rid,nr,rg,j?{['j'+j]:p.v}:p.v);return true}
function nextScoreInput(el){const all=[...$app.querySelectorAll('input[data-act="score"]')];
  const list=el.classList.contains('gi')?all.filter(x=>x.dataset.nr===el.dataset.nr&&x.classList.contains('gi')):all;
  const i=list.indexOf(el);return list[i+1]||null}
// pijltjestoetsen: in het raster omhoog/omlaag binnen de teamkolom, links/rechts binnen de regel; per team gewoon vorige/volgende
function arrowScoreInput(el,key){const all=[...$app.querySelectorAll('input[data-act="score"]')];
  const grid=el.classList.contains('gi');const vert=key==='ArrowUp'||key==='ArrowDown';const d=key==='ArrowUp'||key==='ArrowLeft'?-1:1;
  const list=!grid?all:vert?all.filter(x=>x.dataset.nr===el.dataset.nr&&x.classList.contains('gi')):[...el.closest('tr').querySelectorAll('input[data-act="score"]')];
  return list[list.indexOf(el)+d]||null}
function curVraag(rid,q){return clone(vragen(rid)[q-1])}

$app.addEventListener('input',e=>{const el=e.target;if(el.id)dirty.add(el.id)});
$app.addEventListener('keydown',e=>{const el=e.target;
  if(el.dataset.act==='score'&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&!e.shiftKey&&!e.ctrlKey&&!e.altKey){
    e.preventDefault();const nx=arrowScoreInput(el,e.key);if(!nx)return;const ok=commitScore(el);
    if(ok){S.pf=nx.id;if(!raf){nx.focus();nx.select()}}return}
  if(e.key!=='Enter'||el.tagName==='TEXTAREA')return;
  if(el.dataset.act==='score'){e.preventDefault();const nx=nextScoreInput(el);const ok=commitScore(el);
    if(ok&&nx){S.pf=nx.id;if(!raf){nx.focus();nx.select()}}return}
  if(el.id==='ln_ww'){e.preventDefault();loginBestuur();return}
  if(el.tagName==='INPUT'){e.preventDefault();el.blur()}});
$app.addEventListener('change',e=>{const el=e.target;const a=el.dataset.act;if(!a)return;dirty.delete(el.id);const v=el.value;
  if(a==='score'){commitScore(el);return}
  if(a==='toegang'){const list=[...new Set(v.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>x.includes('@')))];saveToegang(list);toast(list.length+' adressen hebben toegang.');return}
  if(a==='namen'){const list=[...new Set(v.split('\n').map(x=>x.trim()).filter(Boolean))];saveNamen(list);toast(list.length+(list.length===1?' naam staat':' namen staan')+' op het inlogscherm.');return}
  if(a==='ln-naam'){S.naam=v;return}
  if(a==='rub'){S.rid=v;store('gg_rid',v);render();return}
  if(a==='teamsel'){S.team=+v;store('gg_team',v);schedule();return}
  if(a==='vf'){const q=+el.dataset.q,rid=el.dataset.rid;const o=curVraag(rid,q);const f=el.dataset.f;
    if(f==='punten')o.punten=num(v);else o[f]=v;saveVraag(rid,q,o);return}
  if(a==='rf'){const q=+el.dataset.q,rid=el.dataset.rid,k=+el.dataset.k;const o=curVraag(rid,q);if(!o.regels[k])return;
    if(el.dataset.f==='punten')o.regels[k].punten=num(v);else o.regels[k].tekst=v;saveVraag(rid,q,o);return}
  if(a==='team-naam'){const t=clone(S.teams);t[el.dataset.nr]=v.trim();saveTeams(t);return}
  if(a==='joker'){const j=clone(S.jokers);if(v)j[el.dataset.nr]=v;else delete j[el.dataset.nr];saveJokers(j);return}
  if(a==='cfg'){const c=clone(cfg());c[el.dataset.f]=el.dataset.f==='jury'?+v:v;saveConfig(c);return}
  if(a==='rb'){const c=clone(cfg());const r=c.rubrieken[+el.dataset.i];if(!r)return;const f=el.dataset.f;
    if(f==='naam')r.naam=v.trim()||r.naam;else if(f==='vragen')r.vragen=Math.max(1,Math.min(20,num(v)||1));else r.max=Math.max(1,num(v)||1000);saveConfig(c);return}
});
$app.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el||el.disabled)return;const a=el.dataset.act;
  if(a==='login'){const p=new firebase.auth.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});firebase.auth().signInWithPopup(p).catch(e=>{if(e&&e.code!=='auth/popup-closed-by-user')toast('Inloggen lukte niet: '+(e.message||e.code),true)});return}
  if(a==='logout'){firebase.auth().signOut().then(()=>location.reload());return}
  if(a==='login-bestuur'){loginBestuur();return}
  if(a==='bww'){const ww=(document.getElementById('bww').value||'').trim();if(ww.length<6){toast('Het wachtwoord moet minstens 6 tekens hebben.',true);return}
    dirty.delete('bww');el.disabled=true;
    zetBestuurWw(ww).then(()=>toast('Het algemene wachtwoord is ingesteld.')).catch(e=>{el.disabled=false;const c=e&&e.code;
      toast(c==='auth/operation-not-allowed'?'Zet eerst in Firebase bij Authentication de inlogmethode "E-mailadres/wachtwoord" aan.'
        :c==='geen-oud'?'Het bestuursaccount bestaat al, maar het oude wachtwoord is onbekend. Verwijder het account in Firebase bij Authentication en probeer opnieuw.'
        :c==='auth/weak-password'?'Dit wachtwoord is te zwak. Kies een langer wachtwoord.':'Instellen lukte niet: '+((e&&(e.message||c))||'onbekende fout'),true)});return}
  if(a==='tab'){S.tab=el.dataset.tab;try{history.replaceState(null,'','#'+S.tab)}catch(x){}render();window.scrollTo(0,0);return}
  if(a==='mode'){S.mode=el.dataset.m;store('gg_mode',S.mode);render();return}
  if(a==='uj'){S.uj=el.dataset.m;store('gg_uj',S.uj);render();return}
  if(a==='winnaar'){toonWinnaar();return}
  // direct in de pagina wisselen (niet opnieuw opbouwen), zodat wat al getypt is blijft staan
  if(a==='toon-ww'){const id=el.dataset.for;const inp=document.getElementById(id);if(!inp)return;const t=toonWw[id]=!toonWw[id];
    inp.type=t?'text':'password';el.textContent=t?'Verbergen':'Tonen';el.setAttribute('aria-pressed',t);inp.focus();return}
  if(a==='verberg'){const c=clone(cfg());c.onthuld=false;saveConfig(c);toast('De uitslag is weer verborgen.');return}
  if(a==='team-prev'||a==='team-next'){const T=teams();const i=T.findIndex(t=>t.nr===S.team)+(a==='team-next'?1:-1);if(T[i]){S.team=T[i].nr;store('gg_team',S.team)}render();window.scrollTo(0,0);return}
  if(a==='set'){const rid=el.dataset.rid,nr=+el.dataset.nr,rg=el.dataset.rg,val=+el.dataset.v;if(raw(rid,nr,rg)!==val)saveScore(rid,nr,rg,val);return}
  if(a==='add-regel'){const rid=el.dataset.rid,q=+el.dataset.q;const o=curVraag(rid,q);const id=newId();o.regels.push({id,tekst:'',punten:0});
    if(o.nummering==='enkel'&&o.regels.length>1)o.nummering='abc';S.pf=`e_${rid}_${q}_${id}_t`;saveVraag(rid,q,o);return}
  if(a==='del-regel'){if(!askConfirm(el.dataset.ck))return;const rid=el.dataset.rid,q=+el.dataset.q;const o=curVraag(rid,q);o.regels.splice(+el.dataset.k,1);saveVraag(rid,q,o);return}
  if(a==='verdeel'){const rid=el.dataset.rid,q=+el.dataset.q;const o=curVraag(rid,q);const P=o.punten,n=o.regels.length;
    if(!P){toast('Vul eerst het aantal punten van deze vraag in.',true);return}if(!n)return;
    const b=Math.floor(P/n),rest=P-b*n;o.regels.forEach((g,k)=>g.punten=b+(k<rest?1:0));saveVraag(rid,q,o);toast(P+' punten verdeeld over '+n+(n===1?' regel':' regels')+'.');return}
  if(a==='team-add'){const t=clone(S.teams);const nr=Math.max(0,...Object.keys(t).map(Number))+1;if(nr>99){toast('Maximaal 99 teams.',true);return}t[nr]='';S.pf='tn_'+nr;saveTeams(t);return}
  if(a==='team-del'){if(!askConfirm(el.dataset.ck))return;const t=clone(S.teams);delete t[el.dataset.nr];saveTeams(t);return}
  if(a==='team-bulk'){const ta=document.getElementById('bulk');const names=ta.value.split('\n').map(s=>s.trim()).filter(Boolean);if(!names.length){toast('Plak eerst één of meer teamnamen.',true);return}
    const t=clone(S.teams);let nr=Math.max(0,...Object.keys(t).map(Number));for(const n of names){if(nr>=99)break;t[++nr]=n}dirty.delete('bulk');ta.value='';saveTeams(t);toast(names.length+' teams toegevoegd.');return}
  if(a==='rb-add'){const c=clone(cfg());let k=1;while(c.rubrieken.some(r=>r.id==='r'+k))k++;const gi=c.rubrieken.findIndex(r=>VAST[r.soort]);
    const nr={id:'r'+k,naam:'Nieuwe rubriek',soort:'normaal',vragen:7,max:1000};if(gi<0)c.rubrieken.push(nr);else c.rubrieken.splice(gi,0,nr);S.pf='rn_'+nr.id;saveConfig(c);return}
  if(a==='rb-del'){if(!askConfirm(el.dataset.ck))return;const c=clone(cfg());c.rubrieken.splice(+el.dataset.i,1);saveConfig(c);return}
});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if([...TABS,...BTABS].some(t=>t[0]===h)){S.tab=h;render()}});

/* ---------- opstarten ---------- */
function gotFresh(){if(!S.fresh){S.fresh=true;S.loadSlow=false;setStatus()}}
function subscribe(){if(subscribed)return;subscribed=true;
  const err=e=>{if(e&&e.code==='permission-denied'){S.noAccess=true;S.canWrite=false}else S.loadSlow=true;schedule()};
  db.doc('beheer/config').onSnapshot(s=>{const d=s.exists?s.data():null;S.config=d&&Array.isArray(d.rubrieken)?metOverig(d):null;VC={};if(!s.metadata.fromCache)gotFresh();schedule()},err);
  db.doc('beheer/teams').onSnapshot(s=>{S.teams=(s.exists&&s.data().teams)||{};schedule()},err);
  db.doc('beheer/jokers').onSnapshot(s=>{S.jokers=(s.exists&&s.data().j)||{};schedule()},err);
  if(S.isOwner&&S.backend==='firebase'){
    db.doc('beheer/toegang').onSnapshot(s=>{S.toegang=(s.exists&&s.data().emails)||[];schedule()},err);
    db.doc('beheer/bestuur').onSnapshot(s=>{S.bestuur=(s.exists&&s.data())||{};schedule()},err);
    db.collection('aanmeldingen').onSnapshot(qs=>{S.aanm=qs.docs.map(d=>d.data()).filter(x=>x&&x.naam);schedule()},err)}
  db.collection('vragen').onSnapshot(qs=>{const o={};qs.docs.forEach(d=>{o[d.id]=d.data()});S.vragen=o;VC={};schedule()},err);
  db.collection('scores').onSnapshot(qs=>{const o={};qs.docs.forEach(d=>{o[d.id]=d.data()});S.scores=o;schedule()},err);
  setTimeout(()=>{if(!S.fresh&&!S.noAccess){S.loadSlow=true;schedule()}},10000);
}
function init(){const O=window.GGOpslag;
  if(O.firebaseIngesteld()){const F=window.GG_FIREBASE;S.backend='firebase';
    firebase.initializeApp(F.config);db=O.firebaseOpslag(firebase.firestore());
    // namenlijst voor het inlogscherm (mag iedereen lezen)
    db.doc('publiek/bestuur').onSnapshot(s=>{S.namen=(s.exists&&s.data().namen)||[];schedule()},()=>{});
    firebase.auth().onAuthStateChanged(u=>{
      if(!u){S.needLogin=true;S.email='';render();return}
      S.needLogin=false;S.email=(u.email||'').toLowerCase();
      S.isOwner=S.email===String(F.beheerder||'').trim().toLowerCase();
      S.isBestuur=S.email===String(F.bestuurAccount||'').trim().toLowerCase();
      S.dbOk=true;S.canWrite=true;subscribe();render()});
    render();return}
  S.backend='lokaal';db=O.lokaleOpslag();S.dbOk=true;S.isOwner=true;S.canWrite=true;subscribe();render()}
init();
})();
