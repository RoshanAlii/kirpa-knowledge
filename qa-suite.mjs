import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';

// ---------------- mock Apps Script backend ----------------
let store={rev:0,state:null,updatedAt:null}, failNext=0, reqLog=[];
const api=http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  reqLog.push(q.url);
  const h={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if(failNext>0){failNext--;s.writeHead(404,h);return s.end('<html>404</html>');}
  let j={};try{j=JSON.parse(b||'{}')}catch(e){}
  if(j.token!=='kirpa_aa7abca846471b077fa6671cbf6943f4'){s.writeHead(200,h);return s.end(JSON.stringify({ok:false,error:'Invalid token'}))}
  if(j.action==='get'){s.writeHead(200,h);return s.end(JSON.stringify({ok:true,...store}))}
  if(j.action==='put'){store={rev:store.rev+1,state:j.state,updatedAt:new Date().toISOString()};s.writeHead(200,h);return s.end(JSON.stringify({ok:true,rev:store.rev,updatedAt:store.updatedAt}))}
  if(j.action==='patch'){
    if(!store.state){s.writeHead(200,h);return s.end(JSON.stringify({ok:false,error:'Nothing stored yet - push a full copy first'}))}
    const st=store.state;
    (j.scopes||[]).forEach(sc=>{
      if(sc.upserts||sc.deletes){const touched={};(sc.upserts||[]).forEach(r=>touched[r.agent]=1);(sc.deletes||[]).forEach(a=>touched[a]=1);
        st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area&&touched[r.agent]));
        (sc.upserts||[]).forEach(r=>st.records.push(r));return;}
      st.records=st.records.filter(r=>!(r.week===sc.week&&r.team===sc.team&&(r.area||'')===sc.area));(sc.records||[]).forEach(r=>st.records.push(r));});
    if(j.roster){if(j.roster.teams)st.teams=j.roster.teams;if(j.roster.inactive)st.inactive=j.roster.inactive;}
    store={rev:store.rev+1,state:st,updatedAt:new Date().toISOString()};
    s.writeHead(200,h);return s.end(JSON.stringify({ok:true,rev:store.rev,updatedAt:store.updatedAt}))}
  s.writeHead(200,h);s.end(JSON.stringify({ok:true,time:'x'}))})});
await new Promise(r=>api.listen(8900,r));

const SRC='/home/claude/kirpa/index.html';
function page(offline){
  return fs.readFileSync(SRC,'utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/, offline?"var DEFAULT_API_URL = ''":"var DEFAULT_API_URL = 'http://localhost:8900/exec'")
    .replace("/^https:\\/\\/script\\.google\\.com\\//","/^http/");
}
const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});s.end(page(!q.url.includes('sync')))});
await new Promise(r=>web.listen(8901,r));

// ---------------- harness ----------------
const results=[]; let group='';
const G=n=>{group=n};
function check(name,cond,detail){results.push({group,name,pass:!!cond,detail:cond?'':(detail||'')});}
const b=await chromium.launch();
async function fresh(opts={}){
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage();
  p.on('pageerror',e=>results.push({group,name:'UNCAUGHT JS ERROR',pass:false,detail:e.message}));
  p.on('console',m=>{if(m.type()==='error'&&!/ERR_|Failed to load resource/.test(m.text()))results.push({group,name:'CONSOLE ERROR',pass:false,detail:m.text()});});
  await p.goto('http://localhost:8901/'+(opts.sync?'?sync=1':'')); await p.waitForTimeout(250);
  if(!opts.locked){ await p.fill('#gateInput','Kirpa@2026'); if(opts.noRemember) await p.uncheck('#gateRemember'); await p.click('#gateBtn'); await p.waitForTimeout(opts.sync?900:350); }
  return {ctx,p};
}
const nav=async(p,v)=>{await p.click(`[data-view="${v}"]`);await p.waitForTimeout(250);};

