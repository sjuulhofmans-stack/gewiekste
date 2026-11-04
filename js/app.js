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
                  rubriek: {id, naam, soort, vragen, max, juryleden[]}  juryleden = verantwoordelijken (namen)
  beheer/teams    teams: { "1": "Teamnaam", ... }               (alleen beheerder)
  beheer/jokers   j: { "1": "r6", ... }  teamnummer -> rubriek  (alleen beheerder)
  beheer/toegang  emails: [ ... ]  extra Google-adressen         (alleen beheerder)
  beheer/bestuur  uid, ww  het gezamenlijke bestuursaccount     (alleen beheerder)
  publiek/bestuur namen: [ ... ]  namenlijst op het inlogscherm (iedereen leest)
  aanmeldingen/<id> naam, tijd  wie heeft ingelogd              (alleen beheerder leest)
  vragen/<rubriek> v: { v1: {titel, punten, soort, nummering, regels[], juryleden[]|null}, ... }
                   juryleden bij de vraag = eigen jury; null = die van de rubriek
  scores/<rubriek> s: { t1: { <regelId>: punten | {n_Naam,...} of {j1,j2,j3} }, ... }
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
// bestuursleden zien alleen Vragen & antwoorden, en Nakijken zodra de beheerder dat aanzet (config.nakijken)
function nakijkenAan(){return cfg().nakijken===true}
function mijnTabs(){return S.isOwner?TABS:TABS.filter(t=>t[0]==='vragen'||(t[0]==='nakijken'&&nakijkenAan()))}

const S={config:null,teams:{},jokers:{},vragen:{},scores:{},seen:{},fresh:false,
  isOwner:false,canWrite:true,backend:null,email:'',needLogin:false,noAccess:false,toegang:[],namen:[],naam:'',isBestuur:false,bestuur:{},aanm:[],online:[],chat:false,chatMsgs:[],dbOk:null,loadSlow:false,
  tab:'vragen',rid:null,vq:1,mode:'raster',team:null,confirm:null,pf:null};
const dirty=new Set(), Q={};
let db=null,VC={},subscribed=false;

try{S.naam=localStorage.getItem('gg_naam')||'';S.chat=localStorage.getItem('gg_chat')==='1';S.rid=localStorage.getItem('gg_rid');S.uj=localStorage.getItem('gg_uj')||'met';S.nkm=localStorage.getItem('gg_nkm');}catch(e){}
if(!['s','m','l'].includes(S.nkm))S.nkm='m';
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

function defVraag(i){return{titel:'',punten:0,soort:'antwoord',nummering:'enkel',regels:[{id:'v'+i+'r1',tekst:'',punten:0}],juryleden:null}}
function norm(v,i){if(!v||typeof v!=='object')return defVraag(i);
  return{titel:String(v.titel||''),punten:num(v.punten),soort:v.soort==='creatief'?'creatief':'antwoord',
    nummering:['enkel','abc','123'].includes(v.nummering)?v.nummering:'enkel',
    juryleden:Array.isArray(v.juryleden)?v.juryleden.map(String):null,
    regels:Array.isArray(v.regels)?v.regels.filter(x=>x&&x.id).map(x=>({id:String(x.id),tekst:String(x.tekst||''),punten:num(x.punten)})):[]}}
function vragen(rid){if(VC[rid])return VC[rid];const r=rub(rid);if(!r)return[];const n=Math.max(1,Math.min(20,+r.vragen||7));
  const st=(S.vragen[rid]&&S.vragen[rid].v)||{};const out=[];for(let i=1;i<=n;i++)out.push(norm(st['v'+i],i));return VC[rid]=out}
// jury van een creatieve opdracht: eigen lijst bij de vraag, anders de verantwoordelijken van de rubriek,
// en zonder namen de oude rijen "Jury 1..n" (aantal uit Instellingen)
function rubJury(r){return r&&Array.isArray(r.juryleden)?r.juryleden:[]}
function juryNamen(r,v){return Array.isArray(v.juryleden)?v.juryleden:rubJury(r)}
function juryOf(r,v){const N=juryNamen(r,v);
  if(N.length)return N.map((n,i)=>({k:'n_'+n,l:'Beoordeeld door '+n,kort:n,i:i+1}));
  return Array.from({length:jury()},(_,i)=>({k:'j'+(i+1),l:'Jury '+(i+1),kort:'J'+(i+1),i:i+1}))}
function lab(v,k){if(v.nummering==='abc')return String.fromCharCode(65+k);if(v.nummering==='123')return String(k+1);return v.regels.length>1?String.fromCharCode(65+k):''}

/* ---------- scores ---------- */
function raw(rid,nr,rg){const d=S.scores[rid];const t=d&&d.s&&d.s['t'+nr];return t?t[rg]:undefined}
function juryVals(o,J){const a=[];if(o&&typeof o==='object')for(const jl of J){const x=o[jl.k];if(typeof x==='number'&&isFinite(x))a.push(x)}return a}
function waarde(rid,nr,v,g){const x=raw(rid,nr,g.id);
  if(v.soort==='creatief'){if(typeof x==='number')return x;const a=juryVals(x,juryOf(rub(rid),v));if(!a.length)return null;
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
// naar een vakje springen zonder dat de pagina verschuift: alleen scrollen als het vakje buiten beeld staat
function focusSel(el){el.focus({preventScroll:true});el.scrollIntoView({block:'nearest',inline:'nearest'});if(el.select)el.select()}
// opslaan gebeurt stil op de achtergrond; alleen bij een fout verschijnt een melding
function enqueue(path,fn){if(!db)return;
  Q[path]=(Q[path]||Promise.resolve()).then(fn).catch(onErr)}
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
/* meldingen: kaartjes rechtsonder met een kruisje. Korte berichten (toast) verdwijnen vanzelf;
   vaste meldingen (notices) blijven tot je ze wegklikt. */
const WEG=new Set();
function kaart(k,soort,html){return `<div class="mld ${soort}" data-k="${k}" role="${soort==='bad'?'alert':'status'}"><span class="mld-i" aria-hidden="true">${soort==='bad'?'!':soort==='ok'?'✓':'i'}</span><div class="mld-t">${html}</div><button class="mld-x" data-weg="${k}" aria-label="Melding sluiten" title="Sluiten">✕</button></div>`}
let tt=0;function toast(msg,bad){const el=document.getElementById('mld-kort');el.innerHTML=kaart('kort',bad?'bad':'ok',esc(msg));clearTimeout(tt);tt=setTimeout(()=>{el.innerHTML=''},bad?8000:4000)}
document.getElementById('meldingen').addEventListener('click',e=>{const b=e.target.closest('[data-weg]');if(!b)return;const k=b.dataset.weg;
  if(k==='kort'){clearTimeout(tt);document.getElementById('mld-kort').innerHTML=''}else{WEG.add(k);b.closest('.mld').remove();mldNu=document.getElementById('mld-vast').innerHTML}});
function askConfirm(key){if(S.confirm===key){S.confirm=null;return true}S.confirm=key;schedule();setTimeout(()=>{if(S.confirm===key){S.confirm=null;schedule()}},4000);return false}

/* ---------- render ---------- */
// nakijktabel loopt door tot de onderkant van het scherm; alleen de tabel scrollt
function fitGrid(){const g=$app.querySelector('.grid-wrap.nk');if(!g)return;
  const top=g.getBoundingClientRect().top+window.scrollY;g.style.maxHeight=Math.max(320,window.innerHeight-top-16)+'px'}
// chat loopt door tot de onderkant van het scherm; alleen de berichtenlijst scrollt
function fitChat(){const c=$app.querySelector('.chat');if(!c)return;
  const top=c.getBoundingClientRect().top+window.scrollY;c.style.height=Math.max(360,window.innerHeight-top-16)+'px'}
// uitslag nog dicht: de knop staat midden in het scherm
function fitGate(){const g=$app.querySelector('.gate');if(!g)return;
  // precies tot de onderkant van het scherm, zodat de pagina niet kan scrollen
  const top=g.getBoundingClientRect().top+window.scrollY;g.style.minHeight=Math.max(420,Math.floor(window.innerHeight-top)-1)+'px'}
window.addEventListener('resize',()=>{fitGrid();fitChat();fitGate()});
// draaiende blauwe achtergrond met schijnwerpers achter de hele pagina zolang de uitslag dicht is;
// staat buiten #app zodat de beweging niet bij elke update opnieuw begint
const $podium=document.createElement('div');$podium.id='podium';$podium.setAttribute('aria-hidden','true');
$podium.innerHTML='<div class="pd-bg"></div><div class="pd-vig"></div><span class="pd-spot l"></span><span class="pd-spot r"></span>';
document.body.prepend($podium);
// naamkaartje bij muis op een teamkop (data-tip); staat buiten #app zodat de tabel het niet afknipt
const $tip=document.createElement('div');$tip.id='tip';$tip.hidden=true;document.body.appendChild($tip);
$app.addEventListener('mouseover',e=>{const el=e.target.closest('[data-tip]');if(!el){$tip.hidden=true;return}
  $tip.textContent=el.dataset.tip;$tip.hidden=false;const b=el.getBoundingClientRect();const w=$tip.offsetWidth;
  $tip.style.left=Math.max(8,Math.min(innerWidth-w-8,b.left+b.width/2-w/2))+'px';$tip.style.top=(b.bottom+6)+'px'});
$app.addEventListener('mouseleave',()=>{$tip.hidden=true});
document.addEventListener('scroll',()=>{$tip.hidden=true},true);
let raf=0;function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;render()})}
function render(){VC={};
  const a=document.activeElement;let f=null;
  if(a&&a.id&&$app.contains(a))f={id:a.id,val:a.value,s:null,e:null,tag:a.tagName};
  if(f&&(f.tag==='INPUT'||f.tag==='TEXTAREA')){try{f.s=a.selectionStart;f.e=a.selectionEnd}catch(e){}}
  const gw=$app.querySelector('.grid-wrap');const sc=gw?{l:gw.scrollLeft,t:gw.scrollTop}:null;
  // chat: stond je onderaan, dan blijf je onderaan (nieuwe berichten in beeld); anders blijft de plek staan
  const cl=document.getElementById('chat-list');const cs=cl?{t:cl.scrollTop,bodem:cl.scrollHeight-cl.scrollTop-cl.clientHeight<40}:null;
  $app.innerHTML=html();fitGrid();fitChat();fitGate();
  document.body.classList.toggle('gate-open',!!$app.querySelector('.gate'));
  document.body.classList.toggle('chat-open',!!$app.querySelector('.chat')); // meldingen dan links, niet over het typvak
  const gw2=$app.querySelector('.grid-wrap');if(gw2&&sc){gw2.scrollLeft=sc.l;gw2.scrollTop=sc.t}
  const cl2=document.getElementById('chat-list');if(cl2)cl2.scrollTop=(!cs||cs.bodem)?cl2.scrollHeight:cs.t;
  if(S.pf){const el=document.getElementById(S.pf);S.pf=null;if(el)focusSel(el);return}
  if(f){const el=document.getElementById(f.id);if(el){
    if(dirty.has(f.id)&&el.value!==f.val)el.value=f.val;
    el.focus({preventScroll:true});if(f.s!=null){try{el.setSelectionRange(f.s,f.e)}catch(e){}}}}}

