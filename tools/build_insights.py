"""Simulate the T-Life tracked population around Bellevue, WA and aggregate it into
anonymized hex-cell x hour counts -> data/insights.js.

Only consenting devices for people 16+ are simulated. Under-16 devices are counted
for the panel summary and never enter the aggregates. Output is raw aggregate counts;
the portal applies k-anonymity suppression and Laplace noise on top.
"""
import json, math, os, random

random.seed(20261025)
ROOT = os.path.join(os.path.dirname(__file__), "..")

LAT0, LNG0 = 47.597, -122.165
MLAT = 111320.0
MLNG = 111320.0 * math.cos(math.radians(LAT0))
BOUNDS = (47.546, 47.648, -122.214, -122.112)  # lat min/max, lng min/max
HEX_R = 240.0  # meters, center to corner
DAYS = {"wd": 5, "we": 2}
MI = 1609.34

def xy(lat, lng): return ((lng - LNG0) * MLNG, (lat - LAT0) * MLAT)
def ll(x, y): return (LAT0 + y / MLAT, LNG0 + x / MLNG)
def dist(a, b):
    ax, ay = xy(*a); bx, by = xy(*b)
    return math.hypot(ax - bx, ay - by)

def on_land(lat, lng):
    if not (BOUNDS[0] <= lat <= BOUNDS[1] and BOUNDS[2] <= lng <= BOUNDS[3]): return False
    if lng < -122.207 and lat < 47.607: return False          # Lake Washington / Enatai shore
    if lng < -122.211 and lat < 47.620: return False          # Meydenbauer Bay
    return True

def hex_of(lat, lng):
    x, y = xy(lat, lng)
    q = (math.sqrt(3) / 3 * x - y / 3) / HEX_R
    r = (2 / 3 * y) / HEX_R
    cx, cz = q, r; cy = -cx - cz
    rx, ry, rz = round(cx), round(cy), round(cz)
    dx, dy, dz = abs(rx - cx), abs(ry - cy), abs(rz - cz)
    if dx > dy and dx > dz: rx = -ry - rz
    elif dy > dz: ry = -rx - rz
    else: rz = -rx - ry
    return (rx, rz)

def hex_center(q, r):
    return ll(HEX_R * math.sqrt(3) * (q + r / 2), HEX_R * 1.5 * r)

# ---------------------------------------------------------------- places (approximate coordinates)
HOODS = [  # name, lat, lng, weight, spread_m
    ("Downtown Bellevue", 47.6135, -122.1975, 1.5, 420), ("West Bellevue", 47.6170, -122.2080, 0.8, 450),
    ("Northwest Bellevue", 47.6270, -122.1990, 0.8, 500), ("Wilburton", 47.6060, -122.1790, 0.8, 450),
    ("Spring District", 47.6245, -122.1760, 0.7, 320), ("Bridle Trails", 47.6400, -122.1700, 0.8, 700),
    ("Crossroads", 47.6170, -122.1320, 1.1, 600), ("Lake Hills", 47.5990, -122.1320, 1.2, 700),
    ("Woodridge", 47.5990, -122.1720, 0.6, 420), ("Enatai", 47.5900, -122.1990, 0.5, 350),
    ("Somerset", 47.5630, -122.1580, 0.9, 600), ("Factoria", 47.5740, -122.1750, 0.6, 420),
    ("Eastgate", 47.5790, -122.1400, 0.8, 600), ("Newport Hills", 47.5540, -122.1800, 0.7, 600),
    ("Overlake", 47.6310, -122.1400, 0.8, 600), ("Lake Hills East", 47.5900, -122.1200, 0.6, 500),
]
STATIONS = [  # name, lat, lng
    ("Bellevue Downtown Station", 47.6152, -122.1917), ("East Main Station", 47.6082, -122.1913),
    ("South Bellevue Station", 47.5866, -122.1906), ("Wilburton Station", 47.6182, -122.1830),
    ("Spring District/120th Station", 47.6237, -122.1785), ("BelRed/130th Station", 47.6247, -122.1660),
    ("Overlake Village Station", 47.6360, -122.1385), ("Redmond Technology Station", 47.6447, -122.1340),
    ("Bellevue Transit Center", 47.6155, -122.1955), ("Eastgate Park & Ride", 47.5800, -122.1530),
]
WORK = [  # name, lat, lng, weight, spread
    ("Downtown office core", 47.6150, -122.1960, 3.0, 280), ("Lincoln Square", 47.6162, -122.2005, 1.0, 150),
    ("Spring District campus", 47.6232, -122.1772, 1.5, 220), ("T-Mobile HQ (Factoria)", 47.5786, -122.1672, 1.3, 180),
    ("Bellevue College", 47.5853, -122.1480, 0.8, 250), ("Overlake Medical Center", 47.6195, -122.1880, 0.7, 150),
    ("BelRed corridor", 47.6250, -122.1600, 0.7, 350), ("Crossroads retail", 47.6180, -122.1290, 0.5, 200),
    ("Microsoft / Overlake", 47.6420, -122.1350, 1.4, 300),
]
SCHOOLS = [("Bellevue High School", 47.5993, -122.1985), ("Sammamish High School", 47.6100, -122.1530),
           ("Interlake High School", 47.6310, -122.1240), ("Newport High School", 47.5705, -122.1725)]
