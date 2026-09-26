import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';
let store={rev:0,state:null,updatedAt:null};
let delayGets=0;                          // hold GET replies open to create the race
const api=http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  const h={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  let j={};try{j=JSON.parse(b||'{}')}catch(e){}
  const send=o=>{s.writeHead(200,h);s.end(JSON.stringify(o))};
  if(j.action==='get'){
    const snap={ok:true,rev:store.rev,state:JSON.parse(JSON.stringify(store.state)),updatedAt:store.updatedAt};
    if(delayGets) return setTimeout(()=>send(snap),delayGets);   // snapshot taken NOW, delivered late
    return send(snap);
  }
  if(j.action==='put'){store={rev:store.rev+1,state:j.state,updatedAt:new Date().toISOString()};return send({ok:true,rev:store.rev,updatedAt:store.updatedAt})}
  if(j.action==='patch'){
    if(!store.state)return send({ok:false,error:'Nothing stored yet - push a full copy first'});
    const st=store.state;
    (j.scopes||[]).forEach(sc=>{
      if(sc.upserts||sc.deletes){const t={};(sc.upserts||[]).forEach(r=>t[r.agent]=1);(sc.deletes||[]).forEach(a=>t[a]=1);
        st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area&&t[r.agent]));
        (sc.upserts||[]).forEach(r=>st.records.push(r));return;}
      st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area));
      (sc.records||[]).forEach(r=>st.records.push(r));});
    if(j.roster){if(j.roster.teams)st.teams=j.roster.teams;if(j.roster.inactive)st.inactive=j.roster.inactive;}
    store={rev:store.rev+1,state:st,updatedAt:new Date().toISOString()};
    return send({ok:true,rev:store.rev,updatedAt:store.updatedAt});
  }
  send({ok:true});})});
await new Promise(r=>api.listen(8920,r));
const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/,"var DEFAULT_API_URL = 'http://localhost:8920/exec'")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/"))});
await new Promise(r=>web.listen(8921,r));

const res=[]; const check=(n,c,d)=>res.push({n,c:!!c,d:c?'':(d||'')});
const b=await chromium.launch();
const open=async()=>{const p=await (await b.newContext()).newPage();
  p.on('pageerror',e=>res.push({n:'JS ERROR',c:false,d:e.message}));
  await p.goto('http://localhost:8921/'); await p.waitForTimeout(250);
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(1100); return p;};
const grid=async(p,w,t,a)=>{await p.click('[data-view="assess"]');await p.waitForTimeout(250);
  await p.fill('#assessWeek',w);await p.selectOption('#assessTeam',t);await p.$eval('#assessArea',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))}, a);await p.waitForTimeout(280);};
const mark=(p,ag,l)=>p.$eval(`#weeklyGrid [data-agent="${ag}"] .level-btn[data-level="${l}"]`,e=>e.click());

const W='2026-09-18', TM='Team Mubeen', AR='Basic Real Estate KB';
const seed=await open();
await seed.click('[data-view="settings"]'); await seed.waitForTimeout(300);
await seed.click('#syncPushBtn'); await seed.waitForTimeout(2200);
await seed.context().close();

// hold GET replies open so the page's own startup poll is still in flight while we save
delayGets=8000;
const p=await open();
await grid(p,W,TM,AR);
await mark(p,'Faiyaz',4); await mark(p,'Nikita',3);
await p.click('#saveWeekBtn');
// sample continuously - a revert that a later poll heals is still a revert the
// user sees, so the end state alone is not enough to judge this
let everLost=null, samples=0;
for(let i=0;i<70;i++){
  const cur=await p.evaluate(([w,a])=>state.records.filter(r=>r.week===w&&(r.area||'')===a).length,[W,AR]);
  samples++;
  if(cur<2 && everLost===null) everLost='dropped to '+cur+' at ~'+(i*250)+'ms after save';
  if(i===16) delayGets=0;                        // the stale reply becomes due
  await p.waitForTimeout(250);
}
const local=await p.evaluate(([w,a])=>state.records.filter(r=>r.week===w&&(r.area||'')===a).map(r=>r.agent+':'+r.level).sort(),[W,AR]);
const onSheet=store.state.records.filter(r=>r.week===W).map(r=>r.agent+':'+r.level).sort();
check('YOUR RACE: the local save is never reverted, even transiently',
  everLost===null && JSON.stringify(local)===JSON.stringify(['Faiyaz:4','Nikita:3']),
  (everLost||'')+' final: '+JSON.stringify(local)+' ('+samples+' samples)');
check('the save still reached the sheet', JSON.stringify(onSheet)===JSON.stringify(['Faiyaz:4','Nikita:3']), JSON.stringify(onSheet));

// per-area coverage surfaces the gap the dashboard cannot
await grid(p,W,TM,AR);
const prog=await p.textContent('#areaProgress');
check('Assess shows per-area progress', /2 of 4 scored/.test(prog), prog);   // Team Mubeen is 5 people, one of them the leader
check('Assess names who is still missing in this area',
  /Sahil Mendiratta/.test(prog)&&/Aanchal/.test(prog), prog);
check('the team leader is not named as missing', !/still to score:[^\n]*\bMubeen\b/.test(prog), prog);
await p.click('[data-view="dashboard"]'); await p.waitForTimeout(400);
await p.selectOption('#teamFilter',TM); await p.waitForTimeout(400);
const areaCounts=await p.$$eval('#teamScores .area-row',rs=>rs.map(r=>r.querySelector('.area-n').textContent));
check('dashboard area rows show assessed-per-area', areaCounts[0]==='2/4', JSON.stringify(areaCounts));
const cov=await p.textContent('#coverageText');
check('the company coverage figure is labelled as week-level', /any area/.test(cov), cov);

console.log('');
let pass=0,fail=0; res.forEach(r=>{r.c?pass++:fail++;console.log(`  ${r.c?'PASS':'FAIL'}  ${r.n}${r.d?'  -> '+r.d:''}`)});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await b.close(); api.close(); web.close();
