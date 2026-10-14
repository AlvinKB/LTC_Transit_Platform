"""Refresh the self-contained planner's GTFS snapshot for the fixed demo date.

Usage: python scripts/update-planner-data.py [--feed path/to/google_transit.zip]
The original map/demo data is intentionally independent of this snapshot.
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import urllib.request
import zipfile

SOURCE = 'https://www.londontransit.ca/gtfsfeed/google_transit.zip'
DEMO_DATE = dt.date(2026, 10, 20)
ROOT = pathlib.Path(__file__).resolve().parents[1]


def build_snapshot(content):
    archive = zipfile.ZipFile(io.BytesIO(content))
    def rows(name):
        if name not in archive.namelist():
            return []
        return csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig')))
    date = DEMO_DATE.strftime('%Y%m%d')
    weekday = DEMO_DATE.strftime('%A').lower()
    services = {r['service_id'] for r in rows('calendar.txt')
                if r['start_date'] <= date <= r['end_date'] and r[weekday] == '1'}
    for r in rows('calendar_dates.txt'):
        if r['date'] == date:
            if r['exception_type'] == '1': services.add(r['service_id'])
            else: services.discard(r['service_id'])
    feed = next(iter(rows('feed_info.txt')), {})
    if not services:
        raise ValueError('Feed has no service on the demo date; do not replace the snapshot.')
    routes, route_index = [], {}
    for r in rows('routes.txt'):
        route_index[r['route_id']] = len(routes)
        short = r['route_short_name'].lstrip('0') or '0'
        routes.append([short, r['route_long_name'], r.get('route_color') or '7C8A83'])
    stops, stop_index = [], {}
    for s in rows('stops.txt'):
        if s.get('location_type', '') not in ('', '0'): continue
        stop_index[s['stop_id']] = len(stops)
        stops.append([s['stop_id'], s['stop_name'], float(s['stop_lat']), float(s['stop_lon'])])
    selected = {t['trip_id']: t for t in rows('trips.txt') if t['service_id'] in services}
    times = {key: [] for key in selected}
    def seconds(value):
        h, m, s = map(int, value.split(':'))
        return h * 3600 + m * 60 + s
    for r in rows('stop_times.txt'):
        if r['trip_id'] not in selected: continue
        if r['stop_id'] not in stop_index: continue
        if not r['arrival_time'] or not r['departure_time']:
            raise ValueError('Missing stop times require interpolation before import.')
        times[r['trip_id']].append((int(r['stop_sequence']), stop_index[r['stop_id']],
            seconds(r['arrival_time']), seconds(r['departure_time']),
            int(r.get('pickup_type') or 0), int(r.get('drop_off_type') or 0)))
    trips = []
    for key, t in selected.items():
        seq = sorted(times[key])
        if len(seq) < 2: continue
        if any(b[2] < a[3] for a, b in zip(seq, seq[1:])):
            raise ValueError('Nonmonotonic trip: ' + key)
        # Array schema: route, direction, headsign, stops, arrivals, departures,
        # pickup rules, drop-off rules, original GTFS trip ID.
        trips.append([route_index[t['route_id']], int(t.get('direction_id') or 0),
            t['trip_headsign'], [x[1] for x in seq], [x[2] for x in seq],
            [x[3] for x in seq], [x[4] for x in seq], [x[5] for x in seq], key])
    trips.sort(key=lambda t: t[5][0])
    return {'source': SOURCE, 'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat(),
        'date': DEMO_DATE.isoformat(), 'version': feed.get('feed_version', ''),
        'validFrom': feed.get('feed_start_date', ''), 'validUntil': feed.get('feed_end_date', ''),
        'sha256': hashlib.sha256(content).hexdigest(), 'routes': routes, 'stops': stops, 'trips': trips}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--feed', type=pathlib.Path)
    args = parser.parse_args()
    if args.feed:
        content = args.feed.read_bytes()
    else:
        request = urllib.request.Request(SOURCE, headers={'User-Agent': 'ForestCityTransit/1.0'})
        with urllib.request.urlopen(request, timeout=60) as response: content = response.read()
    snapshot = build_snapshot(content)
    html_path = ROOT / 'Forest City Transit.html'
    html = html_path.read_bytes().decode('utf-8')
    block = '<script type="application/json" id="d-planner">' + json.dumps(snapshot, separators=(',', ':')).replace('<', '\\u003c') + '</script>'
    if 'id="d-planner"' not in html: raise ValueError('Planner data placeholder is missing.')
    html, count = re.subn(r'<script type="application/json" id="d-planner">.*?</script>', lambda _: block, html, count=1, flags=re.S)
    assert count == 1
    html_path.write_bytes(html.encode('utf-8'))
    print(f"Imported {len(snapshot['routes'])} routes, {len(snapshot['stops'])} stops, {len(snapshot['trips'])} trips for {snapshot['date']}.")


if __name__ == '__main__': main()