LEISURE = [  # name, lat, lng, weekday_w, weekend_w, spread
    ("Bellevue Square", 47.6163, -122.2033, 3.0, 4.0, 120), ("Downtown Park", 47.6122, -122.2050, 1.5, 3.0, 120),
    ("Old Bellevue (Main St)", 47.6105, -122.2010, 1.8, 2.5, 150), ("Crossroads Shopping Center", 47.6180, -122.1290, 2.0, 2.5, 150),
    ("Factoria Mall", 47.5770, -122.1700, 1.5, 1.8, 130), ("Meydenbauer Bay Park", 47.6118, -122.2075, 0.6, 1.8, 90),
    ("Kelsey Creek Park", 47.6090, -122.1450, 0.5, 1.5, 150), ("Mercer Slough Nature Park", 47.5920, -122.1830, 0.3, 1.2, 200),
    ("Bellevue Botanical Garden", 47.6080, -122.1780, 0.4, 1.4, 120), ("Spring District restaurants", 47.6228, -122.1760, 1.2, 1.2, 130),
    ("Bellevue Library", 47.6175, -122.1890, 0.6, 0.6, 80), ("Lake Hills Village", 47.5990, -122.1290, 0.7, 0.8, 120),
    ("Crossroads Park", 47.6200, -122.1250, 0.4, 1.2, 150), ("Lincoln Square dining", 47.6165, -122.2005, 1.2, 1.5, 100),
]

def pick(items, wi):
    tot = sum(i[wi] for i in items); x = random.random() * tot
    for i in items:
        x -= i[wi]
        if x <= 0: return i
    return items[-1]

def scatter(lat, lng, spread):
    for _ in range(50):
        p = (lat + random.gauss(0, spread) / MLAT, lng + random.gauss(0, spread) / MLNG)
        if on_land(*p): return p
    return (lat, lng)

def nearest(p, items):
    return min(items, key=lambda s: dist(p, (s[1], s[2])))

# ---------------------------------------------------------------- panel
N_FAMILIES = 2200
people, panel = [], {"families": N_FAMILIES, "devices": 0, "under13": 0, "age13to15": 0,
                     "adults": 0, "teens1617": 0, "optedOut": 0}