let mldNu='';
function html(){const m=notices().filter(([k])=>!WEG.has(k)).map(n=>kaart(...n)).join('');
  if(m!==mldNu){mldNu=m;document.getElementById('mld-vast').innerHTML=m}
  return header()+'<main class="wrap main">'+view()+'</main>'}
function header(){const c=cfg();
  const role=S.backend==='lokaal'?'Lokaal testen':S.isOwner?'Beheerder':(S.dbOk&&S.canWrite?'Bestuurslid':'Alleen lezen');
  const tb=([k,l],lock)=>`<button class="tab" data-act="tab" data-tab="${k}"${S.tab===k?' aria-current="page"':''}>${lock?'<span class="lock" aria-hidden="true">🔒</span>':''}${l}</button>`;
  return `<header class="band"><div class="wrap top"><div class="brand">${OWL}<div><h1>${esc(c.naam||'Genneps Gewiekste')}</h1><p>${esc(c.editie||'')}${c.editie?' · ':''}Uitslagen &amp; nakijken</p></div></div>
  <div class="head-r"><div class="top-right">${onlineTxt()}<span class="role">${role}</span>${S.email?`<span class="who" title="Ingelogd">${esc(S.isBestuur?(S.naam||'Bestuur'):S.email)}</span><button class="btn ghost" data-act="logout">Uitloggen</button>`:''}</div>
  ${S.needLogin?'':`<nav class="tabs" aria-label="Onderdelen">`}${S.needLogin?'':mijnTabs().map(t=>tb(t)).join('')}${S.isOwner?'<span class="tabsep" aria-hidden="true"></span>'+BTABS.map(t=>tb(t,1)).join(''):''}${S.needLogin?'':'</nav>'}</div></div></header>`}
// vaste meldingen als [sleutel, soort, tekst]; getoond als kaartje rechtsonder
function notices(){const h=[];
  if(S.backend==='lokaal')h.push(['lokaal','info','<b>Lokaal testen.</b> Firebase is nog niet ingesteld (js/firebase-config.js). Alles wordt alleen in deze browser bewaard.']);
  if(S.noAccess)h.push(['toegang','bad',S.isBestuur?'<b>Nog geen toegang.</b> Het bestuursaccount is nog niet goedgekeurd. Vraag de beheerder om bij Instellingen het wachtwoord opnieuw in te stellen. Daarna herlaad je de pagina.'
    :`<b>Nog geen toegang.</b> Je bent ingelogd als ${esc(S.email)}, maar dit adres staat nog niet op de lijst. Vraag de beheerder om je e-mailadres toe te voegen. Daarna herlaad je de pagina.`]);
  else if(S.loadSlow&&!S.fresh)h.push(['traag','info','<b>Even geduld.</b> De gegevens zijn nog niet bereikbaar. Controleer je internetverbinding. De pagina probeert het zelf opnieuw.']);
  else if(S.dbOk&&!S.canWrite)h.push(['lezen','info','Je kunt meekijken, maar niets wijzigen.']);
  return h}
// wachtwoordvak met een knop om te wisselen tussen bolletjes en leesbare tekst
const toonWw={};
function wwVeld(id,val,extra){const t=!!toonWw[id];
  return `<div class="ww-rij"><input class="inp" id="${id}" type="${t?'text':'password'}" value="${esc(val)}" spellcheck="false" ${extra}><button type="button" class="btn" data-act="toon-ww" data-for="${id}" aria-pressed="${t}">${t?'Verbergen':'Tonen'}</button></div>`}
function vLogin(){const N=S.namen||[];
  const kies=N.length?`<p class="mut">Kies je naam en vul het wachtwoord van het bestuur in. Alles wordt direct opgeslagen.</p>
    <label class="fld"><span>Je naam</span><select class="inp" id="ln_naam" data-act="ln-naam"><option value="">Kies je naam…</option>${N.map(n=>`<option value="${esc(n)}"${n===S.naam?' selected':''}>${esc(n)}</option>`).join('')}</select></label>
    <div class="fld"><label for="ln_ww">Wachtwoord</label>${wwVeld('ln_ww','','autocomplete="current-password"')}</div>
    <button class="btn primary big" data-act="login-bestuur">Inloggen</button>`
    :'<p class="mut">De beheerder heeft nog geen bestuursleden ingesteld.</p>';
  return `<div class="login">${OWL}<h2>Welkom bij het nakijken en de uitslagen</h2>${kies}<div class="login-beh"><p class="mut">Ben je de beheerder?</p><button class="btn" data-act="login">Inloggen met Google</button></div></div>`}
function view(){if(S.needLogin)return vLogin();if(S.noAccess)return '';let t=S.tab;if(!S.isOwner&&!mijnTabs().some(x=>x[0]===t))t='vragen';
  return({nakijken:vNakijken,vragen:vVragen,overzicht:vOverzicht,uitslag:vUitslag,stats:vStats,teams:vTeams,jokers:vJokers,instellingen:vInst}[t]||vNakijken)()}
function empty(t,p){return `<div class="empty"><h3>${t}</h3><p>${p}</p></div>`}
// rubriekkeuze: één uitklapmenu in plaats van een rij knoppen
function rubSelect(){ensureRid();return `<label class="rubsel"><span>Rubriek</span><select class="inp sel-rub" id="rubsel" data-act="rub">${rubs().map(r=>`<option value="${r.id}"${r.id===S.rid?' selected':''}>${code(r)} · ${esc(r.naam)}</option>`).join('')}</select></label>`}
const dis=()=>S.canWrite&&S.dbOk?'':' disabled';

/* ---------- Nakijken ---------- */
function vNakijken(){ensureRid();const r=rub(S.rid);const T=teams();
  // grootte van de tabel: ieder kiest zelf (onthouden op deze computer)
  const G=[['s','Klein'],['m','Middel'],['l','Groot']];
  let h=`<div class="toolbar">${rubSelect()}
  <p class="hint nk-hint">Typ een getal, of <kbd>g</kbd> = goed (alle punten) en <kbd>f</kbd> = fout (0). Met <kbd>Enter</kbd> ga je naar de volgende regel, met de <kbd>pijltjes</kbd> naar elk vakje.</p>
  <div class="rubsel"><span id="nkm-l">Weergave tabel</span><div class="seg" role="group" aria-labelledby="nkm-l">${G.map(([k,l])=>`<button data-act="nkm" data-m="${k}" aria-pressed="${S.nkm===k}">${l}</button>`).join('')}</div></div></div>`;
  if(!T.length)return h+empty('Er zijn nog geen teams','De beheerder maakt de teams aan onder Teams. Daarna verschijnen ze hier.');
  return h+raster(r,T)}

// jl = één jurylid uit juryOf() bij creatieve opdrachten, anders 0
function scoreInput(pre,r,t,v,g,jl,extra){const x=raw(r.id,t.nr,g.id);
  let val='';if(jl){if(x&&typeof x==='object'&&typeof x[jl.k]==='number')val=x[jl.k]}else if(typeof x==='number')val=x;
  const id=`${pre}_${r.id}_${t.nr}_${g.id}${jl?'_j'+jl.i:''}`;
  return `<input class="${extra}" id="${id}" data-act="score" data-rid="${r.id}" data-nr="${t.nr}" data-rg="${g.id}"${jl?` data-j="${esc(jl.k)}" placeholder="${esc(jl.kort)}" title="${esc(jl.l)}"`:''} data-max="${g.punten}" inputmode="numeric" autocomplete="off" value="${val}" aria-label="Team ${t.nr}, ${esc(g.tekst||v.titel||'regel')}${jl?', '+esc(jl.l):''}"${dis()}>`}

function raster(r,T){const V=vragen(r.id);const pc=code(r);
  // smalle blauwe kolom die vast blijft staan, als scheiding tussen de vragen en de teams
  const SP='<td class="stk c4 sp" aria-hidden="true"></td>';
  let h=`<div class="grid-wrap nk nk-${S.nkm}"><table class="grid nk" style="--nt:${T.length}"><colgroup><col class="w1"><col class="w2"><col class="w3"><col class="wsp">${T.map(()=>'<col class="wt">').join('')}</colgroup>
  <thead><tr><th class="stk c1">#</th><th class="stk c2 tl">Vraag / opdracht</th><th class="stk c3">Punten</th><th class="stk c4 sp" aria-hidden="true"></th>${T.map(t=>`<th class="ct" data-tip="Team ${t.nr} · ${t.naam?esc(t.naam):'nog geen naam'}"><span class="tnm">Team</span><span class="tn">${t.nr}${jokerOf(t.nr)===r.id?' <span class="jk" title="Joker op deze rubriek">★</span>':''}</span></th>`).join('')}</tr></thead><tbody>`;
  V.forEach((v,i)=>{
    h+=`<tr class="rq"><td class="stk c1">${pc}.${i+1}</td><td class="stk c2 tl" title="${esc(v.titel)}">${v.titel?esc(v.titel):'<i>Nog geen titel</i>'}</td><td class="stk c3">${v.punten}</td>${SP}${T.map(t=>`<td>${fmt(vraagScore(r.id,t.nr,v))}</td>`).join('')}</tr>`;
    v.regels.forEach((g,k)=>{const L=lab(v,k);
      if(v.soort==='creatief'){
        h+=`<tr class="rg"><td class="stk c1">${L}</td><td class="stk c2 tl" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Beoordeling</i>'} <span class="mut">· gemiddelde</span></td><td class="stk c3">0–${g.punten}</td>${SP}${T.map(t=>{const w=waarde(r.id,t.nr,v,g);return `<td class="${cls(w,g.punten)}">${fmt(w)}</td>`}).join('')}</tr>`;
        for(const jl of juryOf(r,v))h+=`<tr class="rj"><td class="stk c1"></td><td class="stk c2 tl" title="${esc(jl.l)}">${esc(jl.l)}</td><td class="stk c3">0–${g.punten}</td>${SP}${T.map(t=>`<td>${scoreInput('s',r,t,v,g,jl,'gi')}</td>`).join('')}</tr>`;
      }else{
        h+=`<tr><td class="stk c1">${L}</td><td class="stk c2 tl" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Antwoord nog niet ingevuld</i>'}</td><td class="stk c3">${g.punten}</td>${SP}${T.map(t=>{const w=waarde(r.id,t.nr,v,g);return `<td class="${cls(w,g.punten)}">${scoreInput('s',r,t,v,g,0,'gi')}</td>`}).join('')}</tr>`;
      }});
  });
  // de joker zie je aan het sterretje in de teamkop; geen aparte jokerregel onderin
  h+=`</tbody><tfoot><tr class="trow solo"><td class="stk c1"></td><td class="stk c2 tl">Totaal rubriek</td><td class="stk c3">${r.max}</td>${SP}${T.map(t=>`<td>${rubTot(r.id,t.nr)}</td>`).join('')}</tr>`;
  return h+'</tfoot></table></div>'}


/* ---------- Vragen & antwoorden ---------- */
function somBadge(som,max){if(som===max)return `<span class="badge ok">Totaal ${som} / ${max} ✓</span>`;
  if(som<max)return `<span class="badge warn">Totaal ${som} / ${max} · nog ${max-som} te verdelen</span>`;
  return `<span class="badge bad">Totaal ${som} / ${max} · ${som-max} te veel</span>`}
