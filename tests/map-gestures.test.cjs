const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=process.env.FCT_TEST_OUTPUT||path.join(root,'test-results');
fs.mkdirSync(output,{recursive:true});
const checks=[];function check(name){checks.push(name);console.log('PASS: '+name);}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FCT_BROWSER_PATH||undefined});
 try{
  const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await p.route('https://**',r=>r.abort());
  await p.goto(pathToFileURL(path.join(root,'Forest City Transit.html')).href+'#map');
  await p.locator('[aria-label="Center on my location"]').click();await p.locator('#gmap.zooming').waitFor();await p.locator('#gmap:not(.zooming)').waitFor();
  await p.locator('#gmap .map-cache.detail').waitFor({state:'attached'});
  assert.equal(await p.locator('#gmap').getAttribute('data-renderer'),'worker-canvas');
  const before=await p.locator('#world').getAttribute('transform');
  const burst=await p.evaluate(async()=>{
   const map=document.getElementById('gmap'),r=map.getBoundingClientRect(),world=document.getElementById('world');
   let writes=0;const observer=new MutationObserver(list=>writes+=list.filter(m=>m.attributeName==='transform').length);observer.observe(world,{attributes:true});
   for(let i=0;i<60;i++)map.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width*.5,clientY:r.top+r.height*.5,deltaY:-2}));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));observer.disconnect();
   return{writes,gesturing:map.classList.contains('gesturing'),baseDisplay:getComputedStyle(document.getElementById('baseMap')).display};
  });
  assert.ok(burst.writes>=1&&burst.writes<=2,'Wheel burst is rendered once per frame');
  assert.equal(burst.gesturing,true);assert.equal(burst.baseDisplay,'none');
  const surface=await p.locator('.map-gesture-surface').evaluate(el=>({width:el.width,height:el.height,transform:getComputedStyle(el).transform}));
  const viewport=await p.locator('#gmap').boundingBox();
  assert.ok(surface.width<=Math.ceil(viewport.width*1.5)&&surface.height<=Math.ceil(viewport.height*1.5));
  assert.equal(surface.transform,'none');
  assert.equal(await p.locator('.map-cache').evaluateAll(els=>els.every(el=>getComputedStyle(el).display==='none'&&getComputedStyle(el).transform==='none')),true);
  assert.notEqual(await p.locator('#world').getAttribute('transform'),before);
  // Keep a real gesture active while capturing, rather than its settled SVG.
  await p.evaluate(()=>{
    const map=document.getElementById('gmap'),r=map.getBoundingClientRect();
    window.gestureCaptureTimer=setInterval(()=>map.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-.1})),30);
  });
  try{await p.locator('.screen').screenshot({path:path.join(output,'LTC-smooth-map-gesture.png')});}
  finally{await p.evaluate(()=>clearInterval(window.gestureCaptureTimer));}
  check('Rapid wheel input uses the raster cache and batches camera updates per frame');
  await p.locator('#gmap:not(.gesturing):not(.zooming)').waitFor();
  assert.notEqual(await p.locator('#baseMap').evaluate(el=>getComputedStyle(el).display),'none');
  await p.locator('#labels text').first().waitFor();
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-smooth-map-settled.png')});
  check('Street labels remain available after wheel zoom settles');
  const beforePan=await p.locator('#world').getAttribute('transform');
  const r=await p.locator('#gmap').boundingBox();
  await p.mouse.move(r.x+r.width*.5,r.y+r.height*.55);await p.mouse.down();
  await p.mouse.move(r.x+r.width*.5+65,r.y+r.height*.55+35,{steps:12});await p.mouse.up();
  await p.locator('#gmap:not(.gesturing)').waitFor();
  assert.notEqual(await p.locator('#world').getAttribute('transform'),beforePan);
  check('Dragging pans the map and ends its gesture cleanly');
  await p.evaluate(async()=>{
   const map=document.getElementById('gmap'),r=map.getBoundingClientRect(),x=r.left+r.width*.5,y=r.top+r.height*.5;
   const event=(type,id,px)=>map.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:px,clientY:y,button:0,buttons:1}));
   event('pointerdown',10,x-40);event('pointerdown',11,x+40);
   event('pointermove',10,x-60);event('pointermove',11,x+60);
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   event('pointerup',10,x-60);event('pointerup',11,x+60);
  });
  await p.locator('#gmap:not(.gesturing):not(.zooming)').waitFor();
  assert.equal(await p.locator('#gmap.dragging').count(),0);
  check('Two-pointer pinch zoom returns to the normal interactive map');
  const checkFrames=async()=>p.evaluate(async()=>{
    const map=document.getElementById('gmap'),r=map.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const canvas=document.querySelector('.map-gesture-surface'),frames=[];
    const sample=()=>{
      if(!map.classList.contains('gesturing'))throw new Error('Pixel checks must sample the active gesture renderer');
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let transparent=0,black=0;
      for(let gy=0;gy<=10;gy++)for(let gx=0;gx<=10;gx++){
        const sx=Math.min(canvas.width-1,Math.floor(canvas.width*gx/10)),sy=Math.min(canvas.height-1,Math.floor(canvas.height*gy/10)),i=(sy*canvas.width+sx)*4;
        if(pixels[i+3]!==255)transparent++;
        if(pixels[i]<8&&pixels[i+1]<8&&pixels[i+2]<8)black++;
      }
      frames.push({transparent,black});
    };
    map.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:33,clientX:x,clientY:y,button:0}));
    for(const offset of [150,500,1200,-650,-1200,0]){
      map.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:33,clientX:x+offset,clientY:y+offset/3,buttons:1}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));sample();
    }
    map.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:33,clientX:x,clientY:y,button:0}));
    return frames;
  });
  const lightFrames=await checkFrames();
  assert.ok(lightFrames.every(frame=>frame.transparent===0&&frame.black===0));
  await p.locator('#gmap:not(.gesturing)').waitFor();
  check('Large pans render opaque viewport-sized frames without black pixels or transparent edges');
  await p.locator('[aria-label="Search stops and routes"]').fill('Richmond at Queens');await p.locator('#msr [data-action="search-stop"]').first().click();
  await p.locator('#gmap.zooming').waitFor();await p.locator('#gmap:not(.zooming)').waitFor();await p.locator('#mcard').waitFor();
  assert.ok(await p.locator('#mkStops .mk-stop.sel').count()===1);
  check('Stop search and selection still work after cached gestures');
  await p.locator('#mcard [data-action="map-card-close"]').click();
  await p.emulateMedia({colorScheme:'dark'});await p.locator('#gmap .map-cache.detail').waitFor({state:'attached'});
  const darkFrames=await checkFrames();assert.ok(darkFrames.every(frame=>frame.transparent===0&&frame.black===0));
  await p.locator('#gmap:not(.gesturing)').waitFor();
  assert.equal(await p.locator('#gmap .map-cache.detail').count(),1);
  await p.locator('[aria-label="Zoom in"]').click();await p.locator('#gmap.zooming').waitFor();await p.locator('#gmap:not(.zooming)').waitFor();
  await p.locator('[aria-label="Zoom out"]').click();await p.locator('#gmap.zooming').waitFor();await p.locator('#gmap:not(.zooming)').waitFor();
  check('Theme changes rebuild the cache and zoom buttons continue to work');
  const map=await p.locator('#gmap').boundingBox();await p.mouse.move(map.x+map.width/2,map.y+map.height/2);await p.mouse.wheel(0,100);
  await p.locator('.tab[data-tab="home"]').click();await p.waitForTimeout(250);
  assert.equal(await p.locator('#gmap.gesturing').count(),0);
  await p.locator('.tab[data-tab="map"]').click();
  assert.ok(await p.locator('#gmap .map-cache').count()<=1);
  assert.deepEqual(errors,[]);check('Leaving the map cancels gesture work; cache stays bounded and no JavaScript errors occur');
  fs.writeFileSync(path.join(output,'LTC-map-gesture-tests.json'),JSON.stringify({checks,errors,lightFrames,darkFrames},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