for f in range(N_FAMILIES):
    h = pick(HOODS, 3); home = scatter(h[1], h[2], h[4])
    n_adults = 1 if random.random() < 0.25 else 2
    n_kids = random.choices([0, 1, 2, 3], [0.3, 0.3, 0.3, 0.1])[0]
    members = [("adult", random.randint(24, 66)) for _ in range(n_adults)] + [("kid", random.randint(4, 17)) for _ in range(n_kids)]
    school = nearest(home, SCHOOLS)
    for kind, age in members:
        panel["devices"] += 1
        if age < 13: panel["under13"] += 1; continue
        if age < 16: panel["age13to15"] += 1; continue
        seg = "a" if age >= 18 else "t"
        consent = random.random() < (0.62 if seg == "a" else 0.48)
        if not consent: panel["optedOut"] += 1; continue
        panel["adults" if seg == "a" else "teens1617"] += 1
        if seg == "a":
            role = random.choices(["local", "seattle", "student", "flex"], [0.5, 0.17, 0.06, 0.27])[0]
            if age > 60: role = random.choice(["flex", "flex", "local"])
        else:
            role = "teen"
        w = pick(WORK, 3); work = scatter(w[1], w[2], w[4])
        people.append({"id": len(people), "seg": seg, "role": role, "home": home, "work": work,
                       "school": (school[1], school[2]), "drives": random.random() < 0.8})

# ---------------------------------------------------------------- simulation
cells = {}           # hex -> index
def cell_idx(p):
    k = hex_of(*p)
    if k not in cells: cells[k] = len(cells)
    return cells[k]

# agg[(dt, seg, cell, hour)] = [person_days_present, set(uniq), short, med, ends]
agg = {}
def slot(dt, seg, c, h):
    k = (dt, seg, c, h)
    if k not in agg: agg[k] = [0, set(), 0.0, 0.0, 0.0]
    return agg[k]

def clock(mu_h, sd_min, lo=0.0, hi=23.9):
    return min(hi, max(lo, mu_h + random.gauss(0, sd_min) / 60))

def leisure_near(p, dt, max_m=None):
    wi = 3 if dt == "wd" else 4
    opts = [l for l in LEISURE if max_m is None or dist(p, (l[1], l[2])) < max_m] or LEISURE
    l = pick(opts, wi)
    return scatter(l[1], l[2], l[5])

def mode_for(d_m, person, purpose_walkable=True):
    mi = d_m / MI
    if mi < 0.7: return "walk" if random.random() < 0.85 else "drive"
    if mi < 1.8: return "walk" if random.random() < 0.3 else ("drive" if person["drives"] or person["seg"] == "t" else "walk")
    return "drive"

def micromobility_weight(mode, d_m, lastmile):
    mi = d_m / MI
    if mi < 0.3 or mi > 3.2: return 0.0
    if lastmile: return 1.25
    return {"walk": 1.0, "drive": 0.32}.get(mode, 0.0)

class Day:
    def __init__(self, person, dt, day):
        self.p, self.dt, self.day = person, dt, day
        self.present = set()  # (cell, hour)
    def dwell(self, p, t0, t1):
        if p is None: return
        c = cell_idx(p)
        for h in range(int(t0), min(24, int(math.ceil(t1)))):
            self.present.add((c, h))
    def leg(self, a, b, t, mode, lastmile=False):
        """Travel a->b starting at t (hours). Returns arrival time."""
        if a is None or b is None: return t
        d = dist(a, b) * 1.25  # street-network detour
        mph = {"walk": 3.0, "drive": 21.0}[mode]
        dur = d / MI / mph
        # L-shaped path (Bellevue's arterials are mostly a grid)
        corner = (a[0], b[1]) if random.random() < 0.5 else (b[0], a[1])
        n = max(2, int(dur * 60 / 2))
        for i in range(n + 1):
            f = i / n
            if f < 0.5: g = f * 2; q = (a[0] + (corner[0] - a[0]) * g, a[1] + (corner[1] - a[1]) * g)
            else: g = (f - 0.5) * 2; q = (corner[0] + (b[0] - corner[0]) * g, corner[1] + (b[1] - corner[1]) * g)
            hr = int(min(23.99, t + dur * f))
            if on_land(*q): self.present.add((cell_idx(q), hr))
        w = micromobility_weight(mode, d, lastmile)
        if w > 0:
            s = slot(self.dt, self.p["seg"], cell_idx(a), int(min(23.99, t)))
            s[2 if d / MI < 1.2 else 3] += w
            e = slot(self.dt, self.p["seg"], cell_idx(b), int(min(23.99, t + dur)))
            e[4] += w
        return t + dur
    def go(self, a, b, t, lastmile=False):
        return self.leg(a, b, t, mode_for(dist(a, b) * 1.25, self.p), lastmile)
    def commit(self):
        for c, h in self.present:
            s = slot(self.dt, self.p["seg"], c, h)
            s[0] += 1; s[1].add(self.p["id"])