// stand van één vraag: leeg (grijs), klopt (groen), nog niet af (oranje) of te veel punten (rood)
function vraagStatus(v){const rs=v.regels.reduce((s,g)=>s+g.punten,0);
  if(!v.titel&&!v.punten&&v.regels.every(g=>!g.tekst&&!g.punten))return['leeg','Nog leeg'];
  if(!v.punten)return['warn','Vul de punten van de vraag in'];
  if(rs>v.punten)return['bad',(rs-v.punten)+' punten te veel verdeeld'];
  if(rs<v.punten)return['warn','Nog '+(v.punten-rs)+' punten verdelen'];
  if(!v.titel)return['warn','Titel ontbreekt'];
  if(v.regels.some(g=>!g.tekst))return['warn','Antwoord ontbreekt'];
  return['ok','✓ Klopt']}
// gekozen juryleden als kaartjes met een kruisje, plus een uitklapmenu met de overige bestuursleden
function juryKies(N,act,base,d,id){const A=S.namen||[];const vrij=A.filter(n=>!N.includes(n));
  return `<div class="chips">${N.length?N.map(n=>`<span class="chip">${esc(n)}<button class="chip-x" data-act="${act}-del" data-n="${esc(n)}" ${base} aria-label="${esc(n)} weghalen" title="Weghalen"${d}>✕</button></span>`).join(''):'<span class="mut">Nog niemand gekozen</span>'}</div>
  <select class="inp" id="${id}" data-act="${act}-add" ${base} aria-label="Jurylid toevoegen"${d||(vrij.length?'':' disabled')}><option value="">${!A.length?'Nog geen bestuursleden':vrij.length?'+ Jurylid toevoegen…':'Iedereen is gekozen'}</option>${vrij.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>`}
function vqJury(r,v,q,base,d){const eigen=Array.isArray(v.juryleden);const N=juryNamen(r,v);
  const uitleg=eigen?'Aangepast voor deze opdracht.':'Dit zijn de verantwoordelijken van de rubriek.';
  return `<div class="fld"><span>Jury voor deze opdracht</span><div class="jrow">${juryKies(N,'vj',base,d,`e_${r.id}_${q}_jury`)}</div></div>
    <div class="vq-foot"><span class="mut">${uitleg} ${N.length?'Bij Nakijken krijgt ieder jurylid een eigen rij.':`Zonder namen staan er bij Nakijken rijen Jury 1 t/m ${jury()}.`}</span>${eigen?`<button class="btn" data-act="vj-reset" ${base}${d}>Terug naar de jury van de rubriek</button>`:''}</div>`}
// vraag voor vraag: links de lijst met vragen, rechts één vraag om in te vullen
function vVragen(){ensureRid();const r=rub(S.rid);const V=vragen(r.id);const som=V.reduce((s,v)=>s+v.punten,0);const max=+r.max||1000;const pc=code(r);const d=dis();
  const q=Math.max(1,Math.min(V.length,S.vq||1));const v=V[q-1];const base=`data-rid="${r.id}" data-q="${q}"`;const st=vraagStatus(v);
  const sel=(f,opts,cur)=>`<select class="inp" id="e_${r.id}_${q}_${f}" data-act="vf" data-f="${f}" ${base}${d}>${opts.map(([k,l,off])=>`<option value="${k}"${k===cur?' selected':''}${off?' disabled':''}>${l}</option>`).join('')}</select>`;
  // "Eén antwoord" kan pas als er nog maar één antwoordregel over is
  const veel=v.regels.length>1;
  const RJ=rubJury(r);
  let h=`<div class="toolbar">${rubSelect()}${somBadge(som,max)}${RJ.length?`<span class="mut">Verantwoordelijk: <b>${RJ.map(esc).join(', ')}</b></span>`:''}<button class="btn chat-knop${S.chat?' primary':''}" data-act="chat" aria-pressed="${S.chat}">${S.chat?'Chat sluiten':'Open chat'}</button></div><div class="vq-grid${S.chat?' met-chat':''}"><nav class="vq-nav" aria-label="Vragen">`;
  V.forEach((x,i)=>{h+=`<button data-act="vq" data-q="${i+1}"${i+1===q?' aria-current="true"':''}><span class="nr">${pc}.${i+1}</span><span class="t">${x.titel?esc(x.titel):'Nog leeg'}</span><span class="p">${x.punten?x.punten+' pt':'–'}</span><span class="dot ${vraagStatus(x)[0]}" title="${vraagStatus(x)[1]}"></span></button>`});
  h+=`</nav><section class="vq-card"><div class="vq-top"><h2>Vraag ${pc}.${q}</h2>${v.soort==='creatief'?'<span class="badge joker">Creatief · jury</span>':''}<span class="badge ${st[0]}">${st[1]}</span></div>
    <label class="fld"><span>Titel van de vraag</span><input class="inp vq-titel" id="e_${r.id}_${q}_titel" data-act="vf" data-f="titel" ${base} value="${esc(v.titel)}" placeholder="Titel van de vraag of opdracht"${d}></label>
    <div class="vq-set"><label class="fld"><span>Nakijken</span>${sel('soort',[['antwoord','Goed / fout (antwoorden)'],['creatief','Creatief (jury)']],v.soort)}</label>
    <label class="fld"><span>Nummering</span>${sel('nummering',[['enkel',veel?'Eén antwoord (eerst antwoorden weghalen)':'Eén antwoord',veel],['abc','A  B  C'],['123','1  2  3']],v.nummering)}</label>
    <label class="fld"><span>Punten vraag</span><input class="inp num" id="e_${r.id}_${q}_punten" data-act="vf" data-f="punten" ${base} inputmode="numeric" value="${v.punten||''}" placeholder="0"${d}></label></div>
    ${v.soort==='creatief'?vqJury(r,v,q,base,d):''}
    <div class="vq-ans"><div class="vq-ah"><span></span><span>${v.soort==='creatief'?'Wat wordt beoordeeld':'Juiste antwoord'}</span><span>Punten</span><span></span></div>`;
  v.regels.forEach((g,k)=>{const ck='dr_'+r.id+'_'+q+'_'+g.id;const on=S.confirm===ck;
    h+=`<div class="vq-row"><span class="vq-l">${lab(v,k)||'•'}</span>
      <input class="inp" id="e_${r.id}_${q}_${g.id}_t" data-act="rf" data-f="tekst" data-k="${k}" ${base} value="${esc(g.tekst)}" placeholder="${v.soort==='creatief'?'Bijv. filmpje, tekening, creativiteit':'Het juiste antwoord'}" aria-label="Antwoord ${lab(v,k)}"${d}>
      <input class="inp num" id="e_${r.id}_${q}_${g.id}_p" data-act="rf" data-f="punten" data-k="${k}" ${base} inputmode="numeric" value="${g.punten||''}" placeholder="0" aria-label="Punten ${lab(v,k)}"${d}>
      <button class="ibtn${on?' danger':''}" data-act="del-regel" data-k="${k}" data-ck="${ck}" ${base} aria-label="Regel verwijderen"${d||(v.regels.length<2?' disabled':'')}>${on?'Zeker?':'✕'}</button></div>`});
  h+=`</div><div class="vq-foot"><button class="btn" data-act="add-regel" ${base}${d}>+ Antwoordregel</button><button class="btn" data-act="verdeel" ${base}${d}>Verdeel ${v.punten||0} punten gelijk</button></div></section>${S.chat?vChat():''}</div>`;
  return h}
// chat naast de vragen: berichten blijven bewaard in chat/<id> met naam, tijd en tekst
function mijnNaam(){return onlNaam||(S.isBestuur?S.naam:'')||S.email||'Beheerder'}
function vChat(){const M=S.chatMsgs;const ik=mijnNaam();
  return `<aside class="chat" aria-label="Chat"><div class="chat-kop"><h3>Chat</h3><span class="mut">Berichten blijven bewaard</span></div>
  <div class="chat-list" id="chat-list" aria-live="polite">${M.length?M.map(m=>`<div class="cmsg${m.naam===ik?' mij':''}"><div class="cmeta"><b>${esc(m.naam)}</b><span>${esc(tijdTxt(m.tijd))}</span></div><div class="ctekst">${esc(m.tekst)}</div></div>`).join(''):'<p class="mut chat-leeg">Nog geen berichten. Stuur hieronder het eerste bericht.</p>'}</div>
  <div class="chat-in"><textarea class="inp" id="chat-in" rows="2" maxlength="1000" placeholder="Typ een bericht… (Enter = versturen)" aria-label="Bericht"></textarea><button class="btn primary" data-act="chat-stuur">Versturen</button></div></aside>`}
let chatSub=false;
function volgChat(){if(chatSub||!db)return;chatSub=true;
  db.collection('chat').onSnapshot(qs=>{S.chatMsgs=qs.docs.map(d=>d.data()).filter(m=>m&&m.tekst).sort((a,b)=>a.tijd-b.tijd);schedule()},
    e=>{chatSub=false;if(e&&e.code==='permission-denied')toast('De chat kan nog niet geladen worden. Vraag de beheerder om de nieuwe beveiligingsregels in Firebase te zetten.',true)})}
function stuurChat(){const el=document.getElementById('chat-in');if(!el)return;const t=el.value.trim();if(!t)return;
  el.value='';dirty.delete('chat-in');const p='chat/'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const cl=document.getElementById('chat-list');if(cl)cl.scrollTop=cl.scrollHeight;
  enqueue(p,()=>db.doc(p).set({naam:mijnNaam(),tijd:Date.now(),tekst:t}))}

