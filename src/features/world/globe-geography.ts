export type LonLat = readonly [number, number];
const RAD = Math.PI / 180;

// Three's SphereGeometry: Greenwich faces +X; east longitudes turn toward -Z.
export function globeVector([longitude, latitude]: LonLat): [number, number, number] {
  const parallel = Math.cos(latitude * RAD);
  return [parallel * Math.cos(longitude * RAD), Math.sin(latitude * RAD), -parallel * Math.sin(longitude * RAD)];
}

export function distanceKm(a: LonLat, b: LonLat) {
  const h = Math.sin((b[1] - a[1]) * RAD / 2) ** 2
    + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin((b[0] - a[0]) * RAD / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function normalizeGlobeView(longitude: number, latitude: number, zoom: number) {
  return {longitude: ((longitude + 180) % 360 + 360) % 360 - 180, latitude: Math.max(-80, Math.min(80, latitude)), zoom: Math.max(1, Math.min(28, zoom))};
}

export type LandCollection = {
  type: 'FeatureCollection';
  features: {geometry: {type: 'Polygon'; coordinates: number[][][]} | {type: 'MultiPolygon'; coordinates: number[][][][]}}[];
};

export const REGION_TEXTURE_BOUNDS = [-84, 34, -65, 48] as const;

export function paintWorldTexture(context: CanvasRenderingContext2D, land: LandCollection, bounds: readonly [number, number, number, number] = [-180, -90, 180, 90]) {
  const {width, height} = context.canvas;
  const [west, south, east, north] = bounds;
  const pixelX = (longitude: number) => (longitude - west) / (east - west) * width;
  const pixelY = (latitude: number) => (north - latitude) / (north - south) * height;
  context.fillStyle = '#44798b';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#b9c7a0'; context.strokeStyle = '#d7d8b4'; context.lineWidth = .8;
  for (const feature of land.features) {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      context.beginPath();
      for (const ring of polygon) {
        ring.forEach(([longitude, latitude], index) => {
          const x = pixelX(longitude), y = pixelY(latitude);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.closePath();
      }
      context.fill('evenodd'); context.stroke();
    }
  }
  context.strokeStyle = '#e3e7d524'; context.lineWidth = 1;
  context.beginPath();
  for (let longitude = -180; longitude < 180; longitude += 15) {
    const x = pixelX(longitude); context.moveTo(x, 0); context.lineTo(x, height);
  }
  for (let latitude = -75; latitude < 90; latitude += 15) {
    const y = pixelY(latitude); context.moveTo(0, y); context.lineTo(width, y);
  }
  context.stroke();
}
