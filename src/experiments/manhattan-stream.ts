import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { TextureCandidate } from './manhattan-texture-detail';

export interface CityModel { id: string; path: string; bounds: number[][]; triangles: number; streamFile: string; streamBytes: number }
export interface CityTile { id: string; center: number[]; nominalBounds: number[][]; instances: number; triangles: number; manifest: string; omittedInstances: number }
export interface CityIndex { version: number; origin: number[]; centerTile: string; tileSize: number; totalInstances: number; tiles: CityTile[]; models: Record<string, CityModel> }
export interface TileData extends CityTile { groups: { id: string; matrices: number[][]; offsets: number[]; variants: number[] }[] }
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type Progress = { tile: string; state: LoadState; loaded?: number; total?: number; message?: string };

const ROOT = '/assets-source/nyc-local/manhattan/';

export function tilesForRange(index: CityIndex, range: number, centerId = index.centerTile) {
  const center = index.tiles.find(tile => tile.id === centerId)!;
  return index.tiles.filter(tile => {
    const dx = Math.abs(tile.center[0] - center.center[0]) / index.tileSize;
    const dz = Math.abs(tile.center[2] - center.center[2]) / index.tileSize;
    return range === 1 ? dx + dz < .1 : range === 5 ? dx + dz < 1.1 : Math.max(dx, dz) < 1.1;
  }).sort((a, b) => Math.hypot(a.center[0]-center.center[0], a.center[2]-center.center[2]) - Math.hypot(b.center[0]-center.center[0], b.center[2]-center.center[2]));
}

export async function readCityIndex(): Promise<CityIndex> {
  const response = await fetch(`${ROOT}index.json`);
  if (!response.ok) throw new Error(`街区索引读取失败 (${response.status})`);
  const data: CityIndex = await response.json();
  if (data.version !== 1 || !data.tiles.length) throw new Error('不支持的街区数据');
  return data;
}

async function parallel<T>(values: T[], count: number, action: (value: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(count, values.length) }, async () => {
    while (cursor < values.length) await action(values[cursor++]);
  }));
}

/** Shared asset cache: each model and identical material is uploaded once. */
export class CityAssetStore {
  readonly tiles = new Map<string, TileData>();
  readonly models = new Map<string, T.Group>();
  private pending = new Map<string, Promise<T.Group>>();
  private materials = new Map<string, T.MeshStandardMaterial>();
  private textures = new Map<string, T.Texture>();
  private loader = new GLTFLoader();
  constructor(readonly index: CityIndex, private progress: (event: Progress) => void) { T.Cache.enabled = true; }

