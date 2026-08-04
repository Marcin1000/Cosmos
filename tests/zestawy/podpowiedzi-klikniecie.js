const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  const b=await przegladarka();
  const c=await b.newContext({viewport:{width:1440,height:900}}); const p=await c.newPage();
  await p.goto(`${ADRES}`,{waitUntil:'networkidle'}); await p.waitForTimeout(500);
  const label=await p.textContent('.suggestion:nth-child(1)');
  await p.click('.suggestion:nth-child(1)');
  await p.waitForTimeout(1200);
  const userMsg=await p.textContent('.msg-user .msg-content').catch(()=>'(none)');
  console.log('  clicked:',JSON.stringify(label.trim()));
  console.log('  user message in chat:',JSON.stringify(userMsg.trim().slice(0,70)));
  console.log('  welcome hidden:', await p.evaluate(()=>{const w=document.getElementById('welcome');return !w||w.style.display==='none'||getComputedStyle(w).display==='none';}));
  await b.close(); console.log('DONE');
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