def transit_trip(day, a, b, t):
    """a -> nearest station (first mile) -> train -> station near b -> b (last mile)."""
    s1 = nearest(a, STATIONS); s2 = nearest(b, STATIONS)
    p1, p2 = (s1[1], s1[2]), (s2[1], s2[2])
    t = day.go(a, p1, t, lastmile=True)
    t += 0.05 + dist(p1, p2) / MI / 28
    return day.go(p2, b, t, lastmile=True)

def simulate_weekday(day):
    p, home = day.p, day.p["home"]
    role = p["role"]
    if role in ("local", "student"):
        dest = p["work"] if role == "local" else (47.5853, -122.1480)
        t = clock(8.0 if role == "local" else 9.0, 45, 5.5, 10.5)
        day.dwell(home, 0, t)
        near_rail = dist(home, nearest(home, STATIONS)[1:3]) < 1300 and dist(dest, nearest(dest, STATIONS)[1:3]) < 900
        use_rail = near_rail and dist(home, dest) > 2500 and random.random() < 0.45
        t = transit_trip(day, home, dest, t) if use_rail else day.go(home, dest, t)
        t_leave = clock(17.2 if role == "local" else 14.8, 55, t + 3, 21)
        if random.random() < 0.5:  # lunch
            tl = clock(12.0, 25, t + 0.5, t_leave - 1)
            day.dwell(dest, t, tl)
            spot = leisure_near(dest, "wd", 1600)
            ta = day.go(dest, spot, tl); tb = ta + random.uniform(0.4, 0.9); day.dwell(spot, ta, tb)
            t = day.go(spot, dest, tb)
        day.dwell(dest, t, t_leave)
        t = t_leave
        if random.random() < 0.3:
            spot = leisure_near(dest, "wd", 2500)
            ta = day.go(dest, spot, t); t = ta + random.uniform(0.4, 1.2); day.dwell(spot, ta, t)
            t = transit_trip(day, spot, home, t) if use_rail else day.go(spot, home, t)
        else:
            t = transit_trip(day, dest, home, t) if use_rail else day.go(dest, home, t)
        evening(day, t)
    elif role == "seattle":
        st = nearest(home, STATIONS[:3] + STATIONS[8:9]); sp = (st[1], st[2])
        t = clock(7.4, 40, 5.5, 9.5); day.dwell(home, 0, t)
        day.go(home, sp, t, lastmile=True)            # leaves the map on the train
        t = clock(17.8, 50, 15.5, 21)
        t = day.go(sp, home, t, lastmile=True)
        evening(day, t)
    elif role == "flex":
        t = clock(9.5, 60, 7, 12); day.dwell(home, 0, t)
        loc = home
        for _ in range(random.choice([1, 2, 2, 3])):
            spot = leisure_near(loc, "wd", 4000)
            ta = day.go(loc, spot, t); tb = ta + random.uniform(0.5, 1.8); day.dwell(spot, ta, tb)
            loc, t = spot, tb
            if t > 20: break
            if random.random() < 0.5:
                ta = day.go(loc, home, t); t = ta + random.uniform(0.5, 2.5); day.dwell(home, ta, t); loc = home
        t = day.go(loc, home, t) if loc != home else t
        day.dwell(home, t, 24)
    elif role == "teen":
        sch = p["school"]
        t = clock(7.1, 12, 6.5, 7.6); day.dwell(home, 0, t)
        t = day.go(home, sch, t)
        t_out = clock(14.4, 25, 13.5, 16.5)
        if random.random() < 0.3: t_out = clock(16.8, 30, 16, 18)  # sports / clubs
        day.dwell(sch, t, t_out); t = t_out
        if random.random() < 0.4:
            spot = leisure_near(sch, "wd", 3500)
            ta = day.go(sch, spot, t); t = ta + random.uniform(0.8, 2.0); day.dwell(spot, ta, t)
            t = day.go(spot, home, t)
        else:
            t = day.go(sch, home, t)
        evening(day, t)