  private model(id: string): Promise<T.Group> {
    const ready = this.models.get(id); if (ready) return Promise.resolve(ready);
    const loading = this.pending.get(id); if (loading) return loading;
    const promise = this.loader.loadAsync(ROOT + this.index.models[id].streamFile).then(async gltf => {
      gltf.scene.updateWorldMatrix(true, true);
      const lods: Promise<void>[] = [];
      gltf.scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        if (typeof object.userData.farIndicesAccessor === 'number') {
          lods.push(gltf.parser.getDependency('accessor', object.userData.farIndicesAccessor).then((indices: T.BufferAttribute) => {
            const low = new T.BufferGeometry();
            for (const [name, attribute] of Object.entries(object.geometry.attributes)) low.setAttribute(name, attribute as T.BufferAttribute);
            low.setIndex(indices); object.geometry.userData.farGeometry = low;
          }));
        }
        const material = object.material as T.MeshStandardMaterial;
        const key: string = material.userData.sharedMaterialKey ?? material.uuid;
        const existing = this.materials.get(key);
        if (existing) { object.material = existing; material.dispose(); }
        else {
          for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) {
            const texture = material[slot]; if (!texture) continue;
            const textureKey = `${texture.name}:${texture.colorSpace}:${texture.wrapS}:${texture.wrapT}:${texture.flipY}`;
            const shared = this.textures.get(textureKey);
            if (shared) { material[slot] = shared; texture.dispose(); } else this.textures.set(textureKey, texture);
          }
          material.envMapIntensity = .55; this.materials.set(key, material);
        }
      });
      await Promise.all(lods);
      this.models.set(id, gltf.scene); return gltf.scene;
    }).finally(() => this.pending.delete(id));
    this.pending.set(id, promise); return promise;
  }

  async loadTile(tile: CityTile) {
    if (this.tiles.has(tile.id)) {
      const cached = this.tiles.get(tile.id)!; this.tiles.delete(tile.id); this.tiles.set(tile.id, cached);
      this.progress({ tile: tile.id, state: 'ready' }); return;
    }
    this.progress({ tile: tile.id, state: 'loading' });
    try {
      const response = await fetch(ROOT + tile.manifest);
      if (!response.ok) throw new Error(`街区 ${tile.id} 读取失败 (${response.status})`);
      const data: TileData = await response.json();
      if (data.id !== tile.id || !Array.isArray(data.groups)) throw new Error('街区数据不匹配');
      let loaded = 0;
      await parallel(data.groups, 6, async group => {
        await this.model(group.id); loaded++;
        if (loaded % 12 === 0) this.progress({ tile: tile.id, state: 'loading', loaded, total: data.groups.length });
      });
      this.tiles.set(tile.id, data); this.progress({ tile: tile.id, state: 'ready' });
    } catch (error) {
      this.progress({ tile: tile.id, state: 'error', message: String(error) }); throw error;
    }
  }

  /** Bound CPU/GPU caches when future index revisions expose more tiles. */
  trim(visible: string[], keep = 12) {
    if (this.tiles.size <= keep) return;
    for (const id of this.tiles.keys()) {
      if (this.tiles.size <= keep) break;
      if (!visible.includes(id)) this.tiles.delete(id);
    }
    const retained = new Set([...this.tiles.values()].flatMap(tile => tile.groups.map(g => g.id)));
    for (const [id, model] of this.models) if (!retained.has(id) && !this.pending.has(id)) {
      model.traverse(child => { if (child instanceof T.Mesh) { child.geometry.userData.farGeometry?.dispose(); child.geometry.dispose(); } });
      this.models.delete(id);
    }
    const materials = new Set<T.Material>();
    for (const model of this.models.values()) model.traverse(child => { if (child instanceof T.Mesh) materials.add(child.material); });
    for (const [key, material] of this.materials) if (!materials.has(material)) { material.dispose(); this.materials.delete(key); }
    const textures = new Set<T.Texture>();
    for (const material of this.materials.values()) for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    for (const [key, texture] of this.textures) if (!textures.has(texture)) { texture.dispose(); this.textures.delete(key); }
    T.Cache.clear();
  }
}

interface GeometryInstances { geometry: T.BufferGeometry; matrices: T.Matrix4[]; detail: boolean; mirrored: boolean; lod: 'only' | 'near' | 'far' }
interface MaterialBatch { material: T.Material; geometries: Map<string, GeometryInstances> }

