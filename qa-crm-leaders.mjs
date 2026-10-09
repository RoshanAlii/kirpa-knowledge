// v2.7: team leaders are rated in CRM Usage but NOT in Basic Real Estate KB.
//  - a leader missing from her own roster (Team Manpreet Ma'am) is added once
//  - KB grid, KB counts and KB scores exclude leaders exactly as before
//  - CRM grid, CRM counts and CRM scores include them
//  - deactivated agents stay out of both
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';

let store={rev:0,state:null,updatedAt:null}, puts=0;
const api=http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  const h={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  let j={};try{j=JSON.parse(b||'{}')}catch(e){}
  const send=o=>{s.writeHead(200,h);s.end(JSON.stringify(o))};
  if(j.action==='head')return send({ok:true,rev:store.rev,updatedAt:store.updatedAt});
  if(j.action==='get') return send({ok:true,rev:store.rev,state:store.state?JSON.parse(JSON.stringify(store.state)):null,updatedAt:store.updatedAt});
  if(j.action==='put'){puts++;store={rev:store.rev+1,state:j.state,updatedAt:new Date().toISOString()};return send({ok:true,rev:store.rev,updatedAt:store.updatedAt})}
  if(j.action==='patch'){
    if(!store.state)return send({ok:false,error:'Nothing stored yet'});
    const st=store.state;
    (j.scopes||[]).forEach(sc=>{
      const t={};(sc.upserts||[]).forEach(r=>t[r.agent]=1);(sc.deletes||[]).forEach(a=>t[a]=1);
      st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area&&t[r.agent]));
      (sc.upserts||[]).forEach(r=>st.records.push(r));});
    if(j.roster){if(j.roster.teams)st.teams=j.roster.teams;if(j.roster.inactive)st.inactive=j.roster.inactive;}
    store={rev:store.rev+1,state:st,updatedAt:new Date().toISOString()};
    return send({ok:true,rev:store.rev,updatedAt:store.updatedAt});
  }
  send({ok:true});})});
await new Promise(r=>api.listen(8970,r));

const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/,"var DEFAULT_API_URL = 'http://localhost:8970/exec'")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/"))});
await new Promise(r=>web.listen(8971,r));

const res=[]; const check=(n,c,d)=>res.push({n,c:!!c,d:c?'':(d||'')});
const b=await chromium.launch();
const open=async()=>{const p=await (await b.newContext()).newPage();
  p.on('pageerror',e=>res.push({n:'JS ERROR',c:false,d:e.message}));
  await p.goto('http://localhost:8971/'); await p.waitForTimeout(250);
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(1600); return p;};

const KB='Basic Real Estate KB', CRM='CRM Usage', W='2026-10-03';
const seed=()=>({
  teams:[{name:'Team Kamal',leader:'Kamal',members:['Kamal','Karan','Mona','Sarv']},
         {name:"Team Manpreet Ma'am",leader:"Manpreet Ma'am",members:['Navneet','Arbaz']}],
  records:[
    {week:W,team:'Team Kamal',agent:'Karan',area:KB,level:4,comment:''},
    {week:W,team:'Team Kamal',agent:'Sarv',area:KB,level:2,comment:''},
    {week:W,team:"Team Manpreet Ma'am",agent:'Navneet',area:KB,level:3,comment:''}],
  legacy:[], inactive:['Team Kamal|Mona'], version:3});

console.log('\n1. Leader roster repair');
store={rev:5,state:seed(),updatedAt:new Date().toISOString()};
const p=await open(); await p.waitForTimeout(2500);
const mp=await p.evaluate(()=>state.teams.find(t=>t.leader==="Manpreet Ma'am").members);
check("Manpreet Ma'am added to her own roster", mp[0]==="Manpreet Ma'am" && mp.length===3, JSON.stringify(mp));
check('Kamal not duplicated', (await p.evaluate(()=>state.teams[0].members.filter(m=>m==='Kamal').length))===1);
for(let i=0;i<10 && !(store.state.teams[1].members||[]).includes("Manpreet Ma'am");i++) await p.waitForTimeout(500);
check('the repaired roster reached the sheet', store.state.teams[1].members.includes("Manpreet Ma'am"), JSON.stringify(store.state.teams[1]));
check('no records were lost', store.state.records.length===3, store.state.records.length);
const again=await p.evaluate(()=>{const v=JSON.parse(JSON.stringify(state));return ensureLeadersOnRoster(v)});
check('the repair is idempotent', again===false);

console.log('2. Basic Real Estate KB: leaders still not rated');
const kb=await p.evaluate(({W,KB})=>({
  members:activeMembers('ALL',KB).map(m=>m.agent).sort(),
  head:companyScore(W,'ALL',KB),
  stat:areaStats(W,'ALL').find(x=>x.area===KB)}),{W,KB});
check('KB roster excludes leaders and the inactive agent', JSON.stringify(kb.members)===JSON.stringify(['Arbaz','Karan','Navneet','Sarv']), JSON.stringify(kb.members));
check('KB area count is 3/4', kb.stat.count===3&&kb.stat.roster===4, JSON.stringify(kb.stat));
check('KB headline unchanged (100+50+75 -> 75)', kb.head===75, kb.head);
await p.evaluate(()=>setView('assess')); await p.waitForTimeout(300);
await p.fill('#assessWeek',W);
await p.selectOption('#assessTeam','Team Kamal'); await p.waitForTimeout(300);
const kbGrid=await p.$$eval('#weeklyGrid [data-agent]',es=>es.map(e=>e.dataset.agent));
check('KB grid has no leader', JSON.stringify(kbGrid)===JSON.stringify(['Karan','Sarv']), JSON.stringify(kbGrid));

