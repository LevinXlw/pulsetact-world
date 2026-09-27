"""Local building-component proof of concept; GPL-3.0-or-later.

Uses the separately downloaded ALERT parser. Never writes to the game directory.
The exported game assets are not licensed by this script's license.
"""
import argparse
import importlib
import io
import json
import math
import struct

inspection = importlib.import_module('inspect-spiderman-assets')
import dat1lib.crc64
from model_to_gltf import GltfWriter
from PIL import Image
import pygltflib as gl

ROOT = inspection.ROOT
OUTPUT = ROOT / 'assets-source/nyc-local/sample'


def texture_image(archive, path):
    aid = dat1lib.crc64.hash(path)
    data = archive.read(aid)
    asset = archive.parse(aid)
    header = asset.dat1.get_section(0x4EDE3593)
    if header.array_size != 1:
        raise ValueError(f'Texture array unsupported: {path}')
    hd = 1 in archive.entries[aid] and header.hd_mipmaps > 0
    width, height = (header.hd_width, header.hd_height) if hd else (header.sd_width, header.sd_height)
    payload = archive.read(aid, 1) if hd else data[128:]
    # DDS DX10 wrapper around the game's original block-compressed pixel data.
    dds = b'DDS ' + struct.pack('<7I', 124, 0x1007, height, width, 0, 0, 1) + bytes(44)
    dds += struct.pack('<II4s5I', 32, 4, b'DX10', 0, 0, 0, 0, 0)
    dds += struct.pack('<5I', 0x1000, 0, 0, 0, 0)
    # sRGB and linear variants share a block layout; Pillow supports the linear IDs.
    decode_format = {72: 71, 75: 74, 78: 77, 99: 98}.get(header.fmt, header.fmt)
    dds += struct.pack('<5I', decode_format, 3, 0, 1, 0) + payload
    image = Image.open(io.BytesIO(dds))
    image.load()
    return image, {'id': f'{aid:016X}', 'path': path, 'width': width, 'height': height, 'format': header.fmt, 'highResolution': hd}


