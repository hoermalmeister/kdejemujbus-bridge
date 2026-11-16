import csv, io, zipfile, collections
def log(*a): print('PG', *a, flush=True)
z = zipfile.ZipFile('feed.zip')
def rows(n): return csv.DictReader(io.TextIOWrapper(z.open(n), encoding='utf-8-sig'))
want = ('705100', '635007', '495712')
agencies = {a['agency_id']: a['agency_name'] for a in rows('agency.txt')}
routes = {r['route_id']: r for r in rows('routes.txt')}
trips = collections.defaultdict(list)
for t in rows('trips.txt'):
    sn = (t.get('trip_short_name') or '').split()
    if sn and sn[0] in want: trips[sn[0]].append(t)
for line in want:
    ts = trips.get(line, [])
    rs = {t['route_id'] for t in ts}
    log(line, 'trips', len(ts), 'routes', [(routes[r].get('route_short_name'), routes[r].get('route_long_name','')[:60], agencies.get(routes[r].get('agency_id'))) for r in rs], 'headsigns', collections.Counter(t.get('trip_headsign') for t in ts).most_common(5))
