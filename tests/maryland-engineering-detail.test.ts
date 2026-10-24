import {Box3,Mesh,Raycaster,Vector3} from 'three';
import {describe,expect,it} from 'vitest';
import {createMarylandEngineeringDistrict,MARYLAND_ENGINEERING_DETAIL_IDS} from '../src/features/world/maryland-engineering-detail';
import {UMD_FULL_BUILDINGS} from '../src/features/world/maryland-full-layout';
import {marylandElevation} from '../src/features/world/maryland-terrain';

describe('UMD engineering architectural reconstruction',()=>{
  const scene=createMarylandEngineeringDistrict();
  it('uses one precise collision shell per replaced building, with no bounding-box courtyard infill',()=>{
    expect(scene.walls.filter(w=>w.userData.engineeringBuildingId)).toHaveLength(4);
    for(const id of MARYLAND_ENGINEERING_DETAIL_IDS){
      const building=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId===id)!;
      const wall=scene.walls.find(w=>w.userData.engineeringBuildingId===id)!;
      expect(wall).toBeDefined();
      const bounds=new Box3().setFromObject(wall),xs=building.footprint.map(p=>p[0]),zs=building.footprint.map(p=>p[1]);
      expect(bounds.min.x).toBeCloseTo(Math.min(...xs),3);expect(bounds.max.x).toBeCloseTo(Math.max(...xs),3);
      expect(bounds.min.z).toBeCloseTo(Math.min(...zs),3);expect(bounds.max.z).toBeCloseTo(Math.max(...zs),3);
      expect(bounds.min.y).toBeCloseTo(marylandElevation(building.x,building.z),3);
      expect(wall.userData.campusFootprint).toHaveLength(building.footprint.length);
    }
  });
  it('leaves the Kim plaza and Martin rear recess open to walk around their surveyed wings',()=>{
    for(const [id,u,v] of [['225',.72,.83],['088',.81,.20]] as const){
      const wall=scene.walls.find(w=>w.userData.engineeringBuildingId===id)!;
      const box=new Box3().setFromObject(wall),x=box.min.x+(box.max.x-box.min.x)*u,z=box.min.z+(box.max.z-box.min.z)*v;
      const ray=new Raycaster(new Vector3(x,box.max.y+10,z),new Vector3(0,-1,0));
      expect(ray.intersectObject(wall)).toHaveLength(0);
    }
  });
  it('builds finite batched geometry and removes distant fine detail without hiding massing',()=>{
    const meshes:Mesh[]=[];scene.group.traverse(o=>{if(o instanceof Mesh&&o.visible)meshes.push(o);});
    expect(meshes.length).toBeLessThan(80);
    for(const mesh of meshes){const positions=mesh.geometry.getAttribute('position');expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);}
    scene.setQuality(true);scene.update(new Vector3(-10000,200,10000));
    expect(meshes.filter(m=>m.name.endsWith(':detail')).every(m=>!m.visible)).toBe(true);
    expect(meshes.filter(m=>m.name.endsWith(':massing')).every(m=>m.visible)).toBe(true);
    expect(meshes.every(m=>!m.castShadow)).toBe(true);
    scene.setQuality(false);scene.update(new Vector3(450,20,-630));
    expect(meshes.filter(m=>m.name.endsWith(':detail')).some(m=>m.visible)).toBe(true);
  });
});