def evening(day, t):
    home = day.p["home"]
    if random.random() < 0.2 and t < 20:
        t0 = clock(19.2, 40, t + 0.3, 21.5); day.dwell(home, t, t0)
        spot = leisure_near(home, "wd", 4000)
        ta = day.go(home, spot, t0); tb = min(23.5, ta + random.uniform(1, 2.2)); day.dwell(spot, ta, tb)
        t = day.go(spot, home, tb)
    day.dwell(home, t, 24)

def simulate_weekend(day):
    p, home = day.p, day.p["home"]
    t = clock(10.5, 75, 7.5, 14); day.dwell(home, 0, t)
    loc = home
    for _ in range(random.choice([1, 1, 2, 2, 3])):
        spot = leisure_near(loc, "we", 6000)
        ta = day.go(loc, spot, t); tb = ta + random.uniform(0.7, 2.5); day.dwell(spot, ta, tb)
        loc, t = spot, tb
        if t > 21: break
    t = day.go(loc, home, t)
    day.dwell(home, t, 24)

for person in people:
    for dt, n in DAYS.items():
        for d in range(n):
            day = Day(person, dt, d)
            (simulate_weekday if dt == "wd" else simulate_weekend)(day)
            day.commit()

# ---------------------------------------------------------------- export
idx_to_hex = {v: k for k, v in cells.items()}
landmarks = [(n, la, lo, 380) for n, la, lo in STATIONS] + [(n, la, lo, 300) for n, la, lo, *_ in WORK] + \
            [(n, la, lo, 300) for n, la, lo in SCHOOLS] + [(n, la, lo, 260) for n, la, lo, *_ in LEISURE]
names, name_ix, out_cells = [], {}, []
for i in range(len(cells)):
    lat, lng = hex_center(*idx_to_hex[i])
    lm = min(landmarks, key=lambda l: dist((lat, lng), (l[1], l[2])) / l[3])
    if dist((lat, lng), (lm[1], lm[2])) <= lm[3]: name = lm[0]
    else: name = min(HOODS, key=lambda h: dist((lat, lng), (h[1], h[2])) / h[4])[0]
    if name not in name_ix: name_ix[name] = len(names); names.append(name)
    st = nearest((lat, lng), STATIONS); sd = dist((lat, lng), (st[1], st[2]))
    transit = round(max(0.0, 1 - sd / 650), 2)
    out_cells.append([round(lat, 5), round(lng, 5), name_ix[name], transit])

series = {}
for dt in DAYS:
    series[dt] = {}
    for seg in ("a", "t"):
        arr = []
        for c in range(len(cells)):
            row, empty = [], True
            for h in range(24):
                s = agg.get((dt, seg, c, h))
                v = [0, 0, 0, 0, 0] if s is None else [s[0], len(s[1]), round(s[2] * 10), round(s[3] * 10), round(s[4] * 10)]
                if s is not None: empty = False
                row += v
            arr.append(None if empty else row)
        series[dt][seg] = arr

data = {
    "meta": {"metro": "Bellevue, WA", "hexRadiusM": HEX_R, "days": DAYS, "panel": panel,
             "fields": ["personDays", "uniqueDevices", "shortTripStarts_x10", "medTripStarts_x10", "tripEnds_x10"],
             "population": 151854, "adultShare": 0.79},
    "names": names, "cells": out_cells,
    "stations": [[n, la, lo] for n, la, lo in STATIONS],
    "series": series,
}
os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
out = os.path.join(ROOT, "data", "insights.js")
with open(out, "w") as f:
    f.write("// Generated by tools/build_insights.py. Simulated, aggregated T-Life panel data; no individual records.\n")
    f.write("window.INSIGHTS = " + json.dumps(data, separators=(",", ":")) + ";\n")
print(out, os.path.getsize(out) // 1024, "KB", "cells", len(cells), "people", len(people), panel)
