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
  const p=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await p.route('https://**',r=>r.abort());
  await p.goto(pathToFileURL(path.join(__dirname,'..','Forest City Transit.html')).href+'#map');
  await p.locator('[aria-label="Center on my location"]').click();await p.locator('#gmap.zooming').waitFor();
  await p.locator('#gmap:not(.zooming):not(.gesturing)').waitFor();await p.locator('#labels text').first().waitFor();
  const pan=await p.evaluate(async()=>{
   const map=document.getElementById('gmap'),r=map.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
   const pose=()=>document.getElementById('world').getAttribute('transform').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
   const visible=()=>Array.from(document.querySelectorAll('#labels text')).filter(el=>{
    const b=el.getBoundingClientRect(),s=getComputedStyle(el);return s.visibility==='visible'&&s.display!=='none'&&b.left<r.right&&b.right>r.left&&b.top<r.bottom&&b.bottom>r.top;
   }).length;
   map.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:41,clientX:x,clientY:y,button:0}));
   const before=pose();map.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:41,clientX:x+120,clientY:y+40,buttons:1}));
   const immediate=pose(),frames=[];
   for(let i=0;i<8;i++){
    await new Promise(requestAnimationFrame);const canvas=document.querySelector('.map-gesture-surface');
    frames.push({pose:pose(),labels:visible(),source:canvas.dataset.source,width:canvas.width,height:canvas.height});
   }
   map.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:41,clientX:x+120,clientY:y+40,button:0}));
   return {before,immediate,frames,width:r.width,height:r.height};
  });
  assert.equal(pan.immediate[4],pan.before[4],'Input updates a target, not the rendered camera');
  assert.ok(pan.frames[0].pose[4]>pan.before[4]&&pan.frames[0].pose[4]<pan.before[4]+120,'First frame interpolates toward the target');
  assert.ok(pan.frames.every((f,i)=>f.labels>0&&f.width===Math.ceil(pan.width*2)&&f.height===Math.ceil(pan.height*2)&&['detail','native'].includes(f.source)&&(!i||f.pose[4]>=pan.frames[i-1].pose[4])));
  await p.locator('#gmap:not(.gesturing)').waitFor();
  const final=await p.locator('#world').getAttribute('transform');
  const pose=final.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
  assert.ok(Math.abs(pose[4]-pan.before[4]-120)<.02&&Math.abs(pose[5]-pan.before[5]-40)<.02);
  console.log('PASS: Pan lerps monotonically to the exact target; labels stay visible and the canvas keeps 2x resolution');
  const zoom=await p.evaluate(async()=>{
   const map=document.getElementById('gmap'),r=map.getBoundingClientRect();
   const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width*.3,clientY:r.top+r.height*.45,deltaY:-100});
   const sx=wheel.clientX-r.left,sy=wheel.clientY-r.top;
   const pose=()=>document.getElementById('world').getAttribute('transform').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
   const before=pose(),wx=(sx-before[4])/before[0],wy=(sy-before[5])/before[0],frames=[];
   map.dispatchEvent(wheel);
   const immediate=pose();
   for(let i=0;i<10;i++){
    await new Promise(requestAnimationFrame);const v=pose();
    frames.push({scale:v[0],error:Math.hypot((sx-v[4])/v[0]-wx,(sy-v[5])/v[0]-wy),visible:Array.from(document.querySelectorAll('#labels text')).filter(e=>getComputedStyle(e).visibility==='visible').length});
   }
   return {before,immediate,frames};
  });
  assert.equal(zoom.before[0],zoom.immediate[0]);
  assert.ok(zoom.frames.at(-1).scale>zoom.before[0]);
  assert.ok(zoom.frames.every((f,i)=>f.error<.05&&f.visible>0&&(!i||f.scale>=zoom.frames[i-1].scale)));
  await p.locator('#gmap:not(.gesturing):not(.zooming)').waitFor();
  console.log('PASS: Wheel zoom is interpolated and holds the world point under the cursor without hiding labels');
  // Capture moving content, not the already-settled map used by earlier tests.
  await p.evaluate(()=>{
   const map=document.getElementById('gmap'),r=map.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;let n=0;
   map.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:42,clientX:x,clientY:y,button:0}));
   window.motionTimer=setInterval(()=>map.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:42,clientX:x+Math.sin(++n/5)*35,clientY:y+Math.cos(n/5)*20,buttons:1})),25);
  });
  try{await p.locator('.screen').screenshot({path:path.join(output,'LTC-map-labels-during-motion.png')});}
  finally{await p.evaluate(()=>{clearInterval(window.motionTimer);document.getElementById('gmap').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:42,button:0}));});}
  await p.locator('#gmap:not(.gesturing)').waitFor();
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'LTC-map-motion-tests.json'),JSON.stringify({pan,zoom,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
