"""Assemble the app: data.json + guidebook.json + sprites + engine.js + app.src.html  ->  ../docs/index.html
Run from the tools/ folder after parse.py, sources.py, build_data.py and guidebook.py (sync.py does all of it)."""
import json, base64, io, os, subprocess, datetime
from PIL import Image
FUNKY = os.environ.get('FUNKY', os.path.expanduser('~/funky'))
T = FUNKY + '/Resources/Textures/'
d = json.load(open('entnames.json'))
spr = {}; lic = set()
for e, v in d.items():
    s = v.get('s')
    if not s or e == 'CryoPod': continue
    p, st = s; f = T + p + '/' + st + '.png'
    if not os.path.exists(f): continue
    try: meta = json.load(open(T + p + '/meta.json', encoding='utf-8-sig'))
    except Exception: meta = {}
    w = meta.get('size', {}).get('x', 32); h = meta.get('size', {}).get('y', 32)
    im = Image.open(f).convert('RGBA').crop((0, 0, w, h))
    if not im.getbbox(): continue
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
    spr[e] = {'n': v['n'], 'img': 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()}
    lic.add(f"{p}: {meta.get('copyright', '')} ({meta.get('license', '')})")
data = json.load(open('data.json'))
data['synced'] = datetime.date.today().isoformat()
data['commit'] = subprocess.check_output(['git', '-C', FUNKY, 'rev-parse', '--short', 'HEAD']).decode().strip()
try:
    import re
    old = open('../docs/index.html', encoding='utf-8').read()
    if '"commit":"%s"' % data['commit'] in old:
        data['synced'] = re.search(r'"synced":"([0-9-]+)"', old).group(1)
except Exception:
    pass
J = lambda o: json.dumps(o, separators=(',', ':'), ensure_ascii=False).replace('</', '<\\/')
src = open('app.src.html', encoding='utf-8').read()
src = (src.replace('/*DATA*/', J(data)).replace('/*GUIDE*/', J(json.load(open('guidebook.json'))))
          .replace('/*SPRITES*/', J(spr)).replace('/*CREDITS*/', J(sorted(lic))).replace('/*ENGINE*/', open('engine.js', encoding='utf-8').read()))

# --- standalone / PWA wrapping (the source is a fragment for the Claude artifact viewer) ---
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n')
i = src.index('<link rel="stylesheet" href="https://fonts.googleapis.com'); j = src.index('>', i) + 1
assert FONTS in src
src = src[:i] + '<link rel="stylesheet" href="fonts/fonts.css">' + src[j:]
src = src.replace(FONTS, '').replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
HEAD = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#23272c">\n'
        '<meta name="description" content="Plans Funky Station chemistry batches: order, heat, containers, dispenser pulls. Works offline.">\n'
        '<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">\n'
        '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n')
SW = ('<script>\nif ("serviceWorker" in navigator && !window.__TAURI_INTERNALS__ && /^https?:$/.test(location.protocol)) {\n'
      '  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));\n}\n</script>\n')
out = HEAD + src.rstrip() + '\n' + SW + '</body>\n</html>\n'
os.makedirs('../docs', exist_ok=True)
open('../docs/index.html', 'w', encoding='utf-8').write(out)
print('sprites', len(spr), 'bytes', len(out), 'funky', data['commit'], data['synced'])
