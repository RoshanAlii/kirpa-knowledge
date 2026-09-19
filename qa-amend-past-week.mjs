import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';
let store={rev:0,state:null,updatedAt:null};
const api=http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  const h={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  let j={};try{j=JSON.parse(b||'{}')}catch(e){}
  const send=o=>{s.writeHead(200,h);s.end(JSON.stringify(o))};
  if(j.action==='head') return send({ok:true,rev:store.rev,updatedAt:store.updatedAt});
  if(j.action==='get')  return send({ok:true,...store});
  if(j.action==='put'){store={rev:store.rev+1,state:j.state,updatedAt:new Date().toISOString()};return send({ok:true,rev:store.rev,updatedAt:store.updatedAt})}
  if(j.action==='patch'){
    if(!store.state) return send({ok:false,error:'Nothing stored yet - push a full copy first'});
    const st=store.state;
    (j.scopes||[]).forEach(sc=>{
      if(sc.upserts||sc.deletes){const t={};(sc.upserts||[]).forEach(r=>t[r.agent]=1);(sc.deletes||[]).forEach(a=>t[a]=1);
        st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area&&t[r.agent]));
        (sc.upserts||[]).forEach(r=>st.records.push(r));return;}
      st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area));
      (sc.records||[]).forEach(r=>st.records.push(r));});
    if(j.roster){if(j.roster.teams)st.teams=j.roster.teams;if(j.roster.inactive)st.inactive=j.roster.inactive;}
    store={rev:store.rev+1,state:st,updatedAt:new Date().toISOString()};
    return send({ok:true,rev:store.rev,updatedAt:store.updatedAt});}
  send({ok:true});})});
await new Promise(r=>api.listen(8950,r));
const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/,"var DEFAULT_API_URL = 'http://localhost:8950/exec'")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/"))});
await new Promise(r=>web.listen(8951,r));

const res=[]; const check=(n,c,d)=>res.push({n,c:!!c,d:c?'':(d||'')});
const b=await chromium.launch(); const p=await (await b.newContext()).newPage();
p.on('pageerror',e=>res.push({n:'JS ERROR',c:false,d:e.message}));
await p.goto('http://localhost:8951/'); await p.waitForTimeout(250);
await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(1200);
await p.click('[data-view="settings"]'); await p.waitForTimeout(250);
await p.click('#syncPushBtn'); await p.waitForTimeout(2500);

const OLD='2026-09-11', NEW='2026-09-25', TM='Team Kamal', AR='Overall / General Knowledge (Imported Paper)';
// add a later week so we are genuinely amending a PAST week, not the newest one
await p.click('[data-view="assess"]'); await p.waitForTimeout(300);
await p.fill('#assessWeek',NEW); await p.selectOption('#assessTeam',TM); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(300);
await p.$eval('#weeklyGrid [data-agent="Karan"] .level-btn[data-level="4"]',e=>e.click());
await p.click('#saveWeekBtn'); await p.waitForTimeout(3000);

// --- the actual question: fix a wrong rating on the OLD week ---
// route 1: pick the week in the top filter, then open Assess
await p.selectOption('#weekFilter',OLD); await p.waitForTimeout(400);
await p.click('[data-view="assess"]'); await p.waitForTimeout(400);
check('opening Assess carries the week chosen in the top filter',
  (await p.inputValue('#assessWeek'))===OLD, 'assessWeek='+await p.inputValue('#assessWeek'));
await p.selectOption('#assessTeam',TM); await p.selectOption('#assessArea',AR); await p.waitForTimeout(400);
check('the past week shows its saved ratings pre-selected',
  await p.$eval('#weeklyGrid [data-agent="Mona"] .level-btn[data-level="1"]',e=>e.classList.contains('selected')));

const before=await p.evaluate(([w,a])=>state.records.filter(r=>r.week===w&&(r.area||'')===a).map(r=>r.agent+':'+r.level).sort(),[OLD,AR]);
// Mona was recorded Poor; suppose that was wrong and she was Good
await p.$eval('#weeklyGrid [data-agent="Mona"] .level-btn[data-level="3"]',e=>e.click());
await p.$eval('#weeklyGrid [data-agent="Mona"] .comment-input',e=>{e.value='Corrected: was logged Poor in error.';e.dispatchEvent(new Event('input',{bubbles:true}))});
await p.click('#saveWeekBtn'); await p.waitForTimeout(3500);

const after=await p.evaluate(([w,a])=>state.records.filter(r=>r.week===w&&(r.area||'')===a).map(r=>r.agent+':'+r.level).sort(),[OLD,AR]);
check('the corrected rating is updated in place, not duplicated',
  after.filter(x=>x.startsWith('Mona:')).length===1 && after.includes('Mona:3'), JSON.stringify(after));
check('every other agent in that week is untouched',
  before.filter(x=>!x.startsWith('Mona:')).join()===after.filter(x=>!x.startsWith('Mona:')).join(),
  'before '+JSON.stringify(before)+' after '+JSON.stringify(after));
check('the correction reached the sheet',
  store.state.records.some(r=>r.week===OLD&&r.agent==='Mona'&&r.level===3&&/Corrected/.test(r.comment||'')));
check('the newer week is unaffected by amending the old one',
  store.state.records.some(r=>r.week===NEW&&r.agent==='Karan'&&r.level===4));
const total=store.state.records.length;
check('no extra record was created anywhere', total===20, 'sheet holds '+total+' (19 paper + 1 new week)');

// does the correction flow through to derived views?
await p.selectOption('#weekFilter',NEW); await p.waitForTimeout(500);
await p.click('[data-view="assess"]'); await p.waitForTimeout(300);
await p.fill('#assessWeek',NEW); await p.selectOption('#assessTeam',TM); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(400);
const tag=await p.$eval('#weeklyGrid .assessment-person[data-agent="Mona"]',e=>(e.querySelector('.level-btn.prev')||{}).textContent||null);
check('the "last time" marker reflects the corrected value', tag==='Good', 'marker shows '+tag);

console.log('');
let pass=0,fail=0; res.forEach(r=>{r.c?pass++:fail++;console.log(`  ${r.c?'PASS':'FAIL'}  ${r.n}${r.d?'  -> '+r.d:''}`)});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await b.close(); api.close(); web.close();