/** Rebuild only when visible tiles change; render with one batch per material. */
export function buildCityBatches(store: CityAssetStore, visible: string[]) {
  const group = new T.Group(); group.name = 'Recovered_Manhattan';
  const groups = new Map<string, MaterialBatch>(), reflect = new T.Matrix4().makeScale(-1, 1, 1);
  const origin = store.index.origin, center = new T.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]);
  let instances = 0, sourceTriangles = 0;
  const textureRegions: {bounds: T.Sphere; textures: T.Texture[]}[] = [];
  const detailInstances: { batch: T.BatchedMesh; id: number; center: T.Vector3; visible: boolean; detail: boolean; lod: 'only' | 'near' | 'far'; lodDistance: number }[] = [];
  for (const tileId of visible) {
    const tile = store.tiles.get(tileId); if (!tile) continue;
    for (const data of tile.groups) {
      const asset = store.models.get(data.id)!;
      const meta = store.index.models[data.id];
      const size = Math.max(...meta.bounds[0].map((v, i) => meta.bounds[1][i] - v));
      const detail = size < 8 && !/building_kits|\/ground\/|lane_lines/.test(meta.path);
      const matrices = data.matrices.map(values => center.clone().multiply(new T.Matrix4().fromArray(values)));
      instances += matrices.length; sourceTriangles += meta.triangles * matrices.length;
      asset.traverse(child => {
        if (!(child instanceof T.Mesh)) return;
        const material = child.material as T.Material;
        if (!groups.has(material.uuid)) groups.set(material.uuid, { material, geometries: new Map() });
        const definitions = groups.get(material.uuid)!.geometries;
        for (const matrix of matrices) {
          const combined = matrix.clone().multiply(child.matrixWorld), mirrored = combined.determinant() < 0;
          if (mirrored) combined.multiply(reflect);
          const low = child.geometry.userData.farGeometry as T.BufferGeometry | undefined;
          const variants: [T.BufferGeometry, GeometryInstances['lod']][] = low ? [[child.geometry, 'near'], [low, 'far']] : [[child.geometry, 'only']];
          for (const [geometry, lod] of variants) {
            const key = `${geometry.uuid}:${mirrored}:${detail}:${lod}`;
            let definition = definitions.get(key);
            if (!definition) { definition = { geometry, matrices: [], detail, mirrored, lod }; definitions.set(key, definition); }
            definition.matrices.push(combined);
          }
        }
      });
    }
  }
  for (const { material, geometries } of groups.values()) {
    const definitions = [...geometries.values()];
    const instanceCount = definitions.reduce((sum, d) => sum + d.matrices.length, 0);
    const vertexCount = definitions.reduce((sum, d) => sum + d.geometry.getAttribute('position').count, 0);
    const indexCount = definitions.reduce((sum, d) => sum + d.geometry.index!.count, 0);
    const batch = new T.BatchedMesh(instanceCount, vertexCount, indexCount, material);
    batch.name = material.name; batch.sortObjects = false; batch.perObjectFrustumCulled = true;
    batch.castShadow = true; batch.receiveShadow = true;
    for (const definition of definitions) {
      let geometry = definition.geometry;
      if (definition.mirrored) {
        geometry = geometry.clone(); geometry.applyMatrix4(reflect);
        const index = geometry.index!;
        for (let i = 0; i < index.count; i += 3) { const a = index.getX(i); index.setX(i, index.getX(i+2)); index.setX(i+2, a); }
      }
      const geometryId = batch.addGeometry(geometry);
      geometry.computeBoundingSphere();
      for (const matrix of definition.matrices) {
        const id = batch.addInstance(geometryId); batch.setMatrixAt(id, matrix);
        if (definition.lod !== 'far') {
          const surface=material as T.MeshStandardMaterial;
          const textures=[surface.map,surface.normalMap].filter((t): t is T.Texture => t !== null && t !== undefined);
          if (textures.length) textureRegions.push({bounds:geometry.boundingSphere!.clone().applyMatrix4(matrix),textures});
        }
        if (definition.detail || definition.lod !== 'only') {
          const bounds = geometry.boundingSphere!.clone().applyMatrix4(matrix), visible = definition.lod !== 'far';
          batch.setVisibleAt(id, visible);
          detailInstances.push({ batch, id, center: bounds.center, visible, detail: definition.detail, lod: definition.lod, lodDistance: Math.max(220, bounds.radius*8) });
        }
      }
      if (definition.mirrored) geometry.dispose();
    }
    batch.computeBoundingBox(); batch.computeBoundingSphere(); group.add(batch);
  }
  return {
    group, stats: { tiles: visible.length, instances, sourceTriangles, batches: group.children.length, detailInstances: detailInstances.length },
    nearTextures(position: T.Vector3, frustum: T.Frustum): TextureCandidate[] {
      const scores=new Map<T.Texture,number>();
      for (const {bounds,textures} of textureRegions) {
        const distance=Math.max(0,bounds.center.distanceTo(position)-bounds.radius);
        if (distance > 200 || !frustum.intersectsSphere(bounds)) continue;
        const score=(bounds.radius+1)**2/(distance*distance+25);
        for (const texture of textures) scores.set(texture,Math.max(scores.get(texture)??0,score));
      }
      return [...scores].map(([texture,score])=>({texture,score}));
    },
    updateDetails(position: T.Vector3, highQuality = false) {
      let changed = false;
      for (const item of detailInstances) {
        const distance = item.center.distanceToSquared(position);
        const detailDistance=highQuality ? 330 : 190, lodDistance=item.lodDistance*(highQuality ? 1.7 : 1);
        let show = !item.detail || distance < (item.visible ? detailDistance : detailDistance-20) ** 2;
        if (item.lod === 'near') show &&= distance < (item.visible ? lodDistance : lodDistance-30) ** 2;
        if (item.lod === 'far') show &&= distance >= (item.visible ? lodDistance-30 : lodDistance) ** 2;
        if (show !== item.visible) { item.batch.setVisibleAt(item.id, show); item.visible = show; changed = true; }
      }
      return changed;
    },
    dispose() { for (const child of group.children) (child as T.BatchedMesh).dispose(); group.clear(); },
  };
}
