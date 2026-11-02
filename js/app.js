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
  beheer/toegang  emails: [ ... ]  wie mag invullen             (alleen beheerder)
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
  {id:'gh',naam:'Geheime opdracht',soort:'geheim',vragen:1,max:1000}
]};
const TABS=[['nakijken','Nakijken'],['vragen','Vragen & antwoorden'],['overzicht','Totaaloverzicht'],['uitslag','Uitslag']];
const BTABS=[['teams','Teams'],['jokers','Jokers'],['instellingen','Instellingen']];

const S={config:null,teams:{},jokers:{},vragen:{},scores:{},seen:{},fresh:false,
  isOwner:false,canWrite:true,backend:null,email:'',needLogin:false,noAccess:false,toegang:[],dbOk:null,loadSlow:false,saving:0,
  tab:'nakijken',rid:null,mode:'raster',team:null,confirm:null,pf:null};
const dirty=new Set(), Q={};
let db=null,VC={},subscribed=false;

try{S.rid=localStorage.getItem('gg_rid');S.mode=localStorage.getItem('gg_mode')||'raster';const t=+localStorage.getItem('gg_team');if(t)S.team=t;}catch(e){}
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
// rubrieknummer: de sponsorrubriek telt mee (die is rubriek 1), de geheime opdracht is G
function code(r){if(!r)return'?';if(r.soort==='geheim')return'G';let n=0;for(const x of rubs()){if(x.soort!=='geheim'){n++;if(x.id===r.id)return String(n)}}return'?'}
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
function teamTot(nr){let t=0;for(const r of rubs())t+=rubTot(r.id,nr)*(jokerOf(nr)===r.id?2:1);return t}
function progress(rid,nr){let d=0,a=0;for(const v of vragen(rid))for(const g of v.regels){a++;if(waarde(rid,nr,v,g)!=null)d++}return[d,a]}
function cls(w,max){if(w==null)return'';if(max>0&&w>=max)return'v-max';if(w===0)return'v-zero';return'v-part'}
function ranking(){const L=teams().map(t=>({...t,tot:teamTot(t.nr),crea:creaTot(t.nr)}));
  L.sort((a,b)=>b.tot-a.tot||b.crea-a.crea||a.nr-b.nr);let p=0;
  L.forEach((x,i)=>{if(i===0||x.tot!==L[i-1].tot||x.crea!==L[i-1].crea)p=i+1;x.place=p});return L}

/* ---------- opslaan ---------- */
function setStatus(){const el=document.getElementById('status');if(el)el.textContent=statusTxt()}
function statusTxt(){if(S.needLogin)return'Niet ingelogd';if(S.noAccess)return'Geen toegang';if(S.saving>0)return'Opslaan…';if(S.backend==='lokaal')return'Opgeslagen op deze computer ✓';if(S.saving>0)return'Opslaan…';return S.fresh?'':'Laden…'}
function enqueue(path,fn){if(!db)return;S.saving++;setStatus();
  Q[path]=(Q[path]||Promise.resolve()).then(fn).catch(onErr).finally(()=>{S.saving--;setStatus()})}
