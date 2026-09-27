"""Check each downloaded archive's CRC and record its contents without extracting models."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent / 'assets-source' / 'cambridge-gis'
plan = json.loads((root / 'metadata/download-plan.json').read_text(encoding='utf-8'))
results = []
for item in plan['files']:
    path = root / item['path']
    if not path.exists():
        results.append({'path': item['path'], 'status': 'missing'})
        continue
    try:
        with zipfile.ZipFile(path) as archive:
            bad = archive.testzip()
            if bad:
                raise ValueError(f'CRC check failed: {bad}')
            names = archive.namelist()
            unsafe = [n for n in names if '..' in PurePosixPath(n.replace('\\', '/')).parts or PurePosixPath(n).is_absolute()]
            if unsafe:
                raise ValueError('Archive contains unsafe paths')
            record = {'path': item['path'], 'status': 'verified', 'bytes': path.stat().st_size,
                      'sha256': hashlib.file_digest(path.open('rb'), 'sha256').hexdigest(),
                      'entries': len(names), 'uncompressedBytes': sum(i.file_size for i in archive.infolist()),
                      'objFiles': sum(n.lower().endswith('.obj') for n in names),
                      'mtlFiles': sum(n.lower().endswith('.mtl') for n in names),
                      'jpgFiles': sum(n.lower().endswith(('.jpg', '.jpeg')) for n in names),
                      'documents': [n for n in names if n.lower().endswith(('.pdf', '.txt', '.md'))],
                      'sampleEntries': names[:12]}
            results.append(record)
            print(f"VERIFIED {item['path']} ({len(names)} entries)", flush=True)
    except Exception as error:
        results.append({'path': item['path'], 'status': 'failed', 'error': str(error)})
report = {'files': results, 'verified': sum(x['status'] == 'verified' for x in results),
          'expected': len(plan['files']), 'totalBytes': sum(x.get('bytes', 0) for x in results)}
(root / 'metadata/verification.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}))
raise SystemExit(0 if report['verified'] == report['expected'] else 1)
