/*
  OPSLAG — hier staat hoe de app gegevens bewaart.

  Er zijn twee manieren:
  1. Firebase (online, gedeeld met het hele bestuur, live bijgewerkt)
     -> wordt gebruikt zodra js/firebase-config.js is ingevuld.
  2. Lokaal (alleen in deze browser, om te testen)
     -> wordt gebruikt zolang Firebase nog niet is ingevuld.

  Beide geven precies dezelfde "knoppen" aan app.js:
    db.doc("map/document")   -> get(), set(data), update(data), onSnapshot(callback)
    db.collection("map")     -> onSnapshot(callback)
  update() voegt samen (merge): alleen wat je meegeeft wordt veranderd.
*/
(function(){
"use strict";

/* ---------- 1. Lokaal (localStorage) ---------- */
function lokaleOpslag(){
  const SLEUTEL='gg_lokaal';
  let data={};
  try{data=JSON.parse(localStorage.getItem(SLEUTEL)||'{}')}catch(e){}
  const luisteraars=[];
  const bewaar=()=>{
    try{localStorage.setItem(SLEUTEL,JSON.stringify(data))}catch(e){console.error('Opslaan in de browser lukte niet',e)}
    luisteraars.forEach(f=>f());
  };
  const kopie=d=>JSON.parse(JSON.stringify(d));
  const samenvoegen=(a,b)=>{
    for(const k in b){
      const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
      if(isObj(b[k])&&isObj(a[k]))samenvoegen(a[k],b[k]);else a[k]=b[k];
    }
    return a;
  };
  const snap=p=>({id:p.split('/').pop(),exists:p in data,data:()=>data[p],metadata:{fromCache:false,hasPendingWrites:false}});
  return{
    soort:'lokaal',
    doc:p=>({
      get:async()=>snap(p),
      set:async d=>{data[p]=kopie(d);bewaar()},
      update:async d=>{data[p]=samenvoegen(data[p]||{},kopie(d));bewaar()},
      onSnapshot:cb=>{const f=()=>cb(snap(p));luisteraars.push(f);setTimeout(f,0);return()=>{}}
    }),
    collection:c=>({
      onSnapshot:cb=>{
        const f=()=>cb({docs:Object.keys(data).filter(k=>k.startsWith(c+'/')&&k.split('/').length===2).map(snap)});
        luisteraars.push(f);setTimeout(f,0);return()=>{};
      }
    })
  };
}

/* ---------- 2. Firebase Firestore ---------- */
function firebaseOpslag(fs){
  const omzetten=s=>({id:s.id,exists:s.exists,data:()=>s.data(),metadata:s.metadata});
  return{
    soort:'firebase',
    doc:p=>{const ref=fs.doc(p);return{
      get:()=>ref.get().then(omzetten),
      set:d=>ref.set(d),
      // set met merge = alleen de meegegeven velden aanpassen, de rest blijft staan
      update:d=>ref.set(d,{merge:true}),
      onSnapshot:(cb,fout)=>ref.onSnapshot(s=>cb(omzetten(s)),fout)
    }},
    collection:c=>({
      onSnapshot:(cb,fout)=>fs.collection(c).onSnapshot(q=>cb({docs:q.docs.map(omzetten)}),fout)
    })
  };
}

/* Is firebase-config.js ingevuld? */
function firebaseIngesteld(){
  const F=window.GG_FIREBASE;
  return !!(F&&F.config&&F.config.apiKey&&!/^VUL/i.test(F.config.apiKey)&&window.firebase);
}

window.GGOpslag={lokaleOpslag,firebaseOpslag,firebaseIngesteld};
})();
