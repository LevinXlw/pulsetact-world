"""Compress the local recovered library and assemble a self-contained scene.

GLB image compression is lossy WebP; mesh data and source matrices are unchanged.
"""
import io
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'assets-source/tools/python-libs'))
from PIL import Image

folder = ROOT / 'assets-source/nyc-local/empire-original'
raw = (folder / 'empire-kit.glb').read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+length])
binary = raw[28+length:]
chunks = bytearray()
image_by_view = {image['bufferView']: image for image in doc.get('images', [])}
for index, view in enumerate(doc['bufferViews']):
    start = view.get('byteOffset', 0)
    data = binary[start:start+view['byteLength']]
    if index in image_by_view and image_by_view[index].get('mimeType') != 'image/webp':
        image = image_by_view[index]
        picture = Image.open(io.BytesIO(data))
        encoded = io.BytesIO()
        picture.save(encoded, format='WEBP', quality=92, method=4)
        data = encoded.getvalue()
        image['mimeType'] = 'image/webp'
    chunks.extend(bytes((-len(chunks)) % 4))
    view['byteOffset'] = len(chunks)
    view['byteLength'] = len(data)
    chunks.extend(data)
for texture in doc['textures']:
    if 'source' in texture:
        texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': texture.pop('source')}
doc['extensionsUsed'] = list(set(doc.get('extensionsUsed', []) + ['EXT_texture_webp']))
doc['extensionsRequired'] = list(set(doc.get('extensionsRequired', []) + ['EXT_texture_webp']))
chunks.extend(bytes((-len(chunks)) % 4))
doc['buffers'] = [{'byteLength': len(chunks)}]
for material in doc.get('materials', []):
    # The game's window shader samples an interior cubemap array, not a color
    # texture. Use explicit glass-like PBR instead of the default white surface.
    if material.get('name') == 'gbl_arch_window_empire.material':
        material['pbrMetallicRoughness'].update({'baseColorFactor': [.055, .075, .095, 1], 'roughnessFactor': .24, 'metallicFactor': .3})
        material['extras'] = {'approximation': 'Opaque glass PBR; original interior cubemap shader not reproduced'}


def save(document, filename):
    text = json.dumps(document, separators=(',', ':')).encode()
    text += b' ' * ((-len(text)) % 4)
    header = struct.pack('<5I', 0x46546C67, 2, 28+len(text)+len(chunks), len(text), 0x4E4F534A)
    data = header + text + struct.pack('<II', len(chunks), 0x004E4942) + chunks
    (folder / filename).write_bytes(data)
    print(filename, len(data), flush=True)
    return len(data)


size = save(doc, 'empire-kit.glb')
manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
manifest['library'].setdefault('uncompressedPngBytes', manifest['library']['bytes'])
manifest['library']['bytes'] = size
manifest['library']['textureEncoding'] = 'WebP quality 92 / EXT_texture_webp'
source_nodes = {n['name']: n for n in doc['nodes'] if n.get('children')}
nodes, meshes = [], []
origin = manifest['selection']['origin']
for sample in manifest['samples']:
    source = source_nodes[sample['label']]
    primitives = []
    for child in source['children']:
        node = doc['nodes'][child]
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale'))
        primitives.extend(doc['meshes'][node['mesh']]['primitives'])
    index = len(meshes)
    meshes.append({'name': sample['label'], 'primitives': primitives})
    for placement in sample['placements']:
        matrix = placement['matrix'].copy()
        for axis in range(3):
            matrix[12+axis] -= origin[axis]
        nodes.append({'name': sample['label'], 'mesh': index, 'matrix': matrix,
                      'extras': {'sourceAsset': sample['id'], 'zoneRecordOffset': placement['offset']}})
doc['nodes'] = nodes
doc['meshes'] = meshes
doc['scenes'] = [{'name': 'Empire State / original game placement', 'nodes': list(range(len(nodes)))}]
doc['asset']['extras'] = {'sourceZone': manifest['zone'], 'placement': manifest['placement'],
                        'materialFidelity': manifest['materialFidelity'], 'recenteredBy': origin}
manifest['assembled'] = {'file': 'empire-original.glb', 'bytes': save(doc, 'empire-original.glb'), 'instances': len(nodes)}
(folder / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
