"""Read-only world feasibility audit. GPL-3.0-or-later, like the ALERT adapter.

Lists scene assets and samples their sections; does NOT infer scene transforms.
"""
import argparse
import collections
import hashlib
import importlib
import json
import re
import struct

inspection = importlib.import_module('inspect-spiderman-assets')
from dat1lib.types.sections import SerializedSection

# Some level labels contain valid UTF-8. ALERT's MSMR metadata reader assumes
# ASCII; retry only that decoder, without replacing bytes or changing offsets.
original_string_reader = SerializedSection._deserialize_string
utf8_fallbacks = []


def read_metadata_string(section, stream):
    start = stream.tell()
    try:
        return original_string_reader(section, stream)
    except UnicodeDecodeError:
        stream.seek(start)
        layout = '<III' if section.version == inspection.dat1lib.VERSION_SO else '<IIQ'
        length, _, _ = struct.unpack(layout, stream.read(struct.calcsize(layout)))
        value = stream.read(length).decode('utf-8')
        assert stream.read(1) == b'\0'
        section._align(stream, 4)
        utf8_fallbacks.append(value)
        return value


SerializedSection._deserialize_string = read_metadata_string


def brief(value, depth=0):
    if depth > 3:
        return {'type': type(value).__name__, 'length': len(value)} if isinstance(value, (dict, list, str)) else value
    if isinstance(value, dict):
        return {str(k): brief(v, depth + 1) for k, v in list(value.items())[:12]}
    if isinstance(value, list):
        return {'length': len(value), 'sample': [brief(v, depth + 1) for v in value[:3]]}
    if isinstance(value, str):
        return value[:300]
    return value


def inspect(archive, record):
    result = dict(record)
    try:
        asset = archive.parse(int(record['id'], 16))
        result['type'] = type(asset).__name__
        result['sections'] = []
        for header, section in zip(asset.dat1.header.sections, asset.dat1.sections):
            info = {'tag': f'{header.tag:08X}', 'bytes': header.size, 'parser': type(section).__name__}
            for attribute in ('entries', 'names', 'root'):
                value = getattr(section, attribute, None)
                if value is not None:
                    if attribute == 'root':
                        info['structuredPreview'] = brief(value)
                    else:
                        info[attribute + 'Count'] = len(value)
            result['sections'].append(info)
        strings = list(asset.dat1._strings_map.values())
        paths = [v for v in strings if isinstance(v, str) and v.endswith(('.model', '.actor', '.zone', '.material'))]
        result['resourcePaths'] = paths[:60]
        result['resourcePathCount'] = len(paths)
        result['stringSamples'] = strings[:30]
    except Exception as error:
        result['error'] = f'{type(error).__name__}: {error}'
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('game')
    args = parser.parse_args()
    archive = inspection.Archive(args.game)
    records = []
    for aid, name in archive.names.items():
        if not name.endswith(('.level', '.zone')) or 0 not in archive.entries[aid]:
            continue
        records.append({'id': f'{aid:016X}', 'path': name, 'bytes': archive.entries[aid][0].size})
    records.sort(key=lambda record: record['path'])
    zones = [record for record in records if record['path'].endswith('.zone')]
    open_world = [record for record in zones if record['path'].startswith('levels/i20_city/openarea/open_world/')]
    tiles = collections.defaultdict(list)
    for record in open_world:
        match = re.search(r'/tile_([a-z][0-9]{2})/', record['path'])
        if match:
            tiles[match.group(1)].append(record)
    # Prefer central grid labels; this is not yet a verified landmark-to-tile map.
    candidate = next((key for key in ('l20', 'k20', 'j20') if key in tiles), sorted(tiles)[len(tiles) // 2])
    selected = [record for record in records if record['path'].endswith('.level')]
    selected += [record for record in tiles[candidate] if record['bytes'] > 1000][:8]
    output = inspection.ROOT / 'assets-source/nyc-local/world'
    output.mkdir(parents=True, exist_ok=True)
    report = {
        'tocSha256': archive.toc_hash,
        'namedZones': len(zones), 'openWorldZoneAssets': len(open_world),
        'namedTileFolders': len(tiles), 'sampleTile': candidate,
        'sampleTileSelection': 'Grid label only; geographic location not verified',
        'sceneTransformsRecovered': False,
        'zonesAreNotBlocks': 'Includes ground, art, lighting, navigation, missions, day/night and story-state overlays',
        'samples': [inspect(archive, record) for record in selected],
    }
    report['validUtf8StringsRecovered'] = len(utf8_fallbacks)
    assert hashlib.sha256((archive.directory / 'toc').read_bytes()).hexdigest() == archive.toc_hash
    report['tocUnchanged'] = True
    (output / 'scene-index.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
    (output / 'tile-index.json').write_text(json.dumps(tiles, indent=2), encoding='utf-8')
    (output / 'inspection.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({**{k: v for k, v in report.items() if k != 'samples'}, 'samples': [
        {k: v for k, v in sample.items() if k not in ('sections', 'stringSamples', 'resourcePaths')}
        for sample in report['samples']
    ]}, indent=2))


if __name__ == '__main__':
    main()