console.log('3. CRM Usage: leaders are rated');
await p.selectOption('#assessArea',CRM); await p.waitForTimeout(350);
const crmGrid=await p.$$eval('#weeklyGrid [data-agent]',es=>es.map(e=>e.dataset.agent));
check('CRM grid includes Kamal, not the inactive Mona', JSON.stringify(crmGrid)===JSON.stringify(['Kamal','Karan','Sarv']), JSON.stringify(crmGrid));
check('Kamal is labelled team leader', /Team leader/.test(await p.$eval('#weeklyGrid [data-agent="Kamal"]',e=>e.textContent)));
await p.$eval('#weeklyGrid [data-agent="Kamal"] .level-btn[data-level="2"]',e=>e.click());
await p.$eval('#weeklyGrid [data-agent="Karan"] .level-btn[data-level="4"]',e=>e.click());
await p.click('#saveWeekBtn'); await p.waitForTimeout(2500);
await p.evaluate(()=>setView('assess')); await p.waitForTimeout(200);
await p.fill('#assessWeek',W);
await p.selectOption('#assessTeam',"Team Manpreet Ma'am");
await p.selectOption('#assessArea',CRM); await p.waitForTimeout(350);
const mGrid=await p.$$eval('#weeklyGrid [data-agent]',es=>es.map(e=>e.dataset.agent));
check("CRM grid includes Manpreet Ma'am", mGrid.includes("Manpreet Ma'am"), JSON.stringify(mGrid));
await p.$eval(`#weeklyGrid [data-agent="Manpreet Ma'am"] .level-btn[data-level="4"]`,e=>e.click());
await p.click('#saveWeekBtn'); await p.waitForTimeout(3000);

const crm=await p.evaluate(({W,KB,CRM})=>({
  members:activeMembers('ALL',CRM).length,
  head:companyScore(W,'ALL',CRM), kbHead:companyScore(W,'ALL',KB),
  stats:areaStats(W,'ALL'),
  recs:state.records.filter(r=>r.area===CRM).map(r=>r.agent+':'+r.level).sort()}),{W,KB,CRM});
check('CRM roster = 4 agents + 2 leaders', crm.members===6, crm.members);
check('leader CRM scores saved as CRM records', JSON.stringify(crm.recs)===JSON.stringify(['Kamal:2','Karan:4',"Manpreet Ma'am:4"]), JSON.stringify(crm.recs));
const sheetCrm=store.state.records.filter(r=>r.area===CRM).map(r=>r.agent).sort();
check('and reached the sheet', JSON.stringify(sheetCrm)===JSON.stringify(['Kamal','Karan',"Manpreet Ma'am"]), JSON.stringify(sheetCrm));
check('CRM headline counts the leaders ((50+100+100)/3 = 83)', crm.head===83, crm.head);
check('KB headline still 75', crm.kbHead===75, crm.kbHead);
const cs=crm.stats.find(x=>x.area===CRM), ks=crm.stats.find(x=>x.area===KB);
check('area counts: KB 3/4, CRM 3/6', ks.count===3&&ks.roster===4&&cs.count===3&&cs.roster===6, JSON.stringify(crm.stats));

console.log('4. Boards');
await p.evaluate(()=>setView('dashboard')); await p.waitForTimeout(300);
await p.click('#boardAreaButtons .seg[data-area="Basic Real Estate KB"]'); await p.waitForTimeout(300);
// the dashboard follows the team last assessed (Team Manpreet Ma'am): KB Navneet of
// Navneet+Arbaz = 1/2; CRM Manpreet Ma'am of herself+Navneet+Arbaz = 1/3
const rowsTeam=await p.$$eval('#teamScores .area-n',es=>es.map(e=>e.textContent));
check("team dashboard rows read 1/2 (KB) and 1/3 (CRM)", JSON.stringify(rowsTeam)===JSON.stringify(['1/2','1/3']), JSON.stringify(rowsTeam));
await p.selectOption('#teamFilter','ALL'); await p.waitForTimeout(300);
const rows=await p.$$eval('#teamScores .area-n',es=>es.map(e=>e.textContent));
check('company dashboard rows read 3/4 and 3/6', JSON.stringify(rows)===JSON.stringify(['3/4','3/6']), JSON.stringify(rows));
await p.evaluate(()=>setView('teams')); await p.waitForTimeout(300);
const kbCard=await p.$eval('[data-team-card="Team Kamal"]',e=>e.textContent);
check('KB team card: 2 members, no (TL) row', /2 members/.test(kbCard)&&!/\(TL\)/.test(kbCard), kbCard.slice(0,120));
await p.click('#boardAreaButtons .seg[data-area="CRM Usage"]'); await p.waitForTimeout(300);
const crmCard=await p.$eval('[data-team-card="Team Kamal"]',e=>e.textContent);
check('CRM team card: 3 members, leader shown with (TL)', /3 members/.test(crmCard)&&/Kamal \(TL\)/.test(crmCard), crmCard.slice(0,160));

console.log('');
let pass=0,fail=0; res.forEach(r=>{r.c?pass++:fail++;console.log(`  ${r.c?'PASS':'FAIL'}  ${r.n}${r.d?'  -> '+r.d:''}`)});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await b.close(); api.close(); web.close();
process.exit(fail?1:0);