/* ---------- Overzicht & uitslag ---------- */
// gecentreerd; de naamkolom groeit mee met de langste teamnaam, de rubriekkolommen blijven even breed (lange rubrieknamen worden afgekapt)
function vOverzicht(){const T=teams();const R=rubs();
  if(!T.length)return empty('Nog geen teams','Zodra er teams zijn, zie je hier per team de punten van elke rubriek.');
  let h=`<div class="rhead"><div><h2>Totaaloverzicht</h2><p class="mut">Punten per team per rubriek, op teamnummer</p></div><div class="legend"><span class="badge joker">★ Joker: score ×2</span></div></div>
  <div class="grid-wrap ov"><table class="grid ov"><colgroup><col class="w1"><col class="wn">${R.map(()=>'<col class="wr">').join('')}<col class="wr"></colgroup>
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
  // in het midden van het scherm; de draaiende achtergrond en schijnwerpers staan in #podium (buiten #app)
  const c=cfg();
  if(!c.onthuld)return `<div class="gate">${OWL}<div class="gate-kop">${esc(c.naam||'Genneps Gewiekste')}${c.editie?' · '+esc(c.editie):''}</div><h2>Wie wordt de winnaar?</h2>${S.isOwner?`<p>Klaar met nakijken? Druk op de knop. Het scherm gaat vanzelf groot.</p>${pct<100?`<p class="gate-let">Let op: nog niet alles is nagekeken (${pct}%).</p>`:''}${showKies()}<button class="btn primary huge" data-act="winnaar">Toon de winnaar!</button>`:'<p>De uitslag wordt straks samen bekendgemaakt. Even geduld…</p>'}</div>`;
  let notes='';for(let i=0;i<Math.min(3,L.length-1);i++){const a=L[i],b=L[i+1];
    if(a.tot===b.tot){if(a.crea!==b.crea)notes+=`<div class="notice">${nm(a)} en ${nm(b)} hebben allebei ${a.tot} punten. Beslist op de creatieve opdrachten: ${a.crea} tegen ${b.crea}.</div>`;
      else notes+=`<div class="notice bad">${nm(a)} en ${nm(b)} staan precies gelijk, ook op de creatieve opdrachten (${a.crea}). Het bestuur moet zelf beslissen.</div>`}}
  let h=`<div class="rhead"><span class="badge ${pct===100?'ok':'warn'}" style="margin-left:auto">Nakijken ${pct}% ingevuld</span></div>
  <div class="uitslag"><div class="seg" role="group" aria-label="Uitslag"><button data-act="uj" data-m="met" aria-pressed="${!zj}">Met joker</button><button data-act="uj" data-m="zonder" aria-pressed="${zj}">Zonder joker</button></div>${notes}
  <div class="grid-wrap"><table class="grid"><colgroup><col class="wr"><col class="wu"><col class="wr"></colgroup>
  <thead><tr><th>Plaats</th><th class="tl">Team</th><th>Punten</th></tr></thead><tbody>`;
  L.forEach(x=>{h+=`<tr><td><b>${x.place}</b></td><td class="tl" title="${nm(x)}"><div class="tcel"><span class="tnaam">${nm(x)}</span><span class="tnr">Team ${x.nr}</span></div></td><td><b>${x.tot}</b></td></tr>`});
  h+='</tbody></table></div>';
  if(S.isOwner)h+=`<div class="toolbar"><button class="btn" data-act="winnaar">Winnaar nog een keer tonen</button><button class="btn" data-act="verberg">Uitslag weer verbergen</button></div>${showKies()}`;
  return h+'</div>'}
// keuze uit de tien shows (alleen beheerder), met een voorproefje met voorbeeldteams
function showKies(){const X=showOf(cfg().show);
  return `<div class="showkies"><label class="rubsel"><span>Show</span><select class="inp" id="showsel" data-act="showsel">${SHOWS.map(x=>`<option value="${x.id}"${x.id===X.id?' selected':''}>${esc(x.naam)}</option>`).join('')}</select></label><button class="btn" data-act="winnaar-proef">▶ Voorproefje</button></div><p class="showuitleg">${esc(X.uitleg)}</p>`}

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
// schermvullende show bovenop de pagina: aftellen 10 → 1, plaats 3 en 2, tromgeroffel, even doodstil, dan de winnaar.
// Er zijn tien shows (SHOWS). Elke show heeft eigen kleuren (css: .show.t-<id>), geluid (s), deeltjes (deel, kl) en teksten (zin).
let SH=null;
const wacht=ms=>new Promise(r=>setTimeout(r,ms));
const SHOWS=[
  {id:'klassiek',naam:'Klassiek',uitleg:'Gouden lichtring, diepe filmdreunen, een tikkende klok en een hart dat steeds sneller klopt.',
    s:{hit:'braam',f:55,bed:'sawtooth',beat:'hart',klok:true,roffel:'snare',fan:'feest'},deel:'confetti',kl:['--accent','--joker','--good','--bad','--warn','--night-ink']},
  {id:'gala',naam:'Gala',uitleg:'Zwart en goud. Donderende pauken, een groot orkest en gouden regen.',
    s:{hit:'pauk',f:49,bed:'sawtooth',beat:'hart',hart:.8,klok:true,roffel:'pauk',fan:'orkest'},deel:'goud',kl:['--sh-goud','--sh-goud-2','--sh-wit'],
    zin:{10:'Dames en heren…',7:'Mag ik uw aandacht…',4:'Het moment is daar…',3:'Adem in…',1:'!!!'}},
  {id:'thriller',naam:'Thriller',uitleg:'Bloedrood, een bonzend hart en schrille violen. Niet voor bange mensen!',
    s:{hit:'braam',f:41,bed:'sawtooth',beat:'hart',hart:1.25,klok:false,roffel:'snare',fan:'thriller'},deel:'confetti',kl:['--sh-rood','--sh-wit','--sh-bloed'],
    zin:{10:'Doe het licht maar uit…',7:'Hoor je dat?',5:'Het komt dichterbij…',3:'Niet omkijken…',1:'!!!'}},
  {id:'carnaval',naam:'Carnaval',uitleg:'Rood, geel en groen. De grote trom, een blaaskapel en serpentines. Alaaf!',
    s:{hit:'trom',f:65,bed:'square',beat:'mars',klok:false,roffel:'snare',fan:'kapel'},deel:'serpentine',kl:['--sh-rood','--sh-geel','--sh-groen'],
    zin:{10:'Alaaf!',7:'De trommels zijn klaar…',4:'Het wordt spannend…',3:'Hou je vast…',1:'!!!'}},
  {id:'ruimte',naam:'Lancering',uitleg:'Aftellen voor een raketlancering tussen de sterren. Het hele scherm trilt mee.',
    s:{hit:'raket',f:46,bed:'sawtooth',beat:'sonar',klok:false,roffel:'riser',fan:'ruimte'},deel:'vonk',kl:['--sh-wit','--sh-cyaan','--sh-blauw','--sh-oranje'],
    zin:{10:'Alle systemen gecontroleerd…',7:'Motoren starten…',4:'Hoofdmotor ontsteekt…',2:'Daar gaat ie…',1:'Lancering!'}},
  {id:'studio',naam:'Tv-studio',uitleg:'Zwaaiende schijnwerpers, een snel tikkende klok en harde synthakkoorden.',
    s:{hit:'stab',f:55,bed:'sawtooth',beat:'kick',klok:true,klokSnel:true,roffel:'snare',fan:'synth'},deel:'confetti',kl:['--sh-paars','--sh-cyaan','--sh-goud','--sh-wit','--sh-roze'],
    zin:{10:'De camera’s draaien…',7:'Spot aan…',4:'Stilte in de studio!',3:'Daar komt hij…',1:'!!!'}},
  {id:'disco',naam:'Disco',uitleg:'Discobal en flitsende kleuren. De beat gaat steeds sneller en harder.',
    s:{hit:'klap',f:55,bed:'square',beat:'disco',klok:false,roffel:'snare',fan:'disco'},deel:'confetti',kl:['--sh-roze','--sh-cyaan','--sh-geel','--sh-paars'],
    zin:{10:'Iedereen de dansvloer op!',7:'Harder!',4:'Handen in de lucht!',3:'Nog sneller…',1:'!!!'}},
  {id:'onweer',naam:'Onweer',uitleg:'Stromende regen, bliksemflitsen en een donderslag bij elk getal.',
    s:{hit:'donder',f:41,bed:'sawtooth',beat:'hart',klok:false,roffel:'pauk',fan:'orkest',wind:true},deel:'confetti',kl:['--sh-wit','--sh-cyaan','--sh-goud'],fx:'bliksem',
    zin:{10:'Er komt een bui aan…',7:'Hoor je het rommelen?',4:'Het barst los…',3:'Pas op!',1:'!!!'}},
  {id:'arcade',naam:'Arcade',uitleg:'Ouderwetse spelcomputer: pixels, piepjes en een 8-bit overwinningsdeuntje.',
    s:{hit:'chip',f:110,bed:null,beat:'chip',klok:false,roffel:'chip',fan:'chip'},deel:'pixel',kl:['--sh-pixel','--sh-roze','--sh-geel','--sh-cyaan'],
    zin:{10:'Munt erin…',7:'Speler 1 klaar',4:'Laatste level…',3:'Eindbaas!',1:'START!'}},
  {id:'vuurwerk',naam:'Vuurwerk',uitleg:'Een fluitende vuurpijl bij elk getal en een enorme vuurwerkshow voor de winnaar.',
    s:{hit:'knal',f:49,bed:'sawtooth',beat:'hart',klok:false,roffel:'snare',fan:'feest'},deel:'vonk',kl:['--sh-goud','--sh-rood','--sh-groen','--sh-blauw','--sh-roze','--sh-wit'],fx:'vuurpijl',
    zin:{10:'Lont aan…',7:'Nog even…',4:'Afstand houden…',3:'Oren dicht!',1:'!!!'}}
];
function showOf(id){return SHOWS.find(x=>x.id===id)||SHOWS[0]}
const ZIN={10:'Daar gaan we…',7:'Het wordt spannend…',5:'Hou je vast…',3:'Adem in…',1:'!!!'};
// slotmuziek per show: noten = [halve tonen boven f, start (s), duur (s)], daarna een groot slotakkoord (akk) op tijd t
const FAN={
  feest:{f:262,type:'sawtooth',noten:[[0,0,.2],[4,.15,.2],[7,.3,.2],[12,.45,.45],[7,.8,.15],[12,.95,.9]],t:1.2,akk:[0,4,7,12]},
  orkest:{f:196,type:'sawtooth',noten:[[0,0,.55],[7,.5,.55],[12,1,.9]],t:1.5,akk:[0,4,7,12,16]},
  thriller:{f:220,type:'sawtooth',noten:[[0,0,.4],[3,.35,.4],[7,.7,.4],[8,1.05,.5]],t:1.5,akk:[0,4,7,12]},
  kapel:{f:233,type:'square',noten:[[0,0,.15],[0,.18,.15],[4,.36,.15],[7,.54,.3],[4,.9,.15],[7,1.08,.15],[12,1.26,.5]],t:1.8,akk:[0,4,7,12],oempa:true},
  ruimte:{f:131,type:'sawtooth',noten:[[0,0,1],[7,.8,1],[12,1.6,1]],t:2.4,akk:[0,7,12,16,19]},
  synth:{f:262,type:'sawtooth',noten:[[0,0,.12],[4,.12,.12],[7,.24,.12],[12,.36,.12],[16,.48,.12],[19,.6,.12],[24,.72,.6]],t:1.1,akk:[0,4,7,11,14]},
  disco:{f:220,type:'square',noten:[[12,0,.1],[12,.25,.1],[15,.5,.1],[17,.75,.25],[19,1,.4]],t:1.5,akk:[0,3,7,10,14]},
  chip:{f:523,type:'square',noten:[[0,0,.08],[4,.09,.08],[7,.18,.08],[12,.27,.08],[7,.36,.08],[12,.45,.08],[16,.54,.08],[19,.63,.08],[24,.72,.5]],t:1.3,akk:[0,4,7,12],chip:true}
};
// voorbeeldteams voor het voorproefje, zodat je een show kunt bekijken zonder de uitslag te verklappen
const DEMO=[{nr:7,naam:'De Slimme Uilen',tot:812,place:1},{nr:3,naam:'De Snelle Denkers',tot:790,place:2},{nr:12,naam:'De Nachtbrakers',tot:771,place:3}];

// geluiden zelf opgewekt met de Web Audio API, er zijn geen geluidsbestanden nodig.
// Alles loopt via een compressor (hard zonder te kraken) en een galm (klinkt als een grote zaal).
function geluid(P){const niks=()=>{};try{const C=new (window.AudioContext||window.webkitAudioContext)();const T=()=>C.currentTime;if(C.resume)C.resume();
  const comp=C.createDynamicsCompressor();comp.threshold.value=-20;comp.knee.value=10;comp.ratio.value=6;comp.attack.value=.003;comp.release.value=.25;
  const hoofd=C.createGain(),mix=C.createGain(),galm=C.createConvolver(),gg=C.createGain();
  comp.connect(hoofd).connect(C.destination);mix.connect(comp);mix.connect(galm);galm.connect(gg).connect(comp);gg.gain.value=.35;
  {const n=Math.floor(C.sampleRate*3),b=C.createBuffer(2,n,C.sampleRate);for(let c=0;c<2;c++){const a=b.getChannelData(c);for(let i=0;i<n;i++)a[i]=(Math.random()*2-1)*Math.pow(1-i/n,2.5)}galm.buffer=b}
  const wit=C.createBuffer(1,C.sampleRate*2,C.sampleRate);{const a=wit.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1}
  const st=n=>Math.pow(2,n/12);
  // volume: a = aanzwellen, d = uitsterven
  const env=(g,s,a,v,d)=>{g.gain.setValueAtTime(.0001,s);g.gain.exponentialRampToValueAtTime(Math.max(v,.001),s+a);g.gain.exponentialRampToValueAtTime(.0001,s+a+d)};
  // toon met optioneel glijden (f2 in gl seconden) en filter (lp, naar lp2)
  const toon=(f,t,d,type,v,o={})=>{const s=T()+t,a=o.a||.005,os=C.createOscillator(),g=C.createGain();os.type=type;os.frequency.setValueAtTime(f,s);
    if(o.f2)os.frequency.exponentialRampToValueAtTime(o.f2,s+(o.gl||d));if(o.det)os.detune.value=o.det;let n=os;
    if(o.lp){const fl=C.createBiquadFilter();fl.type='lowpass';fl.Q.value=o.q||1;fl.frequency.setValueAtTime(o.lp,s);if(o.lp2)fl.frequency.exponentialRampToValueAtTime(o.lp2,s+a+d);os.connect(fl);n=fl}
    n.connect(g).connect(mix);env(g,s,a,v,d);os.start(s);os.stop(s+a+d+.1)};
  const ruis=(t,d,v,o={})=>{const s=T()+t,a=o.a||.003,b=C.createBufferSource(),fl=C.createBiquadFilter(),g=C.createGain();b.buffer=wit;b.loop=true;
    fl.type=o.type||'lowpass';fl.Q.value=o.q||.7;fl.frequency.setValueAtTime(o.f||1600,s);if(o.f2)fl.frequency.exponentialRampToValueAtTime(o.f2,s+(o.gl||a+d));
    b.connect(fl).connect(g).connect(mix);env(g,s,a,v,d);b.start(s,Math.random()*1.5);b.stop(s+a+d+.1)};
  // instrumenten (t = seconden vanaf nu, v = volume)
  const I={
    kick:(t,v)=>{toon(150,t,.5,'sine',v,{f2:40,gl:.16});ruis(t,.02,v*.35,{type:'highpass',f:2500})},
    boem:(t,v)=>{toon(75,t,2.4,'sine',v,{f2:26,gl:1.8});toon(140,t,.6,'triangle',v*.5,{f2:45,gl:.4});ruis(t,1.8,v*.6,{f:2200,f2:70})},
    braam:(t,f,v)=>[1,2,3,4].forEach((m,i)=>[-12,10].forEach(dt=>toon(f*m,t,1.8,'sawtooth',v*.13/(i+1),{a:.04,det:dt,lp:2600,lp2:160,q:2}))),
    pauk:(t,f,v)=>{toon(f*2.2,t,1.6,'sine',v*.8,{f2:f*2,gl:.08});toon(f*3.4,t,.7,'sine',v*.25);ruis(t,.2,v*.35,{f:1200,f2:200})},
    trom:(t,v)=>{toon(95,t,.8,'sine',v,{f2:48,gl:.3});ruis(t,.2,v*.5,{f:1400,f2:150})},
    bekken:(t,v)=>ruis(t,2.4,v*.3,{type:'highpass',f:5500}),
    snare:(t,v)=>{ruis(t,.16,v*.55,{type:'bandpass',f:2400,q:.7});toon(210,t,.07,'triangle',v*.35,{f2:160})},
    klap:(t,v)=>[0,.011,.023].forEach(x=>ruis(t+x,.1,v*.5,{type:'bandpass',f:1400,q:1.4})),
    hihat:(t,v)=>ruis(t,.045,v*.22,{type:'highpass',f:8000}),
    tik:(t,v,hoog)=>{toon(hoog?2600:1900,t,.04,'square',v*.1,{lp:5000});ruis(t,.015,v*.35,{type:'highpass',f:6000})},
    // hartslag: boem-boem, met een klikje erbij zodat je hem ook op laptopspeakers hoort
    hart:(t,v)=>{toon(95,t,.22,'sine',v,{f2:45,gl:.1});ruis(t,.03,v*.3,{f:500});toon(85,t+.2,.28,'sine',v*.75,{f2:40,gl:.12});ruis(t+.2,.03,v*.22,{f:450})},
    donder:(t,v)=>{ruis(t,3.6,v*.9,{f:1200,f2:60,a:.02});for(let i=0;i<7;i++)ruis(t+Math.random()*.9,.22,v*.45,{f:3000,f2:300});toon(48,t,2.6,'sine',v*.7,{f2:26})},
    chip:(t,f,v)=>toon(f*4,t,.32,'square',v*.11,{f2:f,gl:.28}),
    noot:(t,f,d,v)=>toon(f,t,d,'square',v*.08),
    bliep:(t,f,v)=>toon(f,t,.22,'sine',v*.28),
    bas:(t,f,v)=>toon(f,t,.22,'sawtooth',v*.22,{lp:700,lp2:200}),
    fluit:(t,v)=>toon(450,t,.9,'sine',v*.12,{f2:2800,gl:.9,a:.05}),
    knal:(t,v)=>{ruis(t,.45,v*.8,{type:'highpass',f:900,f2:300});I.boem(t,v*.55);for(let i=0;i<12;i++)ruis(t+.15+Math.random()*1.1,.035,v*.22,{type:'highpass',f:4000})},
    stab:(t,f,v)=>[0,3,7,12].forEach(n=>[-10,10].forEach(dt=>toon(f*st(n),t,.55,'sawtooth',v*.06,{det:dt,lp:5000,lp2:400}))),
    // schrille violen: drie tonen die net vals samen klinken, daar word je onrustig van
    gil:(t,f,v)=>[0,1,6].forEach(n=>toon(f*st(n),t,1.3,'sawtooth',v*.045,{a:.25,lp:6000})),
    // aanzwellend gesis en een toon die steeds hoger gaat
    riser:(t,d,v)=>{ruis(t,.15,v*.4,{type:'bandpass',f:200,f2:7000,q:3,a:d,gl:d});toon(70,t,.15,'sawtooth',v*.1,{f2:1400,gl:d,a:d,lp:5000})}
  };
  // zoemend tapijt onder het aftellen: wordt per getal hoger, helderder en gaat trillen
  const maakBed=k0=>{if(!P.bed)return null;const s=T(),g=C.createGain(),fl=C.createBiquadFilter(),tr=C.createGain(),lfo=C.createOscillator(),ld=C.createGain();
    g.gain.setValueAtTime(.0001,s);g.gain.exponentialRampToValueAtTime(.14,s+1.2);fl.type='lowpass';fl.Q.value=5;fl.frequency.value=220+k0*2400;
    lfo.frequency.value=5;ld.gain.value=0;tr.gain.value=1;lfo.connect(ld).connect(tr.gain);
    const O=[[1,-14],[1,14],[.5,0],[1.5,6],[2,-8]].map(([m,dt])=>{const o=C.createOscillator();o.type=P.bed;o.frequency.value=P.f*m;o.detune.value=dt+k0*1200;o.connect(fl);o.start(s);return[o,dt]});
    fl.connect(tr).connect(g).connect(mix);lfo.start(s);
    const naar=(k,tc)=>{const t=T();fl.frequency.setTargetAtTime(220+k*2400,t,tc);O.forEach(([o,dt])=>o.detune.setTargetAtTime(dt+k*1200,t,tc));
      ld.gain.setTargetAtTime(k>.6?Math.min(.6,(k-.6)*1.2):0,t,tc);lfo.frequency.setTargetAtTime(5+k*8,t,tc);g.gain.setTargetAtTime(Math.min(.3,.13+k*.12),t,tc)};
    return{stap:k=>naar(k,.3),stijg:d=>naar(1.8,d/2.5),
      stop:f=>{const t=T();g.gain.cancelScheduledValues(t);g.gain.setValueAtTime(Math.max(g.gain.value,.0002),t);g.gain.exponentialRampToValueAtTime(.0001,t+f);O.forEach(([o])=>o.stop(t+f+.05));lfo.stop(t+f+.05)}}};
  const vul=(d,iv,fn,start=0)=>{let i=0;for(let x=start;x<d-.05;x+=iv)fn(x,i++)};
  const roffel=d=>{const r=P.roffel;let x=0;
    while(x<d){const k=x/d,a=.2+.8*k*k;
      if(r==='pauk')I.pauk(x,P.f,a*.8);else if(r==='chip')I.noot(x,P.f*2*st(Math.floor(k*24)),.05,a);else if(r!=='riser')I.snare(x,a);
      x+=r==='chip'?.06:Math.max(.035,.11-.075*k)}
    if(r==='riser'){I.riser(0,d,1);ruis(0,.2,.6,{f:100,f2:900,a:d,gl:d})}};
  const fan=F=>{const f=F.f,ty=F.type,ch=!!F.chip;
    F.noten.forEach(([n,t,d])=>{if(ch)I.noot(t,f*st(n),d,1.2);else{[-9,9].forEach(dt=>toon(f*st(n),t,d+.1,ty,.055,{det:dt,lp:4500}));toon(f*st(n)/2,t,d+.1,'triangle',.1)}});
    if(F.oempa)for(let i=0;i<8;i++){const x=i*.225;if(i%2)I.snare(x,.5);else I.bas(x,f/2*(i%4?1.5:1),1.4)}
    const t=F.t;
    if(ch){for(let i=0;i<32;i++)I.noot(t+i*.06,f*st(F.akk[i%F.akk.length])*(i%8<4?1:2),.06,1);I.chip(t,f/2,1.4)}
    else{F.akk.forEach(n=>[-12,0,12].forEach(dt=>toon(f*st(n),t,3.4,ty,.03,{a:.05,det:dt,lp:6500,lp2:900})));toon(f/2,t,3,'triangle',.25);I.pauk(t,f/4,1);I.bekken(t,.9);I.boem(t,.7)}};
  let bed=null;
  return{
    // onheilspellend begin: diepe dreun en het zoemende tapijt komt op
    start:()=>{bed=maakBed(0);I.boem(0,.9);
      if(P.hit==='chip')[0,3,7,12,15,19,24].forEach((n,i)=>I.noot(i*.09,P.f*2*st(n),.08,1));else I.braam(0,P.f,.8);
      if(P.wind)ruis(0,40,.18,{type:'bandpass',f:450,q:.5,a:2})},
    // één getal van het aftellen (n = 10 … 1, ms = hoe lang het getal blijft staan)
    tel:(n,ms)=>{const d=ms/1000,k=(10-n)/9,f=P.f*st(10-n),laat=n<=3;if(bed)bed.stap(k);
      const H={braam:()=>{I.braam(0,f,.7+.5*k);I.kick(0,.9)},pauk:()=>{I.pauk(0,f,1);I.bekken(0,.12+.3*k)},
        trom:()=>{I.trom(0,1);I.bekken(0,.25);I.stab(0,f*4,.5)},raket:()=>{I.boem(0,.45+.5*k);I.bliep(0,660*st(10-n),1)},
        stab:()=>{I.kick(0,1);I.stab(0,f*4,1)},klap:()=>{I.kick(0,1);I.klap(0,1);I.stab(0,f*4,.5)},
        donder:()=>I.donder(0,.55+.45*k),chip:()=>{I.chip(0,f,1);I.noot(0,f*2,.1,1)},knal:()=>{I.knal(0,.6+.4*k);if(n>1)I.fluit(d-.9,.8)}};
      (H[P.hit]||niks)();
      if(laat){if(P.hit==='chip')I.chip(.02,f/2,1.4);else{I.boem(0,1);I.gil(.05,f*4,.6+.3*(3-n))}}
      // tussen de klappen door: hartslag, beat of klok, steeds sneller
      const b=P.beat;
      if(b==='hart')vul(d,(.9-.5*k)/(P.hart||1),x=>I.hart(x,.7+.5*k));
      if(b==='kick')vul(d,.5-.22*k,x=>{I.kick(x,.8);I.hihat(x+(.25-.11*k),1)});
      if(b==='disco'){const s=.5-.2*k;vul(d,s,(x,i)=>{I.kick(x,.9);I.hihat(x+s/2,1);I.bas(x+s/2,f/2*(i%2?2:1),1);if(i%2)I.klap(x,.6)})}
      if(b==='mars'){const s=.46-.18*k;vul(d,s,(x,i)=>{I.bas(x,f*(i%2?1.5:1),1.2);I.snare(x+s/2,.45)})}
      if(b==='sonar'){vul(d,1,x=>I.bliep(x+.5,1320,.6));ruis(0,d,.15+.45*k,{f:120+k*500,a:.1})}
      if(b==='chip')vul(d,.125-.05*k,(x,i)=>I.noot(x,f*2*st([0,3,7,12][i%4]),.06,.8));
      if(P.klok)vul(d,P.klokSnel?.25:.5,(x,i)=>I.tik(x,1,i%2===0))},
    // na de 1: alles valt weg, je hoort alleen nog je hart
    na:()=>{if(bed){bed.stop(.08);bed=null}if(P.hit!=='chip'){I.hart(.5,1.1);I.hart(1.3,1.1)}},
    roffel,
    onthul:()=>{if(P.hit==='chip'){I.chip(0,P.f,1.4);[0,4,7,12].forEach((n,i)=>I.noot(.1+i*.08,P.f*4*st(n),.1,1))}else{I.boem(0,.9);I.bekken(0,.7);I.stab(0,P.f*4,.8)}
      if(P.hit==='knal')I.knal(0,.7);if(P.hit==='donder')I.donder(0,.6)},
    // vlak voor de winnaar: tapijt terug en steeds hoger, roffel en aanzwellend gesis
    spanning:d=>{bed=maakBed(.9);if(bed)bed.stijg(d);roffel(d);I.riser(0,d,1)},
    // doodstil (d seconden), daarna komt het geluid in één klap terug
    stilte:d=>{if(bed){bed.stop(.03);bed=null}const s=T(),g=hoofd.gain;g.cancelScheduledValues(s);g.setValueAtTime(1,s);g.linearRampToValueAtTime(.0001,s+.04);g.setValueAtTime(.0001,s+d);g.linearRampToValueAtTime(1,s+d+.02)},
    winnaar:()=>{I.boem(0,1.1);I.kick(0,1);I.bekken(0,1);if(P.hit==='donder')I.donder(0,1);if(P.hit==='knal')I.knal(0,1);fan(FAN[P.fan]||FAN.feest)},
    vuur:()=>{if(P.hit==='knal'){I.fluit(0,.6);I.knal(.8,.5)}},
    stil:()=>{try{C.close()}catch(e){}}}}
  catch(e){return{start:niks,tel:niks,na:niks,roffel:niks,onthul:niks,spanning:niks,stilte:niks,winnaar:niks,vuur:niks,stil:niks}}}
// deeltjes op een canvas: confetti, gouden snippers, serpentines, pixels of vonken (vuurwerk), en regen bij onweer
function confetti(cv,kleuren,vorm){const ctx=cv.getContext('2d'),d=window.devicePixelRatio||1,css=getComputedStyle(document.documentElement);
  const wit=css.getPropertyValue('--sh-wit').trim(),kl=kleuren.map(k=>css.getPropertyValue(k).trim()).filter(Boolean),kies=()=>kl[Math.floor(Math.random()*kl.length)]||wit;
  const rustig=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let P=[],id=0,regen=false,buien=false;const fit=()=>{cv.width=innerWidth*d;cv.height=innerHeight*d};fit();addEventListener('resize',fit);
  // maat van een snipper: [breedte, + willekeurig, hoogte, + willekeurig]; hoogte 0 = vierkant/rond
  const MAAT={confetti:[7,7,10,12],goud:[5,4,7,7],serpentine:[3,2,24,26],pixel:[9,5,0,0],vonk:[2,1.5,0,0]},M=MAAT[vorm]||MAAT.confetti,vk=vorm==='vonk';
  const deel=(x,y,vx,vy,vonk)=>{const m=vonk?MAAT.vonk:M,w=(m[0]+Math.random()*m[1])*d;
    return{x,y,vx,vy,w,h:m[2]?(m[2]+Math.random()*m[3])*d:w,c:kies(),r:Math.random()*6,vr:vorm==='pixel'?0:(Math.random()-.5)*.35,v:vonk,l:1,dl:vonk?.01+Math.random()*.008:0}};
  const kanon=(links,n)=>{if(rustig)n=Math.round(n/4);for(let i=0;i<n;i++){const a=(links?-62:-118)*Math.PI/180+(Math.random()-.5)*.7,s=(18+Math.random()*20)*d;P.push(deel(links?0:cv.width,cv.height,Math.cos(a)*s,Math.sin(a)*s,vk))}};
  // vuurwerk dat uiteenspat op (x, y), als deel van de schermbreedte en -hoogte
  const knal=(x,y,n)=>{if(rustig)n=Math.round(n/4);const c=kies();for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=(1.5+Math.random()*7)*d,p=deel(x*cv.width,y*cv.height,Math.cos(a)*s,Math.sin(a)*s,true);if(Math.random()<.75)p.c=c;P.push(p)}};
  const stap=()=>{ctx.clearRect(0,0,cv.width,cv.height);
    if(regen&&P.length<900)for(let i=0;i<(rustig?1:4);i++){const p=deel(Math.random()*cv.width,-30*d,(Math.random()-.5)*3*d,(1+Math.random()*3)*d,false);if(vk){p.v=true;p.dl=.004}P.push(p)}
    if(buien&&!rustig)for(let i=0;i<5;i++)P.push({x:Math.random()*cv.width*1.1,y:-40*d,vx:-2*d,vy:(22+Math.random()*10)*d,druppel:true});
    P=P.filter(p=>p.y<cv.height+50*d&&(!p.v||p.l>0));
    for(const p of P){
      if(p.druppel){p.x+=p.vx;p.y+=p.vy;ctx.globalAlpha=.3;ctx.fillStyle=wit;ctx.fillRect(p.x,p.y,1.2*d,20*d);continue}
      if(p.v){p.vx*=.955;p.vy=p.vy*.955+.07*d;p.x+=p.vx;p.y+=p.vy;p.l-=p.dl;ctx.globalCompositeOperation='lighter';ctx.globalAlpha=Math.max(0,p.l);ctx.fillStyle=p.c;
        ctx.beginPath();ctx.arc(p.x,p.y,p.w,0,6.3);ctx.fill();ctx.globalCompositeOperation='source-over';continue}
      ctx.globalAlpha=1;p.vx*=.97;p.vy=p.vy*.96+.25*d;p.x+=p.vx+Math.sin(p.r)*.6*d;p.y+=p.vy;p.r+=p.vr;
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.scale(Math.cos(p.r*1.7),1);ctx.fillStyle=p.c;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore()}
    ctx.globalAlpha=1;id=requestAnimationFrame(stap)};stap();
  return{kanon,knal,regen:v=>{regen=v},buien:v=>{buien=v},stop:()=>{cancelAnimationFrame(id);removeEventListener('resize',fit)}}}
// demo = voorproefje met voorbeeldteams: de echte uitslag blijft dicht
async function toonWinnaar(demo){if(SH||!S.isOwner)return;const L=demo?DEMO:ranking(false);if(!L.length)return;
  const c=cfg(),X=showOf(c.show),zin=X.zin||ZIN,nm=x=>esc(x.naam||'Team '+x.nr),kop=`<div class="sh-kop">${esc(c.naam||'Genneps Gewiekste')}${c.editie?' · '+esc(c.editie):''}</div>`;
  const win=L.filter(x=>x.place===1),rest=win.length>1?[]:L.slice(1,3).reverse(); // eerst plaats 3, dan 2
  const el=document.createElement('div');el.id='show';el.className='show t-'+X.id;el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','De winnaar bekendmaken');
  el.innerHTML=`<div class="sh-licht" aria-hidden="true"></div><div class="sh-deco" aria-hidden="true"></div><div class="sh-vig" aria-hidden="true"></div><canvas class="sh-conf" aria-hidden="true"></canvas>${demo?'<div class="sh-demo">Voorproefje met voorbeeldteams</div>':''}<button class="sh-x" aria-label="Show stoppen">✕</button><div class="sh-stage" aria-live="assertive"></div>`;
  document.body.appendChild(el);document.body.classList.add('show-open');SH=el;
  const G=geluid(X.s),K=confetti(el.querySelector('canvas'),X.kl,X.deel),st=el.querySelector('.sh-stage'),vig=el.querySelector('.sh-vig');
  let stop=false,iv=0;
  const toets=e=>{if(e.key==='Escape')sluit()};
  const sluit=()=>{stop=true;clearInterval(iv);G.stil();K.stop();el.remove();document.body.classList.remove('show-open');removeEventListener('keydown',toets);SH=null};
  addEventListener('keydown',toets);el.querySelector('.sh-x').onclick=sluit;
  const fase=(f,html)=>{el.dataset.fase=f;st.innerHTML=html};
  const w=async ms=>{await wacht(ms);if(stop)throw 0};
  const rnd=(a,b)=>a+Math.random()*(b-a);
  // bij elke klap: gloed langs de randen, en per show een extraatje (bliksem of vuurpijl)
  const klap=n=>{vig.classList.remove('aan');void vig.offsetWidth;vig.classList.add('aan');
    if(X.fx==='bliksem'){const b=document.createElement('div');b.className='sh-bliksem';el.appendChild(b);setTimeout(()=>b.remove(),700)}
    if(X.fx==='vuurpijl')K.knal(rnd(.15,.85),rnd(.12,.45),50+(10-n)*8)};
  if(X.fx==='bliksem')K.buien(true);
  try{
    fase('intro',kop+'<div class="sh-titel">Wie wordt de winnaar?</div>');G.start();await w(2600);
    fase('tel',kop+'<div class="sh-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="sh-rb" cx="100" cy="100" r="90"/><circle class="sh-rv" cx="100" cy="100" r="90"/></svg><span class="sh-num"></span></div><div class="sh-sub"></div>');
    const num=st.querySelector('.sh-num'),rv=st.querySelector('.sh-rv'),sub=st.querySelector('.sh-sub');
    // de laatste getallen blijven langer staan: dan wordt het pas echt spannend
    for(let n=10;n>=1;n--){const ms=n>6?1000:n>3?1200:1700;
      num.textContent=n;num.classList.remove('pop');void num.offsetWidth;num.classList.add('pop');
      rv.style.transitionDuration=ms+'ms';rv.style.strokeDashoffset=String(565.5*(1-(n-1)/10));
      if(zin[n])sub.textContent=zin[n];el.classList.toggle('spannend',n<=3);G.tel(n,ms);klap(n);await w(ms)}
    el.classList.remove('spannend');G.na();
    fase('stil',kop+'<div class="sh-titel">De punten zijn geteld…</div>');await w(2200);
    for(const x of rest){fase('plek',`<div class="sh-plaats">Op de ${x.place}e plaats…</div>`);G.roffel(1.8);await w(2000);
      fase('plek',`<div class="sh-plaats">Op de ${x.place}e plaats</div><div class="sh-naam">${nm(x)}</div><div class="sh-pnt">${x.tot} punten</div>`);G.onthul();
      if(X.deel==='vonk'){K.knal(.3,.3,80);K.knal(.7,.3,80)}else{K.kanon(true,40);K.kanon(false,40)}await w(4000)}
    fase('drum',`<div class="sh-titel">En de winnaar van ${esc(c.naam||'Genneps Gewiekste')} is…</div>`);el.classList.add('spannend');G.spanning(4.4);await w(4500);
    // even helemaal zwart en doodstil… en dan de winnaar
    el.classList.remove('spannend');el.classList.add('zwart');G.stilte(.9);await w(950);el.classList.remove('zwart');
    fase('winnaar',`<div class="sh-flits" aria-hidden="true"></div>${OWL}<div class="sh-kop">${win.length>1?'De winnaars zijn':'De winnaar is'}</div>${win.map(x=>`<div class="sh-naam groot">${nm(x)}</div>`).join('')}<div class="sh-pnt">${win[0].tot} punten</div><button class="btn primary big sh-door">${demo?'Voorproefje sluiten':'Bekijk de hele uitslag'}</button>`);
    G.winnaar();
    if(X.deel==='vonk'){for(let i=0;i<5;i++)K.knal(rnd(.15,.85),rnd(.12,.5),130);K.regen(true);iv=setInterval(()=>{G.vuur();setTimeout(()=>{if(!stop)K.knal(rnd(.12,.88),rnd(.1,.5),120)},800)},900)}
    else{K.kanon(true,180);K.kanon(false,180);K.regen(true);iv=setInterval(()=>K.kanon(Math.random()<.5,90),2200)}
    st.querySelector('.sh-door').onclick=sluit;
    if(!demo&&!c.onthuld){const cc=clone(c);cc.onthuld=true;saveConfig(cc)}
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
  // elke rubriek een even grote pil achter de teamnaam; klik = joker zetten, nog eens klikken = joker weg
  h+=`<div class="panel" style="--nj:${N.length}"><div class="lrow jk lhead"><span style="text-align:center">Nr</span><span>Team</span><span>Joker op rubriek · klik nog eens om de joker weg te halen</span></div>`;
  T.forEach(t=>{const cur=jokerOf(t.nr)||'';
    h+=`<div class="lrow jk"><span class="ln">${t.nr}</span><span class="qa" title="${esc(t.naam)}">${t.naam?esc(t.naam):'<i>Geen naam</i>'}</span><div class="jpills" role="group" aria-label="Joker team ${t.nr}">${N.map(r=>`<button class="jpill" data-act="jk" data-nr="${t.nr}" data-r="${r.id}" aria-pressed="${r.id===cur}" title="${code(r)} · ${esc(r.naam)}"><b>${code(r)}</b><span>${esc(r.naam)}</span></button>`).join('')}</div></div>`});
  return h+'</div>'}
function vInst(){const c=cfg();const R=rubs();
  const nk=nakijkenAan();
  let h=`<div class="rhead"><div><h2>Instellingen</h2><p class="mut">Alleen jij kunt dit wijzigen. Wijzigingen zijn direct zichtbaar voor iedereen.</p></div></div>
  <div class="panel"><h3>Nakijken voor het bestuur</h3><div class="pad">
    <div class="toolbar"><div class="seg" role="group" aria-label="Nakijken voor het bestuur"><button data-act="nk-aan" data-v="uit" aria-pressed="${!nk}">Uit</button><button data-act="nk-aan" data-v="aan" aria-pressed="${nk}">Aan</button></div>
    <span class="badge ${nk?'ok':'warn'}">${nk?'Het bestuur kan nu nakijken':'Het bestuur ziet alleen Vragen &amp; antwoorden'}</span></div>
    <p class="mut" style="margin:0">Zet dit aan als alle vragen en opdrachten klaar zijn. Bestuursleden zien dan ook het tabblad Nakijken. Totaaloverzicht, Uitslag en Statistieken blijven alleen voor jou.</p>
  </div></div>
  <div class="panel"><h3>Kwis</h3><div class="pad"><div class="formgrid">
    <label class="fld"><span>Naam</span><input class="inp" id="c_naam" data-act="cfg" data-f="naam" value="${esc(c.naam)}"></label>
    <label class="fld"><span>Editie</span><input class="inp" id="c_editie" data-act="cfg" data-f="editie" value="${esc(c.editie)}" placeholder="Bijv. Editie 6 (2026)"></label>
    <label class="fld"><span>Aantal juryleden zonder namen</span><select class="inp" id="c_jury" data-act="cfg" data-f="jury">${[1,2,3,4,5,6].map(n=>`<option${n===jury()?' selected':''}>${n}</option>`).join('')}</select></label>
  </div></div></div>
  ${S.backend==='firebase'?vToegang():''}
  <div class="panel"><h3>Rubrieken</h3><div class="lrow rb lhead"><span style="text-align:center">#</span><span>Naam</span><span class="soort">Soort</span><span>Vragen</span><span>Max punten</span><span></span></div>`;
  R.forEach((r,i)=>{const ck='drb_'+r.id;const on=S.confirm===ck;
    h+=`<div class="lrow rb"><span class="ln">${code(r)}</span><input class="inp" id="rn_${r.id}" data-act="rb" data-f="naam" data-i="${i}" value="${esc(r.naam)}" aria-label="Naam rubriek ${code(r)}"><span class="soort mut">${{sponsor:'Sponsor · geen joker',geheim:'Geheim · geen joker',overig:'Extra punten · geen joker',normaal:'Normaal'}[r.soort]||''}</span>
    <input class="inp num" id="rv_${r.id}" data-act="rb" data-f="vragen" data-i="${i}" inputmode="numeric" value="${r.vragen}" aria-label="Aantal vragen"><input class="inp num" id="rm_${r.id}" data-act="rb" data-f="max" data-i="${i}" inputmode="numeric" value="${r.max}" aria-label="Maximaal aantal punten">
    ${r.soort==='normaal'?`<button class="ibtn${on?' danger':''}" data-act="rb-del" data-i="${i}" data-ck="${ck}" aria-label="Rubriek verwijderen">${on?'Zeker?':'✕'}</button>`:'<span></span>'}</div>`});
  h+=`<div class="efoot" style="padding-left:12px"><button class="btn" data-act="rb-add">+ Rubriek toevoegen</button><span class="mut">Een verwijderde rubriek verdwijnt uit de uitslag. Ingevulde punten blijven bewaard.</span></div></div>`;
  // verantwoordelijken per rubriek; zij zijn ook de jury van de creatieve opdrachten in die rubriek
  h+=`<div class="panel"><h3>Verantwoordelijken en jury per rubriek</h3><div class="pad"><p class="mut" style="margin:0">Kies per rubriek wie er verantwoordelijk is. Zij zijn ook de jury van de creatieve opdrachten in die rubriek. Bij een opdracht kun je de jury nog aanpassen.${(S.namen||[]).length?'':' Vul eerst de namen van de bestuursleden in bij Toegang bestuur.'}</p></div>
  <div class="lrow rj lhead"><span style="text-align:center">#</span><span class="qa">Rubriek</span><span>Verantwoordelijk / jury</span><span></span></div>`;
  R.forEach((r,i)=>{h+=`<div class="lrow rj"><span class="ln">${code(r)}</span><span class="qa" title="${esc(r.naam)}">${esc(r.naam)}</span>${juryKies(rubJury(r),'rbj',`data-i="${i}"`,'','rj_'+r.id)}</div>`});
  return h+'</div>'}

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
  const x=raw(rid,nr,rg);const cur=j?(x&&typeof x==='object'&&typeof x[j]==='number'?x[j]:null):(typeof x==='number'?x:null);
  const p=parseScore(el.value,max);
  if(p.err){toast(p.err,true);el.value=cur==null?'':cur;return false}
  if(p.v===cur){el.value=cur==null?'':cur;return true}
  saveScore(rid,nr,rg,j?{[j]:p.v}:p.v);return true}
