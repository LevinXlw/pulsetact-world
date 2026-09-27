"""Read-only archive inspection. Outputs stay outside public/ and production builds.

Requires the separately downloaded GPLv3 ALERT tool and project-local Python libs.
This research adapter is licensed GPL-3.0-or-later; see ALERT/LICENSE.txt.
"""
import argparse
import collections
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'assets-source/tools/python-libs'), str(ROOT / 'assets-source/tools/ALERT')]
import dat1lib
import dat1lib.decompression
import lz4.block

# Use the maintained native decoder instead of the tool's slow Python LZ4 loop.
dat1lib.decompression.decompress = lambda data, size: lz4.block.decompress(bytes(data), uncompressed_size=size)


class Archive:
    def __init__(self, game):
        self.directory = Path(game).resolve() / 'asset_archive'
        toc_path = self.directory / 'toc'
        self.toc_hash = hashlib.sha256(toc_path.read_bytes()).hexdigest()
        with toc_path.open('rb') as stream:
            self.toc = dat1lib.read(stream, version=dat1lib.VERSION_MSMR)
        self.toc.set_archives_dir(str(self.directory))
        self.entries = collections.defaultdict(dict)
        for span, section in enumerate(self.toc.get_spans_section().entries):
            for index in range(section.asset_index, section.asset_index + section.count):
                entry = self.toc.get_asset_entry_by_index(index)
                self.entries[entry.asset_id][span] = entry
        self.names = {}
        names_zip = ROOT / 'assets-source/tools/hashes.zip'
        if names_zip.exists():
            with zipfile.ZipFile(names_zip) as bundle:
                name = next(n for n in bundle.namelist() if n.split('/')[-1] == 'hashes.txt')
                for line in bundle.read(name).decode('utf-8-sig').splitlines():
                    parts = line.split(',')
                    if len(parts) < 2:
                        continue
                    try:
                        aid = int(parts[0], 16)
                    except ValueError:
                        continue
                    if aid in self.entries:
                        self.names[aid] = parts[1].strip().lower().replace('\\', '/')

    def read(self, aid, span=0):
        entry = self.entries[aid][span]
        data = bytes(self.toc.extract_asset(entry))
        if len(data) != entry.size:
            raise ValueError(f'Truncated asset {aid:016X}: {len(data)} != {entry.size}')
        return data

    def parse(self, aid, span=0):
        return dat1lib.read(io.BytesIO(self.read(aid, span)), version=dat1lib.VERSION_MSMR)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('game')
    parser.add_argument('--inspect', help='Hexadecimal asset ID; exports only this sample')
    args = parser.parse_args()
    archive = Archive(args.game)
    output = ROOT / 'assets-source/nyc-local'
    output.mkdir(parents=True, exist_ok=True)
    models = []
    for aid, name in archive.names.items():
        if name.endswith('.model') and 0 in archive.entries[aid]:
            entry = archive.entries[aid][0]
            models.append({'id': f'{aid:016X}', 'path': name, 'bytes': entry.size})
    buildings = [m for m in models if any(word in m['path'] for word in ('building', 'architecture', 'landmark', 'brownstone', 'tenement'))]
    report = {
        'game': "Marvel's Spider-Man Remastered", 'steamBuild': '23986256',
        'executableVersion': '4.0630.0.0', 'tocSha256': archive.toc_hash,
        'records': len(archive.toc.get_assets_section().ids), 'uniqueAssets': len(archive.entries),
        'namedAssets': len(archive.names), 'modelCount': len(models),
        'buildingCandidates': len(buildings),
        'archiveFilesPresent': len(list(archive.directory.glob('g*s*'))),
        'candidates': sorted(buildings, key=lambda m: m['path']),
    }
    (output / 'inventory.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    (output / 'models.json').write_text(json.dumps(models, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'candidates'}, indent=2))
    print(json.dumps(report['candidates'][:35], indent=2))
    if args.inspect:
        aid = int(args.inspect, 16)
        data = archive.read(aid)
        asset = dat1lib.read(io.BytesIO(data), version=dat1lib.VERSION_MSMR)
        (output / f'{aid:016X}.model').write_bytes(data)
        print('TYPE', type(asset).__name__)
        print('STRINGS', json.dumps(asset.dat1._strings_map, indent=2))
        print('SECTIONS', [(f'{s.tag:08X}', s.size) for s in asset.dat1.header.sections])
    # Verify the index was not modified by inspection.
    assert hashlib.sha256((archive.directory / 'toc').read_bytes()).hexdigest() == archive.toc_hash


if __name__ == '__main__':
    main()
