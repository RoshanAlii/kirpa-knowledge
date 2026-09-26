// Collapsing the five knowledge categories + the paper import into one area.
// The risk is duplication: a record is keyed by (week, team, agent, area), so
// two agents who were scored twice in one week under two different category
// names must end up with ONE record, not two. Mirrors the live data shape.
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
await new Promise(r=>api.listen(8960,r));

const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/,"var DEFAULT_API_URL = 'http://localhost:8960/exec'")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/"))});
await new Promise(r=>web.listen(8961,r));

const res=[]; const check=(n,c,d)=>res.push({n,c:!!c,d:c?'':(d||'')});
const b=await chromium.launch();
const open=async()=>{const p=await (await b.newContext()).newPage();
  p.on('pageerror',e=>res.push({n:'JS ERROR',c:false,d:e.message}));
  await p.goto('http://localhost:8961/'); await p.waitForTimeout(250);
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(1600); return p;};

const PAPER='Overall / General Knowledge (Imported Paper)';
const OBJ='Objection Handling', ROI='Investment / ROI Knowledge';

const legacy=()=>({
  teams:[{name:'Team Kamal',leader:'Kamal',members:['Kamal','Karan','Mona']},
         {name:'Team Priyanka',leader:'Priyanka',members:['Priyanka','Ameer','Spoorthi']}],
  records:[
    // ordinary single-category rows
    {week:'2026-09-12',team:'Team Kamal',agent:'Karan',area:PAPER,level:3,comment:'pad note'},
    {week:'2026-09-12',team:'Team Kamal',agent:'Mona',area:PAPER,level:1,comment:''},
    {week:'2026-09-19',team:'Team Kamal',agent:'Karan',area:OBJ,level:2,comment:'objection note'},
    {week:'2026-09-26',team:'Team Kamal',agent:'Mona',area:ROI,level:4,comment:'roi note'},
    // THE COLLISIONS: same agent, same week, two different categories
    {week:'2026-09-12',team:'Team Priyanka',agent:'Ameer',area:OBJ,level:3,comment:''},
    {week:'2026-09-12',team:'Team Priyanka',agent:'Ameer',area:PAPER,level:3,comment:''},
    {week:'2026-09-12',team:'Team Priyanka',agent:'Spoorthi',area:OBJ,level:1,comment:''},
    {week:'2026-09-12',team:'Team Priyanka',agent:'Spoorthi',area:PAPER,level:1,comment:'Good, but should improve.'},
    // a collision where the two levels DISAGREE - the higher must win, so a
    // score is never silently reduced, and both notes must survive
    {week:'2026-09-19',team:'Team Priyanka',agent:'Spoorthi',area:OBJ,level:2,comment:'first note'},
    {week:'2026-09-19',team:'Team Priyanka',agent:'Spoorthi',area:ROI,level:4,comment:'second note'}],
  legacy:[], inactive:[], version:3});

