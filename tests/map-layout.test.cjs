const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=process.env.FCT_TEST_OUTPUT||path.join(root,'test-results');
fs.mkdirSync(output,{recursive:true});
const checks=[];function check(name){checks.push(name);console.log('PASS: '+name);}
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:process.env.FCT_BROWSER_PATH||undefined});
 try{
  const p=await b.newPage({viewport:{width:1280,height:900}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await p.route('https://**',r=>r.abort());
  await p.addInitScript(()=>localStorage.setItem('fct-saved-v3',JSON.stringify(['13|0','2|1'])));
  await p.goto(pathToFileURL(path.join(root,'Forest City Transit.html')).href+'#app');
  assert.equal(await p.locator('#routeCards .rcard').count(),0);
  await p.locator('#routeCards').getByText('No saved routes yet',{exact:true}).waitFor();
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-home-without-default-routes.png')});
  check('Old default route cards are not loaded into Home');
  await p.locator('.tab[data-tab="account"]').click();
  assert.equal(await p.locator('#pane-account [data-account-card="digital"]').count(),0);
  assert.equal(await p.locator('#pane-account').getByText('Digital card',{exact:true}).count(),0);
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-account-physical-only.png')});
  await p.locator('.tab[data-tab="card"]').click();assert.equal(await p.locator('#qr').count(),1);
  await p.locator('#pane-card [data-card-id="digital"]').waitFor();
  check('Account omits the digital card; it remains available in Card');
  await p.locator('.tab[data-tab="map"]').click();
  await p.waitForTimeout(250);
  const nodes=await p.locator('#gsvg *').count();assert.ok(nodes<1800,'Map opening must not create thousands of hidden SVG labels');
  assert.ok(await p.locator('#labels text').count()<=70);
  assert.equal(await p.locator('#gsvg textPath').count(),0);
  assert.ok(await p.locator('#buses .bus').count()<100);
  check('Initial map has bounded SVG labels and only nearby buses');
  await p.locator('[aria-label="Center on my location"]').click();
  await p.locator('#gmap.zooming').waitFor();
  await p.locator('#gmap:not(.zooming):not(.gesturing)').waitFor();
  await p.locator('#mkStops .mk-stop').first().waitFor();
  const seenStops=await p.locator('#mkStops .mk-stop').count();assert.ok(seenStops>0&&seenStops<=100);
  assert.ok(await p.locator('#mkStops .stop-bus').count()>0);
  assert.equal(await p.locator('#mkStops .stop-bg').first().evaluate(el=>getComputedStyle(el).fill),'rgb(26, 115, 232)');
  const stop=p.locator('#mkStops .mk-stop').first(),stopName=await stop.getAttribute('aria-label');
  await stop.focus();await stop.press('Enter');
  await p.locator('#mcard').getByText(stopName,{exact:true}).waitFor();
  check('Blue bus-stop symbols open stop details with the keyboard');
  await p.locator('#mcard [data-action="save-line"]').first().click();
  await p.locator('.tab[data-tab="home"]').click();assert.equal(await p.locator('#routeCards .rcard').count(),1);
  await p.reload();assert.equal(await p.locator('#routeCards .rcard').count(),1);
  check('An explicitly saved route still appears and survives reload');
  await p.locator('.tab[data-tab="map"]').click();await p.locator('[aria-label="Center on my location"]').click();
  await p.locator('#gmap.zooming').waitFor();
  await p.locator('#gmap:not(.zooming)').waitFor();
  const checkLabels=async()=>{
   await p.locator('#gmap:not(.zooming):not(.gesturing)').waitFor();
   await p.waitForTimeout(150);
   const rectangles=await p.locator('#labels text').evaluateAll(els=>els.filter(el=>getComputedStyle(el).visibility!=='hidden').map(el=>{const r=el.getBoundingClientRect();return{name:el.textContent,x0:r.left,y0:r.top,x1:r.right,y1:r.bottom};}));
   assert.ok(rectangles.length>0&&rectangles.length<=70);
   for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
    const a=rectangles[i],c=rectangles[j];assert.ok(!(a.x0<c.x1&&a.x1>c.x0&&a.y0<c.y1&&a.y1>c.y0),'Labels overlap: '+a.name+' / '+c.name);
   }
  };
  await checkLabels();
  for(const action of ['Zoom in','Zoom out','Zoom out']){await p.locator('[aria-label="'+action+'"]').click();await p.locator('#gmap.zooming').waitFor();await p.locator('#gmap:not(.zooming)').waitFor();await checkLabels();}
  await p.setViewportSize({width:390,height:844});await p.waitForTimeout(250);await checkLabels();
  await p.locator('[aria-label="Center on my location"]').click();await p.locator('#gmap.zooming').waitFor();await p.locator('#gmap:not(.zooming)').waitFor();await checkLabels();
  await p.locator('#toast').waitFor({state:'hidden'});
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-clean-map-labels-stops.png')});
  check('Street and park labels do not overlap at multiple zoom levels or on mobile');
  await p.locator('[aria-label="Search stops and routes"]').fill('Richmond at Queens');
  await p.locator('#msr [data-action="search-stop"]').first().click();
  await p.locator('#mcard').waitFor();await p.locator('#gmap.zooming').waitFor();await p.locator('#gmap:not(.zooming)').waitFor();
  assert.ok(await p.locator('#mkStops .mk-stop.sel').count()===1);
  check('Stop search still selects a stop independently of icon thinning');
  await p.locator('.tab[data-tab="home"]').click();await p.locator('.tab[data-tab="map"]').click();
  assert.ok(await p.locator('#gsvg *').count()<1800);
  assert.deepEqual(errors,[]);check('Returning to the map reuses it without JavaScript errors');
  fs.writeFileSync(path.join(output,'LTC-map-layout-tests.json'),JSON.stringify({checks,errors,initialSvgNodes:nodes},null,2));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
