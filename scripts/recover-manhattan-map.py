"""Incremental, read-only static city recovery. GPL-3.0-or-later.

Reuses the ALERT adapter and the independently checked Empire position decoder.
Outputs local, shared model/texture resources and separate tile manifests.
"""
import argparse
import collections
import contextlib
import hashlib
import importlib
import io
import json
import math
from pathlib import Path
import re
import struct

recovery = importlib.import_module('recover-empire-scene')
inspection = recovery.inspection
exporter = importlib.import_module('export-spiderman-sample')
from PIL import Image

ROOT = inspection.ROOT
OUT = ROOT / 'assets-source/nyc-local/manhattan'
ORIGIN = [116, 1, 288]
DEFAULT_TILES = ['l27', 'k27', 'l26', 'm27', 'l28', 'k26', 'm26', 'k28', 'm28']


def save_glb(doc, binary, path):
    binary += bytes((-len(binary)) % 4)
    doc['buffers'] = [{'byteLength': len(binary)}]
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' '*((-len(text)) % 4)
    path.write_bytes(struct.pack('<5I', 0x46546C67, 2, 28+len(text)+len(binary), len(text), 0x4E4F534A)
                     + text + struct.pack('<II', len(binary), 0x004E4942) + binary)


def stream_model(source, destination, report):
    """Externalize content-addressed textures, retain original geometry/UVs."""
    raw = source.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+length])
    binary = raw[28+length:]
    image_views = set()
    texture_bytes = 0
    for image in doc.get('images', []):
        v = doc['bufferViews'][image['bufferView']]
        data = binary[v.get('byteOffset', 0):v.get('byteOffset', 0)+v['byteLength']]
        key = hashlib.sha256(data).hexdigest()
        output = OUT / 'textures' / f'{key}.webp'
        if not output.exists():
            picture = Image.open(io.BytesIO(data))
            picture.thumbnail((512, 512))
            picture.save(output, format='WEBP', quality=90, method=4)
        texture_bytes += output.stat().st_size
        image_views.add(image.pop('bufferView'))
        image.update({'uri': f'../textures/{key}.webp', 'mimeType': 'image/webp'})
    for texture in doc.get('textures', []):
        texture['extensions'] = {'EXT_texture_webp': {'source': texture.pop('source')}}
    if doc.get('textures'):
        doc['extensionsUsed'] = ['EXT_texture_webp']
        doc['extensionsRequired'] = ['EXT_texture_webp']
    view_map, views, payload = {}, [], bytearray()
    for index, view in enumerate(doc['bufferViews']):
        if index in image_views:
            continue
        data = binary[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
        payload.extend(bytes((-len(payload)) % 4))
        view_map[index] = len(views)
        views.append({**view, 'byteOffset': len(payload)})
        payload.extend(data)
    for accessor in doc['accessors']:
        accessor['bufferView'] = view_map[accessor['bufferView']]
    doc['bufferViews'] = views
    for material in doc.get('materials', []):
        pbr = material['pbrMetallicRoughness']
        name = material.get('name', '')
        if ('window' in name or 'glass' in name) and 'baseColorTexture' not in pbr:
            pbr.update({'baseColorFactor': [.055, .075, .095, 1], 'roughnessFactor': .24, 'metallicFactor': .3})
        if any(word in report['path'] for word in ('/plant/', '/bush', '/tree', 'foliage')):
            material.update({'alphaMode': 'MASK', 'alphaCutoff': .45, 'doubleSided': True})
        # Stable key includes actual texture content, not glTF-local indices.
        signature = json.loads(json.dumps(material))
        for owner in (signature, signature.get('pbrMetallicRoughness', {})):
            for key, value in owner.items():
                if key.endswith('Texture') and isinstance(value, dict):
                    texture = doc['textures'][value['index']]
                    value['index'] = doc['images'][texture['extensions']['EXT_texture_webp']['source']]['uri']
        material['extras'] = {'sharedMaterialKey': hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()}
    save_glb(doc, bytes(payload), destination)
    report.update({'streamFile': f'models/{destination.name}', 'streamBytes': destination.stat().st_size,
                   'textureBytesBeforeSharing': texture_bytes, 'streamVersion': 1})


def tile_records(archive, tile, entry):
    zone = archive.parse(int(entry['id'], 16))
    read = lambda tag: bytes(zone.dat1.get_section(tag)._raw)
    table = read(0xC6A5905E)
    assert len(table) % 12 == 0
    count = len(table)//12
    ids = struct.unpack_from(f'<{count}Q', table)
    data = read(0x06ABCAB2)
    offsets = [v[0] for v in struct.iter_unpack('<I', read(0x6987F172))]
    records, omitted, centers, sizes = [], [], [], collections.Counter()
    for offset in offsets:
        assert offset+320 <= len(data)
        size = struct.unpack_from('<I', data, offset+124)[0] & 0xFFFFFF
        index, variant = struct.unpack_from('<HH', data, offset+272)
        assert size in (320,352,384) and offset+size <= len(data) and index < count
        sizes[size] += 1
        matrix = list(struct.unpack_from('<16f', data, offset))
        assert all(math.isfinite(v) for v in matrix)
        assert all(abs(matrix[i]) < 1e-5 for i in (3,7,11)) and abs(matrix[15]-1)<1e-5
        aid = ids[index]
        path = archive.names.get(aid, f'unknown/{aid:016X}.model')
        if path.endswith(f'tile_{tile}_ground_00.model'):
            centers.append(matrix[12:15])
        if aid not in archive.names or 0 not in archive.entries[aid] or '/gameplay/' in path:
            omitted.append({'id':f'{aid:016X}', 'offset':offset, 'reason':'missing resource or gameplay helper'})
            continue
        records.append({'id':f'{aid:016X}', 'offset':offset, 'variant':variant, 'matrix':matrix})
    assert len(centers) == 1, f'{tile}: ambiguous ground origin {centers}'
    center = centers[0]
    return {'id':tile, 'zoneId':entry['id'], 'source':entry['path'], 'center':center,
            'nominalBounds':[[center[0]-64,center[2]-64],[center[0]+64,center[2]+64]],
            'sourceInstances':len(offsets), 'recordSizes':dict(sizes), 'records':records, 'omitted':omitted}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('game')
    parser.add_argument('--tiles', nargs='+', default=DEFAULT_TILES)
    args = parser.parse_args()
    for name in ('models','textures','tiles','source-staging'):
        (OUT / name).mkdir(parents=True, exist_ok=True)
    archive = inspection.Archive(args.game)
    scene_index = json.loads((ROOT / 'assets-source/nyc-local/world/scene-index.json').read_text())
    scenes = {re.search(r'/tile_([a-z]\d{2})/tile_\1_ground.zone$', v['path']).group(1):v
              for v in scene_index if re.search(r'/tile_([a-z]\d{2})/tile_\1_ground.zone$', v['path'])}
    tiles = [tile_records(archive, tile, scenes[tile]) for tile in args.tiles]
    (OUT / 'source-index.json').write_text(json.dumps(tiles, separators=(',', ':')), encoding='utf-8')
    ids = list(dict.fromkeys(record['id'] for tile in tiles for record in tile['records']))
    old = json.loads((ROOT / 'assets-source/nyc-local/empire-original/manifest.json').read_text())
    empire_cache = {s['id']:s for s in old['samples']}
    encoded_cache, models, failures = {}, {}, {}
    for number, aid in enumerate(ids):
        cache = OUT / 'models' / f'{aid}.json'
        output = OUT / 'models' / f'{aid}.glb'
        if cache.exists() and output.exists():
            models[aid] = json.loads(cache.read_text(encoding='utf-8'))
        else:
            try:
                if aid in empire_cache:
                    report = dict(empire_cache[aid]); report.pop('placements', None)
                    source = ROOT / 'assets-source/nyc-local/empire-original/models' / report['file']
                    temporary = False
                else:
                    with contextlib.redirect_stdout(io.StringIO()):
                        report = exporter.export(archive, int(aid,16), aid, OUT / 'source-staging', encoded_texture_cache=encoded_cache, allow_missing_materials=True)
                        recovery.correct_position_quantization(archive, report, OUT / 'source-staging')
                    source = OUT / 'source-staging' / report['file']
                    temporary = True
                stream_model(source, output, report)
                cache.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
                models[aid] = report
                if temporary:
                    source.unlink()  # only this newly generated intermediate, never a game file
            except Exception as error:
                failures[aid] = str(error)
                print(f'Skipped {aid}: {error}', flush=True)
        if number % 25 == 0:
            print(f'Models {number+1}/{len(ids)}, ready {len(models)}, omitted {len(failures)}', flush=True)
    seen, summaries = set(), []
    for tile in tiles:
        groups, duplicates = {}, 0
        for record in tile.pop('records'):
            if record['id'] not in models:
                tile['omitted'].append({**record, 'reason':failures[record['id']]})
                continue
            key = (record['id'],struct.pack('<16f',*record['matrix']),record['variant'])
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            group = groups.setdefault(record['id'], {'id':record['id'], 'matrices':[], 'offsets':[], 'variants':[]})
            group['matrices'].append(record['matrix']); group['offsets'].append(record['offset']); group['variants'].append(record['variant'])
        tile['groups'] = list(groups.values())
        tile['duplicateInstancesRemoved'] = duplicates
        tile['instances'] = sum(len(g['matrices']) for g in tile['groups'])
        tile['triangles'] = sum(models[g['id']]['triangles']*len(g['matrices']) for g in tile['groups'])
        tile_file = OUT / 'tiles' / f'{tile["id"]}.json'
        tile_file.write_text(json.dumps(tile, separators=(',', ':')), encoding='utf-8')
        summaries.append({k:v for k,v in tile.items() if k not in ('groups','omitted')})
        summaries[-1].update({'manifest':f'tiles/{tile["id"]}.json','omittedInstances':len(tile['omitted'])})
    # Also migrate textures from earlier uncapped local exports without re-reading the game.
    for texture in (OUT/'textures').glob('*.webp'):
        with Image.open(texture) as picture:
            if max(picture.size) > 512:
                picture.thumbnail((512, 512))
                picture.save(texture, format='WEBP', quality=90, method=4)
    catalog = {aid:{k:s[k] for k in ('id','path','bounds','triangles','streamFile','streamBytes','textureCount')}
               for aid,s in models.items()}
    index = {'version':1, 'origin':ORIGIN, 'centerTile':'l27', 'tileSize':128, 'tiles':summaries,
             'models':catalog, 'totalInstances':sum(t['instances'] for t in tiles),
             'tocSha256':archive.toc_hash, 'failedModels':failures,
             'textureCount':len(list((OUT/'textures').glob('*.webp'))), 'textureMaxDimension':512,
             'textureBytes':sum(p.stat().st_size for p in (OUT/'textures').glob('*.webp')),
             'geometryBytes':sum(s['streamBytes'] for s in models.values()),
             'materialFidelity':'Approximate PBR, original textures and geometry, game shader/variant overrides not restored'}
    (OUT / 'index.json').write_text(json.dumps(index, separators=(',', ':')), encoding='utf-8')
    assert hashlib.sha256((archive.directory/'toc').read_bytes()).hexdigest() == archive.toc_hash
    print(json.dumps({k:v for k,v in index.items() if k not in ('models','tiles','failedModels')}, indent=2), flush=True)


if __name__ == '__main__':
    main()
