// Covers the two changes made on 21 Sep 2026:
//   1. the 11 Sep and 12 Sep paper rounds are merged into one week (12 Sep)
//   2. team leaders are never rated
// Runs against a local copy of index.html plus a mock Apps Script backend.
// Nothing here touches the live sheet.
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';

let store={rev:0,state:null,updatedAt:null}, putCount=0;
const api=http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  const h={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  let j={};try{j=JSON.parse(b||'{}')}catch(e){}
  if(process.env.TRACE&&j.action&&j.action!=='head')console.log('  >>',j.action, j.state?('weeks='+JSON.stringify([...new Set(j.state.records.map(r=>r.week))])):'');
  const send=o=>{s.writeHead(200,h);s.end(JSON.stringify(o))};
  if(j.action==='head')return send({ok:true,rev:store.rev,updatedAt:store.updatedAt});
  if(j.action==='get') return send({ok:true,rev:store.rev,state:store.state?JSON.parse(JSON.stringify(store.state)):null,updatedAt:store.updatedAt});
  if(j.action==='put'){putCount++;store={rev:store.rev+1,state:j.state,updatedAt:new Date().toISOString()};return send({ok:true,rev:store.rev,updatedAt:store.updatedAt})}
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
await new Promise(r=>api.listen(8930,r));

const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/,"var DEFAULT_API_URL = 'http://localhost:8930/exec'")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/"))});
await new Promise(r=>web.listen(8931,r));

const res=[]; const check=(n,c,d)=>res.push({n,c:!!c,d:c?'':(d||'')});
const b=await chromium.launch();
const open=async()=>{const p=await (await b.newContext()).newPage();
  p.on('pageerror',e=>res.push({n:'JS ERROR',c:false,d:e.message}));
  await p.goto('http://localhost:8931/'); await p.waitForTimeout(250);
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(1600); return p;};

const PAPER='Overall / General Knowledge (Imported Paper)', OBJ='Objection Handling';
// a sheet that still looks the way the live one did before the merge
const splitWeeks=()=>({
  teams:[{name:'Team Kamal',leader:'Kamal',members:['Kamal','Karan','Mona','Sarv']},
         {name:'Team Priyanka',leader:'Priyanka',members:['Priyanka','Ameer','Spoorthi']}],
  records:[
    {week:'2026-09-11',team:'Team Kamal',agent:'Karan',area:PAPER,level:3,comment:'pad'},
    {week:'2026-09-11',team:'Team Kamal',agent:'Mona',area:PAPER,level:1,comment:'pad'},
    {week:'2026-09-11',team:'Team Kamal',agent:'Sarv',area:PAPER,level:3,comment:'pad'},
    {week:'2026-09-11',team:'Team Priyanka',agent:'Ameer',area:PAPER,level:3,comment:'pad'},
    {week:'2026-09-11',team:'Team Priyanka',agent:'Spoorthi',area:PAPER,level:1,comment:'pad'},
    // the two stray 12 Sep rows - a DIFFERENT area, so no collision
    {week:'2026-09-12',team:'Team Priyanka',agent:'Ameer',area:OBJ,level:3,comment:'stray'},
    {week:'2026-09-12',team:'Team Priyanka',agent:'Spoorthi',area:OBJ,level:1,comment:'stray'},
    // a later week, to prove the merge does not touch anything else
    {week:'2026-09-19',team:'Team Kamal',agent:'Karan',area:OBJ,level:2,comment:'later'}],
  legacy:[], inactive:[], version:3});