function onErr(e){const c=e&&e.code;
  if(c==='permission-denied'||c==='invalid_argument'){S.canWrite=false;toast('Opslaan lukte niet: je hebt geen rechten om dit te wijzigen. Vraag de beheerder om je e-mailadres toe te voegen.',true);schedule()}
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
function saveDoc(path,data){enqueue(path,()=>db.doc(path).set(data))}
function saveTeams(t){S.teams=t;schedule();saveDoc('beheer/teams',{teams:t})}
function saveJokers(j){S.jokers=j;schedule();saveDoc('beheer/jokers',{j:j})}
function saveConfig(c){S.config=c;VC={};schedule();saveDoc('beheer/config',c)}

/* ---------- toast & bevestigen ---------- */
let tt=0;function toast(msg,bad){const el=document.getElementById('toast');el.textContent=msg;el.className='show'+(bad?' bad':'');clearTimeout(tt);tt=setTimeout(()=>{el.className=''},bad?5200:2600)}
function askConfirm(key){if(S.confirm===key){S.confirm=null;return true}S.confirm=key;schedule();setTimeout(()=>{if(S.confirm===key){S.confirm=null;schedule()}},4000);return false}

/* ---------- render ---------- */
let raf=0;function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;render()})}
function render(){VC={};
  const a=document.activeElement;let f=null;
  if(a&&a.id&&$app.contains(a))f={id:a.id,val:a.value,s:null,e:null,tag:a.tagName};
  if(f&&f.tag==='INPUT'){try{f.s=a.selectionStart;f.e=a.selectionEnd}catch(e){}}
  const gw=$app.querySelector('.grid-wrap');const sc=gw?{l:gw.scrollLeft,t:gw.scrollTop}:null;
  $app.innerHTML=html();
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
  <div class="head-r"><div class="top-right"><span class="role">${role}</span><span id="status" class="status" aria-live="polite">${statusTxt()}</span>${S.email?`<span class="who" title="Ingelogd">${esc(S.email)}</span><button class="btn ghost" data-act="logout">Uitloggen</button>`:''}</div>
  ${S.needLogin?'':`<nav class="tabs" aria-label="Onderdelen">`}${S.needLogin?'':TABS.map(t=>tb(t)).join('')}${S.isOwner?'<span class="tabsep" aria-hidden="true"></span>'+BTABS.map(t=>tb(t,1)).join(''):''}${S.needLogin?'':'</nav>'}</div></div></header>`}
function notices(){let h='';
  if(S.backend==='lokaal')h+='<div class="notice"><b>Lokaal testen.</b> Firebase is nog niet ingesteld (js/firebase-config.js). Alles wordt alleen in deze browser bewaard.</div>';
  if(S.noAccess)h+=`<div class="notice bad"><b>Nog geen toegang.</b> Je bent ingelogd als ${esc(S.email)}, maar dit adres staat nog niet op de lijst. Vraag de beheerder om je e-mailadres toe te voegen. Daarna herlaad je de pagina.</div>`;
  else if(S.loadSlow&&!S.fresh)h+='<div class="notice">De gegevens zijn nog niet bereikbaar. Controleer je internetverbinding. De pagina probeert het zelf opnieuw.</div>';
  else if(S.dbOk&&!S.canWrite)h+='<div class="notice">Je kunt meekijken, maar niets wijzigen.</div>';
  return h}
function vLogin(){return `<div class="login">${OWL}<h2>Welkom bij de uitslagen</h2><p class="mut">Log in met je Google-account om vragen en scores in te vullen. Alles wordt direct opgeslagen.</p><button class="btn primary big" data-act="login">Inloggen met Google</button></div>`}
function view(){if(S.needLogin)return vLogin();if(S.noAccess)return '';let t=S.tab;if(BTABS.some(x=>x[0]===t)&&!S.isOwner)t='nakijken';
  return({nakijken:vNakijken,vragen:vVragen,overzicht:vOverzicht,uitslag:vUitslag,teams:vTeams,jokers:vJokers,instellingen:vInst}[t]||vNakijken)()}
function empty(t,p){return `<div class="empty"><h3>${t}</h3><p>${p}</p></div>`}
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
  let h=`<div class="grid-wrap"><table class="grid"><colgroup><col class="w1"><col class="w2"><col class="w3">${T.map(()=>'<col class="wt">').join('')}</colgroup>
  <thead><tr><th class="stk c1">#</th><th class="stk c2 tl">Vraag / opdracht</th><th class="stk c3">Punten</th>${T.map(t=>`<th class="ct" title="Team ${t.nr}"><span class="tnm">Team</span><span class="tn">${t.nr}${jokerOf(t.nr)===r.id?' <span class="jk" title="Joker op deze rubriek">★</span>':''}</span></th>`).join('')}</tr></thead><tbody>`;
  V.forEach((v,i)=>{
    h+=`<tr class="rq"><td class="stk c1">${pc}.${i+1}</td><td class="stk c2 tl" title="${esc(v.titel)}">${v.titel?esc(v.titel):'<i>Nog geen titel</i>'}</td><td class="stk c3">${v.punten}</td>${T.map(t=>`<td>${fmt(vraagScore(r.id,t.nr,v))}</td>`).join('')}</tr>`;
    v.regels.forEach((g,k)=>{const L=lab(v,k);
      if(v.soort==='creatief'){
        h+=`<tr class="rg"><td class="stk c1">${L}</td><td class="stk c2 tl" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Beoordeling</i>'} <span class="mut">· gemiddelde</span></td><td class="stk c3">0–${g.punten}</td>${T.map(t=>{const w=waarde(r.id,t.nr,v,g);return `<td class="${cls(w,g.punten)}">${fmt(w)}</td>`}).join('')}</tr>`;
        for(let j=1;j<=J;j++)h+=`<tr class="rj"><td class="stk c1"></td><td class="stk c2 tl">Jury ${j}</td><td class="stk c3">0–${g.punten}</td>${T.map(t=>`<td>${scoreInput('s',r,t,v,g,j,'gi')}</td>`).join('')}</tr>`;
      }else{
        h+=`<tr><td class="stk c1">${L}</td><td class="stk c2 tl" title="${esc(g.tekst)}">${g.tekst?esc(g.tekst):'<i>Antwoord nog niet ingevuld</i>'}</td><td class="stk c3">${g.punten}</td>${T.map(t=>{const w=waarde(r.id,t.nr,v,g);return `<td class="${cls(w,g.punten)}">${scoreInput('s',r,t,v,g,0,'gi')}</td>`}).join('')}</tr>`;
      }});
  });
  const anyJ=isN&&T.some(t=>jokerOf(t.nr)===r.id);
  h+=`</tbody><tfoot><tr class="trow${anyJ?'':' solo'}"><td class="stk c1"></td><td class="stk c2 tl">Totaal rubriek</td><td class="stk c3">${r.max}</td>${T.map(t=>`<td>${rubTot(r.id,t.nr)}</td>`).join('')}</tr>`;
  if(anyJ)h+=`<tr class="jrow"><td class="stk c1">★</td><td class="stk c2 tl">Met joker (×2)</td><td class="stk c3"></td>${T.map(t=>`<td>${jokerOf(t.nr)===r.id?rubTot(r.id,t.nr)*2:''}</td>`).join('')}</tr>`;
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
  let h=`<div class="toolbar">${rubSelect()}</div>`+`<div class="rhead"><div><h2>${pc} · ${esc(r.naam)}</h2><p class="mut">${V.length} ${V.length===1?'opdracht':'vragen en opdrachten'} · samen maximaal ${max} punten</p></div>${somBadge(som,max)}</div>`;
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
function vOverzicht(){const T=teams();const R=rubs();
  if(!T.length)return empty('Nog geen teams','Zodra er teams zijn, zie je hier per team de punten van elke rubriek.');
  let h=`<div class="rhead"><div><h2>Totaaloverzicht</h2><p class="mut">Punten per team per rubriek, op teamnummer</p></div><div class="legend"><span class="badge joker">★ Joker: score ×2</span></div></div>
  <div class="grid-wrap"><table class="grid"><colgroup><col class="w1"><col class="wn">${R.map(()=>'<col class="wr">').join('')}<col class="wr"></colgroup>
  <thead><tr><th class="stk c1">Team</th><th class="stk tl" style="left:var(--w1)">Naam</th>${R.map(r=>`<th title="${esc(r.naam)}">${code(r)}<span class="tnm">${esc(r.naam)}</span></th>`).join('')}<th>Totaal</th></tr></thead><tbody>`;
  T.forEach(t=>{const jk=jokerOf(t.nr);
    h+=`<tr><td class="stk c1"><b>${t.nr}</b></td><td class="stk tl" style="left:var(--w1)" title="${esc(t.naam)}">${esc(t.naam)}</td>${R.map(r=>{const s=rubTot(r.id,t.nr);return jk===r.id?`<td class="jc" title="Joker: ${s} × 2">★ ${s*2}</td>`:`<td>${s}</td>`}).join('')}<td><b>${teamTot(t.nr)}</b></td></tr>`});
  return h+'</tbody></table></div>'}
function vUitslag(){const L=ranking();
  if(!L.length)return empty('Nog geen uitslag','Er zijn nog geen teams aangemaakt.');
  let filled=0,all=0;for(const r of rubs())for(const t of L){const[d,a]=progress(r.id,t.nr);filled+=d;all+=a}
  const pct=all?Math.round(filled/all*100):0;
  let notes='';for(let i=0;i<Math.min(3,L.length-1);i++){const a=L[i],b=L[i+1];
    if(a.tot===b.tot){if(a.crea!==b.crea)notes+=`<div class="notice">Team ${a.nr} en team ${b.nr} hebben allebei ${a.tot} punten. Beslist op de creatieve opdrachten: ${a.crea} tegen ${b.crea}.</div>`;
      else notes+=`<div class="notice bad">Team ${a.nr} en team ${b.nr} staan precies gelijk, ook op de creatieve opdrachten (${a.crea}). Het bestuur moet zelf beslissen.</div>`}}
  const pod=L.slice(0,3).map((x,i)=>`<div class="pod p${i+1}"><span class="pl">${x.place}</span><span class="pt">${esc(teamLabel(x))}</span><span class="pp"><b>${x.tot}</b> punten</span></div>`);
  const order=pod.length===3?[pod[1],pod[0],pod[2]]:pod;
  let h=`<div class="rhead"><div><h2>Uitslag</h2><p class="mut">Bij gelijke punten wint het team met de hoogste score op de creatieve opdrachten.</p></div><span class="badge ${pct===100?'ok':'warn'}">Nakijken ${pct}% ingevuld</span></div>
  <div class="podium">${order.join('')}</div>${notes}
  <div class="grid-wrap" style="max-height:none"><table class="grid"><colgroup><col class="wr"><col class="w1"><col class="wn"><col class="wr"><col class="wr"><col class="wn"></colgroup>
  <thead><tr><th>Plaats</th><th>Team</th><th class="tl">Naam</th><th>Punten</th><th title="Creatieve opdrachten, voor gelijke stand">Creatief</th><th class="tl">Joker</th></tr></thead><tbody>`;
  L.forEach(x=>{const jk=jokerOf(x.nr);const r=jk&&rub(jk);
    h+=`<tr><td><b>${x.place}</b></td><td>${x.nr}</td><td class="tl" title="${esc(x.naam)}">${esc(x.naam)}</td><td><b>${x.tot}</b></td><td>${x.crea}</td><td class="tl">${r?'★ '+code(r)+' · '+esc(r.naam):'<span class="mut">–</span>'}</td></tr>`});
  return h+'</tbody></table></div>'}

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
  let h=`<div class="rhead"><div><h2>Jokers</h2><p class="mut">Elk team zet vóór de kwis één joker in. De score van die rubriek telt dubbel. Niet mogelijk op de sponsorrubriek en de geheime opdracht.</p></div><span class="badge ${n===T.length&&T.length?'ok':'warn'}">${n} van ${T.length} teams hebben een joker</span></div>`;
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
  ${S.backend==='firebase'?`<div class="panel"><h3>Toegang bestuur</h3><div class="pad"><p class="mut" style="margin:0">Google-adressen van bestuursleden die mogen invullen, één per regel. Wordt automatisch opgeslagen zodra je buiten het vak klikt.</p><textarea class="inp" id="toegang" data-act="toegang" rows="6" placeholder="naam@gmail.com">${esc((S.toegang||[]).join('\n'))}</textarea></div></div>`:''}
  <div class="panel"><h3>Rubrieken</h3><div class="lrow rb lhead"><span style="text-align:center">#</span><span>Naam</span><span class="soort">Soort</span><span>Vragen</span><span>Max punten</span><span></span></div>`;
  R.forEach((r,i)=>{const ck='drb_'+r.id;const on=S.confirm===ck;
    h+=`<div class="lrow rb"><span class="ln">${code(r)}</span><input class="inp" id="rn_${r.id}" data-act="rb" data-f="naam" data-i="${i}" value="${esc(r.naam)}" aria-label="Naam rubriek ${code(r)}"><span class="soort mut">${{sponsor:'Sponsor · geen joker',geheim:'Geheim · geen joker',normaal:'Normaal'}[r.soort]||''}</span>
    <input class="inp num" id="rv_${r.id}" data-act="rb" data-f="vragen" data-i="${i}" inputmode="numeric" value="${r.vragen}" aria-label="Aantal vragen"><input class="inp num" id="rm_${r.id}" data-act="rb" data-f="max" data-i="${i}" inputmode="numeric" value="${r.max}" aria-label="Maximaal aantal punten">
    ${r.soort==='normaal'?`<button class="ibtn${on?' danger':''}" data-act="rb-del" data-i="${i}" data-ck="${ck}" aria-label="Rubriek verwijderen">${on?'Zeker?':'✕'}</button>`:'<span></span>'}</div>`});
  h+=`<div class="efoot" style="padding-left:12px"><button class="btn" data-act="rb-add">+ Rubriek toevoegen</button><span class="mut">Een verwijderde rubriek verdwijnt uit de uitslag. Ingevulde punten blijven bewaard.</span></div></div>`;
  return h}

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
  if(el.tagName==='INPUT'){e.preventDefault();el.blur()}});
