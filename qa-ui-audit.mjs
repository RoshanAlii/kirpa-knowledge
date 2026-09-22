// Layout audit: walks every view at several widths and reports elements whose
// text is clipped, whose box overflows its parent, or whose tap target is too
// small. Run: node qa-ui-audit.mjs   (add FIX=1 to print only the summary)
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js'; const { chromium } = pw;
import http from 'http'; import fs from 'fs';

const web=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(fs.readFileSync('/home/claude/kirpa/index.html','utf8')
    .replace(/var DEFAULT_API_URL = '[^']*'/,"var DEFAULT_API_URL = ''"))});
await new Promise(r=>web.listen(8941,r));

const WIDTHS=[1440,1280,1024,820,600,390];
const VIEWS=['dashboard','assess','agents','teams','reports','admin','settings'];

const b=await chromium.launch();
const findings=[];

for(const w of WIDTHS){
  const ctx=await b.newContext({viewport:{width:w,height:900},deviceScaleFactor:1});
  const p=await ctx.newPage();
  await p.goto('http://localhost:8941/'); await p.waitForTimeout(200);
  await p.fill('#gateInput','Kirpa@2026'); await p.click('#gateBtn'); await p.waitForTimeout(600);

  for(const v of VIEWS){
    await p.evaluate(v=>setView(v), v); await p.waitForTimeout(350);   // not click(): the Settings link is display:none on narrow widths
    const bad=await p.evaluate(({view,width})=>{
      const out=[];
      const seen=new Set();
      const label=el=>{
        const id=el.id?'#'+el.id:'';
        const cls=el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'';
        const txt=(el.tagName==='SELECT'?(el.selectedOptions[0]||{}).textContent:el.textContent||'').trim().slice(0,28);
        return el.tagName.toLowerCase()+id+cls+(txt?` "${txt}"`:'');
      };
      document.querySelectorAll('.view.active *').forEach(el=>{
        const cs=getComputedStyle(el);
        if(cs.display==='none'||cs.visibility==='hidden'||!el.getClientRects().length) return;
        const r=el.getBoundingClientRect();
        if(!r.width||!r.height) return;
        const key=label(el)+'|'+Math.round(r.top);
        if(seen.has(key)) return; seen.add(key);

        // 1. text actually clipped. Only elements that really clip count:
        //    form controls (the browser clips those itself) and anything with a
        //    non-visible overflow. A plain <div> just paints outside its padding
        //    box, which looks fine, so flagging it is noise.
        const formCtl = ['SELECT','INPUT','BUTTON','TEXTAREA'].includes(el.tagName);
        const clips = formCtl || cs.overflowY==='hidden' || cs.overflowX==='hidden'
                   || cs.overflow==='hidden' || cs.textOverflow==='ellipsis';
        const leaf = !el.children.length || formCtl;
        if(clips && leaf){
          const inner = r.height - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
                      - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
          let need = 0, text = '';
          if(el.tagName==='SELECT'){
            // measure the selected option's text with the control's own font
            text = ((el.selectedOptions[0]||{}).textContent||'').trim();
            if(text){
              const probe=document.createElement('span');
              probe.textContent=text;
              probe.style.cssText=`position:absolute;visibility:hidden;white-space:pre;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
              document.body.appendChild(probe);
              need=probe.getBoundingClientRect().height;
              probe.remove();
            }
          }else if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'){
            text = el.value||el.placeholder||'';
            if(text){
              const probe=document.createElement('span');
              probe.textContent=text;
              probe.style.cssText=`position:absolute;visibility:hidden;white-space:pre;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
              document.body.appendChild(probe);
              need=probe.getBoundingClientRect().height;
              probe.remove();
            }
          }else{
            text=(el.textContent||'').trim();
            if(text && el.firstChild && el.firstChild.nodeType===3){
              const rg=document.createRange(); rg.selectNodeContents(el);
              need=rg.getBoundingClientRect().height;
            }
          }
          if(text && need > inner + 0.5)
            out.push({view,width,kind:'text clipped',el:label(el),
              detail:`text needs ${need.toFixed(1)}px, content box is ${inner.toFixed(1)}px (short by ${(need-inner).toFixed(1)}px)`});
          // A control with almost no headroom is not safe either: a slightly
          // taller font, a bolder weight or a browser that rounds differently
          // clips it. This applies only to controls whose height is FIXED by
          // CSS - a button sized by its own padding grows with its text and by
          // definition has zero slack, which is fine.
          const fixedHeight = ['SELECT','INPUT','TEXTAREA'].includes(el.tagName);
          if(text && fixedHeight && need <= inner + 0.5 && need > inner - 2)
            out.push({view,width,kind:'no headroom',el:label(el),
              detail:`only ${(inner-need).toFixed(1)}px of slack (text ${need.toFixed(1)}px in a ${inner.toFixed(1)}px box)`});
        }

        // 2. content spills out of its own scroll box
        if(el.scrollHeight - el.clientHeight > 2 && cs.overflowY==='visible' && el.clientHeight>0 && leaf && !formCtl)
          out.push({view,width,kind:'vertical overflow',el:label(el),detail:`${el.scrollHeight}px in a ${el.clientHeight}px box`});

        // 3. interactive targets that are too small to hit reliably
        if((el.tagName==='BUTTON'||el.tagName==='SELECT'||el.tagName==='INPUT') && r.height>0 && r.height<28
           && el.type!=='checkbox' && el.type!=='hidden')
          out.push({view,width,kind:'tap target',el:label(el),detail:`${Math.round(r.height)}px tall`});

        // 4. text too small to read
        if(leaf && (el.textContent||'').trim() && parseFloat(cs.fontSize)<10)
          out.push({view,width,kind:'tiny text',el:label(el),detail:cs.fontSize});
      });
      // 5. the page itself scrolling sideways
      if(document.documentElement.scrollWidth > window.innerWidth+1)
        out.push({view,width,kind:'PAGE scrolls sideways',el:'<html>',detail:`${document.documentElement.scrollWidth}px > ${window.innerWidth}px`});
      return out;
    },{view:v,width:w});
    findings.push(...bad);
  }
  await ctx.close();
}
await b.close(); web.close();

const byKind={};
findings.forEach(f=>{(byKind[f.kind]=byKind[f.kind]||[]).push(f)});
Object.keys(byKind).sort().forEach(k=>{
  console.log(`\n### ${k}  (${byKind[k].length})`);
  const seen=new Set();
  byKind[k].forEach(f=>{
    const key=f.el+'|'+f.kind;
    if(seen.has(key))return; seen.add(key);
    const widths=[...new Set(byKind[k].filter(x=>x.el===f.el).map(x=>x.width))].join(',');
    console.log(`  ${f.el}\n     ${f.detail}   [${f.view} @ ${widths}px]`);
  });
});
console.log(`\n==== ${findings.length} findings ====`);
process.exit(0);