// Enter: volgende vakje omlaag in dezelfde teamkolom
function nextScoreInput(el){const list=[...$app.querySelectorAll('input[data-act="score"]')].filter(x=>x.dataset.nr===el.dataset.nr);
  return list[list.indexOf(el)+1]||null}
// pijltjestoetsen: omhoog/omlaag binnen de teamkolom, links/rechts binnen de regel
function arrowScoreInput(el,key){const vert=key==='ArrowUp'||key==='ArrowDown';const d=key==='ArrowUp'||key==='ArrowLeft'?-1:1;
  const list=vert?[...$app.querySelectorAll('input[data-act="score"]')].filter(x=>x.dataset.nr===el.dataset.nr):[...el.closest('tr').querySelectorAll('input[data-act="score"]')];
  return list[list.indexOf(el)+d]||null}
function curVraag(rid,q){return clone(vragen(rid)[q-1])}

$app.addEventListener('input',e=>{const el=e.target;if(el.id)dirty.add(el.id)});
$app.addEventListener('keydown',e=>{const el=e.target;
  if(el.id==='chat-in'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();stuurChat();return}
  if(el.dataset.act==='score'&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&!e.shiftKey&&!e.ctrlKey&&!e.altKey){
    e.preventDefault();const nx=arrowScoreInput(el,e.key);if(!nx)return;const ok=commitScore(el);
    if(ok){S.pf=nx.id;if(!raf)focusSel(nx)}return}
  if(e.key!=='Enter'||el.tagName==='TEXTAREA')return;
  if(el.dataset.act==='score'){e.preventDefault();const nx=nextScoreInput(el);const ok=commitScore(el);
    if(ok&&nx){S.pf=nx.id;if(!raf)focusSel(nx)}return}
  if(el.id==='ln_ww'){e.preventDefault();loginBestuur();return}
  if(el.tagName==='INPUT'){e.preventDefault();el.blur()}});
