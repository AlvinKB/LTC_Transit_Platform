# LTC Transit Platform

Forest City Transit is a browser prototype for London, Ontario transit.

## Project status

Open **Forest City Transit.html** in a browser, then choose **Try the app**. No build or API key is required. The map, bus animation, clock, payment flows, and saved route cards remain part of the original demo.

In **Add a route**, type **From** and **To** addresses or choose LTC stops, swap the locations if needed, and choose **Find Routes**. Exact typed addresses resolve automatically; ambiguous places prompt you to choose a match. Each trip is one selectable card with travel time, arrival, walking, and route numbers. Selecting it opens the map with a scrolling itinerary that names boarding and alighting stops and transfer times. Grey alternative routes can also be selected on the map. **Other routes** returns to the original choices and addresses; **Save** adds the selected route directions to Home.

**Preview trip** presents one instruction at a time. **Next step** advances manually through walking, riding, transfers and arrival; it does not track device movement. Timeline steps and numbered map markers can be selected to focus that part of the trip. The route is framed above the directions sheet, including after a viewport resize. Walking lines and routes between stops remain approximate, rather than street-level turn-by-turn navigation.

**Account** manages physical cards. Add existing demo cards by name and last four digits, or order additional cards. The digital card and its Block/Unblock control are in **Card**. Each card has independent controls; blocking a physical card does not block the digital card or another physical card. Card names, last four digits, shipping status, and block status stay in this browser's local storage until **Reset demo**. Nothing is registered with LTC. Discount passes are available in **Wallet**. Home starts without preset saved routes; only routes you explicitly save appear there. Earlier demo route selections use a separate storage version and are no longer loaded.

