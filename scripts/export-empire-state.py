"""Extract the installed game's Empire State kit for a local study. GPL-3.0-or-later."""
import argparse
import importlib
import json

exporter = importlib.import_module('export-spiderman-sample')
inspection = exporter.inspection
OUTPUT = inspection.ROOT / 'assets-source/nyc-local/empire'
SAMPLES = [
    (0xA946E5DAF5F14256, 'empire-silhouette'),
    (0x8BF70BA6A3BD1A2F, 'empire-window'),
    (0x8F181AC5B61B6F09, 'empire-upper-window'),
    (0x91DE9BBA88AE0E5F, 'empire-window-deco'),
    (0x847E0A0AF040251B, 'empire-entrance'),
    (0x97384440DABD3C44, 'empire-crown'),
    (0xB927132E2E6E3C2E, 'empire-spire'),
    (0x826A0774AB17C996, 'empire-antenna'),
    (0x8BD5D0F026FD392E, 'empire-railing'),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('game')
    args = parser.parse_args()
    archive = inspection.Archive(args.game)
    report = {
        'game': "Marvel's Spider-Man Remastered",
        'tocSha256': archive.toc_hash,
        'sourceToolCommit': 'bc90ed9b53fbcaa3b7acf94b36f00e77eab0dacb',
        'placement': 'Manual reconstruction using game components; not original scene transforms',
        'samples': [exporter.export(archive, aid, label, OUTPUT) for aid, label in SAMPLES],
    }
    (OUTPUT / 'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    assert inspection.hashlib.sha256((archive.directory / 'toc').read_bytes()).hexdigest() == archive.toc_hash


if __name__ == '__main__':
    main()