$app.addEventListener('change',e=>{const el=e.target;const a=el.dataset.act;if(!a)return;dirty.delete(el.id);const v=el.value;
  if(a==='score'){commitScore(el);return}
  if(a==='toegang'){const list=[...new Set(v.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>x.includes('@')))];saveToegang(list);toast(list.length+' adressen hebben toegang.');return}
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
  if(a==='tab'){S.tab=el.dataset.tab;try{history.replaceState(null,'','#'+S.tab)}catch(x){}render();window.scrollTo(0,0);return}
  if(a==='mode'){S.mode=el.dataset.m;store('gg_mode',S.mode);render();return}
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
  if(a==='rb-add'){const c=clone(cfg());let k=1;while(c.rubrieken.some(r=>r.id==='r'+k))k++;const gi=c.rubrieken.findIndex(r=>r.soort==='geheim');
    const nr={id:'r'+k,naam:'Nieuwe rubriek',soort:'normaal',vragen:7,max:1000};if(gi<0)c.rubrieken.push(nr);else c.rubrieken.splice(gi,0,nr);S.pf='rn_'+nr.id;saveConfig(c);return}
  if(a==='rb-del'){if(!askConfirm(el.dataset.ck))return;const c=clone(cfg());c.rubrieken.splice(+el.dataset.i,1);saveConfig(c);return}
});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if([...TABS,...BTABS].some(t=>t[0]===h)){S.tab=h;render()}});