def export(archive, aid, label, output_dir=OUTPUT, lod=0, encoded_texture_cache=None, allow_missing_materials=False):
    output_dir.mkdir(parents=True, exist_ok=True)
    model = archive.parse(aid)
    writer = GltfWriter()
    writer.init(model)
    chosen = writer.get_meshes_indexes_by_looks_and_lod([0], lod)
    if not chosen:
        lod = 0
        chosen = writer.get_meshes_indexes_by_looks_and_lod([0], lod)
    if any(writer.meshes[i].flags & 1 for i in chosen):
        raise ValueError('This exporter handles static building components only')
    used_materials = sorted({writer.meshes[i].material_index for i in chosen})
    material_map = {}
    report = {'id': f'{aid:016X}', 'path': archive.names[aid], 'label': label, 'lod': lod, 'materials': [], 'warnings': []}
    images = {}
    writer.gltf.samplers = [gl.Sampler(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)]

    def image_texture(path, normal=False):
        key = (path, normal)
        if key in images:
            return images[key]
        if encoded_texture_cache is not None and key in encoded_texture_cache:
            encoded_bytes, info = encoded_texture_cache[key]
            _, view_index = writer.create_buffer_view(encoded_bytes, None)
            writer.gltf.images.append(gl.Image(bufferView=view_index, mimeType='image/png', name=path))
            index = len(writer.gltf.textures)
            writer.gltf.textures.append(gl.Texture(source=len(writer.gltf.images)-1, sampler=0))
            images[key] = (index, info)
            return index, info
        picture, info = texture_image(archive, path)
        limit = 512 if normal else 1024
        picture.thumbnail((limit, limit))
        if normal and info['format'] in (82, 83, 84):
            picture = picture.convert('RGB')
            values = bytearray(picture.tobytes())
            for i in range(0, len(values), 3):
                x, y = values[i] / 127.5 - 1, values[i + 1] / 127.5 - 1
                values[i + 2] = round((math.sqrt(max(0, 1 - x*x - y*y)) + 1) * 127.5)
            picture = Image.frombytes('RGB', picture.size, bytes(values))
        else:
            picture = picture.convert('RGBA')
        encoded = io.BytesIO()
        picture.save(encoded, format='PNG')
        if encoded_texture_cache is not None:
            if len(encoded_texture_cache) >= 192:
                del encoded_texture_cache[next(iter(encoded_texture_cache))]
            encoded_texture_cache[key] = (encoded.getvalue(), info)
        view, view_index = writer.create_buffer_view(encoded.getvalue(), None)
        writer.gltf.images.append(gl.Image(bufferView=view_index, mimeType='image/png', name=path))
        index = len(writer.gltf.textures)
        writer.gltf.textures.append(gl.Texture(source=len(writer.gltf.images)-1, sampler=0))
        images[key] = (index, info)
        return index, info

    for material_index in used_materials:
        path = writer.get_material_path(material_index).replace('\\', '/').lower()
        try:
            parsed = archive.parse(dat1lib.crc64.hash(path))
            section = parsed.dat1.get_section(0xF5260180)
        except KeyError:
            if not allow_missing_materials:
                raise
            section = None
            report['warnings'].append(f'Missing material {path}: neutral PBR fallback')
        references = list(dict.fromkeys(section._get_string(offset).replace('\\', '/').lower() for offset, slot in section.textures)) if section else []
        details = {'path': path, 'textureReferences': references, 'texturesDecoded': [], 'shaderFidelity': 'approximate'}
        name = path.rsplit('/', 1)[-1]
        material = gl.Material(name=name, pbrMetallicRoughness=gl.PbrMetallicRoughness(metallicFactor=0, roughnessFactor=.82))
        params = dict(section.params) if section else {}
        if 'painted_wood' in name and 0x1279F7B1 in params:
            # First stored color parameter approximates the proprietary paint blend.
            color_parameter = struct.unpack('<3f', params[0x1279F7B1])
            material.pbrMetallicRoughness.baseColorFactor = [*color_parameter, 1]
            details['approximatePaintTint'] = list(color_parameter)
        if 'curtains' in name:
            material.pbrMetallicRoughness.baseColorFactor = [.045, .07, .075, 1]
            material.pbrMetallicRoughness.roughnessFactor = .32
            material.pbrMetallicRoughness.metallicFactor = .25
            details['approximation'] = 'Opaque dark window surface; game interior shader not reconstructed'
        color = next((p for p in references if p.endswith('_c.texture') and 'default_pink' not in p), None)
        normal = next((p for p in references if p.endswith('_n.texture') and 'default_pink' not in p), None)
        for path_to_texture, is_normal in [(color, False), (normal, True)]:
            if not path_to_texture:
                continue
            try:
                index, info = image_texture(path_to_texture, is_normal)
                details['texturesDecoded'].append(info)
                if is_normal:
                    material.normalTexture = gl.NormalMaterialTexture(index=index, scale=.65)
                else:
                    material.pbrMetallicRoughness.baseColorTexture = gl.TextureInfo(index=index)
            except Exception as error:
                report['warnings'].append(f'{path_to_texture}: {error}')
        # Multi-layer proprietary shaders are approximated with base color + normal.
        # Thin grime overlays need alpha rather than opaque rectangular panels.
        if 'decal' in name:
            material.alphaMode = 'BLEND'
            material.pbrMetallicRoughness.baseColorFactor = [.28, .24, .19, .16]
        if 'brass' in name:
            material.pbrMetallicRoughness.metallicFactor = .65
            material.pbrMetallicRoughness.roughnessFactor = .4
            material.pbrMetallicRoughness.baseColorFactor = [.3, .21, .09, 1]
        material_map[material_index] = len(writer.gltf.materials)
        writer.gltf.materials.append(material)
        report['materials'].append(details)

    vertices, triangles = 0, 0
    mins, maxs = [float('inf')] * 3, [-float('inf')] * 3
    for index in chosen:
        mesh = writer.meshes[index]
        if mesh.flags & 1:
            raise ValueError('This exporter handles static building components only')
        data = writer.make_intermediate(mesh)
        for position in data[0]:
            for axis in range(3):
                mins[axis] = min(mins[axis], position[axis])
                maxs[axis] = max(maxs[axis], position[axis])
        writer.add_mesh(data, mesh, None, None, index, [])
        writer.gltf.nodes[-1].skin = None
        writer.gltf.meshes[-1].primitives[0].material = material_map[mesh.material_index]
        vertices += len(data[0])
        triangles += len(data[3])
    for accessor in writer.gltf.accessors:
        if accessor.componentType == gl.FLOAT:
            accessor.normalized = False
    writer.gltf.scene = 0
    writer.gltf.asset.generator = 'Local research sample / ALERT + Pulsetact adapter'
    writer.gltf.asset.extras = {'source': report['path'], 'materialFidelity': 'base-color-and-normal approximation'}
    filename = f'{label}.glb'
    writer.gltf.save_binary(str(output_dir / filename))
    report.update({'file': filename, 'vertices': vertices, 'triangles': triangles, 'bounds': [mins, maxs], 'bytes': (output_dir / filename).stat().st_size, 'textureCount': len(images)})
    print(json.dumps({k: v for k, v in report.items() if k != 'materials'}, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('game')
    args = parser.parse_args()
    archive = inspection.Archive(args.game)
    samples = [(0xBC5237AE61AE4906, 'brownstone-entrance'), (0x9B91E4530DE43867, 'brownstone-window'), (0xA1A090560BEBB5EA, 'brownstone-wall')]
    report = {'game': "Marvel's Spider-Man Remastered", 'tocSha256': archive.toc_hash, 'sourceToolCommit': 'bc90ed9b53fbcaa3b7acf94b36f00e77eab0dacb', 'placement': 'Manual component study, not original NYC placement', 'samples': [export(archive, aid, label) for aid, label in samples]}
    (OUTPUT / 'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    assert inspection.hashlib.sha256((archive.directory / 'toc').read_bytes()).hexdigest() == archive.toc_hash


if __name__ == '__main__':
    main()
