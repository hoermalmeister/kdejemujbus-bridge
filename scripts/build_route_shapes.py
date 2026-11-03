#!/usr/bin/env python3
"""Z celostátního GTFS (JDF) vytvoří malé soubory s trasami po linkách pro GitHub Pages.

Celý feed se nikdy nenačítá do paměti: shapes.txt se čte po řádcích přímo ze ZIPu
a drží se jen tvary spojů, které pojedou v následujících dnech.

Výstup: <out>/routes/<linka>.json
  {"base": "20261103", "shapes": ["<polyline>", ...], "trips": {"<spoj>": [[index_tvaru, maska_dnů], ...]}}
Bit N v masce znamená, že varianta jede v den base + N.
"""
import csv
import io
import json
import math
import os
import sys
import zipfile
from collections import defaultdict
from datetime import date, timedelta

WINDOW_DAYS = 8
TOLERANCE_M = 10.0


def rows(archive, name):
    with archive.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''))


def parse_date(text):
    return date(int(text[:4]), int(text[4:6]), int(text[6:8]))


def service_masks(archive, base):
    masks = defaultdict(int)
    weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    for row in rows(archive, 'calendar.txt'):
        start, end = parse_date(row['start_date']), parse_date(row['end_date'])
        for offset in range(WINDOW_DAYS):
            day = base + timedelta(days=offset)
            if start <= day <= end and row[weekdays[day.weekday()]] == '1':
                masks[row['service_id']] |= 1 << offset
    for row in rows(archive, 'calendar_dates.txt'):
        offset = (parse_date(row['date']) - base).days
        if 0 <= offset < WINDOW_DAYS:
            if row['exception_type'] == '1':
                masks[row['service_id']] |= 1 << offset
            else:
                masks[row['service_id']] &= ~(1 << offset)
    return masks


def simplify(points):
    """Douglas-Peucker s tolerancí v metrech."""
    if len(points) < 3:
        return points
    scale = 111320 * math.cos(math.radians(points[0][0]))
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        ax, ay = points[first][1] * scale, points[first][0] * 111320
        bx, by = points[last][1] * scale, points[last][0] * 111320
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        worst, worst_index = 0.0, -1
        for i in range(first + 1, last):
            px, py = points[i][1] * scale, points[i][0] * 111320
            t = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
            distance = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if distance > worst:
                worst, worst_index = distance, i
        if worst > TOLERANCE_M:
            keep[worst_index] = True
            stack.append((first, worst_index))
            stack.append((worst_index, last))
    return [p for p, k in zip(points, keep) if k]


def encode(points):
    """Kódování polyline s přesností 5 desetinných míst (asi 1 m)."""
    out = []
    previous = (0, 0)
    for lat, lon in points:
        current = (round(lat * 1e5), round(lon * 1e5))
        for value, last in zip(current, previous):
            delta = value - last
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 0x20:
                out.append(chr((0x20 | (delta & 0x1f)) + 63))
                delta >>= 5
            out.append(chr(delta + 63))
        previous = current
    return ''.join(out)


def read_shapes(archive, wanted):
    encoded = {}
    current, points = None, []

    def finish():
        if current is not None and len(points) >= 2:
            encoded[current] = encode(simplify(points))

    for row in rows(archive, 'shapes.txt'):
        shape_id = row['shape_id']
        if shape_id != current:
            finish()
            current, points = shape_id, []
            if len(encoded) % 5000 == 0 and encoded:
                print(f'  tvarů: {len(encoded)}', flush=True)
        if shape_id in wanted:
            points.append((float(row['shape_pt_lat']), float(row['shape_pt_lon'])))
    finish()
    return encoded


def main(feed_path, out_dir):
    base = date.today()
    with zipfile.ZipFile(feed_path) as archive:
        masks = service_masks(archive, base)

        lines = defaultdict(lambda: defaultdict(dict))
        wanted = set()
        total = 0
        for row in rows(archive, 'trips.txt'):
            total += 1
            mask = masks.get(row['service_id'], 0)
            parts = row['trip_short_name'].split()
            if not mask or len(parts) != 2 or not row['shape_id']:
                continue
            line, run = parts
            variants = lines[line][run]
            variants[row['shape_id']] = variants.get(row['shape_id'], 0) | mask
            wanted.add(row['shape_id'])
        print(f'Spojů celkem: {total}, linek v okně: {len(lines)}, tvarů: {len(wanted)}', flush=True)

        shapes = read_shapes(archive, wanted)

    routes_dir = os.path.join(out_dir, 'routes')
    os.makedirs(routes_dir, exist_ok=True)
    total_bytes = 0
    for line, runs in lines.items():
        unique, trips = {}, {}
        for run, variants in runs.items():
            entries = []
            for shape_id, mask in variants.items():
                polyline = shapes.get(shape_id)
                if polyline:
                    entries.append([unique.setdefault(polyline, len(unique)), mask])
            if entries:
                trips[run] = entries
        if not trips:
            continue
        payload = json.dumps({'base': base.strftime('%Y%m%d'), 'shapes': list(unique), 'trips': trips},
                             separators=(',', ':'))
        with open(os.path.join(routes_dir, f'{line}.json'), 'w', encoding='utf-8') as handle:
            handle.write(payload)
        total_bytes += len(payload)
    print(f'Souborů: {len(os.listdir(routes_dir))}, celkem {total_bytes / 1e6:.1f} MB', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
