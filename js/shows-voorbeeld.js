/*
  VOORBEELDPAGINA WINNAAR-SHOWS (shows.html)

  Losse pagina om tien varianten van de winnaar-show te bekijken en er één uit te kiezen.
  Dit hoort (nog) niet bij de app: er wordt niets opgeslagen en de echte uitslag wordt niet gebruikt.
  Alle shows spelen met verzonnen voorbeeldteams (DEMO).
*/
(function(){
"use strict";
const OWL='<img class="owl" src="img/uil.png" alt="Logo Genneps Gewiekste">';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cfg(){return{naam:'Genneps Gewiekste',editie:'6e editie'}}

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
async function toonWinnaar(id){if(SH)return;const L=DEMO,demo=true;
  const c=cfg(),X=showOf(id),zin=X.zin||ZIN,nm=x=>esc(x.naam||'Team '+x.nr),kop=`<div class="sh-kop">${esc(c.naam||'Genneps Gewiekste')}${c.editie?' · '+esc(c.editie):''}</div>`;
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
  }catch(e){if(e!==0)throw e}}

/* ---------- de pagina: tien kaartjes met een knop om de show te bekijken ---------- */
document.getElementById('lijst').innerHTML=SHOWS.map((x,i)=>`<article class="vb-kaart"><div class="vb-voorbeeld show t-${x.id}" aria-hidden="true"><div class="sh-licht"></div><div class="sh-deco"></div><span>${i+1}</span></div>
  <div class="vb-tekst"><h2><span class="vb-nr">${i+1}.</span> ${esc(x.naam)}</h2><p>${esc(x.uitleg)}</p></div>
  <button class="btn primary big" data-show="${x.id}">▶ Bekijk show ${i+1}</button></article>`).join('');
document.getElementById('lijst').addEventListener('click',e=>{const b=e.target.closest('[data-show]');if(!b)return;
  const d=document.documentElement;if(!document.fullscreenElement&&d.requestFullscreen)d.requestFullscreen().catch(()=>{});
  toonWinnaar(b.dataset.show)});
})();
