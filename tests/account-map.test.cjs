const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const output=process.env.FCT_TEST_OUTPUT || path.join(root,'test-results');
fs.mkdirSync(output,{recursive:true});
const checks=[];
function check(name){checks.push(name);console.log('PASS: '+name);}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FCT_BROWSER_PATH || undefined});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',route=>route.abort());
  await page.goto(pathToFileURL(path.join(root,'Forest City Transit.html')).href+'#app');
  await page.locator('.tab[data-tab="account"]').click();
  assert.equal(await page.locator('#pane-account [data-action="signup"], #pane-account [data-action="apply-pass"]').count(),0);
  assert.equal(await page.locator('#pane-account').getByText('New rider?',{exact:true}).count(),0);
  assert.equal(await page.locator('#pane-account [data-account-card="digital"]').count(),0);
  await page.locator('#pane-account').getByRole('button',{name:'Order physical card',exact:true}).waitFor();
  check('Account has direct physical-card ordering without New rider or discount passes');
  await page.locator('.tab[data-tab="wallet"]').click();
  assert.equal(await page.locator('#pane-wallet [data-action="apply-pass"]').count(),2);
  check('Both discount passes remain in Wallet');
  for (const pass of ['youth','income']) {
    await page.locator('#pane-wallet [data-action="apply-pass"][data-pass="'+pass+'"]').click();
    assert.equal(await page.locator('#sheet .note-today').count(),0);
    await page.locator('#proofFile').waitFor({state:'attached'});
    if (pass==='income') {
      await page.locator('#sheet').evaluate(el=>el.getAnimations().forEach(a=>a.finish()));
      await page.locator('.screen').screenshot({path:path.join(output,'LTC-pass-without-notice.png')});
    }
    await page.locator('#sheet').getByRole('button',{name:'Close',exact:true}).click();
  }
  check('Both pass applications omit the location and reload notice while keeping proof upload');
  await page.locator('.tab[data-tab="account"]').click();
  await page.locator('[data-action="link-card"]').click();
  await page.locator('[data-action="link-card-submit"]').click();
  await page.locator('#sheet [role="alert"]').waitFor();
  assert.equal(await page.locator('#pane-account .account-card').count(),0);
  check('An incomplete existing-card form does not create a card');
  for(const [name,last4] of [['Personal card','1234'],['Spare card','5678']]){
   if(await page.locator('#linkCardName').count()===0) await page.locator('[data-action="link-card"]').click();
   await page.locator('#linkCardName').fill(name);await page.locator('#linkCardLast4').fill(last4);
   await page.locator('[data-action="link-card-submit"]').click();
  }
  assert.equal(await page.locator('#pane-account .account-card').count(),2);
  const physical=page.locator('[data-account-card]').filter({hasText:'Personal card'});
  const spare=page.locator('[data-account-card]').filter({hasText:'Spare card'});
  const digital=page.locator('#pane-card [data-card-id="digital"]');
  const personalId=await physical.getAttribute('data-account-card');
  await physical.locator('[data-action="block"]').click();
  assert.equal(await page.locator('.inline-confirm, [data-action="block-yes"], [data-action="block-no"]').count(),0);
  assert.equal(await physical.locator('.pill').textContent(),'Blocked');
  assert.equal(await spare.locator('.pill').textContent(),'Active');
  await page.locator('.tab[data-tab="card"]').click();assert.equal(await page.locator('.bc-blocked').count(),0);
  check('One-click physical blocking leaves the other physical card and digital card active without confirmation text');
  await digital.click();
  assert.equal(await spare.locator('.pill').textContent(),'Active');
  await page.locator('.tab[data-tab="card"]').click();await page.locator('.bc-blocked').waitFor();
  await page.locator('[data-action="tap-sim"]').click();
  assert.equal(await page.locator('#tapfx').isVisible(),false);
  assert.match(await page.locator('#toast').innerText(),/digital card is blocked/);
  check('Blocking the digital card disables its simulated scan independently');
  await page.reload();await page.locator('.tab[data-tab="account"]').click();
  assert.equal(await page.locator('#pane-account .account-card').count(),2);
  assert.equal(await page.locator('#pane-card .bc-blocked').count(),1);
  assert.equal(await physical.locator('.pill').textContent(),'Blocked');
  assert.equal(await spare.locator('.pill').textContent(),'Active');
  check('Multiple cards and independent block states survive a reload');
  await page.locator('.tab[data-tab="card"]').click();
  await digital.click();
  assert.equal(await page.locator('#pane-card .bc-blocked').count(),0);
  await page.locator('.tab[data-tab="account"]').click();
  await physical.locator('[data-action="unblock"]').click();
  assert.equal(await physical.locator('.pill').textContent(),'Active');
  await page.locator('[data-action="order-card"]').click();
  await page.locator('#ordCardName').fill('Travel card');await page.locator('#ordStreet').fill('450 Highbury Avenue North');await page.locator('#ordPostal').fill('N5W 5L2');
  await page.locator('[data-action="order-submit"]').click();await page.locator('#sheet').getByText('Card ordered',{exact:true}).waitFor();
  await page.locator('#sheet').getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.locator('#pane-account .account-card').count(),3);
  assert.equal(await page.locator('[data-account-card="'+personalId+'"]').count(),1);
  await page.locator('[data-action="order-card"]').waitFor();
  check('Unblocking cards and ordering another physical card retain the existing collection');
  await page.locator('[data-account-card]').filter({hasText:'Spare card'}).locator('[data-action="block"]').click();
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.locator('#pane-account').evaluate(el=>el.scrollWidth===el.clientWidth),true);
   if(width===390){await page.locator('#appBody').evaluate(el=>el.scrollTop=0);await page.locator('.screen').screenshot({path:path.join(output,'LTC-multiple-cards-account.png')});}
  }
  check('Multiple-card account layout fits 390px and 320px screens');
  await page.locator('.tab[data-tab="map"]').click();
  const data=await page.locator('#d-roads').evaluate(el=>JSON.parse(el.textContent));
  assert.ok(data.segmentCount>9000);
  assert.ok(data.roads.filter(r=>r[0]==='C').length>1500);
  for(const name of ['Dundas St','Nightingale Ave','Ashland Ave','Watson St']) assert.ok(data.roads.some(r=>r[1]===name),name+' is present');
  assert.equal(data.roads.length,data.roadCount);
  const gapDistance=await page.locator('#d-roads').evaluate(el=>{
   const paths=JSON.parse(el.textContent).roads.map(r=>{
    const text=r[2].replace(/!/g,'\\');let i=0,lat=0,lon=0;const points=[];
    while(i<text.length){
     for(let axis=0;axis<2;axis++){let value=0,shift=0,b;do{b=text.charCodeAt(i++)-63;value|=(b&31)<<shift;shift+=5;}while(b>=32);const delta=(value&1)?~(value>>1):(value>>1);if(axis===0)lat+=delta;else lon+=delta;}
     points.push([(lon/1e5+81.247)*111320*Math.cos(42.987*Math.PI/180),-(lat/1e5-42.987)*110540]);
    }
    return points;
   });
   let best=Infinity;
   for(const points of paths){
    for(let i=1;i<points.length;i++){
     const [ax,ay]=points[i-1],[bx,by]=points[i],dx=bx-ax,dy=by-ay;
     const t=Math.max(0,Math.min(1,((3226-ax)*dx+(-975-ay)*dy)/(dx*dx+dy*dy||1)));
     best=Math.min(best,Math.hypot(3226-ax-t*dx,-975-ay-t*dy));
    }
   }
   return best;
  });
  assert.ok(gapDistance<35,'Dundas road geometry crosses the formerly blank gap');
  check('Full offline city roads include neighbourhood streets and cross the missing Dundas section');
  await page.setViewportSize({width:1280,height:900});
  await page.locator('[data-action="detours"]:visible').first().click();await page.locator('#sheet [data-detour="2"]').click();
  await page.locator('#mcard').getByText('Dundas St closure for rapid transit',{exact:true}).waitFor();await page.waitForTimeout(650);
  await page.locator('#mcard [data-action="map-card-close"]').click();
  await page.locator('.screen').screenshot({path:path.join(output,'LTC-complete-Dundas-road.png')});
  await page.locator('[aria-label="Zoom in"]').click();await page.locator('[aria-label="Zoom out"]').click();
  check('Detours, route overlays and map zoom still work with the fuller road layer');
  await page.locator('[data-action="reset"]').click();await page.locator('.tab[data-tab="account"]').click();
  assert.equal(await page.locator('#pane-account .account-card').count(),0);
  assert.equal(await page.locator('#pane-card .bc-blocked').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('fct-cards-v1')),null);
  check('Reset demo clears the demo card collection');
  assert.deepEqual(errors,[]);check('No browser JavaScript errors');
  fs.writeFileSync(path.join(output,'LTC-account-map-tests.json'),JSON.stringify({checks,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