$app.addEventListener('change',e=>{const el=e.target;const a=el.dataset.act;if(!a)return;dirty.delete(el.id);const v=el.value;
  if(a==='score'){commitScore(el);return}
  if(a==='toegang'){const list=[...new Set(v.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>x.includes('@')))];saveToegang(list);toast(list.length+' adressen hebben toegang.');return}
  if(a==='namen'){const list=[...new Set(v.split('\n').map(x=>x.trim()).filter(Boolean))];saveNamen(list);toast(list.length+(list.length===1?' naam staat':' namen staan')+' op het inlogscherm.');return}
  if(a==='ln-naam'){S.naam=v;return}
  if(a==='showsel'){const c=clone(cfg());c.show=v;saveConfig(c);toast('Show gekozen: '+showOf(v).naam+'.');return}
  if(a==='rub'){S.rid=v;S.vq=1;store('gg_rid',v);render();return}
  if(a==='vf'){const q=+el.dataset.q,rid=el.dataset.rid;const o=curVraag(rid,q);const f=el.dataset.f;
    if(f==='nummering'&&v==='enkel'&&o.regels.length>1){el.value=o.nummering;toast('Haal eerst de antwoorden weg die te veel zijn. Daarna kun je "Eén antwoord" kiezen.',true);return}
    if(f==='punten')o.punten=num(v);else o[f]=v;saveVraag(rid,q,o);return}
  if(a==='rf'){const q=+el.dataset.q,rid=el.dataset.rid,k=+el.dataset.k;const o=curVraag(rid,q);if(!o.regels[k])return;
    if(el.dataset.f==='punten')o.regels[k].punten=num(v);else o.regels[k].tekst=v;saveVraag(rid,q,o);return}
  if(a==='vj-add'){if(!v)return;const q=+el.dataset.q,rid=el.dataset.rid;const o=curVraag(rid,q);const N=juryNamen(rub(rid),o);
    if(!N.includes(v))o.juryleden=[...N,v];saveVraag(rid,q,o);toast(v+' is toegevoegd aan de jury van deze opdracht.');return}
  if(a==='rbj-add'){if(!v)return;const c=clone(cfg());const r=c.rubrieken[+el.dataset.i];if(!r)return;const N=rubJury(r);
    if(!N.includes(v))r.juryleden=[...N,v];saveConfig(c);return}
  if(a==='team-naam'){const t=clone(S.teams);t[el.dataset.nr]=v.trim();saveTeams(t);return}
  if(a==='cfg'){const c=clone(cfg());c[el.dataset.f]=el.dataset.f==='jury'?+v:v;saveConfig(c);return}
  if(a==='rb'){const c=clone(cfg());const r=c.rubrieken[+el.dataset.i];if(!r)return;const f=el.dataset.f;
    if(f==='naam')r.naam=v.trim()||r.naam;else if(f==='vragen')r.vragen=Math.max(1,Math.min(20,num(v)||1));else r.max=Math.max(1,num(v)||1000);saveConfig(c);return}
});
$app.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el||el.disabled)return;const a=el.dataset.act;
  if(a==='login'){const p=new firebase.auth.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});firebase.auth().signInWithPopup(p).catch(e=>{if(e&&e.code!=='auth/popup-closed-by-user')toast('Inloggen lukte niet: '+(e.message||e.code),true)});return}
  if(a==='logout'){firebase.auth().signOut().then(()=>location.reload());return}
  if(a==='login-bestuur'){loginBestuur();return}
  if(a==='jk'){const j=clone(S.jokers);const nr=el.dataset.nr;if(j[nr]===el.dataset.r)delete j[nr];else j[nr]=el.dataset.r;saveJokers(j);return}
  // direct in de pagina wisselen (niet opnieuw opbouwen), zodat wat al getypt is blijft staan
  if(a==='toon-ww'){const id=el.dataset.for;const inp=document.getElementById(id);if(!inp)return;const t=toonWw[id]=!toonWw[id];
    inp.type=t?'text':'password';el.textContent=t?'Verbergen':'Tonen';el.setAttribute('aria-pressed',t);inp.focus();return}
  if(a==='bww'){const ww=(document.getElementById('bww').value||'').trim();if(ww.length<6){toast('Het wachtwoord moet minstens 6 tekens hebben.',true);return}
    dirty.delete('bww');el.disabled=true;
    zetBestuurWw(ww).then(()=>toast('Het algemene wachtwoord is ingesteld.')).catch(e=>{el.disabled=false;const c=e&&e.code;
      toast(c==='auth/operation-not-allowed'?'Zet eerst in Firebase bij Authentication de inlogmethode "E-mailadres/wachtwoord" aan.'
        :c==='geen-oud'?'Het bestuursaccount bestaat al, maar het oude wachtwoord is onbekend. Verwijder het account in Firebase bij Authentication en probeer opnieuw.'
        :c==='auth/weak-password'?'Dit wachtwoord is te zwak. Kies een langer wachtwoord.':'Instellen lukte niet: '+((e&&(e.message||c))||'onbekende fout'),true)});return}
  if(a==='tab'){S.tab=el.dataset.tab;try{history.replaceState(null,'','#'+S.tab)}catch(x){}render();window.scrollTo(0,0);return}
  if(a==='vq'){S.vq=+el.dataset.q;render();window.scrollTo(0,0);return}
  if(a==='chat'){S.chat=!S.chat;store('gg_chat',S.chat?'1':'0');if(S.chat)volgChat();render();if(S.chat){const c=document.getElementById('chat-in');if(c)c.focus({preventScroll:true})}return}
  if(a==='chat-stuur'){stuurChat();return}
  if(a==='uj'){S.uj=el.dataset.m;store('gg_uj',S.uj);render();return}
  if(a==='nkm'){S.nkm=el.dataset.m;store('gg_nkm',S.nkm);render();return}
  // scherm vanzelf groot (mag alleen direct na een klik), daarna de show
  if(a==='winnaar'||a==='winnaar-proef'){const d=document.documentElement;if(!document.fullscreenElement&&d.requestFullscreen)d.requestFullscreen().catch(()=>{});toonWinnaar(a==='winnaar-proef');return}
  if(a==='nk-aan'){const c=clone(cfg());c.nakijken=el.dataset.v==='aan';saveConfig(c);toast(c.nakijken?'Nakijken staat aan: het bestuur ziet nu het tabblad Nakijken.':'Nakijken staat uit: het bestuur ziet alleen Vragen & antwoorden.');return}
  if(a==='verberg'){const c=clone(cfg());c.onthuld=false;saveConfig(c);toast('De uitslag is weer verborgen.');return}
  if(a==='add-regel'){const rid=el.dataset.rid,q=+el.dataset.q;const o=curVraag(rid,q);const id=newId();o.regels.push({id,tekst:'',punten:0});
    if(o.nummering==='enkel'&&o.regels.length>1)o.nummering='abc';S.pf=`e_${rid}_${q}_${id}_t`;saveVraag(rid,q,o);return}
  if(a==='del-regel'){if(!askConfirm(el.dataset.ck))return;const rid=el.dataset.rid,q=+el.dataset.q;const o=curVraag(rid,q);o.regels.splice(+el.dataset.k,1);saveVraag(rid,q,o);return}
  if(a==='vj-del'){const rid=el.dataset.rid,q=+el.dataset.q;const o=curVraag(rid,q);o.juryleden=juryNamen(rub(rid),o).filter(n=>n!==el.dataset.n);saveVraag(rid,q,o);return}
  if(a==='vj-reset'){const rid=el.dataset.rid,q=+el.dataset.q;const o=curVraag(rid,q);o.juryleden=null;saveVraag(rid,q,o);return}
  if(a==='rbj-del'){const c=clone(cfg());const r=c.rubrieken[+el.dataset.i];if(!r)return;r.juryleden=rubJury(r).filter(n=>n!==el.dataset.n);saveConfig(c);return}
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
function gotFresh(){if(!S.fresh){S.fresh=true;S.loadSlow=false;schedule()}}
// scores alleen ophalen als je mag nakijken (beheerder altijd, bestuur zodra Nakijken aan staat)
let scoreSub=null;
function volgScores(){if(!db)return;const mag=S.isOwner||nakijkenAan();
  if(mag&&!scoreSub)scoreSub=db.collection('scores').onSnapshot(qs=>{const o={};qs.docs.forEach(d=>{o[d.id]=d.data()});S.scores=o;schedule()},()=>{scoreSub=null});
  else if(!mag&&scoreSub){scoreSub();scoreSub=null;S.scores={}}}
