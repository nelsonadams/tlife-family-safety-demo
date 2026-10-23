"""Inline CSS/JS (incl. Leaflet) into dist/tlife-family-safety-demo.html so the demo is one shareable file.
Map tiles still load from the internet."""
import os, re
root = os.path.join(os.path.dirname(__file__), "..")
read = lambda p: open(os.path.join(root, p), encoding="utf-8").read()
html = read("index.html")
html = re.sub(r'<link rel="stylesheet" href="([^"]+)" />', lambda m: f"<style>\n{read(m.group(1))}\n</style>", html)
def inline_js(m):
    js = read(m.group(1)).replace("</script", "<\\/script")
    return "<script>\n" + js + "\n</script>"
html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
os.makedirs(os.path.join(root, "dist"), exist_ok=True)
out = os.path.join(root, "dist", "tlife-family-safety-demo.html")
open(out, "w", encoding="utf-8").write(html)
print(out, len(html) // 1024, "KB")
