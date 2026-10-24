import {describe,it,expect} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {ARIZONA_BUILDINGS} from '../src/features/world/arizona-geography';
import {ARIZONA_LANDMARK_IDS,createArizonaLandmarks} from '../src/features/world/arizona-landmarks';

describe('Arizona surveyed landmark exteriors',()=>{
  const model=createArizonaLandmarks();
  it('keeps all ENR2 ground wings and its central canyon open',()=>{
    const wings=ARIZONA_BUILDINGS.filter(b=>b.sourceId==='137');
    expect(wings).toHaveLength(5);
    expect(wings.every(b=>ARIZONA_LANDMARK_IDS.has(b.id))).toBe(true);
    expect(model.walls.filter(m=>m.name.startsWith('ENR2 surveyed curved wing'))).toHaveLength(wings.length);
    const center=model.group.userData.enr2Canyon.center as [number,number];
    const ray=new Raycaster(new Vector3(center[0],200,center[1]),new Vector3(0,-1,0));
    expect(ray.intersectObjects(model.walls,false)).toHaveLength(0);
  });
  it('uses Old Main’s actual cross-shaped body with a separate walkable veranda',()=>{
    const old=ARIZONA_BUILDINGS.find(b=>b.id==='arizona-old-main-building')!;
    const wall=model.walls.find(m=>m.name==='Old Main enclosed brick rooms')!;
    expect(wall.userData.campusFootprint).toHaveLength(old.footprint.length);
    expect(model.group.userData.oldMainVeranda.floorHeight).toBeGreaterThan(2);
    expect(model.ground.some(m=>m.name.startsWith(old.id))).toBe(true);
  });
  it('constructs finite batched meshes without browser APIs and culls fine detail',()=>{
    let count=0,finite=true;
    model.group.traverse(object=>{if(!(object instanceof Mesh)||!object.visible)return;count++;const positions=object.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)finite=finite&&Number.isFinite(positions.getX(i))&&Number.isFinite(positions.getY(i))&&Number.isFinite(positions.getZ(i));});
    expect(finite).toBe(true);expect(count).toBeLessThan(60);
    model.setQuality(true);model.update(new Vector3(10000,200,10000));
    expect(model.group.children.some(m=>m.name.includes(':detail:')&&!m.visible)).toBe(true);
  },15000);
});