function subscribe(){if(subscribed)return;subscribed=true;if(S.chat)volgChat();
  const err=e=>{if(e&&e.code==='permission-denied'){S.noAccess=true;S.canWrite=false}else S.loadSlow=true;schedule()};
  db.doc('beheer/config').onSnapshot(s=>{const d=s.exists?s.data():null;S.config=d&&Array.isArray(d.rubrieken)?metOverig(d):null;VC={};if(!s.metadata.fromCache)gotFresh();volgScores();schedule()},err);
  db.doc('beheer/teams').onSnapshot(s=>{S.teams=(s.exists&&s.data().teams)||{};schedule()},err);
  db.doc('beheer/jokers').onSnapshot(s=>{S.jokers=(s.exists&&s.data().j)||{};schedule()},err);
  if(S.isOwner&&S.backend==='firebase'){
    db.doc('beheer/toegang').onSnapshot(s=>{S.toegang=(s.exists&&s.data().emails)||[];schedule()},err);
    db.doc('beheer/bestuur').onSnapshot(s=>{S.bestuur=(s.exists&&s.data())||{};schedule()},err);
    db.collection('aanmeldingen').onSnapshot(qs=>{S.aanm=qs.docs.map(d=>d.data()).filter(x=>x&&x.naam);schedule()},err)}
  db.collection('vragen').onSnapshot(qs=>{const o={};qs.docs.forEach(d=>{o[d.id]=d.data()});S.vragen=o;VC={};schedule()},err);
  volgScores();
  setTimeout(()=>{if(!S.fresh&&!S.noAccess){S.loadSlow=true;schedule()}},10000);
}
/* ---------- wie is er nog meer online ---------- */
// elk geopend venster meldt zich elke minuut in online/<id>; wie 2,5 minuut niets liet horen, telt niet meer mee
const ONL_ID=(()=>{const n=()=>Math.random().toString(36).slice(2,10);try{let x=sessionStorage.getItem('gg_onl');if(!x){x=n();sessionStorage.setItem('gg_onl',x)}return x}catch(e){return n()}})();
let onlDocs=[],onlNaam='';
function onlineTxt(){const L=S.online;if(!L.length)return'';
  return `<span class="online" data-tip="Ook online: ${esc(L.join(', '))}"><span class="odot" aria-hidden="true"></span>${L.length===1?esc(L[0])+' is ook online':L.length+' anderen online'}</span>`}