Tap or search for a bus stop to open a flush bottom sheet based on [Google's published mobile transit interface](https://support.google.com/transitpartners/answer/10106342?hl=en). The departure board sorts the next three trips for each direction by arrival time, with destinations on the left and countdowns on the right. Route chips filter the board. **Directions** fills in the current location and stop and automatically finds trips; **Save** saves the stop's route directions to Home, and each row also has a bookmark. Tap **More info** or drag the handle upwards to expand the sheet. Long labels wrap without horizontal scrolling. Closed stops remain closed as the demo clock advances.

## Data and limitations

- Trip planning uses an embedded snapshot of [LTC's official GTFS feed](https://www.londontransit.ca/open-data/), for the demo's **Tuesday, October 20, 2026** service day. The calendar and holiday exceptions are applied during import. All route variants, exact stop times, and regular pickup/drop-off rules are retained. The feed covers September 28–November 28, 2026.
- The demo clock sets the departure time. Results are static scheduled times, not live arrivals. Existing animated buses and delays remain simulated.
- The road layer uses an embedded snapshot of the [City of London's Single Line Roads](https://maps.london.ca/server/rest/services/OpenData/OpenData_Transportation/MapServer/7), including neighbourhood streets and roads affected by construction. Parks, waterways, and other background features retain the original OpenStreetMap data. The road layer and map work offline. Detour markers identify construction corridors; they do not calculate alternate driving routes.
- Map geometry uses cached Path2D shapes, with long polylines split into short sections so offscreen route and river geometry can be excluded. Visible road and route strokes are batched and reused. A local Web Worker builds one padded detail cache; its canvas buffers are reused. The same renderer runs on the main thread if workers are unavailable. Geometry and label placement are prepared during idle time; the full timetable is parsed only when trip planning needs it.
- Mouse-wheel, drag and pinch input update camera targets. A frame-rate-independent exponential lerp follows those targets, with log-space zoom and a stable cursor/pinch anchor. Buttons and route focus use eased interpolation; new pointer input interrupts existing motion without jumping to an old target. Map bounds constrain both the targets and displayed camera.
- Street names stay visible during gestures in a separate SVG layer. Labels use a fixed screen font size, retain their nodes and update positions each camera frame; collision placement and nearby stops refresh at bounded intervals. Buffered viewport edges and preference for existing labels and stop icons prevent small pans from replacing items in view. Zoom detail uses a shared dead band for canvas roads and SVG overlays; stops have separate entry/exit scales so small zoom reversals do not flicker. Stops, buses, location and trip overlays remain interactive SVG.
- The visible canvas uses the display's actual pixel ratio. Nearby pans reuse sharp cached pixels. Uncached views render at the current scale, and zoom paints only the visible vector scene to avoid GPU contention with simultaneous padded worker repaints. The low-resolution city overview is no longer stretched into active views. One hidden detail cache refreshes as needed during pans and after zoom; theme and route changes invalidate it. No map tiles or image requests are sent to an external service.
- London address and landmark lookup uses [Photon](https://github.com/komoot/photon) and OpenStreetMap data, with the [City of London's public locator](https://maps.london.ca/server/rest/services/Locators/SearchKeyCompositeLocator/GeocodeServer) as a fallback for missing matches. Street abbreviations are normalized and candidates must match the entered house number and street. A street midpoint is never substituted for a missing numbered address. Queries are debounced, cached in memory, and geographically filtered. Address queries are sent to these services; addresses are not stored in browser storage. The City locator's supported JSONP endpoint allows the self-contained HTML to work without a separate proxy. Availability is not guaranteed, so production use should provide a managed or self-hosted geocoder.
- Stop search and scheduled trip planning work offline from the embedded data. **Use current location** uses the location already set in the demo map, without requesting device location.
- Walking is a distance-based estimate, with a 25% allowance and a speed of 72 metres/minute. Access/egress is limited to an estimated 800 m, foot transfers to 250 m, and bus connections include a two-minute buffer. Results search up to four hours ahead and show up to three route combinations. They do not model street crossings, step-free paths, live detours, or walking-only trips.
- The trip overlay connects actual stops; it does not provide street-level navigation. Existing map route geometry remains unchanged. Home saves use the existing route-direction demo cards and their nearest-stop behavior.

## Test and refresh

Run the routing regression tests with Node.js 18 or newer:

```sh
node --test tests/planner.test.cjs tests/addresses.test.cjs
```

Browser tests exercise autocomplete, validation, swaps, scheduled results, route saving, detour selection, the demo clock, map overlays, network failure, escaped labels, and mobile layout. Install Playwright and its Chromium browser to run them:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.test.cjs
node tests/account-map.test.cjs
node tests/map-layout.test.cjs
node tests/map-gestures.test.cjs
node tests/stop-lookup.test.cjs
node tests/map-renderer.test.cjs
node tests/journey-flow.test.cjs
node tests/map-motion.test.cjs
node tests/map-visibility.test.cjs
```

To use an installed Chromium-based browser, set `FCT_BROWSER_PATH` to its executable. Test images and results go into the ignored `test-results/` directory. The address-service tests use deterministic responses; the optional live lookup reports availability separately.

Refresh the planner snapshot using Python 3.10 or newer:

```sh
python scripts/update-planner-data.py
```

Or supply a downloaded GTFS archive with `--feed path/to/google_transit.zip`. The importer refuses to replace the snapshot if the feed lacks service on the fixed demo date. Changing the demo service day requires updating the date in the importer and the existing UI date labels; the legacy map/demo schedule is a separate dataset.

Refresh the embedded city road network with `python scripts/update-road-data.py`. Use `--save-snapshot roads.json` to save the downloaded source for inspection, or `--snapshot roads.json` to import it without a network request.

## Get started

```sh
git clone https://github.com/AlvinKB/LTC_Transit_Platform.git
cd LTC_Transit_Platform
```

Open this repository folder as a local project in Codex. In GitHub Desktop, use **File > Add local repository** and select the same folder so both tools work with the same files and Git history.

## Development workflow

1. Start from an up-to-date `main` branch.
2. Create a branch for a focused change, such as `codex/project-setup`.
3. Make the change and review the diff. Run the relevant checks once application code is available.
4. Commit and push the branch, then open a pull request for review.
5. Merge approved changes into `main`.

When direct changes to `main` are requested, review and commit the changes before pushing them. Fetch and pull updates from GitHub before starting new work.

## Local files

The `.gitignore` excludes common local dependencies, caches, editor files, logs, and environment files. Keep credentials out of the repository; use a tracked `.env.example` or `.env.template` with placeholder values when configuration examples are needed.
