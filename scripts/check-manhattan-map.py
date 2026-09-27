"""Validate tile placements, shared resources and grid spacing without a browser."""
import collections
import json
import math
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'assets-source/tools/python-libs'))
from PIL import Image

folder = ROOT/'assets-source/nyc-local/manhattan'
index = json.loads((folder/'index.json').read_text(encoding='utf-8'))
sources = {t['id']:t for t in json.loads((folder/'source-index.json').read_text(encoding='utf-8'))}
assert not index.get('inProgress'), 'Temporary preview data is not a complete map'
assert len(index['tiles']) == len(sources)
origin = index['origin']
models = index['models']
source_placements, checked_placements = set(), set()
instance_count = triangle_count = duplicate_count = omitted_count = 0

def placement(aid, matrix, variant):
    return (aid, struct.pack('<16f', *matrix), variant)

for source in sources.values():
    for record in source['records']:
        if record['id'] in models:
            source_placements.add(placement(record['id'], record['matrix'], record['variant']))

for tile in index['tiles']:
    data = json.loads((folder/tile['manifest']).read_text(encoding='utf-8'))
    source = sources[tile['id']]
    source_offsets = {r['offset']:r for r in source['records']}
    assert data['center'] == source['center'] == tile['center']
    reference = sources[index['centerTile']]['center']
    for axis in (0,2):
        steps = (tile['center'][axis]-reference[axis])/index['tileSize']
        assert abs(steps-round(steps)) < 1e-6
    count = triangles = 0
    for group in data['groups']:
        assert len(group['matrices']) == len(group['offsets']) == len(group['variants'])
        for matrix, offset, variant in zip(group['matrices'],group['offsets'],group['variants']):
            record = source_offsets[offset]
            assert record['matrix'] == matrix and record['variant'] == variant and record['id'] == group['id']
            assert len(matrix) == 16 and all(math.isfinite(v) for v in matrix)
            key = placement(group['id'], matrix, variant)
            assert key not in checked_placements, f'Duplicate placement: {tile["id"]}, {offset}'
            checked_placements.add(key)
        count += len(group['matrices'])
        triangles += len(group['matrices'])*models[group['id']]['triangles']
    assert count == data['instances'] == tile['instances']
    assert triangles == data['triangles'] == tile['triangles']
    assert count + len(data['omitted']) + data['duplicateInstancesRemoved'] == source['sourceInstances']
    instance_count += count; triangle_count += triangles
    duplicate_count += data['duplicateInstancesRemoved']; omitted_count += len(data['omitted'])
assert checked_placements == source_placements
assert instance_count == index['totalInstances']

textures, material_keys = set(), set()
unique_triangles = 0
for aid, model in models.items():
    path = folder/model['streamFile']
    raw = path.read_bytes()
    magic, version, total, json_length, json_tag = struct.unpack_from('<5I', raw)
    assert magic == 0x46546C67 and version == 2 and total == len(raw) == model['streamBytes']
    assert json_tag == 0x4E4F534A
    doc = json.loads(raw[20:20+json_length]); binary = raw[28+json_length:]
    for view in doc['bufferViews']:
        assert 0 <= view.get('byteOffset',0) <= len(binary)-view['byteLength']
    for image in doc.get('images',[]):
        texture = (path.parent/image['uri']).resolve()
        assert texture.parent == (folder/'textures').resolve() and texture.exists()
        textures.add(texture)
    def values(accessor_id):
        acc = doc['accessors'][accessor_id]; view = doc['bufferViews'][acc['bufferView']]
        width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[acc['type']]
        component = {5121:'B',5123:'H',5125:'I',5126:'f'}[acc['componentType']]
        fmt = '<'+component*width; size = struct.calcsize(fmt)
        stride = view.get('byteStride',size); start = view.get('byteOffset',0)+acc.get('byteOffset',0)
        assert acc.get('byteOffset',0)+stride*(acc['count']-1)+size <= view['byteLength']
        return [struct.unpack_from(fmt,binary,start+i*stride) for i in range(acc['count'])]
    model_triangles = 0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            positions = values(primitive['attributes']['POSITION']); indices = values(primitive['indices'])
            assert all(all(math.isfinite(v) for v in p) for p in positions)
            assert len(indices)%3 == 0 and all(0 <= i[0] < len(positions) for i in indices)
            model_triangles += len(indices)//3
        if 'farIndicesAccessor' in mesh.get('extras',{}):
            low = values(mesh['extras']['farIndicesAccessor'])
            assert 0 < len(low) < len(indices) and len(low)%3 == 0
            assert all(0 <= i[0] < len(positions) for i in low)
    assert model_triangles == model['triangles'], aid
    unique_triangles += model_triangles
    for material in doc.get('materials',[]):
        material_keys.add(material['extras']['sharedMaterialKey'])
for texture in textures:
    with Image.open(texture) as picture:
        assert max(picture.size) <= 512 and picture.format == 'WEBP'

# Adjacent nominal cells share exactly the same edge, in original game metres.
adjacencies = 0
for a in index['tiles']:
    for b in index['tiles']:
        dx, dz = b['center'][0]-a['center'][0], b['center'][2]-a['center'][2]
        if abs(dx-128) < .001 and abs(dz) < .001:
            assert abs(a['nominalBounds'][1][0]-b['nominalBounds'][0][0]) < .001; adjacencies += 1
        if abs(dx) < .001 and abs(dz-128) < .001:
            assert abs(a['nominalBounds'][1][1]-b['nominalBounds'][0][1]) < .001; adjacencies += 1

report = {'checks':'passed','tiles':len(index['tiles']), 'adjacentEdges':adjacencies,
          'instances':instance_count,'uniqueModels':len(models),'sharedMaterials':len(material_keys),
          'sharedTextures':len(textures),'uniqueTriangles':unique_triangles,'instancedTriangles':triangle_count,
          'duplicatePlacementsRemoved':duplicate_count,'omittedInstances':omitted_count,
          'geometryBytes':sum((folder/m['streamFile']).stat().st_size for m in models.values()),
          'textureBytes':sum(t.stat().st_size for t in textures)}
(folder/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
