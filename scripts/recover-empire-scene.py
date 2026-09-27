"""Empire State scene research; local, read-only game access. GPL-3.0-or-later.

Uses the separately installed ALERT reader. Raw research files stay outside public/.
"""
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import struct
import collections
import contextlib
import io
import math

inspection = importlib.import_module('inspect-spiderman-assets')
importlib.import_module('inspect-spiderman-world')  # strict UTF-8 metadata adapter
OUT = inspection.ROOT / 'assets-source/nyc-local/empire-original'


def scan(archive):
    candidates = [(aid, path) for aid, path in archive.names.items()
                  if path.startswith('levels/i20_city/openarea/open_world/')
                  and path.endswith(('_ground.zone', '_art.zone'))
                  and 0 in archive.entries[aid] and archive.entries[aid][0].size > 1000]
    candidates.sort(key=lambda item: item[1])
    matches = []
    for index, (aid, path) in enumerate(candidates):
        raw = archive.read(aid)
        low = raw.lower()
        counts = {term.decode(): low.count(term) for term in (b'empire_state', b'jn_empire')}
        if any(counts.values()):
            item = {'id': f'{aid:016X}', 'path': path, 'bytes': len(raw), 'hits': counts}
            matches.append(item)
            (OUT / f'{aid:016X}.zone').write_bytes(raw)
            print(json.dumps(item), flush=True)
        if index % 50 == 0:
            print(f'Scanned {index + 1}/{len(candidates)} zones', flush=True)
    (OUT / 'zone-matches.json').write_text(json.dumps(matches, indent=2), encoding='utf-8')
    print(f'Complete: {len(matches)} matching zones', flush=True)


def dump(archive, aid):
    zone = archive.parse(aid)
    folder = OUT / f'{aid:016X}'
    folder.mkdir(exist_ok=True)
    (folder / 'strings.json').write_text(json.dumps(zone.dat1._strings_map, indent=2), encoding='utf-8')
    for header, section, raw in zip(zone.dat1.header.sections, zone.dat1.sections, zone.dat1._sections_data):
        (folder / f'{header.tag:08X}.bin').write_bytes(raw)
        print(f'{header.tag:08X} {len(raw)} {type(section).__name__}')
        if hasattr(section, 'root'):
            payload = {'root': section.root, 'extras': getattr(section, 'extras', [])}
            (folder / f'{header.tag:08X}.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        if header.tag == 0x91DE11D9:
            print([(f'{e[0]:016X}', zone.dat1.get_string(e[1])) for e in section.entries])
    info = {'headers': [{'tag': f'{s.tag:08X}', 'offset': s.offset, 'size': s.size}
                        for s in zone.dat1.header.sections]}
    (folder / 'headers.json').write_text(json.dumps(info, indent=2), encoding='utf-8')


def recover(archive):
    """Decode the observed static-instance layout, retaining source offsets.

    6987F172: uint32 byte offsets into 06ABCAB2.
    C6A5905E: N uint64 model hashes, followed by N uint32 name offsets.
    Static records: column-major affine matrix at +0, size/flags at +124,
    uint16 model index at +272 (upper 16 bits contain variant metadata).
    This decoder is deliberately limited to this zone's validated records.
    """
    aid = 0xBAD2AB9A64DC6DC6
    zone = archive.parse(aid)
    section = lambda tag: bytes(zone.dat1.get_section(tag)._raw)
    table = section(0xC6A5905E)
    assert len(table) % 12 == 0
    count = len(table) // 12
    ids = list(struct.unpack(f'<{count}Q', table[:count*8]))
    data = section(0x06ABCAB2)
    offsets = [item[0] for item in struct.iter_unpack('<I', section(0x6987F172))]
    selected = collections.defaultdict(list)
    excluded = []
    for offset in offsets:
        assert offset + 320 <= len(data)
        matrix = list(struct.unpack_from('<16f', data, offset))
        size = struct.unpack_from('<I', data, offset+124)[0] & 0xFFFFFF
        index, variant = struct.unpack_from('<HH', data, offset+272)
        assert size in (320, 352, 384) and index < count
        assert all(math.isfinite(v) for v in matrix)
        assert all(abs(matrix[i]) < 1e-5 for i in (3, 7, 11)) and abs(matrix[15]-1) < 1e-5
        if not (54 <= matrix[12] <= 178 and 257 <= matrix[14] <= 319):
            continue
        model_id = ids[index]
        path = archive.names.get(model_id, f'unknown/{model_id:016X}.model')
        if model_id not in archive.entries or 0 not in archive.entries[model_id] or '/gameplay/' in path:
            excluded.append({'index': index, 'id': f'{model_id:016X}', 'path': path, 'offset': offset, 'reason': 'missing asset or traversal helper'})
            continue
        selected[index].append({'offset': offset, 'matrix': matrix, 'variant': variant})
    exporter = importlib.import_module('export-spiderman-sample')
    original_texture = exporter.texture_image
    texture_cache = {}
    def cached_texture(archive, path):
        if path not in texture_cache:
            texture_cache[path] = original_texture(archive, path)
        image, info = texture_cache[path]
        return image.copy(), info
    exporter.texture_image = cached_texture
    samples = []
    models_folder = OUT / 'models'
    models_folder.mkdir(exist_ok=True)
    for number, (index, placements) in enumerate(selected.items()):
        model_id = ids[index]
        cache_file = models_folder / f'model-{index:03d}.json'
        try:
            if cache_file.exists():
                report = json.loads(cache_file.read_text(encoding='utf-8'))
            else:
                with contextlib.redirect_stdout(io.StringIO()):
                    report = exporter.export(archive, model_id, f'model-{index:03d}', models_folder)
            if not report.get('positionQuantizationDecoded'):
                correct_position_quantization(archive, report, models_folder)
                cache_file.write_text(json.dumps(report, indent=2), encoding='utf-8')
            report['modelIndex'] = index
            report['placements'] = placements
            samples.append(report)
        except Exception as error:
            excluded.append({'index': index, 'id': f'{model_id:016X}', 'path': archive.names.get(model_id), 'reason': str(error), 'instances': len(placements)})
            print(f'Skipped model {index}: {error}', flush=True)
        if number % 10 == 0:
            print(f'Exported {number+1}/{len(selected)} models', flush=True)
    report = {'source': "Marvel's Spider-Man Remastered", 'tocSha256': archive.toc_hash,
              'zone': archive.names[aid], 'zoneId': f'{aid:016X}',
              'placement': 'Recovered static instance matrices from the original game zone',
              'materialFidelity': 'Base-color/normal PBR approximation; game shader and per-instance material overrides not reproduced',
              'selection': {'origin': [116, 1, 288], 'x': [54, 178], 'z': [257, 319]},
              'sourceStaticInstances': len(offsets), 'sourceModelReferences': count,
              'instances': sum(len(s['placements']) for s in samples), 'excluded': excluded, 'samples': samples}
    (OUT / 'manifest.json').write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({k: v for k,v in report.items() if k not in ('samples','excluded')}, indent=2))
    print('Exported models:', len(samples), 'Excluded entries:', len(excluded), flush=True)


