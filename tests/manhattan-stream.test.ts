import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { buildCityBatches, CityAssetStore, tilesForRange, type CityIndex } from '../src/experiments/manhattan-stream';

function index(): CityIndex {
  const tiles = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) tiles.push({
    id: `${x}:${z}`, center: [x*128,1,z*128], nominalBounds: [[x*128-64,z*128-64],[x*128+64,z*128+64]], instances:0, triangles:0, manifest:'', omittedInstances:0,
  });
  return { version:1, origin:[0,0,0], centerTile:'0:0', tileSize:128, totalInstances:0, tiles, models:{} };
}

describe('incremental city visibility', () => {
  it('expands in connected 1 / 5 / 9 tile stages and clips at available data', () => {
    const data = index();
    expect(tilesForRange(data,1).map(t=>t.id)).toEqual(['0:0']);
    expect(tilesForRange(data,5).map(t=>t.id).sort()).toEqual(['-1:0','0:-1','0:0','0:1','1:0']);
    expect(tilesForRange(data,9)).toHaveLength(9);
    expect(tilesForRange(data,9,'1:1')).toHaveLength(4);
  });

  it('preserves reflected geometry bounds without negative GPU instance matrices', () => {
    const data = index(), store = new CityAssetStore(data, () => {});
    const geometry = new T.BoxGeometry(2,4,6), material = new T.MeshStandardMaterial();
    const asset = new T.Group(); asset.add(new T.Mesh(geometry, material)); asset.updateWorldMatrix(true,true);
    data.models.box = {id:'box',path:'environment/building_kits/test.model',bounds:[[-1,-2,-3],[1,2,3]],triangles:12,streamFile:'',streamBytes:0};
    store.models.set('box',asset);
    const a = new T.Matrix4().makeTranslation(10,2,0), b = new T.Matrix4().makeScale(-1,1,1); b.setPosition(-10,2,0);
    store.tiles.set('0:0',{...data.tiles.find(t=>t.id==='0:0')!,groups:[{id:'box',matrices:[a.toArray(),b.toArray()],offsets:[1,2],variants:[0,0]}]});
    const built = buildCityBatches(store,['0:0']), batch = built.group.children[0] as T.BatchedMesh;
    const bounds = batch.boundingBox!;
    expect(bounds.min.toArray()).toEqual([-11,0,-3]); expect(bounds.max.toArray()).toEqual([11,4,3]);
    for (let i=0;i<2;i++) { const matrix = new T.Matrix4(); batch.getMatrixAt(i,matrix); expect(matrix.determinant()).toBeGreaterThan(0); }
    expect(built.stats.instances).toBe(2); expect(built.stats.batches).toBe(1);
    let sourceDisposed = false; geometry.addEventListener('dispose', () => {sourceDisposed=true;});
    built.dispose(); expect(sourceDisposed).toBe(false); expect(store.models.has('box')).toBe(true);
    geometry.dispose(); material.dispose();
  });

  it('culls small street props by distance and uses hysteresis to avoid flicker', () => {
    const data = index(), store = new CityAssetStore(data, () => {}), geometry = new T.BoxGeometry(1,1,1);
    const asset = new T.Group(); asset.add(new T.Mesh(geometry,new T.MeshStandardMaterial())); asset.updateWorldMatrix(true,true);
    data.models.prop={id:'prop',path:'environment/props/test.model',bounds:[[-.5,-.5,-.5],[.5,.5,.5]],triangles:12,streamFile:'',streamBytes:0};
    store.models.set('prop',asset);
    store.tiles.set('0:0',{...data.tiles.find(t=>t.id==='0:0')!,groups:[{id:'prop',matrices:[new T.Matrix4().toArray()],offsets:[0],variants:[0]}]});
    const built=buildCityBatches(store,['0:0']), batch=built.group.children[0] as T.BatchedMesh;
    built.updateDetails(new T.Vector3(0,0,200)); expect(batch.getVisibleAt(0)).toBe(false);
    built.updateDetails(new T.Vector3(0,0,180)); expect(batch.getVisibleAt(0)).toBe(false);
    built.updateDetails(new T.Vector3(0,0,160)); expect(batch.getVisibleAt(0)).toBe(true);
    built.updateDetails(new T.Vector3(0,0,180)); expect(batch.getVisibleAt(0)).toBe(true);
    built.dispose(); geometry.dispose();
  });

  it('switches between full and reduced geometry without rendering both levels', () => {
    const data=index(), store=new CityAssetStore(data,()=>{}), geometry=new T.BoxGeometry(2,4,6);
    const low=geometry.clone(); low.setIndex([0,1,2,2,1,3]); geometry.userData.farGeometry=low;
    const material=new T.MeshStandardMaterial(), asset=new T.Group(); asset.add(new T.Mesh(geometry,material)); asset.updateWorldMatrix(true,true);
    data.models.box={id:'box',path:'environment/building_kits/test.model',bounds:[[-1,-2,-3],[1,2,3]],triangles:12,streamFile:'',streamBytes:0};
    store.models.set('box',asset);
    store.tiles.set('0:0',{...data.tiles.find(t=>t.id==='0:0')!,groups:[{id:'box',matrices:[new T.Matrix4().toArray()],offsets:[0],variants:[0]}]});
    const built=buildCityBatches(store,['0:0']), batch=built.group.children[0] as T.BatchedMesh;
    built.updateDetails(new T.Vector3(0,0,100)); expect([batch.getVisibleAt(0),batch.getVisibleAt(1)]).toEqual([true,false]);
    built.updateDetails(new T.Vector3(0,0,250)); expect([batch.getVisibleAt(0),batch.getVisibleAt(1)]).toEqual([false,true]);
    built.updateDetails(new T.Vector3(0,0,200)); expect([batch.getVisibleAt(0),batch.getVisibleAt(1)]).toEqual([false,true]);
    built.updateDetails(new T.Vector3(0,0,180)); expect([batch.getVisibleAt(0),batch.getVisibleAt(1)]).toEqual([true,false]);
    built.dispose(); geometry.dispose(); low.dispose(); material.dispose();
  });
});
