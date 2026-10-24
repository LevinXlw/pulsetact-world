"""Decode the downloaded public USGS 3DEP F32 GeoTIFF into a runtime grid.

The export metadata records the geographic extent; values are pixel-centred,
north to south. No colour-map or height exaggeration is applied.
"""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'assets-source/arizona'
metadata = json.loads((source / 'terrain-export.json').read_text())
with Image.open(source / 'terrain-3dep.tif') as image:
    if image.mode != 'F' or image.size != (metadata['width'], metadata['height']):
        raise ValueError('Expected the source F32 single-band elevation export')
    values = [round(float(v), 3) for v in image.getdata()]
if any(not 650 < v < 850 for v in values):
    raise ValueError('Unexpected Tucson elevation units or missing pixels')
data = {'source': 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',
        'retrievedAt': '2026-10-15', 'units': 'metres', 'pixelCenters': True,
        'width': metadata['width'], 'height': metadata['height'],
        'extent': metadata['extent'], 'values': values}
encoded = json.dumps(data, separators=(',', ':'))
(source / 'terrain-samples.json').write_text(encoded + '\n', encoding='utf-8')
(root / 'src/features/world/arizona-terrain-data.ts').write_text(
    '// USGS 3DEP bare-earth elevations. Rebuild: python scripts/prepare-arizona-terrain.py\n'
    + 'export const ARIZONA_TERRAIN_DATA=' + encoded + ';\n', encoding='utf-8')
print(json.dumps({'samples': len(values), 'minMetres': min(values), 'maxMetres': max(values)}))
