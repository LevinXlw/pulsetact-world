import {describe, expect, it} from 'vitest';
import {OrthographicCamera, SphereGeometry, Vector2, Vector3} from 'three';
import {ATLAS_SCHOOLS} from '../src/features/world/campus-atlas-data';
import {distanceKm, globeVector, normalizeGlobeView} from '../src/features/world/globe-geography';

describe('geographic atlas', () => {
  it('aligns geography with the actual Three sphere texture coordinates', () => {
    const sphere = new SphereGeometry(1, 72, 36);
    const points = sphere.getAttribute('position'), uvs = sphere.getAttribute('uv');
    // Compare varied longitudes/latitudes with the engine geometry, so a
    // mirrored or shifted land texture cannot silently separate pins from land.
    for (let index = 73; index < points.count - 73; index += 23) {
      const uv = new Vector2(uvs.getX(index), uvs.getY(index));
      const geographic = new Vector3(...globeVector([uv.x * 360 - 180, uv.y * 180 - 90]));
      expect(geographic.distanceTo(new Vector3().fromBufferAttribute(points, index))).toBeLessThan(.000001);
    }
    sphere.dispose();
  });

  it('places Boston northeast of Philadelphia and College Park at the regional camera', () => {
    const camera = new OrthographicCamera(-1.22, 1.22, 1.22, -1.22, .1, 8);
    camera.position.set(...globeVector([-74, 40.7])).multiplyScalar(3);
    camera.zoom = 19; camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const project = (id: string) => new Vector3(...globeVector(ATLAS_SCHOOLS.find(s => s.id === id)!.location)).project(camera);
    const boston = project('mit'), penn = project('upenn'), maryland = project('umd');
    expect(boston.x).toBeGreaterThan(penn.x); expect(penn.x).toBeGreaterThan(maryland.x);
    expect(boston.y).toBeGreaterThan(penn.y); expect(penn.y).toBeGreaterThan(maryland.y);
    for (const point of [boston, penn, maryland]) {expect(Math.abs(point.x)).toBeLessThan(.85); expect(Math.abs(point.y)).toBeLessThan(.85);}
  });

  it('reports plausible real-world separation at both city and regional scales', () => {
    const location = (id: string) => ATLAS_SCHOOLS.find(s => s.id === id)!.location;
    expect(distanceKm(location('mit'), location('bu'))).toBeGreaterThan(1);
    expect(distanceKm(location('mit'), location('bu'))).toBeLessThan(2);
    expect(distanceKm(location('mit'), location('upenn'))).toBeGreaterThan(430);
    expect(distanceKm(location('mit'), location('upenn'))).toBeLessThan(450);
    expect(distanceKm(location('upenn'), location('umd'))).toBeGreaterThan(180);
    expect(distanceKm(location('upenn'), location('umd'))).toBeLessThan(190);
    expect(distanceKm([0, 0], [180, 0])).toBeCloseTo(20015.114, 2);
    expect(distanceKm(location('umd'), location('umd'))).toBe(0);
  });

  it('keeps polar camera rotation and zoom finite after long drags and pinches', () => {
    expect(normalizeGlobeView(1081, 150, 100)).toEqual({longitude: 1, latitude: 80, zoom: 28});
    expect(normalizeGlobeView(-1081, -150, .001)).toEqual({longitude: -1, latitude: -80, zoom: 1});
  });
});