// ==========================================================
console.log('\n1. Merging 11 Sep into 12 Sep');
{
  store={rev:4,state:splitWeeks(),updatedAt:new Date().toISOString()};
  const p=await open();
  await p.waitForTimeout(2500);
  const d=await p.evaluate(()=>({
    weeks:[...new Set(state.records.map(r=>r.week))].sort(),
    n:state.records.length,
    twelve:state.records.filter(r=>r.week==='2026-09-12').length,
    karan:state.records.filter(r=>r.agent==='Karan').map(r=>r.week+'/'+r.level).sort(),
    ameer:state.records.filter(r=>r.agent==='Ameer').map(r=>r.week+'/'+r.area+'/'+r.level).sort()}));
  check('no 2026-09-11 record survives', !d.weeks.includes('2026-09-11'), JSON.stringify(d.weeks));
  // this seed uses the OLD category names, so the area collapse runs too: the 8
  // seeded rows become 6 because Ameer and Spoorthi were each scored once under
  // each of two categories in the same week.
  check('nothing is lost beyond the two category merges', d.n===6, 'records='+d.n);
  check('the five 12 Sep rows all sit on 12 Sep', d.twelve===5, 'twelve='+d.twelve);
  check('the later week is untouched', d.karan.join()==='2026-09-12/3,2026-09-19/2', JSON.stringify(d.karan));
  check('two old category rows for one agent collapse into one', d.ameer.length===1, JSON.stringify(d.ameer));
  check('that merged row keeps the level', d.ameer[0] && /\/3$/.test(d.ameer[0]), JSON.stringify(d.ameer));

  // the fix is written back to the sheet, not just held locally
  const sheetWeeks=[...new Set(store.state.records.map(r=>r.week))].sort();
  check('the merged copy is pushed back to the sheet', !sheetWeeks.includes('2026-09-11')&&store.rev>4,
    'rev='+store.rev+' weeks='+JSON.stringify(sheetWeeks));
  check('the sheet holds the collapsed set', store.state.records.length===6, 'n='+store.state.records.length);

  // the board must open on the newest week, not on the seed data's week
  check('a fresh browser lands on the newest week',
    (await p.inputValue('#weekFilter'))==='2026-09-19', 'weekFilter='+await p.inputValue('#weekFilter'));
  // ...but a week the user picks is kept across the next pull
  await p.selectOption('#weekFilter','2026-09-12'); await p.waitForTimeout(200);
  // make the sheet move so the next poll really applies a remote state
  store={rev:store.rev+1,state:JSON.parse(JSON.stringify(store.state)),updatedAt:new Date().toISOString()};
  store.state.records.push({week:'2026-09-19',team:'Team Kamal',agent:'Sarv',area:OBJ,level:2,comment:'from another device'});
  await p.waitForTimeout(20000);
  check('the remote change was pulled in', await p.evaluate(()=>state.records.some(r=>r.comment==='from another device')));
  check('a week the user picked survives a pull',
    (await p.inputValue('#weekFilter'))==='2026-09-12', 'weekFilter='+await p.inputValue('#weekFilter'));

  // and it does not keep firing
  const revAfter=store.rev, putsAfter=putCount;
  await p.waitForTimeout(3000);
  check('the migration does not re-fire on later polls', store.rev===revAfter&&putCount===putsAfter,
    'rev '+revAfter+'->'+store.rev+', puts '+putsAfter+'->'+putCount);
  await p.context().close();
}

// ==========================================================
console.log('2. Merging when a 12 Sep row already covers the same agent and area');
{
  const st=splitWeeks();
  // same agent, same area, both weeks: the 12 Sep note is the later one and wins
  st.records.push({week:'2026-09-12',team:'Team Kamal',agent:'Mona',area:PAPER,level:4,comment:'later note'});
  store={rev:9,state:st,updatedAt:new Date().toISOString()};
  const p=await open();
  await p.waitForTimeout(2500);
  const mona=await p.evaluate(()=>state.records.filter(r=>r.agent==='Mona').map(r=>r.week+'/'+r.level+'/'+r.comment));
  check('the colliding row is not duplicated', mona.length===1, JSON.stringify(mona));
  check('the later 12 Sep note wins', mona[0]==='2026-09-12/4/later note', JSON.stringify(mona));
  await p.context().close();
}

