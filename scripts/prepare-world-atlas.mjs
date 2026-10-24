import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Natural Earth's maintainer publishes the same public-domain land dataset as
// GeoJSON, so this preparation needs no GIS dependency or raster map service.
const source = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';
const sourcePath = 'assets-source/world-atlas/ne_50m_land.geojson';
// --local regenerates from the retained official snapshot without a network request.
let bytes;
if (process.argv.includes('--local')) bytes = await readFile(sourcePath);
else {
  const response = await fetch(source, {signal: AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`Natural Earth: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
const data = JSON.parse(bytes.toString('utf8'));
if (data.type !== 'FeatureCollection' || !data.features?.length) throw new Error('Invalid Natural Earth land file');
const round = (coordinates) => typeof coordinates[0] === 'number'
  ? coordinates.map(value => Math.round(value * 10000) / 10000)
  : coordinates.map(round);
let polygonCount = 0, ringCount = 0, coordinateCount = 0;
for (const feature of data.features) {
  if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) throw new Error('Expected land polygons');
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    if (!polygon.length) throw new Error('Empty land polygon');
    polygonCount++;
    for (const ring of polygon) {
      if (ring.length < 4) throw new Error('Invalid polygon ring');
      const first = ring[0], last = ring.at(-1);
      if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Unclosed polygon ring');
      ringCount++;
      for (const [longitude, latitude] of ring) {
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error('Invalid WGS84 coordinate');
        coordinateCount++;
      }
    }
  }
}
const reduced = {type: 'FeatureCollection', features: data.features.map(feature => ({
  type: 'Feature', properties: {}, geometry: {type: feature.geometry.type, coordinates: round(feature.geometry.coordinates)},
}))};
await mkdir('assets-source/world-atlas', {recursive: true});
await mkdir('public/assets/maps', {recursive: true});
await writeFile(sourcePath, bytes);
const output = `${JSON.stringify(reduced)}\n`;
await writeFile('public/assets/maps/world-land.json', output);
// Keep the earlier 110m provenance when refreshing the runtime with 50m data.
try {
  const previous = JSON.parse(await readFile('assets-source/world-atlas/land-source.json', 'utf8'));
  if (previous.source?.includes('ne_110m_')) await writeFile('assets-source/world-atlas/land-source-110m.json', `${JSON.stringify(previous, null, 2)}\n`);
} catch (error) {if (error.code !== 'ENOENT') throw error;}
await writeFile('assets-source/world-atlas/land-source.json', `${JSON.stringify({
  title: 'Natural Earth 1:50m land polygons',
  retrieved: new Date().toISOString(), source,
  publisher: 'Natural Earth / Nathaniel Vaughn Kelso',
  homepage: 'https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/',
  license: 'Public domain', licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
  usage: 'Redistribution, modification and commercial use permitted; no attribution required. Credit retained voluntarily.',
  attribution: 'Made with Natural Earth',
  originalSha256: createHash('sha256').update(bytes).digest('hex'),
  originalBytes: bytes.length, runtimeBytes: Buffer.byteLength(output), featureCount: reduced.features.length,
  geometryValidation: {polygonCount, ringCount, coordinateCount, closedRings: true, finiteWgs84Coordinates: true},
  modifications: 'Discarded thematic properties and rounded WGS84 longitude/latitude to four decimal places; no geometry simplification beyond the source 1:50m scale.',
  limitations: 'World and regional locator coastline only. More detailed than the earlier 1:110m asset, but it does not resolve individual campus streets, property boundaries or all Boston inland waterways.',
}, null, 2)}\n`);
console.log(JSON.stringify({features: reduced.features.length, polygonCount, ringCount, coordinateCount, bytes: Buffer.byteLength(output), output: 'public/assets/maps/world-land.json'}));
