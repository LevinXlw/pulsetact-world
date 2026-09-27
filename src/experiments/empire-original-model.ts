import * as T from 'three';

export interface RecoveredScene {
  instances: number;
  selection: { origin: number[] };
  samples: { label: string; id: string; path: string; triangles: number; modelIndex: number; placements: { matrix: number[]; offset: number; variant: number }[] }[];
}

/** Original game matrices are Y-up, column-major, in metres. */
export function buildRecoveredEmpire(library: T.Group, manifest: RecoveredScene) {
  const building = new T.Group(); building.name = 'Empire_State_Original_Scene';
  const recenter = new T.Matrix4().makeTranslation(...manifest.selection.origin.map(v => -v) as [number, number, number]);
  const reflect = new T.Matrix4().makeScale(-1, 1, 1);
  let instances = 0, triangles = 0, mirrored = 0;
  for (const sample of manifest.samples) {
    const source = library.getObjectByName(sample.label);
    if (!source) throw new Error(`缺少构件：${sample.label}`);
    source.updateWorldMatrix(true, true);
    const matrices = sample.placements.map(p => recenter.clone().multiply(new T.Matrix4().fromArray(p.matrix)));
    const positive = matrices.filter(m => m.determinant() >= 0), negative = matrices.filter(m => m.determinant() < 0);
    instances += matrices.length; triangles += sample.triangles * matrices.length; mirrored += negative.length;
    source.traverse(child => {
      if (!(child instanceof T.Mesh)) return;
      const material = child.material as T.MeshStandardMaterial;
      material.envMapIntensity = .55;
      // Foliage uses cutout alpha in the original; the basic PBR adapter only
      // provides the color texture, so restore cutout handling for these leaves.
      if (/plant|bush|tree/.test(sample.path) && material.map) {
        material.alphaTest = .45; material.side = T.DoubleSide;
      }
      for (const [transforms, flip] of [[positive, false], [negative, true]] as const) {
        if (!transforms.length) continue;
        let geometry = child.geometry;
        if (flip) {
          geometry = geometry.clone(); geometry.applyMatrix4(reflect);
          // InstancedMesh cannot fix winding per instance. Bake reflection into
          // vertices and winding, then use a positive-determinant matrix.
          const index = geometry.index;
          if (!index) throw new Error('Expected indexed source geometry');
          for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, a);
          }
          index.needsUpdate = true;
        }
        const mesh = new T.InstancedMesh(geometry, material, transforms.length);
        mesh.name = `${sample.label}/${child.name}${flip ? '/mirrored' : ''}`;
        mesh.userData.sourceAsset = sample.id;
        transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix.clone().multiply(child.matrixWorld).multiply(flip ? reflect : new T.Matrix4())));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.computeBoundingBox(); mesh.computeBoundingSphere(); building.add(mesh);
      }
    });
  }
  building.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(building), size = bounds.getSize(new T.Vector3());
  return { building, stats: { models: manifest.samples.length, instances, triangles, mirrored, dimensions: size.toArray(), bounds: [bounds.min.toArray(), bounds.max.toArray()] } };
}