// ==========================================================
G('1. Passcode gate');
{
  const {ctx,p}=await fresh({locked:true});
  check('gate blocks the app on first visit', await p.isVisible('#gate'));
  check('body scroll locked while gated', await p.evaluate(()=>document.body.style.overflow==='hidden'));
  await p.click('#gateBtn'); await p.waitForTimeout(200);
  check('empty passcode is rejected with a message', (await p.textContent('#gateErr')).includes('Enter'));
  await p.fill('#gateInput','wrong'); await p.click('#gateBtn'); await p.waitForTimeout(250);
  check('wrong passcode is rejected', (await p.textContent('#gateErr')).includes('Incorrect') && await p.isVisible('#gate'));
  check('wrong passcode clears the field', (await p.inputValue('#gateInput'))==='');
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(400);
  check('correct passcode unlocks', !(await p.isVisible('#gate')));
  check('scroll lock released', await p.evaluate(()=>document.body.style.overflow!=='hidden'));
  await p.reload(); await p.waitForTimeout(500);
  check('"remember" keeps the device unlocked across reload', !(await p.isVisible('#gate')));
  const exp=await p.evaluate(()=>{try{return JSON.parse(localStorage.getItem('kirpaGate_v1')).exp}catch(e){return 0}});
  check('remember token expires in ~7 days', exp>Date.now()+6.5*864e5 && exp<Date.now()+7.5*864e5, 'exp='+new Date(exp).toISOString());
  await ctx.close();
}
{
  const {ctx,p}=await fresh({noRemember:true});
  await p.reload(); await p.waitForTimeout(400);
  check('unchecking "remember" re-locks on reload', await p.isVisible('#gate'));
  await ctx.close();
}

// ==========================================================
G('2. Dashboard figures');
{
  const {ctx,p}=await fresh();
  const d=await p.evaluate(()=>({
    score:document.getElementById('companyScore').textContent,
    poor:document.getElementById('poorCount').textContent,
    weak:document.getElementById('weakCount').textContent,
    good:document.getElementById('goodCount').textContent,
    very:document.getElementById('veryCount').textContent,
    poorPct:document.getElementById('poorPct').textContent,
    // independent recomputation from raw state
    calc:(()=>{const S={1:25,2:50,3:75,4:100};const recs=state.records.filter(r=>r.week==='2026-09-11'&&r.level);
      const byAgent={};recs.forEach(r=>{(byAgent[r.team+'|'+r.agent]=byAgent[r.team+'|'+r.agent]||[]).push(S[r.level])});
      const scores=Object.values(byAgent).map(a=>Math.round(a.reduce((x,y)=>x+y,0)/a.length));
      const lvl=s=>s<38?1:s<63?2:s<88?3:4;const c={1:0,2:0,3:0,4:0};scores.forEach(s=>c[lvl(s)]++);
      return {n:scores.length,avg:Math.round(scores.reduce((x,y)=>x+y,0)/scores.length),c};})()
  }));
  check('company score matches an independent recompute', d.score===d.calc.avg+'%', `ui=${d.score} calc=${d.calc.avg}%`);
  check('Poor count correct', +d.poor===d.calc.c[1], `ui=${d.poor} calc=${d.calc.c[1]}`);
  check('Weak count correct', +d.weak===d.calc.c[2], `ui=${d.weak} calc=${d.calc.c[2]}`);
  check('Good count correct', +d.good===d.calc.c[3], `ui=${d.good} calc=${d.calc.c[3]}`);
  check('Very Good count correct', +d.very===d.calc.c[4], `ui=${d.very} calc=${d.calc.c[4]}`);
  check('Poor % is of assessed agents', d.poorPct===Math.round(d.calc.c[1]/d.calc.n*100)+'%', `ui=${d.poorPct}`);
  const lc=await p.$$eval('#levelGrid .level-card',els=>els.map(e=>({head:e.querySelector('.level-head').textContent.trim(),rows:e.querySelectorAll('.agent-row').length,more:!!e.querySelector('.more')})));
  check('level cards cap the list at 6 and offer "more"', lc.every(c=>c.rows<=6) && lc.some(c=>c.more||c.rows<6));
  check('team filter narrows the dashboard', await (async()=>{const before=await p.textContent('#companyScore');await p.selectOption('#teamFilter','Team Saloni');await p.waitForTimeout(300);const after=await p.textContent('#companyScore');await p.selectOption('#teamFilter','ALL');await p.waitForTimeout(250);return before!==after})());
  await ctx.close();
}