function startOnline(naam){onlNaam=naam;const p='online/'+ONL_ID;const meld=()=>db.doc(p).set({naam,tijd:Date.now()}).catch(()=>{});
  meld();setInterval(meld,60000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')meld()});
  window.addEventListener('pagehide',()=>{db.doc(p).delete().catch(()=>{})});
  db.collection('online').onSnapshot(qs=>{onlDocs=qs.docs.map(d=>({id:d.id,...d.data()}));wieOnline()},()=>{});
  setInterval(wieOnline,20000)}
function wieOnline(){const nu=Date.now();
  // oude meldingen van vensters die zonder afmelden zijn gesloten opruimen
  for(const d of onlDocs)if(d.id!==ONL_ID&&nu-d.tijd>3600000)db.doc('online/'+d.id).delete().catch(()=>{});
  const L=[...new Set(onlDocs.filter(d=>d.id!==ONL_ID&&d.naam!==onlNaam&&Math.abs(nu-d.tijd)<150000).map(d=>String(d.naam||'Iemand')))].sort((a,b)=>a.localeCompare(b,'nl'));
  if(L.join('|')!==S.online.join('|')){S.online=L;schedule()}}

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
      S.dbOk=true;S.canWrite=true;subscribe();
      if(!onlNaam)startOnline(S.isBestuur?(S.naam||'Bestuurslid'):(u.displayName||S.email.split('@')[0]));
      render()});
    render();return}
  S.backend='lokaal';db=O.lokaleOpslag();db.doc('publiek/bestuur').onSnapshot(s=>{S.namen=(s.exists&&s.data().namen)||[];schedule()});S.dbOk=true;S.isOwner=true;S.canWrite=true;subscribe();render()}
init();
})();
