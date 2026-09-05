const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
const OUT = require('../pomoc').KATALOG_ZRZUTOW;
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  const b=await przegladarka();
  // desktop
  let c=await b.newContext({viewport:{width:1440,height:900}}); let p=await c.newPage();
  await p.goto(`${ADRES}`,{waitUntil:'load'}); await p.waitForTimeout(600);
  await p.locator('#suggestions').screenshot({path:`${OUT}/sug-desktop.png`});
  const align=await p.evaluate(()=>getComputedStyle(document.querySelector('.suggestion')).textAlign);
  console.log('  computed text-align:',align);
  // click a suggestion -> should fill input
  await p.click('.suggestion:nth-child(3)');
  await p.waitForTimeout(300);
  const val=await p.inputValue('#input').catch(()=>'(no #input)');
  console.log('  after click, input =',JSON.stringify(val.slice(0,60)));
  // narrow viewport (buttons wrap to 2 lines) to check centering when wrapped
  await c.close();
  c=await b.newContext({viewport:{width:420,height:900}}); p=await c.newPage();
  await p.goto(`${ADRES}`,{waitUntil:'load'}); await p.waitForTimeout(600);
  await p.locator('#suggestions').screenshot({path:`${OUT}/sug-narrow.png`});
  const over=await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  console.log('  narrow horiz overflow:',over?'YES':'no');
  await c.close(); await b.close(); console.log('DONE');
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