// ==========================================================
console.log('\n1. Collapsing the categories');
{
  store={rev:7,state:legacy(),updatedAt:new Date().toISOString()};
  const p=await open();
  await p.waitForTimeout(2500);
  const d=await p.evaluate(()=>{
    const areas={}; state.records.forEach(r=>areas[r.area]=(areas[r.area]||0)+1);
    const dupes=[]; const seen=new Set();
    state.records.forEach(r=>{const k=r.week+'|'+r.team+'|'+r.agent; if(seen.has(k))dupes.push(k); seen.add(k);});
    const find=(w,a)=>state.records.find(r=>r.week===w&&r.agent===a);
    return {areas, n:state.records.length, dupes,
      ameer:find('2026-09-12','Ameer'),
      spoorthi12:find('2026-09-12','Spoorthi'),
      spoorthi19:find('2026-09-19','Spoorthi'),
      karan12:find('2026-09-12','Karan'), karan19:find('2026-09-19','Karan'),
      areasConst:AREAS.slice()};
  });
  check('only one knowledge area is left', Object.keys(d.areas).length===1 && d.areas['Basic Real Estate KB']===7,
    JSON.stringify(d.areas));
  check('AREAS is the single area', d.areasConst.length===1 && d.areasConst[0]==='Basic Real Estate KB', JSON.stringify(d.areasConst));
  check('NOTHING is duplicated', d.dupes.length===0, JSON.stringify(d.dupes));
  check('10 rows across 3 collisions collapse to 7', d.n===7, 'records='+d.n);
  check('an agent scored twice at the same level keeps that level', d.ameer && d.ameer.level===3, JSON.stringify(d.ameer));
  check('the surviving row keeps the comment that existed', d.spoorthi12 && d.spoorthi12.comment==='Good, but should improve.', JSON.stringify(d.spoorthi12));
  check('when the two levels disagree the HIGHER one wins', d.spoorthi19 && d.spoorthi19.level===4, JSON.stringify(d.spoorthi19));
  check('both comments are kept when both existed',
    d.spoorthi19 && /first note/.test(d.spoorthi19.comment) && /second note/.test(d.spoorthi19.comment), JSON.stringify(d.spoorthi19));
  check('untouched rows keep their level and comment',
    d.karan12.level===3 && d.karan12.comment==='pad note' && d.karan19.level===2 && d.karan19.comment==='objection note',
    JSON.stringify([d.karan12,d.karan19]));

  // written back to the sheet, once
  const sheetAreas={}; store.state.records.forEach(r=>sheetAreas[r.area]=(sheetAreas[r.area]||0)+1);
  check('the collapsed copy is pushed back to the sheet',
    Object.keys(sheetAreas).length===1 && store.state.records.length===7 && store.rev>7,
    'rev='+store.rev+' '+JSON.stringify(sheetAreas));
  const revAfter=store.rev, putsAfter=puts;
  await p.waitForTimeout(3000);
  check('the migration does not re-fire on later polls', store.rev===revAfter && puts===putsAfter,
    'rev '+revAfter+'->'+store.rev+', puts '+putsAfter+'->'+puts);
  await p.context().close();
}

// ==========================================================
console.log('2. The area picker is gone but scoring still works');
{
  store={rev:0,state:null,updatedAt:null};
  const p=await open();
  await p.waitForTimeout(1200);
  await p.evaluate(()=>setView('assess')); await p.waitForTimeout(400);
  check('the Knowledge area picker is hidden', await p.isHidden('#assessAreaField'));
  check('the per-area dashboard panels are hidden',
    await p.isHidden('#teamScores') && await p.isHidden('#trainingGaps'));
  check('the assess screen no longer tells you to pick an area',
    !/knowledge area first/i.test(await p.textContent('#view-assess')));

  await p.fill('#assessWeek','2026-10-03');
  await p.selectOption('#assessTeam','Team Lipika'); await p.waitForTimeout(350);
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .level-btn[data-level="4"]',e=>e.click());
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .comment-input',e=>{e.value='scored with no picker';e.dispatchEvent(new Event('input',{bubbles:true}))});
  await p.click('#saveWeekBtn'); await p.waitForTimeout(2500);
  // an empty sheet rejects the first patch ("nothing stored yet"); the app then
  // falls back to a full push, so give that round trip room before asserting
  for(let i=0;i<20 && !store.state;i++) await p.waitForTimeout(500);
  const saved=await p.evaluate(()=>state.records.filter(r=>r.week==='2026-10-03'));
  check('a score saves into the single area',
    saved.length===1 && saved[0].area==='Basic Real Estate KB' && saved[0].level===4, JSON.stringify(saved));
  check('the comment saves with it', saved[0] && saved[0].comment==='scored with no picker', JSON.stringify(saved[0]));
  check('it reached the sheet', !!store.state && store.state.records.some(r=>r.week==='2026-10-03'&&r.level===4), store.state?'':'sheet still empty');

  // the "last time" marker is the whole point of the board - it must survive
  await p.evaluate(()=>setView('assess'));
  await p.fill('#assessWeek','2026-10-10'); await p.waitForTimeout(400);
  const tag=await p.$eval('#weeklyGrid [data-agent="Kirti"]',e=>{
    const t=e.querySelector('.prev-tag'); return t?t.textContent.trim():'NONE';});
  check('the "last time" marker still works with one area', /Last time/.test(tag), tag);
  check('the marker does not name an area any more', !/\(/.test(tag), tag);
  await p.context().close();
}

console.log('');
let pass=0,fail=0; res.forEach(r=>{r.c?pass++:fail++;console.log(`  ${r.c?'PASS':'FAIL'}  ${r.n}${r.d?'  -> '+r.d:''}`)});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await b.close(); api.close(); web.close();
process.exit(fail?1:0);
