import csv, io, zipfile, collections
def log(*a): print('PG', *a, flush=True)
z = zipfile.ZipFile('feed.zip')
def rows(n): return csv.DictReader(io.TextIOWrapper(z.open(n), encoding='utf-8-sig'))
ag = {a['agency_id']: a['agency_name'] for a in rows('agency.txt')}
kv_ag = {k for k, v in ag.items() if 'karlovy vary' in v.lower() or 'dpkv' in v.lower()}
log('agencies', [ag[k] for k in kv_ag])
routes = {r['route_id']: r for r in rows('routes.txt') if r.get('agency_id') in kv_ag}
log('routes', sorted((r['route_short_name'], r.get('route_long_name','')[:50]) for r in routes.values())[:60])
lines = collections.defaultdict(list)
for t in rows('trips.txt'):
    if t['route_id'] in routes:
        sn = (t.get('trip_short_name') or '').split()
        lines[(routes[t['route_id']]['route_short_name'], sn[0] if sn else '')].append(sn[1] if len(sn) > 1 else '')
for (short, cis), runs in sorted(lines.items()):
    log('line', short, 'cis', cis, 'trips', len(runs), 'runs sample', sorted(set(runs), key=lambda x: int(x) if x.isdigit() else 0)[:12])
