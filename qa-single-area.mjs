// Knowledge areas.
//  1. The five retired categories + the paper import collapse into Basic Real
//     Estate KB without duplicating (two agents were scored twice in one week
//     under two retired names - they must end up with ONE record).
//  2. CRM Usage is a real second area: its scores must NEVER be folded into
//     KB, and a KB score and a CRM score for the same agent and week are two
//     separate records. (The first version of the collapse got this wrong.)
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
  check('AREAS is Basic Real Estate KB + CRM Usage',
    JSON.stringify(d.areasConst)===JSON.stringify(['Basic Real Estate KB','CRM Usage']), JSON.stringify(d.areasConst));
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
console.log('2. Retired names collapse; CRM Usage is never touched');
{
  const ONE='Basic Real Estate KB', CRM='CRM Usage';
  store={rev:30,state:{
    teams:[{name:'Team Lipika',leader:'Lipika',members:['Lipika','Kirti','Sadaf']}],
    records:[
      // THE BUG THIS GUARDS: same agent, same week, a retired KB-ish score AND a
      // CRM score. The retired one must fold into KB; the CRM one must survive
      // as its own record, not be merged into the KB one.
      {week:'2026-10-03',team:'Team Lipika',agent:'Kirti',area:'Objection Handling',level:2,comment:'old category'},
      {week:'2026-10-03',team:'Team Lipika',agent:'Kirti',area:CRM,level:4,comment:'crm note'},
      // a plain CRM score with nothing else around it
      {week:'2026-10-03',team:'Team Lipika',agent:'Sadaf',area:CRM,level:1,comment:''}],
    legacy:[],inactive:[],version:3},updatedAt:new Date().toISOString()};
  const p=await open();
  await p.waitForTimeout(2600);
  const d=await p.evaluate(()=>({
    kirti:state.records.filter(r=>r.agent==='Kirti').map(r=>r.area+'|L'+r.level+'|'+r.comment).sort(),
    sadaf:state.records.filter(r=>r.agent==='Sadaf').map(r=>r.area+'|L'+r.level)}));
  check('a retired category folds into KB', d.kirti.includes('Basic Real Estate KB|L2|old category'), JSON.stringify(d.kirti));
  check('a CRM score beside it is NOT folded into KB', d.kirti.includes('CRM Usage|L4|crm note'), JSON.stringify(d.kirti));
  check('so that agent keeps two records, one per area', d.kirti.length===2, JSON.stringify(d.kirti));
  check('a lone CRM score is untouched', d.sadaf.join()==='CRM Usage|L1', JSON.stringify(d.sadaf));
  await p.context().close();
}

