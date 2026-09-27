"""Checks recovered scene anchors and the delivered GLB independently of WebGL."""
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'assets-source/nyc-local/empire-original'
manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
samples = {sample['modelIndex']: sample for sample in manifest['samples']}

# These physical relationships exposed the original decoder's fixed 1/4096 bug.
assert abs(samples[161]['bounds'][1][0] - samples[161]['bounds'][0][0] - 4) < .001
assert abs(samples[163]['bounds'][1][0] - samples[163]['bounds'][0][0] - 16) < .001
spire, antenna = samples[516], samples[518]
spire_top = spire['placements'][0]['matrix'][13] + spire['bounds'][1][1]
antenna_origin = antenna['placements'][0]['matrix'][13]
assert abs(spire_top - antenna_origin) < .02, (spire_top, antenna_origin)
roof = samples[515]['bounds']
assert 63 < roof[1][0]-roof[0][0] < 65

raw = (folder / 'empire-original.glb').read_bytes()
magic, version, total, json_length, json_tag = struct.unpack_from('<5I', raw)
assert magic == 0x46546C67 and version == 2 and total == len(raw)
assert json_tag == 0x4E4F534A
doc = json.loads(raw[20:20+json_length])
binary = raw[28+json_length:]
assert len(doc['nodes']) == manifest['instances'] == 6462
assert len(doc['meshes']) == len(manifest['samples']) == 227
assert not any('uri' in resource for resource in doc['images'] + doc['buffers'])
for view in doc['bufferViews']:
    assert 0 <= view.get('byteOffset', 0) <= len(binary)-view['byteLength']
for img in doc['images']:
    v = doc['bufferViews'][img['bufferView']]
    data = binary[v['byteOffset']:v['byteOffset']+v['byteLength']]
    assert img['mimeType'] == 'image/webp' and data[:4] == b'RIFF' and data[8:12] == b'WEBP'

def values(index):
    acc = doc['accessors'][index]
    view = doc['bufferViews'][acc['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    component = {5123: 'H', 5125: 'I', 5126: 'f'}[acc['componentType']]
    fmt = '<' + component * width
    stride = view.get('byteStride', struct.calcsize(fmt))
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return [struct.unpack_from(fmt, binary, start+i*stride) for i in range(acc['count'])]

triangle_count = 0
for mesh in doc['meshes']:
    for primitive in mesh['primitives']:
        pos = values(primitive['attributes']['POSITION'])
        idx = values(primitive['indices'])
        assert all(all(math.isfinite(v) for v in p) for p in pos)
        assert all(0 <= i[0] < len(pos) for i in idx)
        assert len(idx) % 3 == 0
        triangle_count += len(idx)//3

source = {(s['label'], p['offset']): p for s in samples.values() for p in s['placements']}
for node in doc['nodes']:
    original = source[(node['name'], node['extras']['zoneRecordOffset'])]['matrix']
    expected = original.copy()
    for axis in range(3):
        expected[12+axis] -= manifest['selection']['origin'][axis]
    assert node['matrix'] == expected
report = {'instances': len(doc['nodes']), 'models': len(doc['meshes']), 'images': len(doc['images']),
          'uniqueMeshTriangles': triangle_count, 'sceneTriangles': sum(s['triangles']*len(s['placements']) for s in samples.values()),
          'spireToAntennaJoinErrorMetres': abs(spire_top-antenna_origin),
          'antennaTopAboveRecenteredGround': antenna_origin + antenna['bounds'][1][1] - 1,
          'glbBytes': len(raw), 'checks': 'passed'}
(folder / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
