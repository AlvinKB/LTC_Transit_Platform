"""Embed London's public road network, including streets under construction.

Usage: python scripts/update-road-data.py [--snapshot saved-response.json]
The resulting HTML map works offline; this is a build-time public data import.
"""
import argparse
import datetime as dt
import json
import math
import pathlib
import re
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = 'https://maps.london.ca/server/rest/services/OpenData/OpenData_Transportation/MapServer/7'
CLASSES = {14:'M',20:'B',21:'A',22:'C',23:'B',24:'A',25:'A',26:'A',27:'A',28:'M',29:'M'}


def download():
    features = []
    offset = 0
    while True:
        query = urllib.parse.urlencode(dict(
            f='json', where='StreetClassification IN (' + ','.join(map(str,CLASSES)) + ')',
            outFields='OBJECTID,FullStreetName,StreetClassification', outSR=4326,
            returnGeometry='true', orderByFields='OBJECTID',
            resultOffset=offset, resultRecordCount=1000))
        with urllib.request.urlopen(SOURCE + '/query?' + query, timeout=60) as response:
            data = json.load(response)
        if 'error' in data:
            raise ValueError(data['error'])
        batch = data.get('features', [])
        features.extend(batch)
        print('Downloaded', len(features), 'road segments', flush=True)
        if not data.get('exceededTransferLimit'):
            break
        if not batch:
            raise ValueError('Road pagination returned an empty incomplete page')
        offset += len(batch)
    return features


def encode(points):
    result, previous = [], [0,0]
    for point in points:
        # ArcGIS supplies longitude, latitude; the app uses encoded latitude first.
        values = [round(point[1]*100000), round(point[0]*100000)]
        for i, value in enumerate(values):
            delta = value-previous[i]
            previous[i] = value
            number = ~(delta<<1) if delta<0 else delta<<1
            while number>=32:
                result.append(chr((32 | (number & 31))+63)); number >>= 5
            result.append(chr(number+63))
    # The existing decoder uses ! for backslashes.
    return ''.join(result).replace('\\','!')


def simplify(points, tolerance=0.00001):
    if len(points)<=2:
        return points
    a,b=points[0],points[-1]
    dx,dy=b[0]-a[0],b[1]-a[1]
    length=dx*dx+dy*dy
    farthest,index=0,0
    for i,p in enumerate(points[1:-1],1):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
        distance=math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
        if distance>farthest: farthest,index=distance,i
    if farthest<=tolerance:
        return [a,b]
    return simplify(points[:index+1],tolerance)[:-1]+simplify(points[index:],tolerance)


def build_snapshot(features):
    if len(features)<1000:
        raise ValueError('Refusing to embed an incomplete city road network')
    groups={}
    for feature in features:
        attrs=feature['attributes']
        classification=CLASSES.get(attrs['StreetClassification'])
        if not classification: continue
        name=attrs.get('FullStreetName') or ''
        for points in feature.get('geometry',{}).get('paths',[]):
            if len(points)>=2:
                groups.setdefault((classification,name),[]).append(simplify(points))
    roads=[]
    for (classification,name),paths in sorted(groups.items()):
        # Join consecutive segments of the same street; preserve branches and loops.
        def key(p): return (round(p[0],6),round(p[1],6))
        nodes={}
        for i,p in enumerate(paths):
            nodes.setdefault(key(p[0]),[]).append(i)
            nodes.setdefault(key(p[-1]),[]).append(i)
        unused=set(range(len(paths)))
        def trace(i,start):
            points=[]
            while i in unused:
                unused.remove(i)
                segment=paths[i]
                if key(segment[0])!=start: segment=segment[::-1]
                points.extend(segment if not points else segment[1:])
                start=key(segment[-1])
                options=[j for j in nodes[start] if j in unused]
                if len(nodes[start])!=2 or not options: break
                i=options[0]
            return points
        for node,edges in nodes.items():
            if len(edges)!=2:
                for i in edges:
                    if i in unused: roads.append([classification,name,encode(trace(i,node))])
        while unused:
            i=min(unused); roads.append([classification,name,encode(trace(i,key(paths[i][0])))])
    return dict(source=SOURCE,attribution='City of London',fetched=dt.date.today().isoformat(),
                segmentCount=len(features),roadCount=len(roads),roads=roads)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--snapshot',type=pathlib.Path)
    parser.add_argument('--save-snapshot',type=pathlib.Path)
    args=parser.parse_args()
    features=json.loads(args.snapshot.read_text()) if args.snapshot else download()
    if args.save_snapshot: args.save_snapshot.write_text(json.dumps(features))
    snapshot=build_snapshot(features)
    payload=json.dumps(snapshot,separators=(',',':'),ensure_ascii=True).replace('<','\\u003c')
    filename=ROOT/'Forest City Transit.html'
    html=filename.read_text(encoding='utf-8')
    tag='<script type="application/json" id="d-roads">'+payload+'</script>'
    if 'id="d-roads"' in html:
        html,count=re.subn(r'<script type="application/json" id="d-roads">.*?</script>',lambda _:tag,html,count=1,flags=re.S)
        if count!=1: raise ValueError('Road snapshot element was not found')
    else:
        html=html.replace('<script id="trip-address-tools">',tag+'\n<script id="trip-address-tools">',1)
    filename.write_text(html,encoding='utf-8')
    print('Embedded',snapshot['roadCount'],'road paths from',snapshot['segmentCount'],'city road segments')


if __name__=='__main__': main()