// ==========================================================
console.log('3. Scoring CRM Usage end to end');
{
  store={rev:0,state:null,updatedAt:null};
  const p=await open();
  await p.waitForTimeout(1200);
  await p.evaluate(()=>setView('assess')); await p.waitForTimeout(400);
  check('the Knowledge area picker is visible again', await p.isVisible('#assessAreaField'));
  const opts=await p.$$eval('#assessArea option',os=>os.map(o=>o.value+'='+o.textContent));
  check('the picker lists exactly the two areas, once each',
    JSON.stringify(opts)===JSON.stringify(['Basic Real Estate KB=Basic Real Estate KB','CRM Usage=CRM Usage']), JSON.stringify(opts));
  check('KB is the default area', (await p.inputValue('#assessArea'))==='Basic Real Estate KB');

  // score Kirti in both areas for the same week
  await p.fill('#assessWeek','2026-10-03');
  await p.selectOption('#assessTeam','Team Lipika'); await p.waitForTimeout(300);
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .level-btn[data-level="4"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(2500);
  for(let i=0;i<20 && !store.state;i++) await p.waitForTimeout(500);
  await p.evaluate(()=>setView('assess'));
  await p.fill('#assessWeek','2026-10-03');
  await p.selectOption('#assessTeam','Team Lipika');
  await p.selectOption('#assessArea','CRM Usage'); await p.waitForTimeout(350);
  const prog=await p.textContent('#areaProgress');
  check('per-area progress names the area', /for CRM/.test(prog), prog);
  check('the KB score does not show as selected in the CRM grid',
    await p.$eval('#weeklyGrid [data-agent="Kirti"]',e=>!e.querySelector('.level-btn.selected')));
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .level-btn[data-level="2"]',e=>e.click());
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .comment-input',e=>{e.value='forgets to log calls';e.dispatchEvent(new Event('input',{bubbles:true}))});
  await p.click('#saveWeekBtn'); await p.waitForTimeout(3000);

  const local=await p.evaluate(()=>state.records.filter(r=>r.agent==='Kirti'&&r.week==='2026-10-03').map(r=>r.area+'|L'+r.level).sort());
  check('KB and CRM are two separate records', JSON.stringify(local)===JSON.stringify(['Basic Real Estate KB|L4','CRM Usage|L2']), JSON.stringify(local));
  const sheet=(store.state&&store.state.records||[]).filter(r=>r.agent==='Kirti'&&r.week==='2026-10-03').map(r=>r.area+'|L'+r.level).sort();
  check('both reached the sheet', JSON.stringify(sheet)===JSON.stringify(['Basic Real Estate KB|L4','CRM Usage|L2']), JSON.stringify(sheet));
  const score=await p.evaluate(()=>agentSummaries('2026-10-03','Team Lipika').find(x=>x.agent==='Kirti').score);
  check('the agent\'s weekly score averages the two areas (100+50)/2', score===75, 'score='+score);

  // the labels that used to say "Paper"
  await p.evaluate(()=>setView('agents')); await p.waitForTimeout(300);
  const cell=await p.$$eval('#agentsBody tr',rs=>{const r=rs.find(x=>x.children[0].textContent==='Kirti');return r?r.children[4].textContent:'';});
  check('the Agents table labels the comment with its area', /^CRM: forgets to log calls$/.test(cell), cell);
  check('nothing is labelled "Paper" any more', !/Paper/.test(await p.textContent('#view-agents')));

  await p.evaluate(()=>setView('dashboard')); await p.waitForTimeout(300);
  check('the per-area dashboard panels are back (checked ON the dashboard)',
    await p.isVisible('#teamScores') && await p.isVisible('#trainingGaps'));
  const rows=await p.$$eval('#teamScores .area-row',rs=>rs.length);
  check('one dashboard row per area', rows===2, 'rows='+rows);
  await p.context().close();
}

// ==========================================================
console.log('4. A reload does not fold CRM back into KB');
{
  // a fresh browser pulls the sheet left behind by section 3
  const p=await open();
  await p.waitForTimeout(2600);
  const after=await p.evaluate(()=>state.records.filter(r=>r.agent==='Kirti'&&r.week==='2026-10-03').map(r=>r.area+'|L'+r.level).sort());
  check('both records survive a fresh load from the sheet',
    JSON.stringify(after)===JSON.stringify(['Basic Real Estate KB|L4','CRM Usage|L2']), JSON.stringify(after));
  // next week, CRM grid: the "last time" marker must come from the CRM score
  await p.evaluate(()=>setView('assess'));
  await p.fill('#assessWeek','2026-10-10');
  await p.selectOption('#assessTeam','Team Lipika');
  await p.selectOption('#assessArea','CRM Usage'); await p.waitForTimeout(400);
  const prev=await p.$eval('#weeklyGrid [data-agent="Kirti"]',e=>({lvl:(e.querySelector('.level-btn.prev')||{}).textContent,
    tag:(e.querySelector('.prev-tag')||{}).textContent}));
  check('the CRM grid marks last week\'s CRM level, not the KB one', prev.lvl==='Weak', JSON.stringify(prev));
  check('and needs no area label since it is the same area', !/\(/.test(prev.tag||''), JSON.stringify(prev));
  await p.context().close();
}

// ==========================================================
console.log('5. Per-area counts never exceed the roster');
{
  const ONE='Basic Real Estate KB';
  store={rev:40,state:{
    teams:[{name:'Team Saloni',leader:'Saloni',members:['Saloni','Ritika','Aasfa']},
           {name:'Team Lipika',leader:'Lipika',members:['Lipika','Kirti']}],
    records:[
      {week:'2026-09-26',team:'Team Saloni',agent:'Ritika',area:ONE,level:4,comment:''},   // counts
      {week:'2026-09-26',team:'Team Lipika',agent:'Kirti',area:ONE,level:2,comment:''},    // counts
      {week:'2026-09-26',team:'Team Saloni',agent:'Aasfa',area:ONE,level:1,comment:''},    // deactivated - must not count
      {week:'2026-09-26',team:'Team Lipika',agent:'Ritika',area:ONE,level:1,comment:''},   // filed under the wrong team - must not count
      {week:'2026-09-26',team:'Team Saloni',agent:'Saloni',area:ONE,level:1,comment:''}],  // team leader - must not count
    legacy:[],inactive:['Team Saloni|Aasfa'],version:3},updatedAt:new Date().toISOString()};
  const p=await open();
  await p.waitForTimeout(2400);
  await p.evaluate(()=>{document.getElementById('weekFilter').value='2026-09-26';renderAll();setView('dashboard');});
  await p.waitForTimeout(300);
  const row=await p.$$eval('#teamScores .area-row',rs=>{const r=rs.find(x=>/Basic Real Estate KB/.test(x.textContent));
    return r?{n:r.querySelector('.area-n').textContent,score:r.querySelector('b').textContent}:null;});
  const headline=await p.evaluate(()=>companyScore('2026-09-26','ALL'));
  check('the area count is only rated agents (2 of 2)', row && row.n==='2/2', JSON.stringify(row));
  check('the area score matches the headline score when one area has data',
    row && row.score===headline+'%', JSON.stringify(row)+' headline='+headline);
  await p.context().close();
}

console.log('');
let pass=0,fail=0; res.forEach(r=>{r.c?pass++:fail++;console.log(`  ${r.c?'PASS':'FAIL'}  ${r.n}${r.d?'  -> '+r.d:''}`)});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await b.close(); api.close(); web.close();
process.exit(fail?1:0);
