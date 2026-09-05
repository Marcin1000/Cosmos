const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
const OUT = require('../pomoc').KATALOG_ZRZUTOW;
let B;
async function ov(p,l){const r=await p.evaluate(()=>({s:document.documentElement.scrollWidth,i:window.innerWidth}));
  console.log(`  [${l}] ${r.s>r.i+1?'PRZEWIJANIE POZIOME ⚠':'brak overflow'}`);return r.s>r.i+1;}
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  B = ADRES;
  const b=await przegladarka();
  let bad=0;
  // desktop
  let c=await b.newContext({viewport:{width:1440,height:900}}); let p=await c.newPage();
  await p.goto(B,{waitUntil:'load'}); await p.waitForTimeout(500);
  bad+=await ov(p,'czat');
  await p.click('#learn-btn'); await p.waitForTimeout(300);
  await p.click('[data-learn-tab="ideas"]'); await p.waitForTimeout(400);
  await p.screenshot({path:`${OUT}/au-ideas.png`}); bad+=await ov(p,'Nauka→Pomysły');
  await p.click('#imp-caps'); await p.waitForTimeout(700);
  const caps=await p.textContent('#imp-out');
  console.log('  „Pokaż co potrafisz" zwróciło',caps.trim().length,'znaków, zaczyna się od:',JSON.stringify(caps.trim().slice(0,42)));
  await p.screenshot({path:`${OUT}/au-caps.png`});
  await p.click('#learn-close'); await p.waitForTimeout(200);
  await p.click('#settings-btn'); await p.waitForTimeout(400);
  await p.evaluate(()=>{const m=document.querySelector('#settings-modal .modal-body');m.scrollTop=m.scrollHeight*0.55;});
  await p.waitForTimeout(300); await p.screenshot({path:`${OUT}/au-settings-dev.png`});
  bad+=await ov(p,'Ustawienia');
  await c.close();
  // mobile
  c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); p=await c.newPage();
  await p.goto(B,{waitUntil:'load'}); await p.waitForTimeout(500);
  bad+=await ov(p,'mobile czat');
  await p.evaluate(()=>document.getElementById('learn-modal').style.display='');
  await p.evaluate(()=>{document.querySelectorAll('[data-learn-tab]').forEach(x=>x.classList.remove('active'));
    document.getElementById('learn-pane-recog').style.display='none';
    document.getElementById('learn-pane-ideas').style.display='';});
  await p.waitForTimeout(300); await p.screenshot({path:`${OUT}/au-mobile-ideas.png`});
  bad+=await ov(p,'mobile Pomysły');
  await c.close(); await b.close();
  console.log(bad?'  ⚠ znaleziono problemy':'  ✓ layout czysty we wszystkich widokach');
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
