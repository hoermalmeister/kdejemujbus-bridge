import csv, io, json, zipfile, urllib.request, collections, re, unicodedata
z = zipfile.ZipFile('feed.zip')
def rows(name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()
agency = {r['agency_id']: r['agency_name'] for r in rows('agency.txt')}
routes = {r['route_id']: r for r in rows('routes.txt')}
stops = {r['stop_id']: r['stop_name'] for r in rows('stops.txt')}
trip_key = {}
by_short = collections.defaultdict(set)   # route_short_name -> lines
line_ag = collections.defaultdict(set)
runs = collections.defaultdict(set)
for t in rows('trips.txt'):
    p = (t.get('trip_short_name') or '').split()
    if len(p) < 2 or not re.fullmatch(r'\d{6}', p[0]): continue
    r = routes.get(t['route_id'], {})
    trip_key[t['trip_id']] = (p[0], p[1])
    by_short[r.get('route_short_name', '')].add(p[0])
    line_ag[p[0]].add(agency.get(r.get('agency_id'), '?'))
    runs[p[0]].add(p[1])
print('PG HK agencies', sorted({a for a in agency.values() if 'Hradc' in a or 'Králov' in a})[:10])
print('PG Brno agencies', sorted({a for a in agency.values() if 'Brn' in a})[:10])
hk = sorted(l for l, a in line_ag.items() if any('Hradce' in x and 'podnik' in x.lower() for x in a))
print('PG DPMHK lines', hk)
dpmb = sorted(l for l, a in line_ag.items() if any('Brna' in x and 'podnik' in x.lower() for x in a))
print('PG DPMB lines', len(dpmb), dpmb[:80])
# poslední zastávka každého spoje
last = {}
for st in rows('stop_times.txt'):
    k = trip_key.get(st['trip_id'])
    if not k: continue
    seq = int(st['stop_sequence'])
    if k not in last or seq > last[k][0]: last[k] = (seq, stops.get(st['stop_id'], ''))
def dest_ok(line, run, dest):
    l = last.get((line, str(run)))
    if not l: return None
    a, b = norm(l[1]), norm(dest)
    return bool(a and b and (a in b or b in a or a.split()[-1] == b.split()[-1]))

def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'probe'}), timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'error': str(e)}
B = 'https://grapp-bridge-production.up.railway.app'

# IDS JMK: kandidáti podle čísla linky a RouteID
jmk = get(B + '/idsjmk').get('Vehicles', [])
stat = collections.Counter(); prefixes = collections.Counter(); bad = []
for v in jmk:
    if v.get('VType') == 5: continue
    name, run = str(v.get('LineName')), str(v.get('RouteID'))
    cands = [l for l in by_short.get(name, ()) if run in runs[l]]
    good = [l for l in cands if dest_ok(l, run, v.get('FinalStopName'))]
    stat[(len(cands) > 0, len(good))] += 1
    for l in good: prefixes[(l[:3], v.get('VType'))] += 1
    if not good and len(bad) < 25: bad.append((name, run, v.get('VType'), v.get('FinalStopName'), v.get('Course'), sorted(by_short.get(name, ()))[:8]))
print('PG JMK stat (hasCand, nGood)', stat.most_common())
print('PG JMK prefixes', prefixes.most_common(30))
for b in bad: print('PG JMK miss', b)
# kolik JMK linek má v GTFS pod stejným krátkým číslem více řádků ve 7xx
amb = {n: sorted(l for l in ls if l[0] == '7') for n, ls in by_short.items() if n and len([l for l in ls if l[0] == '7']) > 1}
print('PG short names with >1 7xx lines', len(amb), list(amb.items())[:15])

hkv = get(B + '/dpmhk')
for v in (hkv if isinstance(hkv, list) else [])[:40]:
    if not v.get('trip'): continue
    cands = [l for l in hk if l.endswith(str(v['line']).zfill(3))]
    print('PG HK', v['line'], v['trip'], v.get('routeName'), v.get('destination'), [(l, str(v['trip']) in runs[l], dest_ok(l, v['trip'], v.get('destination'))) for l in cands])

for v in (get(B + '/dszo') or [])[:40]:
    if not isinstance(v, dict) or not v.get('spoj'): continue
    l = ('826' if str(v['line']) in ('55', '56', '57', '93') else '825') + str(v['line']).zfill(3)
    print('PG DSZO', v['line'], v['spoj'], l, v['spoj'] in runs[l], dest_ok(l, v['spoj'], v.get('destination')), v.get('destination'))
for v in (get(B + '/tsmk') or []):
    if not isinstance(v, dict): continue
    l = '775' + str(v['line']).zfill(3)
    print('PG TSMK', v['line'], v['run'], l, str(v['run']) in runs[l], dest_ok(l, v['run'], v.get('destination')), v.get('destination'))
ok = collections.Counter()
for o in get(B + '/mpv/odis'):
    f = str(o.get('cn', '')).split('|')
    if 'DPO' not in str(o.get('cr')) or re.fullmatch(r'\d{6}', f[0]): continue
    l = '915' + f[0].zfill(3)
    r = (f[2] in runs[l], dest_ok(l, f[2], f[9]))
    ok[r] += 1
    if r != (True, True) and ok[r] < 6: print('PG DPO miss', f[0], f[2], f[9], last.get((l, f[2])))
print('PG DPO stat (runExists, destOk)', ok.most_common())
