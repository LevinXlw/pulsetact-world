export type WorldPoint = [number, number];

/** Exact projection used in scripts/prepare-campus-data.py (GRS80 Lambert). */
export function geoToWorld(lat: number, lon: number): WorldPoint {
  const radians = Math.PI / 180;
  const eccentricity = Math.sqrt(2 / 298.257222101 - (1 / 298.257222101) ** 2);
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - eccentricity ** 2 * Math.sin(p) ** 2);
  const t = (p: number) => Math.tan(Math.PI / 4 - p / 2)
    / ((1 - eccentricity * Math.sin(p)) / (1 + eccentricity * Math.sin(p))) ** (eccentricity / 2);
  const p1 = 42.6833333333333 * radians, p2 = 41.7166666666667 * radians;
  const n = Math.log(m(p1) / m(p2)) / Math.log(t(p1) / t(p2));
  const f = m(p1) / (n * t(p1) ** n);
  const project = (latitude: number, longitude: number): WorldPoint => {
    const rho = 6378137 * f * t(latitude * radians) ** n;
    const rho0 = 6378137 * f * t(41 * radians) ** n;
    const theta = n * (longitude + 71.5) * radians;
    return [200000 + rho * Math.sin(theta), 750000 + rho0 - rho * Math.cos(theta)];
  };
  const origin = project(42.35915, -71.09205), point = project(lat, lon);
  return [point[0] - origin[0], origin[1] - point[1]];
}

