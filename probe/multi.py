import csv, io, json, zipfile, urllib.request, collections, re, datetime, unicodedata, time
z = zipfile.ZipFile('feed.zip')
def rows(name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)
today = datetime.date(2026, 11, 17)
cal = {c['service_id']: c for c in rows('calendar.txt')}
cd = collections.defaultdict(dict)
for c in rows('calendar_dates.txt'): cd[c['service_id']][c['date']] = c['exception_type']
def active(sid):
    c = cal.get(sid); on = False
    if c and c['start_date'] <= today.strftime('%Y%m%d') <= c['end_date']:
        on = c[['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][today.weekday()]] == '1'
    e = cd[sid].get(today.strftime('%Y%m%d'))
    return (e == '1') if e else on
stops = {r['stop_id']: r['stop_name'] for r in rows('stops.txt')}
tk = {}; runs = collections.defaultdict(set)
for t in rows('trips.txt'):
    p = (t.get('trip_short_name') or '').split()
    if len(p) == 2 and re.fullmatch(r'\d{6}', p[0]) and active(t['service_id']):
        tk[t['trip_id']] = (p[0], p[1]); runs[p[0]].add(p[1])
seq = {}
for st in rows('stop_times.txt'):
    k = tk.get(st['trip_id'])
    if not k: continue
    s = int(st['stop_sequence']); n = stops.get(st['stop_id'], '')
    lo, hi = seq.get(k, ((10**9, ''), (-1, '')))
    seq[k] = (min(lo, (s, n)), max(hi, (s, n)))
def dest(line, run, d):
    v = seq.get((line, str(run)))
    if not v: return None
    a, b = norm(v[1][1]), norm(d)
    return bool(a and b and (a.endswith(b) or b.endswith(a) or a[-6:] == b[-6:]))
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'probe'}), timeout=60) as r: return json.loads(r.read())
B = 'https://grapp-bridge-production.up.railway.app'
get(B + '/dpmhk'); get(B + '/dszo'); time.sleep(12)   # první dotaz natáhne párovací data
jmk = [v for v in get(B + '/idsjmk').get('Vehicles', []) if v.get('VType') != 5]
c = collections.Counter(); bad = []
for v in jmk:
    fl = v.get('FullLine')
    if not fl: c['bez FullLine'] += 1; continue
    ok = str(v['RouteID']) in runs[fl]; d = dest(fl, v['RouteID'], v.get('FinalStopName'))
    c[('spoj existuje', ok, 'cíl', d)] += 1
    if d is False and len(bad) < 8: bad.append((v['LineName'], v['RouteID'], fl, v.get('FinalStopName'), seq.get((fl, str(v['RouteID'])), [0, ''])[1]))
print('PG JMK', len(jmk), c.most_common())
for b in bad: print('PG JMK cíl?', b)
print('PG JMK bez FullLine', collections.Counter(v['LineName'] for v in jmk if not v.get('FullLine')).most_common(15))
for name in ('dpmhk', 'dszo'):
    c = collections.Counter(); ex = []
    for v in get(B + '/' + name):
        if not v.get('fullLine'): c['bez linky'] += 1; continue
        if not v.get('run'): c['bez spoje'] += 1; continue
        d = dest(v['fullLine'], v['run'], v.get('destination'))
        c[('cíl sedí', d)] += 1
        if len(ex) < 6: ex.append((v['line'], v['fullLine'], v['run'], v.get('stop'), v.get('destination'), seq.get((v['fullLine'], str(v['run'])), [0, ''])[1]))
    print('PG', name, c.most_common())
    for e in ex: print('PG', name, e)
c = collections.Counter(); ex = []
for o in get(B + '/mpv/odis'):
    f = str(o.get('cn', '')).split('|')
    if 'DPO' not in str(o.get('cr')) or re.fullmatch(r'\d{6}', f[0]) or not re.fullmatch(r'\d{1,3}', f[0]): continue
    l = '915' + f[0].zfill(3)
    k = (f[2] in runs[l], dest(l, f[2], f[9]))
    c[k] += 1
    if k != (True, True) and len(ex) < 8: ex.append(('|'.join(f[:10]), seq.get((l, f[2]))))
print('PG DPO (spoj existuje, cíl sedí)', c.most_common())
for e in ex: print('PG DPO', e)
for v in get(B + '/tsmk'):
    l = '775' + str(v['line']).zfill(3)
    print('PG TSMK', l, v['run'], str(v['run']) in runs[l], dest(l, v['run'], v.get('destination')))