// ==========================================================
console.log('3. Team leaders are not rated');
{
  store={rev:0,state:null,updatedAt:null};
  const p=await open();
  await p.waitForTimeout(1200);
  const am=await p.evaluate(()=>({
    active:activeMembers('ALL').length,
    roster:state.teams.reduce((n,t)=>n+t.members.length,0),
    leadersInActive:activeMembers('ALL').filter(m=>m.agent===m.leader).length}));
  check('no leader appears in the rateable list', am.leadersInActive===0, JSON.stringify(am));
  check('rateable headcount is the roster minus the five leaders who are listed as members',
    am.active===am.roster-5, 'active='+am.active+' roster='+am.roster);

  await p.click('[data-view="assess"]'); await p.waitForTimeout(300);
  await p.selectOption('#assessTeam','Team Lipika'); await p.$eval('#assessArea',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))}, OBJ); await p.waitForTimeout(350);
  const grid=await p.$$eval('#weeklyGrid .assessment-person',es=>es.map(e=>e.dataset.agent));
  check('the leader is not in the assess grid', !grid.includes('Lipika'), JSON.stringify(grid));
  check('every other member still is', ['Priyanka Sunil','Kirti','Sadaf','Sukhpreet'].every(a=>grid.includes(a)), JSON.stringify(grid));

  await p.click('[data-view="agents"]'); await p.waitForTimeout(300);
  const names=await p.$$eval('#agentsBody tr td:first-child',e=>e.map(x=>x.textContent));
  check('the leader is not in the agents table', !names.includes('Lipika')&&!names.includes('Kamal'), JSON.stringify(names.slice(0,6)));
  check('a same-first-name agent is NOT caught by the rule', names.includes('Priyanka Sunil')&&!names.includes('Priyanka'),
    'Priyanka Sunil in list: '+names.includes('Priyanka Sunil')+', Priyanka in list: '+names.includes('Priyanka'));

  await p.click('[data-view="teams"]'); await p.waitForTimeout(300);
  const card=await p.$eval('[data-team-card="Team Lipika"]',e=>e.textContent);
  check('the team card still names its leader', /TL · Lipika/.test(card), card.slice(0,80));
  check('the leader is not listed as an unassessed member', !/Lipika\s*\(TL\)/.test(card), card.slice(0,120));

  await p.click('[data-view="admin"]'); await p.waitForTimeout(300);
  const admin=await p.$$eval('#adminBody tr',rs=>rs.map(r=>r.children[0].textContent+'|'+r.children[2].textContent));
  check('the leader is still on the admin roster, flagged as leader', admin.includes('Lipika|Yes'), JSON.stringify(admin.slice(0,3)));
  await p.context().close();
}

// ==========================================================
console.log('4. Deactivating an agent keeps their history');
{
  store={rev:0,state:null,updatedAt:null};
  const p=await open();
  await p.waitForTimeout(1200);
  const before=await p.evaluate(()=>state.records.filter(r=>r.agent==='Mona').length);
  await p.click('[data-view="admin"]'); await p.waitForTimeout(300);
  const row=await p.$$eval('#adminBody tr',rs=>rs.findIndex(r=>r.children[0].textContent==='Mona'));
  await p.$eval(`#adminBody tr:nth-child(${row+1}) .admin-toggle`,e=>e.click());
  await p.waitForTimeout(400);
  const after=await p.evaluate(()=>({
    recs:state.records.filter(r=>r.agent==='Mona').length,
    inactive:state.inactive.some(k=>/\|Mona$/.test(k)),
    active:activeMembers('ALL').some(m=>m.agent==='Mona')}));
  check('the deactivated agent is out of the rateable list', after.inactive&&!after.active, JSON.stringify(after));
  check('every one of their records is kept', after.recs===before&&before>0, 'before='+before+' after='+after.recs);
  await p.click('[data-view="admin"]'); await p.waitForTimeout(200);
  const stillListed=await p.$$eval('#adminBody tr td:first-child',e=>e.map(x=>x.textContent).includes('Mona'));
  check('they are still on the admin roster so they can be brought back', stillListed);
  await p.context().close();
}

console.log('');
let pass=0,fail=0; res.forEach(r=>{r.c?pass++:fail++;console.log(`  ${r.c?'PASS':'FAIL'}  ${r.n}${r.d?'  -> '+r.d:''}`)});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await b.close(); api.close(); web.close();
process.exit(fail?1:0);
