import csv, io, json, zipfile, urllib.request, collections, re, datetime
z = zipfile.ZipFile('feed.zip')
def rows(name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
today = '20261117'
cal = {c['service_id']: c for c in rows('calendar.txt')}
cd = collections.defaultdict(dict)
for c in rows('calendar_dates.txt'): cd[c['service_id']][c['date']] = c['exception_type']
stops = {r['stop_id']: r['stop_name'] for r in rows('stops.txt')}
want = {'915001', '915008', '915076', '915007'}
trips = {}
for t in rows('trips.txt'):
    p = (t.get('trip_short_name') or '').split()
    if len(p) == 2 and p[0] in want: trips[t['trip_id']] = (p[0], p[1], t['service_id'], t.get('trip_headsign'), t['route_id'])
first = {}
for st in rows('stop_times.txt'):
    if st['trip_id'] in trips:
        s = int(st['stop_sequence']); k = st['trip_id']
        cur = first.get(k)
        if not cur: first[k] = [(s, st['departure_time'], stops[st['stop_id']]), (s, st['departure_time'], stops[st['stop_id']])]
        else:
            if s < cur[0][0]: cur[0] = (s, st['departure_time'], stops[st['stop_id']])
            if s > cur[1][0]: cur[1] = (s, st['departure_time'], stops[st['stop_id']])
sids = collections.Counter(v[2] for v in trips.values())
for sid, n in sids.most_common(8):
    d = sorted(cd[sid].items())
    print('PG sid', sid, n, {k: cal[sid][k] for k in ('start_date', 'end_date')}, 'today', cd[sid].get(today), 'dates', len(d), d[:3], d[-2:])
for line in ('915076', '915008'):
    for tid, (l, r, sid, hs, rid) in sorted(trips.items(), key=lambda x: int(x[1][1])):
        if l == line and r in ('19', '20', '21', '85', '86', '107', '108'):
            print('PG', l, r, cd[sid].get(today), sid[-6:], first.get(tid))
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'probe'}), timeout=60) as r: return json.loads(r.read())
for o in get('https://grapp-bridge-production.up.railway.app/mpv/odis'):
    f = str(o.get('cn', '')).split('|')
    if f[0] in ('76', '8', '1', '7') and 'DPO' in str(o.get('cr')): print('PG ODIS', '|'.join(f[:12]))
