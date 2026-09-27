"""Recover a separate HD texture tier from the local game. GPL-3.0-or-later."""
import argparse
import hashlib
import importlib
import json
import math
from pathlib import Path

recovery = importlib.import_module('recover-empire-scene')
exporter = importlib.import_module('export-spiderman-sample')
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('game')
args = parser.parse_args()
root = recovery.inspection.ROOT / 'assets-source/nyc-local/manhattan'
output = root / 'textures-hd'
output.mkdir(parents=True, exist_ok=True)
archive = recovery.inspection.Archive(args.game)
catalog = json.loads((root/'index.json').read_text())
# Prioritize the landmark, then complete the shared library once per source texture.
models = sorted(catalog['models'].values(), key=lambda m: ('empire_state' not in m['path'], m['id']))
paths = {}
for model in models:
    report = json.loads((root/'models'/f'{model["id"]}.json').read_text())
    for material in report['materials']:
        for texture in material['texturesDecoded']:
            paths[texture['path']] = texture
manifest, failures = {}, {}
for number, (path, source) in enumerate(paths.items()):
    key = hashlib.sha256(path.encode()).hexdigest()
    image_file, info_file = output/f'{key}.webp', output/f'{key}.json'
    if image_file.exists() and info_file.exists():
        manifest[path] = json.loads(info_file.read_text())
        continue
    try:
        picture, info = exporter.texture_image(archive, path)
        normal = path.endswith('_n.texture')
        picture.thumbnail((1024,1024) if normal else (2048,2048))
        if normal and info['format'] in (82,83,84):
            picture = picture.convert('RGB')
            values = bytearray(picture.tobytes())
            for i in range(0,len(values),3):
                x,y = values[i]/127.5-1, values[i+1]/127.5-1
                values[i+2] = round((math.sqrt(max(0,1-x*x-y*y))+1)*127.5)
            picture = Image.frombytes('RGB',picture.size,bytes(values))
        else:
            picture = picture.convert('RGBA')
        picture.save(image_file,format='WEBP',quality=97,method=2,lossless=normal)
        item = {'file':f'textures-hd/{key}.webp','width':picture.width,'height':picture.height,
                'sourceWidth':info['width'],'sourceHeight':info['height'],'normal':normal,
                'bytes':image_file.stat().st_size}
        info_file.write_text(json.dumps(item),encoding='utf-8'); manifest[path]=item
    except Exception as error:
        failures[path]=str(error); print(f'Skipped {path}: {error}',flush=True)
    if number%25 == 0: print(f'HD textures {number+1}/{len(paths)}',flush=True)
result = {'version':1,'textures':manifest,'failed':failures,'tocSha256':archive.toc_hash,
          'colorLimit':2048,'normalLimit':1024,'bytes':sum(v['bytes'] for v in manifest.values())}
assert hashlib.sha256((archive.directory/'toc').read_bytes()).hexdigest() == archive.toc_hash
(output/'index.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print(json.dumps({'ready':len(manifest),'failed':len(failures),'bytes':result['bytes']},indent=2),flush=True)
