import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';
let store={rev:0,state:null,updatedAt:null};
const api=http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  const h={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  let j={};try{j=JSON.parse(b||'{}')}catch(e){}
  if(j.action==='get'){s.writeHead(200,h);return s.end(JSON.stringify({ok:true,...store}))}
  if(j.action==='put'){store={rev:store.rev+1,state:j.state,updatedAt:new Date().toISOString()};s.writeHead(200,h);return s.end(JSON.stringify({ok:true,rev:store.rev,updatedAt:store.updatedAt}))}
  if(j.action==='patch'){
    if(!store.state){s.writeHead(200,h);return s.end(JSON.stringify({ok:false,error:'Nothing stored yet - push a full copy first'}))}
    const st=store.state;
    (j.scopes||[]).forEach(sc=>{
      if(sc.upserts||sc.deletes){
        const touched={}; (sc.upserts||[]).forEach(r=>touched[r.agent]=1); (sc.deletes||[]).forEach(a=>touched[a]=1);
        st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area&&touched[r.agent]));
        (sc.upserts||[]).forEach(r=>st.records.push(r)); return;
      }
      st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area));
      (sc.records||[]).forEach(r=>st.records.push(r));});
    if(j.roster){if(j.roster.teams)st.teams=j.roster.teams;if(j.roster.inactive)st.inactive=j.roster.inactive;}
    store={rev:store.rev+1,state:st,updatedAt:new Date().toISOString()};
    s.writeHead(200,h);return s.end(JSON.stringify({ok:true,rev:store.rev,updatedAt:store.updatedAt}))}
  s.writeHead(200,h);s.end('{}')})});
await new Promise(r=>api.listen(8910,r));
const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/, q.url.includes('sync')?"var DEFAULT_API_URL = 'http://localhost:8910/exec'":"var DEFAULT_API_URL = ''")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/"))});
await new Promise(r=>web.listen(8911,r));

const res=[]; const check=(n,c,d)=>res.push({n,c:!!c,d:c?'':(d||'')});
const b=await chromium.launch();
async function open(sync){const p=await (await b.newContext()).newPage();
  p.on('pageerror',e=>res.push({n:'JS ERROR',c:false,d:e.message}));
  await p.goto('http://localhost:8911/'+(sync?'?sync=1':'')); await p.waitForTimeout(250);
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(sync?1100:350); return p;}
const grid=async(p,week,team,area)=>{await p.click('[data-view="assess"]');await p.waitForTimeout(250);
  await p.fill('#assessWeek',week);await p.selectOption('#assessTeam',team);await p.selectOption('#assessArea',area);await p.waitForTimeout(280);};
const mark=(p,agent,lvl)=>p.$eval(`#weeklyGrid [data-agent="${agent}"] .level-btn[data-level="${lvl}"]`,e=>e.click());
const recs=(p,week,area)=>p.evaluate(([w,a])=>state.records.filter(r=>r.week===w&&(r.area||'')===a).map(r=>r.agent+':'+r.level).sort(),[week,area]);

const W='2026-09-18', TEAM='Team Lipika', AREA='Objection Handling';

// ---------- A. partial save then a second partial save ----------
{
  const p=await open(false);
  await grid(p,W,TEAM,AREA);
  await mark(p,'Kirti',1); await mark(p,'Sadaf',3);
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  check('first partial save writes only the marked agents', JSON.stringify(await recs(p,W,AREA))===JSON.stringify(['Kirti:1','Sadaf:3']), JSON.stringify(await recs(p,W,AREA)));
  // latecomers arrive: Reset Form, then mark only the two who were absent
  await grid(p,W,TEAM,AREA);
  await p.click('#clearTeamForm'); await p.waitForTimeout(250);
  check('Reset Form reloads saved marks instead of wiping them',
    (await p.$$('#weeklyGrid .level-btn.selected')).length===2);
  await mark(p,'Lipika',4); await mark(p,'Sukhpreet',2);
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  check('THE BUG YOU FOUND: earlier scores survive a later partial save',
    JSON.stringify(await recs(p,W,AREA))===JSON.stringify(['Kirti:1','Lipika:4','Sadaf:3','Sukhpreet:2']), JSON.stringify(await recs(p,W,AREA)));
  await p.context().close();
}

// ---------- B. toggle off to clear a single agent ----------
{
  const p=await open(false);
  await grid(p,W,TEAM,AREA);
  await mark(p,'Kirti',1); await mark(p,'Sadaf',3);
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  await grid(p,W,TEAM,AREA);
  check('a saved level shows as selected', await p.$eval(`#weeklyGrid [data-agent="Kirti"] .level-btn[data-level="1"]`,e=>e.classList.contains('selected')));
  await mark(p,'Kirti',1);   // click the selected one again
  check('clicking the selected level again deselects it',
    await p.$eval(`#weeklyGrid [data-agent="Kirti"]`,e=>!e.querySelector('.level-btn.selected')));
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  check('toggling off deletes only that agent, leaves the rest',
    JSON.stringify(await recs(p,W,AREA))===JSON.stringify(['Sadaf:3']), JSON.stringify(await recs(p,W,AREA)));
  await p.context().close();
}

// ---------- C. the stale second leader ----------
{
  store={rev:0,state:null,updatedAt:null};
  const seed=await open(true);
  await seed.click('[data-view="settings"]'); await seed.waitForTimeout(300);
  await seed.click('#syncPushBtn'); await seed.waitForTimeout(2200);

  const A=await open(true), B=await open(true);   // both now hold the same baseline
  await new Promise(r=>setTimeout(r,1200));

  // leader A scores three agents and syncs
  await grid(A,W,TEAM,AREA);
  await mark(A,'Kirti',1); await mark(A,'Sadaf',3); await mark(A,'Sukhpreet',2);
  await A.click('#saveWeekBtn'); await new Promise(r=>setTimeout(r,3000));
  check('leader A three reach the sheet', store.state.records.filter(r=>r.week===W).length===3, String(store.state.records.filter(r=>r.week===W).length));

  // leader B never pulled A's work - marks two others and saves
  await B.evaluate(()=>{ if(window.__pollOff) return; });
  await grid(B,W,TEAM,AREA);
  const bSees=await B.$$eval('#weeklyGrid .level-btn.selected',e=>e.length);
  await mark(B,'Lipika',4); await mark(B,'Priyanka Sunil',3);
  await B.click('#saveWeekBtn'); await new Promise(r=>setTimeout(r,3500));
  const onSheet=store.state.records.filter(r=>r.week===W).map(r=>r.agent+':'+r.level).sort();
  check('THE STALE-LEADER CASE: leader A entries survive leader B save',
    JSON.stringify(onSheet)===JSON.stringify(['Kirti:1','Lipika:4','Priyanka Sunil:3','Sadaf:3','Sukhpreet:2']),
    'B had '+bSees+' marks preloaded; sheet now: '+JSON.stringify(onSheet));
  await A.context().close(); await B.context().close(); await seed.context().close();
}

console.log('');
let pass=0,fail=0;
res.forEach(r=>{ r.c?pass++:fail++; console.log(`  ${r.c?'PASS':'FAIL'}  ${r.n}${r.d?'  -> '+r.d:''}`)});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await b.close(); api.close(); web.close();
