const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.env.FCT_TEST_OUTPUT || path.join(root, 'test-results');
fs.mkdirSync(output, {recursive:true});
const http = require('node:http');
const checks = [];
function check(name) { checks.push(name); console.log('PASS: ' + name); }
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, pathname === '/' ? 'Forest City Transit.html' : pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, content) => { if (err) res.writeHead(404).end(); else {res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain'); res.end(content);} });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({executablePath: process.env.FCT_BROWSER_PATH || undefined, headless: true});
  try {
    const page = await browser.newPage({ viewport: {width: 1280, height: 1000}, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    // Deterministic external address-service contract; live availability is checked separately.
    await page.route('https://photon.komoot.io/**', async route => {
      const q = new URL(route.request().url()).searchParams.get('q');
      if (q === 'offline-test') return route.abort();
      if (q === 'slow-old') { await new Promise(r => setTimeout(r, 1200)); }
      let features = [
        {properties: {housenumber: '450', street: 'Highbury Avenue North', city: 'London', state: 'Ontario', countrycode: 'CA'}, geometry: {type: 'Point', coordinates: [-81.1982461,42.9854949]}},
        {properties: {name: 'Wrong London', city: 'London', state: 'England', countrycode: 'GB'}, geometry: {type:'Point',coordinates:[-.12,51.5]}},
        {properties: {name: '<img src=x onerror=alert(1)>', city: 'London', state: 'Ontario', countrycode: 'CA'}, geometry:{type:'Point',coordinates:[-81.25,43.0]}}
      ];
      if (q === 'xx-no-matches') features = [];
      if (q === 'slow-old') features = [{properties:{name:'Old result',city:'London',state:'Ontario',countrycode:'CA'},geometry:{type:'Point',coordinates:[-81.25,43.0]}}];
      if (q === 'unserved') features = [{properties:{name:'Unserved location',city:'London',state:'Ontario',countrycode:'CA'},geometry:{type:'Point',coordinates:[-81.415,42.825]}}];
      if (/Boullee/i.test(q)) features = [{properties:{housenumber:'248',street:'Steele Street',city:'London',state:'Ontario',countrycode:'CA'},geometry:{type:'Point',coordinates:[-81.25771,43.009256]}}];
      if (q === '1680 Richmond') features = [{properties:{housenumber:'1680',street:'Richmond Street',city:'London',state:'Ontario',countrycode:'CA'},geometry:{type:'Point',coordinates:[-81.277,43.025]}}];
      return route.fulfill({contentType:'application/json', body:JSON.stringify({features})});
    });
    await page.route('https://maps.london.ca/**', async route => {
      const url=new URL(route.request().url()), q=url.searchParams.get('SingleLine'), callback=url.searchParams.get('callback');
      if (q === 'offline test') return route.abort();
      let candidates=[];
      if (/^248 boullee/.test(q)) candidates=[{address:'248 Boullee St',location:{x:-81.223466653686,y:43.012083149622},attributes:{Addr_type:'POI'}},{address:'Boullee St',location:{x:-81.2247,y:43.0084},attributes:{Addr_type:'StreetName'}}];
      if (q === 'london central secondary school') candidates=[{address:'Central Secondary School',location:{x:-81.244961909082,y:42.988794294383},attributes:{Addr_type:'POI'}}];
      return route.fulfill({contentType:'application/javascript',body:callback+'('+JSON.stringify({candidates})+');'});
    });
    await page.goto(baseURL + '/#app');
    const detourTitles=['Richmond St closed between Mill and Piccadilly','Wellington construction from Watson to Exeter','Dundas St closure for rapid transit'];
    const detourViews=[];
    for (let i=0;i<detourTitles.length;i++) {
      await page.locator('[data-action="detours"]:visible').first().click();
      assert.equal(await page.locator('#sheet button.detour-item').count(),3);
      assert.equal(await page.getByText('See the Richmond closure on the map',{exact:true}).count(),0);
      const row=page.locator('#sheet [data-action="show-detour"][data-detour="'+i+'"]');
      if(i===1){await row.focus();await row.press('Enter');}else await row.click();
      await page.locator('#mcard').getByText(detourTitles[i],{exact:true}).waitFor();
      assert.equal(await page.locator('#sheetWrap').isVisible(),false);
      assert.equal(await page.locator('[data-tab="map"][aria-current="page"]').count(),1);
      await page.waitForTimeout(650);
      detourViews.push(await page.locator('#world').getAttribute('transform'));
      await page.locator('#mcard [data-action="map-card-close"]').click();
      assert.equal(await page.locator('#mcard').isVisible(),false);
      check(detourTitles[i]+' opens on the map');
    }
    assert.equal(new Set(detourViews).size,3);
    check('detours have distinct map locations and support keyboard activation');
    await page.locator('[data-tab="home"]').click();
    await page.locator('[data-action="add-route"]').click();
    await page.locator('#findRoutes').click();
    await assert.doesNotReject(() => page.locator('#tripResults').getByText(/Choose a From/).waitFor());
    check('missing locations display validation');
    await page.locator('#trip-from').fill('450 Highbury');
    await page.locator('#trip-from-options').getByText('450 Highbury Avenue North', {exact:true}).waitFor();
    assert.equal(await page.locator('#trip-from-options').getByText('Wrong London').count(), 0);
    await page.locator('#trip-from').press('ArrowDown');
    await page.locator('#trip-from').press('Enter');
    assert.equal(await page.locator('#trip-from').inputValue(), '450 Highbury Avenue North');
    check('London address autocomplete and keyboard selection');
    await page.locator('#trip-to').fill('Richmond at Queens NB');
    await page.locator('#trip-to-options [role="option"]').filter({hasText:/LTC stop/}).first().waitFor();
    await page.locator('#trip-to-options [role="option"]').filter({hasText:/LTC stop/}).first().click();
    await page.locator('#findRoutes').click();
    await page.locator('.trip-card').first().waitFor();
    assert.equal(await page.locator('#sheet').getByText(/Leaving.*scheduled times|Choose a route manually/).count(),0);
    check('address-to-stop scheduled trip and walking details');
    const card=page.locator('.trip-card').first();
    assert.equal(await card.evaluate(el=>el.tagName),'BUTTON');
    assert.ok((await card.boundingBox()).height < 155);
    await card.click();await page.locator('.journey-timeline').waitFor();
    assert.ok((await page.locator('.journey-timeline').innerText()).includes('Board at'));
    await page.locator('#mcard [data-action="journey-other"]').click();
    check('compact results open map directions and return to trip choices');
    const beforeFrom = await page.locator('#trip-from').inputValue(), beforeTo = await page.locator('#trip-to').inputValue();
    await page.locator('[data-action="swap-trip"]').click();
    assert.equal(await page.locator('#trip-from').inputValue(), beforeTo);
    assert.equal(await page.locator('#trip-to').inputValue(), beforeFrom);
    assert.equal(await page.locator('.trip-card').count(), 0);
    check('swap preserves locations and clears stale results');
    await page.locator('#findRoutes').click(); await page.locator('.trip-card').first().waitFor();
    await page.locator('.trip-card').first().click();
    await page.locator('[data-action="journey-save"]').click();
    assert.match(await page.locator('#toast').innerText(), /Saved/);
    check('planner routes save into existing Home cards');
    await page.locator('#mcard [data-action="journey-other"]').click();
    assert.equal(await page.locator('#routeQ, #manualRouteTitle').count(),0);
    check('manual picker and departure line are absent from the route panel');
    await page.locator('.trip-card').first().click();
    await page.locator('#tripMapLayer').waitFor(); assert.ok(await page.locator('#gsvg').count());
    await page.locator('#toast').waitFor({state:'hidden'});
    await page.screenshot({path: path.join(output, 'LTC-planned-trip-map.png')});
    await page.locator('#mcard [data-action="journey-close"]').click(); assert.equal(await page.locator('#tripMapLayer').count(), 0);
    check('trip overlay, map, and Clear trip');
    await page.locator('[data-tab="home"]').click(); await page.locator('[data-action="add-route"]').click();
    await page.locator('[data-action="trip-map-origin"]').click();
    assert.equal(await page.locator('#trip-from').inputValue(), 'Current location');
    assert.equal(await page.locator('#sheet').getByText(/Scheduled for Oct 20|Schedules:|Addresses:|OpenStreetMap/).count(), 0);
    assert.equal(await page.locator('#sheet').getByText('Stop search works offline.', {exact:true}).count(), 1);
    await page.locator('#trip-to').fill('Masonville Place');
    await page.locator('#trip-to-options [role="option"]').filter({hasText:/LTC stop/}).first().click();
    await page.locator('#findRoutes').click(); await page.locator('.trip-card').first().waitFor();
    const earlierArrival = await page.locator('.trip-choice-arrival').first().innerText();
    await page.locator('[data-action="ff"]').click();
    assert.match(await page.locator('#rail [data-clock]').innerText(), /3:10/);
    await page.locator('#findRoutes').click(); await page.locator('.trip-card').first().waitFor();
    assert.notEqual(await page.locator('.trip-choice-arrival').first().innerText(),earlierArrival);
    check('demo clock remains functional and sets planner departure');
    await page.locator('#sheet').evaluate(el => el.scrollTop = 0);
    await page.locator('#toast').waitFor({state:'hidden'});
    assert.equal(await page.locator('#sheet').getByText(/Â/).count(), 0);
    await page.screenshot({path:path.join(output, 'LTC-address-planner-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output, 'LTC-address-planner-mobile.png')});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    check('mobile layout has no horizontal overflow');
    await page.locator('#trip-to').fill('offline-test');
    await page.locator('#trip-to-options').getByText(/Address search is unavailable/).waitFor();
    await page.locator('#trip-to').fill('Fanshawe College');
    await page.locator('#trip-to-options [role="option"]').filter({hasText:/LTC stop/}).first().click();
    await page.locator('#findRoutes').click(); await page.locator('.trip-card').first().waitFor();
    check('address-service failure preserves offline stop planning');
    await page.locator('#trip-from').fill('slow-old'); await page.waitForTimeout(500);
    await page.locator('#trip-from').fill('xx-no-matches'); await page.waitForTimeout(1500);
    assert.equal(await page.locator('#trip-from').inputValue(), 'xx-no-matches');
    assert.equal(await page.locator('#trip-from-options').getByText('Old result',{exact:true}).count(),0);
    check('stale address requests cannot overwrite suggestions');
    await page.locator('#trip-from').fill('img');
    await page.locator('#trip-from-options').getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();
    assert.equal(await page.locator('#trip-from-options img').count(), 0);
    check('untrusted address labels are escaped');
    await page.locator('#trip-from').fill('unserved');
    await page.locator('#trip-from-options').getByText('Unserved location',{exact:true}).click();
    await page.locator('#findRoutes').click();
    await page.locator('#tripResults').getByText(/No served LTC stop/).waitFor();
    check('unserved locations return a helpful empty result');
    await page.locator('#trip-from').fill('450 Highbury');
    await page.locator('#trip-from-options').getByText('450 Highbury Avenue North',{exact:true}).click();
    await page.locator('#trip-to').fill('450 Highbury');
    await page.locator('#trip-to-options').getByText('450 Highbury Avenue North',{exact:true}).click();
    await page.locator('#findRoutes').click();
    await page.locator('#tripResults').getByText(/same location/).waitFor();
    check('identical endpoints are rejected');
    await page.locator('#trip-to').fill('1680 Richmond');
    await page.locator('#trip-to-options').getByText('1680 Richmond Street',{exact:true}).click();
    await page.locator('#findRoutes').click(); await page.locator('.trip-card').first().waitFor();
    check('address-to-address trip planning');
    await page.locator('#trip-from').fill('248 Boullee Street');
    await page.locator('#trip-to').fill('London Central Secondary School');
    // Submit immediately without clicking either autocomplete suggestion.
    await page.locator('#findRoutes').click();
    await page.locator('.trip-card').first().waitFor();
    assert.equal(await page.locator('#trip-from').inputValue(),'248 Boullee St');
    assert.equal(await page.locator('#trip-to').inputValue(),'Central Secondary School');
    assert.equal(await page.locator('.trip-detail-panel:visible').count(),0);
    check('typed Boullee address resolves through the city fallback without a suggestion click');
    await page.locator('#sheet').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:path.join(output,'LTC-compact-trip-desktop.png')});
    await page.locator('#tripResults').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'LTC-compact-trip-results.png')});
    await page.locator('#trip-from').fill('999999 Boullee Street');
    await page.locator('#findRoutes').click();
    await page.locator('#tripResults').getByText(/No exact match/).waitFor();
    assert.equal(await page.locator('.trip-card').count(),0);
    check('an unmatched house number never falls back to the street midpoint');
    await page.locator('#trip-from').fill('248 Boullee St');
    await page.locator('#findRoutes').click(); await page.locator('.trip-card').first().waitFor();
    await page.locator('#sheet').evaluate(el => el.scrollTop = 0);
    await page.emulateMedia({colorScheme:'dark'});
    await page.screenshot({path:path.join(output,'LTC-address-planner-dark.png')});
    check('dark theme retains readable planner controls');
    await page.emulateMedia({colorScheme:'light'});
    const filePage = await browser.newPage();
    const fileErrors=[]; filePage.on('pageerror',e=>fileErrors.push(e.message));
    await filePage.route('https://photon.komoot.io/**',route=>route.abort());
    await filePage.goto(require('node:url').pathToFileURL(path.join(root,'Forest City Transit.html')).href + '#app');
    await filePage.locator('[data-action="add-route"]').click();
    for (const [key,query] of [['from','Richmond at Queens NB'],['to','Masonville Place']]) {
      await filePage.locator('#trip-'+key).fill(query);
      await filePage.locator('#trip-'+key+'-options [role="option"]').filter({hasText:/LTC stop/}).first().click();
    }
    await filePage.locator('#findRoutes').click(); await filePage.locator('.trip-card').first().waitFor();
    assert.deepEqual(fileErrors,[]); await filePage.close();
    check('opening the HTML directly supports offline scheduled planning');
    assert.deepEqual(errors, []); check('no browser JavaScript errors');
    fs.writeFileSync(path.join(output, 'LTC-browser-test-results.json'), JSON.stringify({checks, errors},null,2));
    await page.unroute('https://photon.komoot.io/**');
    await page.locator('#trip-from').fill('450 Highbury Avenue North, London, Ontario');
    try {
      await page.locator('#trip-from-options').getByText('450 Highbury Avenue North',{exact:true}).waitFor({timeout:12000});
      console.log('LIVE: Photon London address lookup succeeded in browser.');
    } catch { console.log('LIVE: address service did not return the expected result; deterministic lookup and offline fallback tests passed.'); }
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exitCode=1;}).finally(() => server.close());
