import csv, io, zipfile, collections
def log(*a): print('PG', *a, flush=True)
z = zipfile.ZipFile('feed.zip')
def rows(n): return csv.DictReader(io.TextIOWrapper(z.open(n), encoding='utf-8-sig'))
agencies = {a['agency_id']: a['agency_name'] for a in rows('agency.txt')}
routes = {r['route_id']: r for r in rows('routes.txt')}
ts = [t for t in rows('trips.txt') if (t.get('trip_short_name') or '').split()[:1] == ['696002']]
rs = {t['route_id'] for t in ts}
log('696002 trips', len(ts), 'routes', [(routes[r].get('route_short_name'), routes[r].get('route_long_name','')[:70], agencies.get(routes[r].get('agency_id'))) for r in rs])
log('headsigns', collections.Counter(t.get('trip_headsign') for t in ts).most_common(6), 'shapes', len({t.get('shape_id') for t in ts if t.get('shape_id')}))
