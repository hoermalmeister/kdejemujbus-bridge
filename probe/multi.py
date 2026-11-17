import csv, io, json, zipfile, urllib.request, collections, re, unicodedata, time
z = zipfile.ZipFile('feed.zip')
def rows(name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)
today = '20261117'
cal = {c['service_id']: c for c in rows('calendar.txt')}
cd = collections.defaultdict(dict)
for c in rows('calendar_dates.txt'): cd[c['service_id']][c['date']] = c['exception_type']
def active(sid):
    e = cd[sid].get(today)
    if e: return e == '1'
    c = cal.get(sid)
    return bool(c and c['start_date'] <= today <= c['end_date'] and c['tuesday'] == '1')
stops = {r['stop_id']: r['stop_name'] for r in rows('stops.txt')}
tk = {}; runs = collections.defaultdict(set)
for t in rows('trips.txt'):
    p = (t.get('trip_short_name') or '').split()
    if len(p) == 2 and p[0].startswith('915') and active(t['service_id']): tk[t['trip_id']] = (p[0], p[1]); runs[p[0]].add(p[1])
last = {}
for st in rows('stop_times.txt'):
    k = tk.get(st['trip_id'])
    if k:
        s = int(st['stop_sequence'])
        if k not in last or s > last[k][0]: last[k] = (s, stops.get(st['stop_id'], ''))
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'probe'}), timeout=60) as r: return json.loads(r.read())
U = 'https://grapp-bridge-production.up.railway.app/mpv/odis'
for attempt in range(4):
    data = get(U); dpo = [o for o in data if o.get('cisLine')]
    done = sum(1 for o in dpo if o.get('cisRun'))
    print('PG pokus', attempt, 'DPO', len(dpo), 's cisRun', done)
    if dpo and done >= len(dpo) * 0.9: break
    time.sleep(15)
c = collections.Counter(); ex = []
for o in dpo:
    if not o.get('cisRun'): c['bez spoje'] += 1; continue
    f = o['cn'].split('|'); l, r = o['cisLine'], str(o['cisRun'])
    lt = last.get((l, r), (0, ''))[1]
    ok = (r in runs[l], bool(lt) and (norm(lt).endswith(norm(f[9])) or norm(f[9])[-6:] == norm(lt)[-6:]))
    c[ok] += 1
    if ok != (True, True) and len(ex) < 10: ex.append((f[0], f[2], '→', r, f[9], lt))
print('PG DPO (spoj dnes jede, cíl sedí)', c.most_common())
for e in ex: print('PG DPO', e)
