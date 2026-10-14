const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=process.env.FCT_TEST_OUTPUT||path.join(root,'test-results');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FCT_BROWSER_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
  await page.goto(pathToFileURL(path.join(root,'Forest City Transit.html')).href+'#map');
  const lookup=async(query)=>{
   if(await page.locator('#mapBack').isVisible())await page.locator('#mapBack').click();
   await page.locator('#mapSearch').fill(query);
   await page.locator('#msr [data-action="search-stop"]').first().click();
   await page.locator('#mcard').waitFor();
   await page.locator('#gmap:not(.zooming):not(.gesturing)').waitFor();
  };
  const checkFit=async()=>{
   const sizes=await page.locator('#mcard').evaluate(card=>{
    const r=card.getBoundingClientRect(),pane=card.parentElement.getBoundingClientRect(),controls=document.querySelector('.mctl').getBoundingClientRect();
    return {overflow:card.scrollWidth-card.clientWidth,left:r.left-pane.left,right:pane.right-r.right,controlsBottom:controls.bottom,cardTop:r.top,
     rowsFit:Array.from(card.querySelectorAll('.mrow')).every(el=>el.scrollWidth<=el.clientWidth+1)};
   });
   assert.ok(sizes.overflow<=1&&sizes.rowsFit,'Stop lookup must fit without horizontal overflow');
   assert.ok(Math.abs(sizes.left-sizes.right)<=1,'Bottom panel uses the full map width');
   assert.ok(sizes.controlsBottom<=sizes.cardTop,'Map controls stay above the lookup');
  };
  await lookup('Ridout at Horton');await checkFit();
  assert.ok(await page.locator('#mcard .stop-route').count()>=2);
  assert.ok(await page.locator('#mcard .arrival-clock').count()>0);
  assert.equal(await page.locator('#mcard').getByText('Tap the star to save a route to your Home screen.').count(),0);
  await page.locator('#mcard [data-action="save-line"]').first().click();
  await page.locator('#mcard [data-action="save-line"][aria-pressed="true"]').first().waitFor();
  console.log('PASS: Offline stop lookup shows departures and saves routes');
  await page.locator('#toast').waitFor({state:'hidden'});
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await checkFit();
   await page.locator('.screen').screenshot({path:path.join(output,'LTC-stop-lookup-'+width+'.png')});
  }
  console.log('PASS: Long destinations fit at desktop, 390px and 320px without side scrolling');
  await page.locator('#mcard [data-action="stop-route-filter"][data-route="15"]').click();
  assert.ok(await page.locator('#mcard .mrow').count()>0);
  assert.equal(await page.locator('#mcard .stop-route:not([data-route="15"])').count(),0);
  await page.locator('#mcard [data-action="stop-route-filter"][data-route="15"]').click();
  await page.locator('#mcard [data-action="stop-directions"]').click();
  assert.equal(await page.locator('#trip-from').inputValue(),'Current location');
  assert.ok((await page.locator('#trip-to').inputValue()).includes('Ridout at Horton'));
  await page.locator('#sheet [data-action="close-sheet"]').first().click();
  await page.locator('#mcard [data-action="stop-expand"]').first().click();
  await page.locator('#mcard.expanded').waitFor();await checkFit();
  await page.locator('#mcard [data-action="stop-expand"]').first().click();
  await page.locator('#mcard:not(.expanded)').waitFor();
  await page.locator('#mcard .stop-handle').evaluate(handle=>{
   const r=handle.getBoundingClientRect();
   handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:88,clientY:r.top+8,pointerType:'touch'}));
   window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:88,clientY:r.top-50,pointerType:'touch'}));
  });
  await page.locator('#mcard.expanded').waitFor();await checkFit();
  await page.locator('#mcard [data-action="stop-expand"]').first().click();
  await page.locator('#mcard [data-action="save-stop-routes"]').click();
  await page.locator('#mcard [data-action="save-stop-routes"][aria-pressed="true"]').waitFor();
  console.log('PASS: Route filters, directions and expandable stop details work');
  await page.locator('#mcard .stop-route').first().click();
  await page.locator('#mcard').waitFor({state:'hidden'});await page.locator('#focusPill').waitFor();
  console.log('PASS: Tapping a destination shows its route on the map');
  await lookup('Wellington at Dundas');await checkFit();
  const departures=await page.locator('#mcard .stop-departures').innerText();
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Skip ahead 5 min'}).click();
  await page.waitForFunction(before=>document.querySelector('#mcard .stop-departures').innerText!==before,departures);
  console.log('PASS: Upcoming departures update with the demo clock');
  await lookup('Richmond at Mill');
  assert.ok((await page.locator('#mcard').innerText()).includes('Closed'));
  assert.equal(await page.locator('#mcard [data-mst]').count(),0);
  await page.getByRole('button',{name:'Skip ahead 5 min'}).click();
  assert.equal(await page.locator('#mcard [data-mst]').count(),0);
  await page.locator('#mcard [data-action="map-card-close"]').click();
  assert.equal(await page.locator('#pane-map').evaluate(el=>el.style.getPropertyValue('--map-card-height')),'0px');
  assert.deepEqual(errors,[]);
  console.log('PASS: Closed stops stay closed as time advances; closing restores map controls');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
