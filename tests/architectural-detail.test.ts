import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Raycaster, Vector3} from 'three';
import {createArchitecturalDetail, type ArchitecturalDetailManifest} from '../src/features/real-campus/architectural-detail';

const manifest = JSON.parse(readFileSync('public/data/killian/detail-manifest.json', 'utf8'));
type Facade = NonNullable<ArchitecturalDetailManifest['courtyardFacades']>[number];
function point(facade:Facade, x:number, y:number, depth:number) {
  const [nx, , nz] = facade.normal, [cx, , cz] = facade.center;
  return new Vector3(cx + nz * x + nx * depth, y, cz - nx * x + nz * depth);
}

it('keeps every new room surface behind the existing glass and inside its recorded cavity', () => {
  const detail = createArchitecturalDetail(new Group(), manifest);
  detail.updateMatrixWorld(true);
  const rooms = detail.children.filter(object => object.name.includes('window'));
  for (const facade of manifest.courtyardFacades as Facade[]) {
    const ray = new Raycaster(undefined, new Vector3(-facade.normal[0], 0, -facade.normal[2]).normalize(), 0, 1.2);
    for (const opening of facade.openings) {
      for (const fraction of [.15, .5, .85]) {
        ray.ray.origin.copy(point(facade, opening.x + .11,
          opening.bottom + (opening.top - opening.bottom) * fraction, facade.glassDepth + .02));
        const hit = ray.intersectObjects(rooms, false)[0];
        expect(hit, `${opening.id} has no physical interior`).toBeDefined();
        expect(hit.distance, `${opening.id} crosses the glazing`).toBeGreaterThan(.1);
        expect(hit.distance, `${opening.id} extends through the existing backing`).toBeLessThan(.58);
      }
    }
  }
});

it('leaves the three portico entrance doors clear and does not introduce walking colliders', () => {
  const detail = createArchitecturalDetail(new Group(), manifest);
  detail.updateMatrixWorld(true);
  const facade = {...manifest.porticoOpening, glassDepth:manifest.porticoSample.glassDepth};
  for (const opening of manifest.porticoSample.openings.filter((opening:{kind:string}) => opening.kind === 'door')) {
    const ray = new Raycaster(point(facade, opening.x, opening.bottom + 1.1, facade.glassDepth + 1),
      new Vector3(-facade.normal[0], 0, -facade.normal[2]).normalize(), 0, 2);
    expect(ray.intersectObjects(detail.children, false)).toHaveLength(0);
  }
  detail.traverse(object => {if (object instanceof Mesh) expect(object.userData.collision).toBe('none');});
});

it('retains reflection shaders and fits all window/drum additions within four draw batches', () => {
  const source = new Group(), glass = new MeshStandardMaterial();
  glass.name = 'courtyardGlass';
  const shader = glass.onBeforeCompile, key = glass.customProgramCacheKey;
  source.add(new Mesh(new BoxGeometry(1, 1, 1), glass));
  const detail = createArchitecturalDetail(source, manifest);
  expect(glass.onBeforeCompile).toBe(shader);
  expect(glass.customProgramCacheKey).toBe(key);
  expect(glass.transparent && !glass.depthWrite).toBe(true);
  expect(glass.opacity).toBeLessThan(.5);
  expect(detail.children.length).toBeLessThanOrEqual(4);
  let triangles = 0;
  for (const object of detail.children) {
    expect(object).toBeInstanceOf(InstancedMesh);
    const mesh = object as InstancedMesh;
    triangles += (mesh.geometry.index?.count || mesh.geometry.getAttribute('position').count) / 3 * mesh.count;
    expect(mesh.boundingSphere?.radius).toBeGreaterThan(0);
  }
  expect(triangles).toBeLessThan(32000);
  expect(detail.userData.architecturalDetail.windows).toBe(312);
  expect(detail.userData.architecturalDetail.shades).toBeGreaterThan(60);
  expect(detail.userData.architecturalDetail.shades).toBeLessThan(200);
});
