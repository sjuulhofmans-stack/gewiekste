/*
  ANTWOORDBLADEN ALS PDF
  Maakt de antwoordbladen van de rubrieken als pdf, met jsPDF (wordt pas geladen bij de eerste download).
  - leeg:      formaat van het kader in het kwisboek; bovenaan elke bladzijde vakken voor teamnaam en teamnummer
  - ingevuld:  A4, met de juiste antwoorden, om op de website te zetten
  Maten in punten (pt); 1 mm = 2,835 pt. Rijhoogte en nummerkolom zijn gelijk aan de oude Word-versie.
*/
(function(){
"use strict";
const MM=72/25.4;
const GRIJS='#C8C8C8';           // kleur als er bij de rubriek niets is gekozen
const ROW=26, HEAD=20, NRW=34;   // regel, kopregel en nummerkolom (zoals in Word)
const LIJN=[90,90,90];
let laden=null;

function laad(){if(window.jspdf&&window.jspdf.jsPDF)return Promise.resolve();if(laden)return laden;
  laden=new Promise((ok,nee)=>{const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=ok;s.onerror=()=>{laden=null;s.remove();nee(new Error('jsPDF laden mislukt'))};document.head.appendChild(s)});
  return laden}

function rgb(hex){if(!/^#[0-9a-f]{6}$/i.test(hex||''))hex=GRIJS;return[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))}
// zwarte of witte letters op de gekleurde balk, wat het best leesbaar is
function inkt(c){const L=c.map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});
  return .2126*L[0]+.7152*L[1]+.0722*L[2]>.179?[0,0,0]:[255,255,255]}
// de standaardletters van pdf kennen geen ‘slimme’ aanhalingstekens en lange streepjes
const tk=s=>String(s==null?'':s).replace(/[‘’‚′]/g,"'").replace(/[“”„]/g,'"')
  .replace(/[–—]/g,'-').replace(/…/g,'...').replace(/[^\x00-\xFF]/g,'');

/* o = {rubrieken:[{code,naam,kleur,vragen:[{nr,titel,creatief,regels:[{label,tekst}]}]}],
        ingevuld:true|false, formaat:{b,h} in mm (alleen leeg), bestand:'naam.pdf'} */
function maak(o){const{jsPDF}=window.jspdf;
  const W=o.formaat?o.formaat.b*MM:595.28, H=o.formaat?o.formaat.h*MM:841.89, OR=W>H?'landscape':'portrait';
  const M=o.formaat?4*MM:18*MM;          // marge: in het kader klein, op A4 normaal
  const X0=M, X1=W-M, TW=X1-X0;
  const doc=new jsPDF({unit:'pt',format:[W,H],orientation:OR,compress:true});
  doc.setLineWidth(.6);doc.setDrawColor(...LIJN);
  let y=0, eerste=true, R=null, kl=null, ink=null;
  const kopH=o.ingevuld?32:68;          // hoogte van titel (en teamvakken) bovenaan elke bladzijde
  const ruimte=()=>H-M-y;

  function pagina(){if(!eerste)doc.addPage([W,H],OR);eerste=false;y=M;
    const t=tk((o.ingevuld?'Antwoorden':'Antwoordenblad')+' rubriek '+R.code+' - '+R.naam);
    doc.setFont('helvetica','bold');doc.setTextColor(0);let fs=16;doc.setFontSize(fs);
    while(fs>10&&doc.getTextWidth(t)>TW){fs-=.5;doc.setFontSize(fs)}
    doc.text(t,W/2,y+13,{align:'center'});y+=28;
    if(!o.ingevuld){// vakken om teamnaam en teamnummer in te schrijven
      const h=30, nrB=Math.min(130,TW*.3), gat=10;
      doc.setLineWidth(1);doc.setDrawColor(0);
      doc.rect(X0,y,TW-nrB-gat,h);doc.rect(X1-nrB,y,nrB,h);
      doc.setFontSize(11);doc.text('Teamnaam:',X0+7,y+h/2+4);doc.text('Team nr.:',X1-nrB+7,y+h/2+4);
      doc.setLineWidth(.6);doc.setDrawColor(...LIJN);y+=h+10}
    else y+=4}

  function vraagKop(v,verv){doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(0);
    doc.text(tk(v.nr),X0,y+13);
    const t=doc.splitTextToSize(tk(v.titel||'')+(verv?' (vervolg)':''),TW-60)[0]||'';doc.text(t,X0+60,y+13);y+=20}

  function balk(x,w,h,txt){doc.setFillColor(...kl);doc.rect(x,y,w,h,'FD');
    if(txt){doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(...ink);
      const L=doc.splitTextToSize(tk(txt),w-12);doc.text(L,x+6,y+(h-(L.length-1)*12)/2+3.5)}}

  function antwoordVraag(v){const nr=v.regels.some(g=>g.label);const ax=nr?X0+NRW:X0, aw=X1-ax;
    doc.setFont('helvetica','normal');doc.setFontSize(11);
    const R2=v.regels.map(g=>{const L=o.ingevuld&&g.tekst?doc.splitTextToSize(tk(g.tekst),aw-12):[];return{g,L,h:Math.max(ROW,L.length*13+10)}});
    const kop=()=>{doc.setFillColor(...kl);doc.rect(X0,y,TW,HEAD,'FD');if(nr)doc.line(ax,y,ax,y+HEAD);
      doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(...ink);doc.text('Antwoord:',ax+6,y+HEAD/2+3.5);y+=HEAD};
    // past de hele vraag niet meer, maar wel op een nieuwe bladzijde? dan daar beginnen (niet in tweeën knippen)
    const heel=8+20+HEAD+R2.reduce((s,r)=>s+r.h,0);
    if(ruimte()<8+20+HEAD+(R2[0]?R2[0].h:0)||(ruimte()<heel&&heel<=H-M-M-kopH))pagina();else if(y>M+kopH)y+=8;
    vraagKop(v,false);kop();
    for(const r of R2){
      if(ruimte()<r.h){pagina();vraagKop(v,true);kop()}
      doc.rect(X0,y,TW,r.h);if(nr)doc.line(ax,y,ax,y+r.h);doc.setTextColor(0);
      if(r.g.label){doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text(tk(r.g.label),X0+NRW/2,y+r.h/2+4,{align:'center'})}
      if(r.L.length){doc.setFont('helvetica','normal');doc.setFontSize(11);doc.text(r.L,ax+6,y+(r.h-(r.L.length-1)*13)/2+4)}
      y+=r.h}}

  function creatieveVraag(v){const w=v.regels.map(g=>g.tekst).filter(Boolean);
    const txt='Creatieve opdracht'+(w.length?' - beoordeeld op: '+w.join(', '):'. Hier hoef je niets in te vullen.');
    doc.setFont('helvetica','bold');doc.setFontSize(10);const h=Math.max(ROW+8,doc.splitTextToSize(tk(txt),TW-12).length*12+16);
    if(ruimte()<8+20+h)pagina();else if(y>M+kopH)y+=8;
    vraagKop(v,false);balk(X0,TW,h,txt);y+=h}

  for(const r of o.rubrieken){R=r;kl=rgb(r.kleur);ink=inkt(kl);pagina();
    if(!r.vragen.length){doc.setFont('helvetica','italic');doc.setFontSize(11);doc.setTextColor(100);doc.text('Nog geen vragen ingevuld bij deze rubriek.',X0,y+14);continue}
    for(const v of r.vragen)v.creatief?creatieveVraag(v):antwoordVraag(v)}
  doc.save(o.bestand||'antwoordbladen.pdf')}

window.GGAntwoordblad={laad,maak,GRIJS};
})();