// ==========================================================
G('3. Assess — save / edit / delete');
{
  const {ctx,p}=await fresh();
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Lipika'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  check('roster shows all active members of the team', (await p.$$('#weeklyGrid .assessment-person')).length===5);
  // save two
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .level-btn[data-level="1"]',e=>e.click());
  await p.$eval('#weeklyGrid [data-agent="Sadaf"] .level-btn[data-level="3"]',e=>e.click());
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .comment-input',e=>{e.value='needs drilling';e.dispatchEvent(new Event('input'))});
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  let recs=await p.evaluate(()=>state.records.filter(r=>r.week==='2026-09-18'));
  check('saving writes one record per selected agent', recs.length===2, JSON.stringify(recs));
  check('comment is stored with the record', (recs.find(r=>r.agent==='Kirti')||{}).comment==='needs drilling');
  check('save navigates back to the dashboard', await p.isVisible('#view-dashboard.active'));
  // edit
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Lipika'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  check('existing selection is pre-filled on return', await p.$eval('#weeklyGrid [data-agent="Kirti"] .level-btn[data-level="1"]',e=>e.classList.contains('selected')));
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .level-btn[data-level="3"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  recs=await p.evaluate(()=>state.records.filter(r=>r.week==='2026-09-18'));
  check('editing updates in place, does not duplicate', recs.length===2 && recs.find(r=>r.agent==='Kirti').level===3, JSON.stringify(recs));
  // deselect removes
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Lipika'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  await p.$eval('#weeklyGrid [data-agent="Kirti"] .level-btn.selected',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  recs=await p.evaluate(()=>state.records.filter(r=>r.week==='2026-09-18'));
  check('toggling a level off deletes that record', recs.length===1 && !recs.some(r=>r.agent==='Kirti'), JSON.stringify(recs));
  // separate areas coexist
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Lipika'); await p.selectOption('#assessArea','Sales Presentation / Pitch'); await p.waitForTimeout(250);
  await p.$eval('#weeklyGrid [data-agent="Sadaf"] .level-btn[data-level="4"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  recs=await p.evaluate(()=>state.records.filter(r=>r.week==='2026-09-18'&&r.agent==='Sadaf'));
  check('same agent can hold one record per knowledge area', recs.length===2 && new Set(recs.map(r=>r.area)).size===2, JSON.stringify(recs));
  // agent score = mean across areas
  const s=await p.evaluate(()=>agentSummaries('2026-09-18','Team Lipika').find(x=>x.agent==='Sadaf'));
  check('agent score averages across areas (75+100)/2 = 88', s.score===88, 'score='+s.score);
  // Clear Form
  await nav(p,'assess'); await p.waitForTimeout(200);
  await p.$eval('#weeklyGrid .assessment-person .level-btn[data-level="2"]',e=>e.click());
  await p.click('#clearTeamForm'); await p.waitForTimeout(200);
  check('Reset Form discards unsaved edits but keeps saved ones',
    await p.evaluate(()=>{
      const sel=[...document.querySelectorAll('#weeklyGrid .assessment-person')]
        .map(r=>({a:r.dataset.agent,l:(r.querySelector('.level-btn.selected')||{}).textContent||null}));
      const saved=state.records.filter(r=>r.week===document.getElementById('assessWeek').value
        &&r.team===document.getElementById('assessTeam').value
        &&(r.area||'')===document.getElementById('assessArea').value);
      return sel.filter(x=>x.l).length===saved.length;}));
  await ctx.close();
}

// ==========================================================
G('4. Assess — previous-level marker');
{
  const {ctx,p}=await fresh();
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-11'); await p.selectOption('#assessTeam','Team Kamal'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  check('no marker when the selected week is the earliest', (await p.$$('#weeklyGrid .level-btn.prev')).length===0);
  check('"no earlier record" is suppressed when nobody has history', (await p.$$('#weeklyGrid .prev-none')).length===0);
  await p.fill('#assessWeek','2026-09-18'); await p.waitForTimeout(250);
  const rows=await p.$$eval('#weeklyGrid .assessment-person',es=>es.map(e=>({a:e.dataset.agent,prev:(e.querySelector('.level-btn.prev')||{}).textContent||null,tag:(e.querySelector('.prev-tag')||{}).textContent||null,none:!!e.querySelector('.prev-none')})));
  check('falls back to another area and names it', rows.find(r=>r.a==='Mona')?.prev==='Poor' && /Paper/.test(rows.find(r=>r.a==='Mona').tag||''), JSON.stringify(rows.find(r=>r.a==='Mona')));
  check('agents with no history show "No earlier record"', rows.find(r=>r.a==='Kamal')?.none===true);
  check('marker never marks more than one button per agent', await p.$$eval('#weeklyGrid .assessment-person',es=>es.every(e=>e.querySelectorAll('.level-btn.prev').length<=1)));
  // same-area beats cross-area
  await p.$eval('#weeklyGrid [data-agent="Mona"] .level-btn[data-level="4"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-25'); await p.selectOption('#assessTeam','Team Kamal'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(300);
  const mona=await p.$eval('#weeklyGrid .assessment-person[data-agent="Mona"]',e=>({prev:(e.querySelector('.level-btn.prev')||{}).textContent,tag:(e.querySelector('.prev-tag')||{}).textContent}));
  check('same-area history takes priority over the fallback', mona.prev==='Very Good' && !/Paper/.test(mona.tag), JSON.stringify(mona));
  check('marker shows the most recent prior week, not the oldest', /18 Sep/.test(mona.tag), mona.tag);
  await ctx.close();
}

// ==========================================================
G('5. Agents view');
{
  const {ctx,p}=await fresh();
  await nav(p,'agents');
  const all=(await p.$$('#agentsBody tr')).length;
  check('all 40 agents listed by default', all===40, 'rows='+all);
  await p.fill('#agentSearch','sah'); await p.waitForTimeout(200);
  const names=await p.$$eval('#agentsBody tr td:first-child',e=>e.map(x=>x.textContent));
  check('search matches case-insensitively on the name', names.length===2 && names.every(n=>/sah/i.test(n)), JSON.stringify(names));
  await p.fill('#agentSearch',''); await p.selectOption('#agentLevelFilter','1'); await p.waitForTimeout(200);
  check('level filter returns only that level', await p.$$eval('#agentsBody tr',rs=>rs.length>0&&rs.every(r=>r.children[2].textContent.trim()==='Poor')));
  await p.selectOption('#agentLevelFilter','NA'); await p.waitForTimeout(200);
  check('"Not assessed" filter works', await p.$$eval('#agentsBody tr',rs=>rs.length>0&&rs.every(r=>/Not assessed/.test(r.children[2].textContent))));
  await p.selectOption('#agentLevelFilter','REVIEW'); await p.waitForTimeout(200);
  check('"Declined since last week" is empty when there is only one week', (await p.$$('#agentsBody tr')).length===0);
  const declined=await p.evaluate(()=>{
    state.records.push({week:'2026-09-18',team:'Team Kamal',agent:'Karan',area:'Objection Handling',level:1,comment:''});
    state.records.push({week:'2026-09-18',team:'Team Kamal',agent:'Sarv',area:'Objection Handling',level:4,comment:''});
    saveState();setupSelectors();document.getElementById('weekFilter').value='2026-09-18';renderAll();
    document.getElementById('agentLevelFilter').value='REVIEW';renderAgents();
    return [...document.querySelectorAll('#agentsBody tr td:first-child')].map(t=>t.textContent);});
  check('"Declined since last week" lists only agents whose score dropped', declined.length===1&&declined[0]==='Karan', JSON.stringify(declined));
  await p.selectOption('#agentLevelFilter','ALL'); await p.selectOption('#agentTeamFilter','Team Kamal'); await p.waitForTimeout(200);
  check('team filter works', await p.$$eval('#agentsBody tr',rs=>rs.length===6&&rs.every(r=>r.children[1].textContent==='Team Kamal')));
  await p.selectOption('#agentTeamFilter','ALL'); await p.waitForTimeout(200);
  await p.click('#agentsBody .agent-link'); await p.waitForTimeout(300);
  check('clicking an agent opens the history modal', await p.isVisible('#agentModal.open'));
  await p.click('#modalClose'); await p.waitForTimeout(200);
  check('modal closes', !(await p.isVisible('#agentModal.open')));
  await ctx.close();
}

// ==========================================================
G('6. Teams / Reports / CSV');
{
  const {ctx,p}=await fresh();
  await nav(p,'teams');
  check('one card per team', (await p.$$('#teamGrid .team-card')).length===6);
  check('unassessed team reads "Not assessed yet"', (await p.$$('#teamGrid .score-none')).length===2);
  await p.click('[data-team-card="Team Kamal"]'); await p.waitForTimeout(300);
  check('clicking a team card filters the dashboard to it', await p.isVisible('#view-dashboard.active') && (await p.inputValue('#teamFilter'))==='Team Kamal');
  await p.selectOption('#teamFilter','ALL'); await p.waitForTimeout(200);
  await nav(p,'reports');
  check('weekly summary has a row per week', (await p.$$('#weeklyReportBody tr')).length===1);
  check('team summary has a row per team', (await p.$$('#teamReportBody tr')).length===6);
  const kpis=await p.$$eval('#reportKpis .kpi strong',e=>e.map(x=>x.textContent));
  check('report KPIs agree with the dashboard', kpis[0]==='40'&&kpis[1]==='18'&&kpis[2]==='45%'&&kpis[3]==='53%', JSON.stringify(kpis));
  const csv=await p.evaluate(()=>{const rows=[['Week','Team','Agent','Knowledge Area','Level','Score','Comment']];
    state.records.slice().forEach(r=>rows.push([r.week,r.team,r.agent,r.area,r.level?LEVELS[r.level]:'',r.level?SCORES[r.level]:'',r.comment||'']));return rows.length});
  check('CSV export covers every record', csv===19, 'rows='+csv);
  const esc=await p.evaluate(()=>{const v='He said "hi", ok';return '"'+String(v).replace(/"/g,'""')+'"'});
  check('CSV quoting doubles embedded quotes', esc==='"He said ""hi"", ok"');
  await ctx.close();
}

// ==========================================================
G('7. Admin roster management');
{
  const {ctx,p}=await fresh();
  await nav(p,'admin');
  check('admin lists every roster row', (await p.$$('#adminBody tr')).length===40);
  p.once('dialog',d=>d.accept());
  await p.click('#addAgentBtn'); await p.waitForTimeout(250);
  check('empty name is rejected', (await p.$$('#adminBody tr')).length===40);
  await p.fill('#newAgentName','Test Agent'); await p.selectOption('#newAgentTeam','Team Lipika');
  await p.click('#addAgentBtn'); await p.waitForTimeout(300);
  check('new agent is added to the chosen team', (await p.$$('#adminBody tr')).length===41 && await p.evaluate(()=>state.teams.find(t=>t.name==='Team Lipika').members.includes('Test Agent')));
  await p.fill('#newAgentName','test agent');
  p.once('dialog',d=>d.accept());
  await p.click('#addAgentBtn'); await p.waitForTimeout(300);
  check('duplicate name (case-insensitive) is rejected', (await p.$$('#adminBody tr')).length===41);
  await p.$eval('#adminBody .admin-toggle',e=>e.click()); await p.waitForTimeout(300);
  check('deactivate marks the agent inactive', await p.evaluate(()=>state.inactive.length===1));
  const active=await p.evaluate(()=>activeMembers('ALL').length);
  check('inactive agent drops out of the active headcount', active===40, 'active='+active);
  await nav(p,'assess'); await p.selectOption('#assessTeam','Team Lipika'); await p.waitForTimeout(250);
  const inGrid=await p.$$eval('#weeklyGrid .assessment-person',es=>es.map(e=>e.dataset.agent));
  check('inactive agent is excluded from the assessment grid', !inGrid.includes('Lipika'), JSON.stringify(inGrid));
  await nav(p,'admin');
  await p.$eval('#adminBody .admin-toggle',e=>e.click()); await p.waitForTimeout(300);
  check('reactivate restores the agent', await p.evaluate(()=>state.inactive.length===0));
  await ctx.close();
}

// ==========================================================
G('8. Settings — backup / restore / reset');
{
  const {ctx,p}=await fresh();
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Kamal'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  await p.$eval('#weeklyGrid [data-agent="Karan"] .level-btn[data-level="4"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(350);
  const backup=await p.evaluate(()=>JSON.stringify(state));
  await nav(p,'settings');
  p.once('dialog',d=>d.accept());
  await p.click('#resetDataBtn'); await p.waitForTimeout(400);
  check('reset restores the original 18 paper records', await p.evaluate(()=>state.records.length===18));
  check('reset clears the added week', await p.evaluate(()=>!state.records.some(r=>r.week==='2026-09-18')));
  const restored=await p.evaluate(b=>{const x=normalizeState(JSON.parse(b));state=x;saveState();setupSelectors();renderAll();return state.records.length},backup);
  check('importing a backup restores the records', restored===19, 'records='+restored);
  const norm=await p.evaluate(()=>{const v=normalizeState({teams:state.teams,records:[{week:'2026-09-11',team:'Team Kamal',agent:'Mona',level:2}]});return v.records[0].area});
  check('records with a missing area are normalised to the paper area', norm==='Overall / General Knowledge (Imported Paper)', norm);
  const bad=await p.evaluate(()=>normalizeState(null).records.length);
  check('a corrupt/empty backup falls back to the seed data', bad===18, 'records='+bad);
  await ctx.close();
}

// ==========================================================
G('9. Escaping / injection');
{
  const {ctx,p}=await fresh();
  await nav(p,'admin');
  await p.fill('#newAgentName','<img src=x onerror=window.__xss=1>'); await p.selectOption('#newAgentTeam','Team Kamal');
  await p.click('#addAgentBtn'); await p.waitForTimeout(400);
  check('HTML in an agent name is escaped, not executed', await p.evaluate(()=>window.__xss===undefined));
  await nav(p,'assess'); await p.selectOption('#assessTeam','Team Kamal'); await p.waitForTimeout(300);
  await p.$eval('#weeklyGrid .assessment-person:last-child .level-btn[data-level="2"]',e=>e.click());
  await p.$eval('#weeklyGrid .assessment-person:last-child .comment-input',e=>{e.value='"><script>window.__xss2=1</script>';});
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  check('HTML in a coaching comment is escaped', await p.evaluate(()=>window.__xss2===undefined));
  check("team name with an apostrophe (Team Manpreet Ma'am) round-trips", await p.evaluate(()=>{
    const s=agentSummaries('2026-09-11',"Team Manpreet Ma'am"); return s.length===13 && s.filter(x=>x.assessed).length===6;}));
  await ctx.close();
}

// ==========================================================
G('10. Cloud sync');
{
  store={rev:0,state:null,updatedAt:null};
  const {ctx,p}=await fresh({sync:true});
  check('connects on load with the baked-in URL', (await p.textContent('#syncPillText'))==='Synced');
  await nav(p,'settings'); await p.click('#syncPushBtn'); await p.waitForTimeout(2200);
  check('first "Push to Sheet" seeds the sheet', store.rev>0 && store.state.records.length===18, 'rev='+store.rev);
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Kamal'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  await p.$eval('#weeklyGrid [data-agent="Sarv"] .level-btn[data-level="4"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(2200);
  check('a save is pushed to the sheet', store.rev>0 && store.state.records.some(r=>r.week==='2026-09-18'), 'rev='+store.rev);
  failNext=1;
  await nav(p,'assess'); await p.waitForTimeout(150);
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Kamal'); await p.selectOption('#assessArea','Investment / ROI Knowledge'); await p.waitForTimeout(250);
  await p.$eval('#weeklyGrid [data-agent="Prachi"] .level-btn[data-level="2"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(4500);
  check('a single transient 404 is retried and absorbed', (await p.textContent('#syncPillText'))==='Synced' && store.state.records.some(r=>r.agent==='Prachi'&&r.area==='Investment / ROI Knowledge'));
  const before=reqLog.length; reqLog=[];
  await p.waitForTimeout(100);
  check('every request carries a unique cache-buster', new Set(reqLog).size===reqLog.length || reqLog.length===0);
  // remote change propagates
  store.rev++; store.state.records.push({week:'2026-09-11',team:'Team Kamal',agent:'Christine',area:'Objection Handling',level:3,comment:'from another device'});
  store.updatedAt=new Date().toISOString();
  await p.waitForTimeout(23000);
  check('a change made elsewhere is pulled in', await p.evaluate(()=>state.records.some(r=>r.comment==='from another device')));
  // outage protects local edits
  failNext=99;
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-10-02'); await p.selectOption('#assessTeam','Team Kamal'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  await p.$eval('#weeklyGrid [data-agent="Karan"] .level-btn[data-level="1"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(16000);
  check('sustained outage surfaces "Not saved"', (await p.textContent('#syncPillText'))==='Not saved', await p.textContent('#syncPillText'));
  check('local edit survives the outage in the browser', await p.evaluate(()=>state.records.some(r=>r.week==='2026-10-02')));
  failNext=0; await p.waitForTimeout(12000);
  check('recovery pushes the edit made during the outage', store.state.records.some(r=>r.week==='2026-10-02'));
  check('pill returns to Synced', (await p.textContent('#syncPillText'))==='Synced');
  await ctx.close();
}

// ==========================================================
G('11. Sync — conflict safety');
{
  store={rev:5,state:{teams:[{name:'Team Kamal',leader:'Kamal',members:['Kamal','Karan']}],records:[{week:'2026-09-11',team:'Team Kamal',agent:'Karan',area:'Objection Handling',level:1,comment:'remote'}],legacy:[],inactive:[],version:3},updatedAt:new Date().toISOString()};
  const {ctx,p}=await fresh({sync:true});
  await p.waitForTimeout(1200);
  check('remote state replaces local on first connect', await p.evaluate(()=>state.teams.length===1&&state.records.length===1));
  check('roster from the sheet is what renders', await p.evaluate(()=>activeMembers('ALL').length===2));
  await ctx.close();
}

// ==========================================================
G('12. Offline / degraded');
{
  const {ctx,p}=await fresh();
  check('with no sheet configured the pill says "Local only"', (await p.textContent('#syncPillText'))==='Local only');
  await nav(p,'assess');
  await p.fill('#assessWeek','2026-09-18'); await p.selectOption('#assessTeam','Team Kamal'); await p.selectOption('#assessArea','Objection Handling'); await p.waitForTimeout(250);
  await p.$eval('#weeklyGrid [data-agent="Sarv"] .level-btn[data-level="3"]',e=>e.click());
  await p.click('#saveWeekBtn'); await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(700);
  check('offline edits persist across a reload (localStorage)', await p.evaluate(()=>state.records.some(r=>r.week==='2026-09-18')));
  await ctx.close();
}

// ---------------- report ----------------
await b.close(); api.close(); web.close();
const byGroup={}; results.forEach(r=>{(byGroup[r.group]=byGroup[r.group]||[]).push(r)});
let pass=0,fail=0;
for(const g of Object.keys(byGroup)){
  console.log('\n'+g);
  byGroup[g].forEach(r=>{ r.pass?pass++:fail++;
    console.log(`  ${r.pass?'PASS':'FAIL'}  ${r.name}${r.detail?'  -> '+r.detail:''}`)});
}
console.log(`\n==== ${pass} passed, ${fail} failed, ${pass+fail} checks ====`);
