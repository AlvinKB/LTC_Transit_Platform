const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const output=process.env.FCT_TEST_OUTPUT||path.join(__dirname,'..','test-results');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FCT_BROWSER_PATH||undefined});
 try{
  const p=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2}),errors=[],checks=[];
  p.on('pageerror',e=>errors.push(e.message));await p.route('https://**',r=>r.abort());
  await p.goto(pathToFileURL(path.join(__dirname,'..','Forest City Transit.html')).href+'#map');
  const settled=async()=>{await p.locator('#gmap:not(.gesturing):not(.zooming)').waitFor();await p.waitForTimeout(180);};
  const zoomTo=async k=>{
   await p.evaluate(k=>{
    const m=document.getElementById('gmap'),r=m.getBoundingClientRect(),current=Number(document.getElementById('world').getAttribute('transform').slice(7).split(' ')[0]);
    m.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-Math.log(k/current)/.0022}));
   },k);
   await p.locator('#gmap.gesturing').waitFor();await settled();
  };
  for(const k of [.06,.14,.4,.7]){
   await zoomTo(k);
   const result=await p.evaluate(async()=>{
    const m=document.getElementById('gmap'),r=m.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const nodes=Array.from(document.querySelectorAll('#labels text,#mkStops .mk-stop,#buses .bus')).filter(el=>{
     const b=el.getBoundingClientRect();return b.left>r.left+25&&b.right<r.right-25&&b.top>r.top+140&&b.bottom<r.bottom-100&&getComputedStyle(el).display!=='none';
    });
    m.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:31,clientX:x,clientY:y,button:0}));
    const samples=[];
    for(const offset of [12,24,12,0]){
     m.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:31,clientX:x+offset,clientY:y+offset/2,buttons:1}));
     await new Promise(resolve=>setTimeout(resolve,180));
     samples.push(nodes.filter(el=>!el.isConnected||getComputedStyle(el).display==='none').map(el=>el.textContent||el.getAttribute('aria-label')));
    }
    m.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:31,clientX:x,clientY:y,button:0}));
    return{count:nodes.length,samples};
   });
   assert.ok(result.count>0,`Expected visible map features at scale ${k}`);
   assert.ok(result.samples.every(a=>a.length===0),`Small pans removed map items at ${k}: ${JSON.stringify(result)}`);
   await settled();checks.push({scale:k,...result});
  }
  console.log('PASS: Small pans retain the same visible labels, bus stops, and buses at city and street scales');
  await zoomTo(.125);const band=await p.locator('#gsvg').getAttribute('class');
  for(const k of [.102,.098,.102,.098]){await zoomTo(k);assert.equal(await p.locator('#gsvg').getAttribute('class'),band);}
  await zoomTo(.07);assert.notEqual(await p.locator('#gsvg').getAttribute('class'),band);
  console.log('PASS: Reversing a small zoom across an old cutoff keeps the same detail layer; a deliberate zoom out changes it');
  await zoomTo(.4);assert.ok(await p.locator('#mkStops .mk-stop').count()>0);
  for(const k of [.33,.31,.29]){await zoomTo(k);assert.ok(await p.locator('#mkStops .mk-stop').count()>0);}
  await zoomTo(.24);assert.equal(await p.locator('#mkStops .mk-stop').count(),0);
  console.log('PASS: Stops remain available through small zoom changes and hide only at a clearly wider view');
  await zoomTo(.06);await p.locator('.screen').screenshot({path:path.join(output,'LTC-stable-city-map.png')});
  await zoomTo(.7);await p.locator('.screen').screenshot({path:path.join(output,'LTC-stable-street-map.png')});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'LTC-map-visibility-tests.json'),JSON.stringify({checks,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
