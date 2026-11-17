import csv, io, json, zipfile, urllib.request, collections, re, datetime
z = zipfile.ZipFile('feed.zip')
def rows(name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
print('PG files', z.namelist())
today = datetime.date(2026, 11, 17)
cal = {c['service_id']: c for c in rows('calendar.txt')}
cd = collections.defaultdict(list)
if 'calendar_dates.txt' in z.namelist():
    for c in rows('calendar_dates.txt'): cd[c['service_id']].append((c['date'], c['exception_type']))
def active(sid):
    on = False
    c = cal.get(sid)
    if c:
        s0 = datetime.datetime.strptime(c['start_date'], '%Y%m%d').date(); e0 = datetime.datetime.strptime(c['end_date'], '%Y%m%d').date()
        on = s0 <= today <= e0 and c[['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][today.weekday()]] == '1'
    for d, t in cd.get(sid, ()):
        if d == today.strftime('%Y%m%d'): on = t == '1'
    return on
routes = {r['route_id']: r for r in rows('routes.txt')}
stops = {r['stop_id']: (float(r['stop_lat'] or 0), float(r['stop_lon'] or 0)) for r in rows('stops.txt')}
trip_line = {}; runs_today = collections.defaultdict(set); runs_any = collections.defaultdict(set); by_short = collections.defaultdict(set)
dpo_sids = collections.Counter()
for t in rows('trips.txt'):
    p = (t.get('trip_short_name') or '').split()
    if len(p) < 2 or not re.fullmatch(r'\d{6}', p[0]): continue
    trip_line[t['trip_id']] = p[0]
    by_short[routes.get(t['route_id'], {}).get('route_short_name', '')].add(p[0])
    runs_any[p[0]].add(p[1])
    if active(t['service_id']): runs_today[p[0]].add(p[1])
    if p[0] == '915076': dpo_sids[t['service_id']] += 1
for sid, n in dpo_sids.most_common(6):
    print('PG DPO sid', sid, n, cal.get(sid), cd.get(sid, [])[:6], len(cd.get(sid, [])))
print('PG DPO runs today 915076', len(runs_today['915076']), 'any', len(runs_any['915076']))
# linky se zastávkou v JMK
inj = set()
for st in rows('stop_times.txt'):
    l = trip_line.get(st['trip_id'])
    if not l or l in inj: continue
    la, lo = stops.get(st['stop_id'], (0, 0))
    if 48.55 <= la <= 49.65 and 15.5 <= lo <= 17.7: inj.add(l)
print('PG lines touching JMK', len(inj), 'trips(line,run) today', sum(len(runs_today[l]) for l in inj))
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'probe'}), timeout=30) as r: return json.loads(r.read())
jmk = get('https://grapp-bridge-production.up.railway.app/idsjmk').get('Vehicles', [])
st1 = collections.Counter(); st2 = collections.Counter(); amb = []
for v in jmk:
    if v.get('VType') == 5: continue
    name, run = str(v.get('LineName')), str(v.get('RouteID'))
    c_all = [l for l in by_short.get(name, ()) if run in runs_today[l]]
    c_j = [l for l in c_all if l in inj]
    st1[min(len(c_all), 3)] += 1; st2[min(len(c_j), 3)] += 1
    if len(c_j) != 1 and len(amb) < 30: amb.append((name, run, v.get('VType'), v.get('FinalStopName'), c_j, [l for l in by_short.get(name, ()) if run in runs_any[l] and l in inj]))
print('PG JMK candidates all', sorted(st1.items()), 'inJMK', sorted(st2.items()))
for a in amb: print('PG JMK', a)
