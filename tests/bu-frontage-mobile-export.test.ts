import {readFileSync} from 'node:fs';
import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3,type Material} from 'three';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {BU_580_SECTION} from '../src/features/world/bu-580-commonwealth';
import {buElevation} from '../src/features/world/bu-terrain';

// Test the direct bake; mobile-campus-selected-base.test.ts also exercises the
// runtime MIT replacement selection. Dedicated model tests alone do
// not prevent a building from falling back to a generic box during the bake.
const bytes=readFileSync(new URL('../public/data/mobile/boston.glb',import.meta.url));
const baked=parseMobileCampus(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
baked.updateMatrixWorld(true);
const visible=baked.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible);
const full=createBUFullCampus({buildingIds:new Set(['commonwealth-580','commonwealth-566','commonwealth-560']),includeSpaces:false,signage:false});
afterAll(()=>{const materials=new Set<Material>();for(const group of [baked,full.group])group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());});

describe('shipped Questrom opposite frontage',()=>{
  it('keeps the separate low curved bank, its glazing and closed roof',()=>{
    const source=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-560')!,base=buElevation(source.x,source.z),metadata=full.group.userData.commonwealth560;
    const p=metadata.glazingProbes.find((p:any)=>p.kind==='curved-entry');
    const hit=new Raycaster(new Vector3(p.x+p.normal[0]*2,base+p.y,p.z+p.normal[1]*2),new Vector3(-p.normal[0],0,-p.normal[1]),0,3).intersectObjects(visible,false)[0];
    expect(hit).toBeDefined();expect(hit.object.name).toMatch(/frontageGlass/);expect(hit.distance).toBeCloseTo(2,2);
    const r=metadata.roofProbe,roof=new Raycaster(new Vector3(r.x,base+r.y+1,r.z),new Vector3(0,-1,0),0,2).intersectObjects(visible,false)[0];
    expect(roof).toBeDefined();expect(roof.point.y-base).toBeCloseTo(9.043,2);
  });
  it('retains 566 open balconies, recessed doors and occupied floors in the exported GLB',()=>{
    const source=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-566')!,base=buElevation(source.x,source.z),metadata=full.group.userData.commonwealth566;
    for(const index of [0,5,10]){
      const p=metadata.northBalconyProbes[index],floor=metadata.floorSlabProbes[index];
      const glass=new Raycaster(new Vector3(p.glassX+p.normal[0]*3,base+p.glassY,p.glassZ+p.normal[1]*3),new Vector3(-p.normal[0],0,-p.normal[1]),0,4).intersectObjects(visible,false)[0];
      expect(glass).toBeDefined();expect(glass.object.name).toMatch(/frontageGlass/);expect(glass.distance).toBeCloseTo(3,2);
      for(const q of [p,floor]){
        const hit=new Raycaster(new Vector3(q.x,base+q.y+1.6,q.z),new Vector3(0,-1,0),0,2).intersectObjects(visible,false)[0];
        expect(hit).toBeDefined();expect(hit.point.y-base).toBeCloseTo(q.y,2);
      }
    }
  });
  it('keeps the recessed 580 apartment aperture and structural floor in the exported GLB',()=>{
    const source=BU_FULL_BUILDINGS.find(b=>b.id==='commonwealth-580')!,base=buElevation(source.x,source.z);
    const f=full.group.userData.commonwealth580.facades.find((f:any)=>f.kind==='brick'&&f.windows.length>0),o=f.windows[0];
    const dx=f.b[0]-f.a[0],dz=f.b[1]-f.a[1],width=Math.hypot(dx,dz),nx=-dz/width,nz=dx/width;
    const x=(f.a[0]+f.b[0])/2+(o.x+.3)*dx/width,z=(f.a[1]+f.b[1])/2+(o.x+.3)*dz/width,y=base+f.bottom+o.bottom+o.height*.2;
    const pane=new Raycaster(new Vector3(x+nx*2,y,z+nz*2),new Vector3(-nx,0,-nz),0,3).intersectObjects(visible,false)[0];
    expect(pane).toBeDefined();expect(pane.object.name).toMatch(/frontageGlass/);expect(pane.distance).toBeCloseTo(2+BU_580_SECTION.glassRecess,2);
    const floor=new Raycaster(new Vector3(x-nx*.75,base+f.bottom+2,z-nz*.75),new Vector3(0,-1,0),0,4).intersectObjects(visible,false)[0];
    expect(floor).toBeDefined();expect(floor.point.y-base).toBeCloseTo(f.bottom,2);
  });
});
