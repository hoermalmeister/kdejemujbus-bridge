import csv, io, json, zipfile, urllib.request, collections, re
z = zipfile.ZipFile('feed.zip')
def rows(name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
agency = {r['agency_id']: r['agency_name'] for r in rows('agency.txt')}
routes = {r['route_id']: r for r in rows('routes.txt')}
lines = collections.defaultdict(lambda: {'short': set(), 'ag': set(), 'runs': set(), 'n': 0})
for t in rows('trips.txt'):
    parts = (t.get('trip_short_name') or '').split()
    if len(parts) < 2 or not re.fullmatch(r'\d{6}', parts[0]): continue
    r = routes.get(t['route_id'], {})
    L = lines[parts[0]]
    L['short'].add(r.get('route_short_name', '')); L['ag'].add(agency.get(r.get('agency_id'), '?')); L['runs'].add(parts[1]); L['n'] += 1
def show(title, pred):
    sel = sorted(k for k, v in lines.items() if pred(k, v))
    print(f'PG == {title}: {len(sel)} lines')
    for k in sel[:400]:
        v = lines[k]
        print('PG ', k, '|', ','.join(sorted(v['short'])), '|', ';'.join(sorted(v['ag']))[:80], '| runs', len(v['runs']), min(v['runs'], key=int), max(v['runs'], key=int))
show('DPMHK', lambda k, v: any('Hradec' in a and 'Dopravní podnik' in a for a in v['ag']))
show('DSZO', lambda k, v: any('Zlín' in a and 'Otrokovice' in a for a in v['ag']))
show('Kroměříž 775', lambda k, v: k.startswith('775'))
show('DPO', lambda k, v: any('Ostrava' in a and 'Dopravní podnik' in a for a in v['ag']))
# prefixy JMK: Brno MHD (DPMB) a ostatní
show('DPMB', lambda k, v: any('Brno' in a and 'Dopravní podnik' in a for a in v['ag']))
pref = collections.Counter(k[:3] for k, v in lines.items() if any('Brno' in a or 'Břeclav' in a or 'Znojm' in a or 'Hodonín' in a or 'Vyškov' in a or 'Blansk' in a or 'BORS' in a or 'ČAD' in a or 'Tourbus' in a for a in v['ag']))
print('PG JMK-ish prefixes', pref.most_common(25))

def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'probe'}), timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'error': str(e)}
B = 'https://grapp-bridge-production.up.railway.app'
jmk = get(B + '/idsjmk')
vs = jmk.get('Vehicles', []) if isinstance(jmk, dict) else []
print('PG JMK vehicles', len(vs))
if vs: print('PG JMK keys', sorted(vs[0].keys()))
for v in vs[:12]: print('PG JMK', {k: v.get(k) for k in ('ID', 'LineID', 'LineName', 'RouteID', 'VType', 'FinalStopName', 'Course', 'ServiceID', 'TripID')})
cnt = collections.Counter((v.get('LineID'), v.get('LineName')) for v in vs)
print('PG JMK LineID/LineName sample', cnt.most_common(60))
for name in ('dpmhk', 'dszo', 'tsmk'):
    d = get(B + '/' + name)
    print('PG', name, 'count', len(d) if isinstance(d, list) else d)
    for v in (d if isinstance(d, list) else [])[:6]: print('PG', name, json.dumps(v, ensure_ascii=False)[:500])
odis = get(B + '/mpv/odis')
od = odis if isinstance(odis, list) else []
print('PG ODIS count', len(od))
short = [o for o in od if not re.fullmatch(r'\d{6}', str(o.get('cn', '')).split('|')[0])]
print('PG ODIS non6', len(short))
for o in short[:10]: print('PG ODIS', json.dumps({k: o.get(k) for k in ('cn', 'cr', 'cat', 'external')}, ensure_ascii=False)[:400])
print('PG ODIS carriers non6', collections.Counter(str(o.get('cr')) for o in short).most_common(10))
