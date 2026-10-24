import {describe,it,expect} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3} from 'three';
import {createMarylandBusinessDistrict} from '../src/features/world/maryland-business-detail';
import {UMD_FULL_BUILDINGS} from '../src/features/world/maryland-full-layout';

describe('Van Munching surveyed exterior',()=>{
  it('retains the open western court and batches finite visible geometry for Node construction',()=>{
    const district=createMarylandBusinessDistrict(),b=UMD_FULL_BUILDINGS.find(x=>x.sourceBuildingId==='039')!;
    const xs=b.footprint.map(p=>p[0]),zs=b.footprint.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    const courtyard=[minX+(maxX-minX)*.30,minZ+(maxZ-minZ)*.52];
    const collider=district.walls.find(m=>m.name.includes('concave'))!;
    const ray=new Raycaster(new Vector3(courtyard[0],200,courtyard[1]),new Vector3(0,-1,0));
    expect(ray.intersectObject(collider,false)).toHaveLength(0);
    expect(collider.userData.campusFootprint).toHaveLength(b.footprint.length);
    let meshes=0,finite=true;district.group.traverse(node=>{if(node instanceof Mesh&&node.visible){meshes++;const p=node.geometry.getAttribute('position');for(let i=0;i<p.count;i++)finite=finite&&Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i));}});
    expect(finite).toBe(true);expect(meshes).toBeLessThan(20);expect(district.ground.length).toBeGreaterThan(0);
    const bounds=new Box3().setFromObject(collider);expect(bounds.min.x).toBeCloseTo(minX,2);expect(bounds.max.x).toBeCloseTo(maxX,2);expect(bounds.min.z).toBeCloseTo(minZ,2);expect(bounds.max.z).toBeCloseTo(maxZ,2);
    district.setQuality(true);district.update(new Vector3(10000,100,10000));expect(district.group.children.some(c=>c instanceof Mesh&&c.name.endsWith(':frame')&&!c.visible)).toBe(true);
  });
});