/* ---------- opstarten ---------- */
function gotFresh(){if(!S.fresh){S.fresh=true;S.loadSlow=false;setStatus()}}
function subscribe(){if(subscribed)return;subscribed=true;
  const err=e=>{if(e&&e.code==='permission-denied'){S.noAccess=true;S.canWrite=false}else S.loadSlow=true;schedule()};
  db.doc('beheer/config').onSnapshot(s=>{const d=s.exists?s.data():null;S.config=d&&Array.isArray(d.rubrieken)?d:null;VC={};if(!s.metadata.fromCache)gotFresh();schedule()},err);
  db.doc('beheer/teams').onSnapshot(s=>{S.teams=(s.exists&&s.data().teams)||{};schedule()},err);
  db.doc('beheer/jokers').onSnapshot(s=>{S.jokers=(s.exists&&s.data().j)||{};schedule()},err);
  if(S.isOwner&&S.backend==='firebase')db.doc('beheer/toegang').onSnapshot(s=>{S.toegang=(s.exists&&s.data().emails)||[];schedule()},err);
  db.collection('vragen').onSnapshot(qs=>{const o={};qs.docs.forEach(d=>{o[d.id]=d.data()});S.vragen=o;VC={};schedule()},err);
  db.collection('scores').onSnapshot(qs=>{const o={};qs.docs.forEach(d=>{o[d.id]=d.data()});S.scores=o;schedule()},err);
  setTimeout(()=>{if(!S.fresh&&!S.noAccess){S.loadSlow=true;schedule()}},10000);
}
function init(){const O=window.GGOpslag;
  if(O.firebaseIngesteld()){const F=window.GG_FIREBASE;S.backend='firebase';
    firebase.initializeApp(F.config);
    firebase.auth().onAuthStateChanged(u=>{
      if(!u){S.needLogin=true;S.email='';render();return}
      S.needLogin=false;S.email=(u.email||'').toLowerCase();
      S.isOwner=S.email===String(F.beheerder||'').trim().toLowerCase();
      S.dbOk=true;S.canWrite=true;db=O.firebaseOpslag(firebase.firestore());subscribe();render()});
    render();return}
  S.backend='lokaal';db=O.lokaleOpslag();S.dbOk=true;S.isOwner=true;S.canWrite=true;subscribe();render()}
init();
})();
