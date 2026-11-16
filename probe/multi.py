import csv, io, json, urllib.request, zipfile, collections, sys
def log(*a): print('PG', *a, flush=True)
q = [{"query":"query busesCurrentLocation { busesCurrentLocations { angle delay destinationName lastStopName latitude longitude linkNumber state type mainType spz updated linkNumberAlias } }","operationName":"busesCurrentLocation","variables":{}}]
try:
    req = urllib.request.Request('https://www.arriva.cz/api/graphql', data=json.dumps(q).encode(), headers={'content-type':'application/json','accept':'*/*','origin':'https://www.arriva.cz','referer':'https://www.arriva.cz/cs/dopravni-info/aktualni-poloha-autobusu-online?mainType=MHD','x-enviroment':'client','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    d = json.load(urllib.request.urlopen(req, timeout=30))
    b = (d[0] if isinstance(d, list) else d)['data']['busesCurrentLocations']
    sel = [x for x in b if x['type'] in ('Kladno','Express')]
    log('ARRIVA ok total', len(b), 'kladno+express', len(sel), sorted(set(x['linkNumber'] for x in sel)))
except Exception as e:
    log('ARRIVA ERROR', repr(e)[:300])
want = ('2256', '580916', '157710', '721341')
z = zipfile.ZipFile('feed.zip')
def rows(n): return csv.DictReader(io.TextIOWrapper(z.open(n), encoding='utf-8-sig'))
routes = {r['route_id']: r for r in rows('routes.txt') if r['route_short_name'].startswith(want)}
log('ROUTES', sorted((r['route_short_name'], r.get('route_long_name','')[:40]) for r in routes.values()))
trips = collections.defaultdict(list)
for t in rows('trips.txt'):
    if t['route_id'] in routes: trips[routes[t['route_id']]['route_short_name']].append(t)
for line, ts in sorted(trips.items()):
    log('TRIPS', line, len(ts), 'headsigns', collections.Counter(t.get('trip_headsign','') for t in ts).most_common(4), 'short', [t.get('trip_short_name') for t in ts[:3]])
names = {s['stop_id']: s['stop_name'] for s in rows('stops.txt')}
sample = {ts[0]['trip_id']: line for line, ts in trips.items()}
st = collections.defaultdict(list)
for r in rows('stop_times.txt'):
    if r['trip_id'] in sample: st[r['trip_id']].append((int(r['stop_sequence']), names.get(r['stop_id'])))
for tid, line in sample.items(): log('STOPS', line, [n for _, n in sorted(st[tid])][:30])
