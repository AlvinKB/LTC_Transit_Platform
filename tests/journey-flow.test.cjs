const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=process.env.FCT_TEST_OUTPUT||path.join(root,'test-results');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FCT_BROWSER_PATH||undefined});
 try{
  const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await p.route('https://**',r=>r.abort());
  await p.goto(pathToFileURL(path.join(root,'Forest City Transit.html')).href+'#map');
  await p.locator('#mapSearch').fill('Wonderland North of McMaster');
  await p.locator('#msr [data-action="search-stop"]').first().click();
  await p.locator('#mcard [data-action="stop-directions"]').click();
  await p.locator('.trip-card').first().waitFor();
  assert.equal(await p.locator('#findRoutes').isDisabled(),false);
  assert.ok(await p.locator('.trip-card').count()>=2);
  assert.equal(await p.locator('.trip-card [data-action]').count(),0);
  assert.equal(await p.locator('#sheet .trip-actions, #sheet [data-action="close-sheet"].btn-primary').count(),0);
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-directions-choices.png')});
  console.log('PASS: Stop Directions automatically finds selectable trip cards with compact controls');
  const from=await p.locator('#trip-from').inputValue(),to=await p.locator('#trip-to').inputValue();
  await p.locator('.trip-card').filter({hasText:'1 transfer'}).first().click();
  await p.locator('#mcard.journey-sheet').waitFor();await p.locator('#sheetWrap').waitFor({state:'hidden'});
  await p.locator('#gmap:not(.gesturing):not(.zooming)').waitFor();
  assert.ok(await p.locator('.journey-timeline .journey-step').count()>=4);
  assert.ok((await p.locator('.journey-timeline').innerText()).includes('Board at'));
  assert.ok((await p.locator('.journey-timeline').innerText()).includes('Get off at'));
  assert.ok(await p.locator('.trip-marker').count()>=3);
  const top=(await p.locator('#mcard').boundingBox()).y;
  for(const marker of await p.locator('.trip-marker').all()){assert.ok((await marker.boundingBox()).y+20<top,'Trip markers remain above the itinerary');}
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-selected-transfer-trip.png')});
  console.log('PASS: Selecting a transfer opens map, boarding/alighting stops and a complete itinerary');
  const before=await p.locator('#tripMapLayer').getAttribute('data-journey');
  await p.locator('.trip-alt-hit').first().dispatchEvent('click');
  assert.notEqual(await p.locator('#tripMapLayer').getAttribute('data-journey'),before);
  await p.locator('#mcard [data-action="journey-save"]').click();
  assert.ok((await p.locator('#mcard [data-action="journey-save"]').innerText()).includes('Saved'));
  await p.locator('#mcard [data-action="journey-other"]').click();
  assert.equal(await p.locator('#trip-from').inputValue(),from);assert.equal(await p.locator('#trip-to').inputValue(),to);
  await p.locator('.trip-card').first().focus();await p.locator('.trip-card').first().press('Enter');
  await p.locator('#mcard.journey-sheet').waitFor();
  console.log('PASS: Map alternatives, route saving, return to choices and keyboard selection work');
  for(const width of [390,320]){
   await p.setViewportSize({width,height:844});
   assert.equal(await p.locator('#mcard').evaluate(c=>c.scrollWidth<=c.clientWidth),true);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await p.setViewportSize({width:390,height:844});await p.locator('#toast').waitFor({state:'hidden'});
  await p.locator('#gmap:not(.gesturing):not(.zooming)').waitFor();
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-journey-mobile.png')});
  await p.locator('#mcard [data-action="journey-start"]').click();
  await p.locator('#mcard.guiding .journey-instruction').waitFor();
  await p.locator('#gmap:not(.gesturing):not(.zooming)').waitFor();await p.waitForTimeout(180);
  const guideTop=(await p.locator('#mcard').boundingBox()).y;
  for(const marker of await p.locator('.trip-marker[data-step="0"]').all()){assert.ok((await marker.boundingBox()).y+20<guideTop,'Walking-step markers remain above the guide');}
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-guided-walking-step.png')});
  let steps=0;
  while(await p.locator('#mcard [data-action="journey-next"]').count()){
   await p.locator('#mcard [data-action="journey-next"]').click();if(++steps>10)throw new Error('Journey preview did not finish');
  }
  assert.ok((await p.locator('.journey-instruction').innerText()).includes('Arrive at your destination'));
  await p.emulateMedia({colorScheme:'dark'});
  await p.locator('.screen').screenshot({path:path.join(output,'LTC-journey-arrival-dark.png')});
  await p.locator('#mcard [data-action="journey-close"]').last().click();
  assert.equal(await p.locator('#tripMapLayer').count(),0);
  assert.equal(await p.locator('#pane-map.journey-open').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Narrow screens, manual step preview, arrival, dark mode and clearing directions work');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
