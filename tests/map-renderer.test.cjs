const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FCT_BROWSER_PATH||undefined});
 try{
  for(const fallback of [false,true]){
   const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
   if(fallback)await page.addInitScript(()=>{window.Worker=class{constructor(){throw new Error('Workers disabled for fallback test');}};});
   await page.goto(pathToFileURL(path.join(__dirname,'..','Forest City Transit.html')).href+'#map');
   await page.locator('.map-cache.detail').waitFor({state:'attached'});
   assert.equal(await page.locator('#gmap').getAttribute('data-renderer'),fallback?'canvas':'worker-canvas');
   const fingerprint=()=>page.locator('.map-cache.detail').evaluate(c=>c.toDataURL());
   const before=await fingerprint();
   assert.ok(await page.locator('.map-gesture-surface').evaluate(c=>{
    const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let varied=0;
    for(let i=0;i<p.length;i+=400)if(Math.abs(p[i]-p[0])+Math.abs(p[i+1]-p[1])+Math.abs(p[i+2]-p[2])>20)varied++;
    return varied>20;
   }),'Visible map must contain rendered features, not a blank canvas');
   // A nearby pan should reuse the padded cache, not render the city again.
   await page.evaluate(()=>{
    window.originalMapDetail=document.querySelector('.map-cache.detail');
    const m=document.getElementById('gmap'),r=m.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    m.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:x,clientY:y,button:0}));
    m.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x+20,clientY:y+10,buttons:1}));
    m.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:x+20,clientY:y+10,button:0}));
   });
   await page.locator('#gmap:not(.gesturing)').waitFor();await page.waitForTimeout(250);
   assert.equal(await page.evaluate(()=>window.originalMapDetail===document.querySelector('.map-cache.detail')),true);
   assert.equal(await fingerprint(),before,'Nearby panning reuses the cached pixels');
   await page.locator('[data-action="routes-sheet"]').click();await page.locator('[data-action="routes-none"]').click();
   await page.waitForFunction(old=>{const c=document.querySelector('.map-cache.detail');return c&&c.toDataURL()!==old;},before);
   await page.locator('#sheet [data-action="close-sheet"]').first().click();
   await page.emulateMedia({colorScheme:'dark'});await page.locator('.map-cache.detail').waitFor({state:'attached'});
   await page.waitForFunction(()=>document.querySelector('.map-cache.detail')?.getContext('2d').getImageData(0,0,1,1).data[0]<100);
   assert.deepEqual(errors,[]);await page.close();
   console.log('PASS: '+(fallback?'Fallback':'Background')+' renderer paints offline, reuses pan caches, and refreshes routes and dark mode');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
