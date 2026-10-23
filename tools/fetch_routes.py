"""Fetch real road geometry for the demo trips from public OSRM servers -> tools/routes.raw.json."""
import json, os, urllib.request

P = {"home": (47.5582, -122.1598), "school": (47.56355, -122.15124),
     "mall": (47.57496, -122.17141), "issaquah": (47.5445, -122.0480)}
TRIPS = {"toSchool": ("home", "school", "foot"), "wander": ("school", "mall", "foot"), "ride": ("school", "issaquah", "driving")}
BASE = {"foot": "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
        "driving": "https://router.project-osrm.org/route/v1/driving"}

def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tlife-demo"})))

out = {}
for name, (a, b, prof) in TRIPS.items():
    (la1, lo1), (la2, lo2) = P[a], P[b]
    r = get(f"{BASE[prof]}/{lo1},{la1};{lo2},{la2}?overview=full&geometries=geojson&annotations=distance,duration")
    rt = r["routes"][0]
    coords = [[round(c[1], 6), round(c[0], 6)] for c in rt["geometry"]["coordinates"]]
    ann = rt["legs"][0]["annotation"]
    mph = [round(d / t * 2.23694, 1) if t > 0 else 0 for d, t in zip(ann["distance"], ann["duration"])]
    print(name, prof, len(coords), "pts", round(rt["distance"]), "m", "start", coords[0], "end", coords[-1])
    out[name] = {"coords": coords, "mph": mph}
json.dump(out, open(os.path.join(os.path.dirname(__file__), "routes.raw.json"), "w"))
