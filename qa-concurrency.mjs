import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';
let store={rev:0,state:null,updatedAt:null};
const api=http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  const h={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  let j={};try{j=JSON.parse(b||'{}')}catch(e){}
  if(j.action==='get'){s.writeHead(200,h);return s.end(JSON.stringify({ok:true,...store}))}
  if(j.action==='put'){
    store={rev:store.rev+1,state:j.state,updatedAt:new Date().toISOString()};
    s.writeHead(200,h);return s.end(JSON.stringify({ok:true,rev:store.rev,updatedAt:store.updatedAt}))}
  if(j.action==='patch'){
    if(!store.state){s.writeHead(200,h);return s.end(JSON.stringify({ok:false,error:'Nothing stored yet - push a full copy first'}))}
    const st=store.state;
    (j.scopes||[]).forEach(sc=>{
      if(sc.upserts||sc.deletes){const touched={};(sc.upserts||[]).forEach(r=>touched[r.agent]=1);(sc.deletes||[]).forEach(a=>touched[a]=1);
        st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area&&touched[r.agent]));
        (sc.upserts||[]).forEach(r=>st.records.push(r));return;}
      st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area));
      (sc.records||[]).forEach(r=>st.records.push(r));});
    if(j.roster){ if(j.roster.teams)st.teams=j.roster.teams; if(j.roster.inactive)st.inactive=j.roster.inactive; }
    store={rev:store.rev+1,state:st,updatedAt:new Date().toISOString()};
    s.writeHead(200,h);return s.end(JSON.stringify({ok:true,rev:store.rev,updatedAt:store.updatedAt}))}
  s.writeHead(200,h);s.end('{}')})});
await new Promise(r=>api.listen(8904,r));
const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/,"var DEFAULT_API_URL = 'http://localhost:8904/exec'")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/"))});
await new Promise(r=>web.listen(8905,r));

const b=await chromium.launch();
async function leader(){ const p=await (await b.newContext()).newPage();
  await p.goto('http://localhost:8905/'); await p.waitForTimeout(250);
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(1200); return p; }
// seed the sheet the way Ali did with "Push to Sheet" before the team starts using it
const seeder=await leader();
await seeder.click('[data-view="settings"]'); await seeder.waitForTimeout(300);
await seeder.click('#syncPushBtn'); await seeder.waitForTimeout(2500);
console.log('sheet seeded: rev', store.rev, 'records', store.state?store.state.records.length:0);
await seeder.close();

const A=await leader(), B=await leader();
await new Promise(r=>setTimeout(r,1500));

async function score(p,team,agent,level,area){
  await p.click('[data-view="assess"]'); await p.waitForTimeout(250);
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam',team); await p.$eval('#assessArea',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))}, area); await p.waitForTimeout(250);
  await p.$eval(`#weeklyGrid [data-agent="${agent}"] .level-btn[data-level="${level}"]`,e=>e.click());
  await p.click('#saveWeekBtn');
}

console.log('--- SCENARIO 1: two leaders, DIFFERENT teams, saving at the same moment ---');
await Promise.all([ score(A,'Team Kamal','Karan',4,'Basic Real Estate KB'),
                    score(B,'Team Saloni','Ritika',1,'Basic Real Estate KB') ]);
await new Promise(r=>setTimeout(r,26000));
let karan=store.state.records.find(r=>r.week==='2026-09-18'&&r.agent==='Karan');
let ritika=store.state.records.find(r=>r.week==='2026-09-18'&&r.agent==='Ritika');
console.log('  Karan (leader A) survived:', !!karan, karan?('level '+karan.level):'LOST');
console.log('  Ritika (leader B) survived:', !!ritika, ritika?('level '+ritika.level):'LOST');
console.log('  => both survived:', !!karan && !!ritika);

console.log('\n--- SCENARIO 2: two leaders, SAME team + same agent, same moment ---');
await Promise.all([ score(A,'Team Mubeen','Faiyaz',1,'Basic Real Estate KB'),
                    score(B,'Team Mubeen','Faiyaz',4,'Basic Real Estate KB') ]);
await new Promise(r=>setTimeout(r,26000));
const f=store.state.records.filter(r=>r.week==='2026-09-18'&&r.agent==='Faiyaz');
console.log('  records for Faiyaz on the sheet:', f.length, JSON.stringify(f.map(r=>r.level)));
console.log('  => no duplicate rows:', f.length===1);
console.log('  => one leader\'s value won, the other was overwritten:', f.length===1);
const aVal=await A.evaluate(()=>state.records.filter(r=>r.week==='2026-09-18'&&r.agent==='Faiyaz').map(r=>r.level));
const bVal=await B.evaluate(()=>state.records.filter(r=>r.week==='2026-09-18'&&r.agent==='Faiyaz').map(r=>r.level));
console.log('  leader A now sees:', JSON.stringify(aVal), ' leader B now sees:', JSON.stringify(bVal));
console.log('  => both browsers converged on the same value:', JSON.stringify(aVal)===JSON.stringify(bVal));
console.log('\n  final sheet revision:', store.rev);
await b.close(); api.close(); web.close();