def correct_position_quantization(archive, report, folder):
    """ALERT Vertex_I20 divides all signed positions by 4096, ignoring Model
    Built's actual step and offset. Decode those before applying zone matrices.
    In particular, the spire/antenna use a step of 1/512, not 1/4096.
    """
    import pygltflib
    built = archive.parse(int(report['id'], 16)).dat1.get_section(0x283D0383)
    factor = built.get_vertex_position_scale() * 4096
    offset = built.get_vertex_position_offset()
    assert math.isfinite(factor) and factor > 0
    gltf = pygltflib.GLTF2().load_binary(str(folder / report['file']))
    binary = bytearray(gltf.binary_blob())
    done = set()
    for mesh in gltf.meshes:
        for primitive in mesh.primitives:
            index = primitive.attributes.POSITION
            if index in done:
                continue
            done.add(index)
            accessor = gltf.accessors[index]
            assert accessor.componentType == 5126 and accessor.type == 'VEC3'
            view = gltf.bufferViews[accessor.bufferView]
            base = (view.byteOffset or 0) + (accessor.byteOffset or 0)
            for i in range(accessor.count):
                position = base + i * (view.byteStride or 12)
                xyz = struct.unpack_from('<3f', binary, position)
                struct.pack_into('<3f', binary, position, *[xyz[k]*factor+offset[k] for k in range(3)])
            if accessor.min:
                accessor.min = [accessor.min[k]*factor+offset[k] for k in range(3)]
            if accessor.max:
                accessor.max = [accessor.max[k]*factor+offset[k] for k in range(3)]
    gltf.set_binary_blob(bytes(binary))
    gltf.save_binary(str(folder / report['file']))
    report['bounds'] = [[bound[k]*factor+offset[k] for k in range(3)] for bound in report['bounds']]
    report['positionQuantizationDecoded'] = {'factorFromAlert': factor, 'offset': offset}
    report['bytes'] = (folder / report['file']).stat().st_size


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('game')
    parser.add_argument('--dump')
    parser.add_argument('--recover', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    archive = inspection.Archive(args.game)
    if args.recover:
        recover(archive)
    elif args.dump:
        dump(archive, int(args.dump, 16))
    else:
        scan(archive)
    assert hashlib.sha256((archive.directory / 'toc').read_bytes()).hexdigest() == archive.toc_hash


if __name__ == '__main__':
    main()
