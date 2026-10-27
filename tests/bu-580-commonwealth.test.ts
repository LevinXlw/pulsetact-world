import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3} from 'three';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_580_SECTION,bu580UpperFootprints} from '../src/features/world/bu-580-commonwealth';
import {buElevation} from '../src/features/world/bu-terrain';

const source=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-580')!;
const models=(['full','mobile'] as const).map(detail=>({detail,model:createBUFullCampus({buildingIds:new Set([source.id]),includeSpaces:false,signage:false,detail})}));
const base=buElevation(source.x,source.z);
afterAll(()=>{for(const {model} of models){const mats=new Set<import('three').Material>();model.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const mat of Array.isArray(o.material)?o.material:[o.material])mats.add(mat);}});mats.forEach(m=>m.dispose());}});

describe('580 Commonwealth source recovery',()=>{
  it('recovers the addressless surveyed footprint with verified BU identity, height and street position',()=>{
    expect(source.cityObjectId).toBe(1374);expect(source.footprint).toHaveLength(60);expect(source.universityOwned).toBe(true);
    expect(source.heightSource).toBe('official-bu');expect(source.height).toBeCloseTo(116*.3048,3);
    const questrom=BU_FULL_BUILDINGS.find(b=>b.id==='questrom')!;expect(source.z-questrom.z).toBeGreaterThan(70);expect(source.z-questrom.z).toBeLessThan(105);
    const adjacent=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-566')!;expect(adjacent.cityObjectId).toBe(1373);expect(adjacent.universityOwned).toBe(false);expect(adjacent.kind).toBe('context');
  });
  it('separates the ground curved shop, apartment bays and flattened top-floor plan',()=>{
    const {upper,top}=bu580UpperFootprints(source.footprint);
    expect(upper.length).toBeLessThan(source.footprint.length);expect(top.length).toBeLessThan(upper.length);
    expect(Math.min(...upper.map(p=>p[0]))).toBeGreaterThan(Math.min(...source.footprint.map(p=>p[0]))+1);
    expect(top).not.toContain(source.footprint[4]);expect(upper).toContain(source.footprint[4]);
  });
});

for(const {detail,model}of models)describe(`580 Commonwealth assembled geometry (${detail})`,()=>{
  const metadata=model.group.userData.commonwealth580;
  const meshes=model.group.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible);
  it('preserves ground collision, dedicated silhouette, warm material regions and finite budget',()=>{
    expect(model.group.userData.districtModels[0].family).toBe('580-commonwealth');expect(model.walls).toHaveLength(1);
    expect((model.walls[0].userData.campusFootprint as number[][]).map(p=>p.join(',')).sort()).toEqual(source.footprint.map(p=>p.join(',')).sort());
    const bounds=new Box3();meshes.forEach(m=>bounds.union(new Box3().setFromObject(m)));expect(bounds.max.y-base).toBeCloseTo(BU_580_SECTION.cornerTop,3);
    expect(meshes.some(m=>m.name.endsWith(':brick'))).toBe(true);expect(meshes.some(m=>m.name.endsWith(':stone'))).toBe(true);expect(meshes.some(m=>m.name.endsWith(':metal'))).toBe(true);
    expect(model.group.userData.districtModels[0].triangles).toBeLessThan(60000);
  });
  it('places recessed glazing inside an actual masonry aperture and closes each occupied floor',()=>{
    const f=metadata.facades.find((f:any)=>f.kind==='brick'&&f.windows.length>0),o=f.windows[0];
    const dx=f.b[0]-f.a[0],dz=f.b[1]-f.a[1],width=Math.hypot(dx,dz),nx=-dz/width,nz=dx/width;
    const x=(f.a[0]+f.b[0])/2+(o.x+.3)*dx/width,z=(f.a[1]+f.b[1])/2+(o.x+.3)*dz/width,y=base+f.bottom+o.bottom+o.height*.2;
    const ray=new Raycaster(new Vector3(x+nx*2,y,z+nz*2),new Vector3(-nx,0,-nz),0,3);
    const hit=ray.intersectObjects(meshes,false)[0];expect(hit.object.name).toMatch(/:frontageGlass$/);expect(hit.distance).toBeCloseTo(2+BU_580_SECTION.glassRecess,3);
    const floorRay=new Raycaster(new Vector3(x-nx*.75,base+f.bottom+2,z-nz*.75),new Vector3(0,-1,0),0,4);
    expect(floorRay.intersectObjects(meshes,false)[0].point.y-base).toBeCloseTo(f.bottom,3);
  });
});
