import {afterAll,describe,expect,it,vi} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {BU_LINK_COURT_DETAIL,createBULinkCourtDetail} from '../src/features/world/bu-link-court-detail';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_SERT_LINK_ENTRY,buSertLocal,buSertPoint} from '../src/features/world/bu-sert-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const full=createBULinkCourtDetail(),mobile=createBULinkCourtDetail({mobile:true});
const buildings=createBUFullCampus({buildingIds:new Set(['gsu-mugar']),includeSpaces:false,signage:false,detail:'mobile'});
const down=(x:number,z:number,meshes:Mesh[])=>{const p=buSertPoint(x,z);return new Raycaster(new Vector3(p[0],40,p[1]),new Vector3(0,-1,0),0,60).intersectObjects(meshes,false);};
afterAll(()=>{
  full.dispose();mobile.dispose();const materials=new Set<import('three').Material>();
  buildings.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());
});

describe('photo-led Link courtyard furniture',()=>{
  it('leaves the full 6.9m door corridor and existing arrival supported and unobstructed',()=>{
    const corridor=BU_LINK_COURT_DETAIL.corridor;
    for(let x=corridor.x-corridor.halfWidth;x<=corridor.x+corridor.halfWidth;x+=.23){
      for(let z=corridor.north;z<corridor.south;z+=.4){
        expect(down(x,z,full.ground),`new furniture enters corridor at ${x},${z}`).toHaveLength(0);
        expect(down(x,z,buildings.ground)[0]).toBeDefined();
      }
      const p=buSertPoint(x,corridor.south),q=buSertPoint(x,BU_SERT_LINK_ENTRY.local[1]+.1),delta=new Vector3(q[0]-p[0],0,q[1]-p[1]);
      for(const above of [.2,.9,1.6])expect(new Raycaster(new Vector3(p[0],buElevation(...p)+.155+above,p[1]),delta.clone().normalize(),0,delta.length()).intersectObjects(full.walls,false)).toHaveLength(0);
    }
    for(const tree of full.trees){const local=buSertLocal([tree.x,tree.z]);expect(Math.abs(local[0]-corridor.x)-tree.radius).toBeGreaterThan(corridor.halfWidth+.2);}
  });

  it('keeps furniture, planted soil and leaves outside the existing GSU/Mugar envelope',()=>{
    // Inspect actual new vertices against existing closed building geometry,
    // rather than relying on broad rectangular footprint bounds.
    for(const mesh of full.group.children as Mesh[]){
      const positions=mesh.geometry.getAttribute('position');
      for(let i=0;i<positions.count;i+=3){
        const x=positions.getX(i),z=positions.getZ(i),local=buSertLocal([x,z]);
        const obstruction=new Raycaster(new Vector3(x,40,z),new Vector3(0,-1,0),0,60).intersectObjects(buildings.walls,false)[0];
        expect(obstruction,`${mesh.name} inside building at ${local}`).toBeUndefined();
      }
    }
  });

  it('models seat slabs and separate feet on the DEM, without making a hidden solid bench block',()=>{
    for(const seat of full.group.userData.seats as {x:number;z:number;width:number;depth:number;top:number;bottom:number}[]){
      const hit=down(seat.x,seat.z,full.ground)[0];expect(hit.point.y).toBeCloseTo(seat.top,4);
      const p=buSertPoint(seat.x-.4,seat.z),q=buSertPoint(seat.x+.4,seat.z),direction=new Vector3(q[0]-p[0],0,q[1]-p[1]).normalize();
      const gapY=(buElevation(...buSertPoint(seat.x,seat.z))+.155+seat.bottom)/2;
      expect(new Raycaster(new Vector3(p[0],gapY,p[1]),direction,0,.8).intersectObjects(full.walls,false)).toHaveLength(0);
      const footZ=seat.z+seat.depth/2-.44,pFoot=buSertPoint(seat.x-.4,footZ);
      expect(new Raycaster(new Vector3(pFoot[0],gapY,pFoot[1]),direction,0,.8).intersectObjects(full.walls,false).length).toBeGreaterThan(0);
      expect(seat.top-buElevation(...buSertPoint(seat.x,seat.z))).toBeLessThan(.67);
    }
    const tree=full.trees[0];expect(tree.rootY).toBeCloseTo(buElevation(tree.x,tree.z)+.177,6);
    expect(down(BU_LINK_COURT_DETAIL.treePit.x,BU_LINK_COURT_DETAIL.treePit.z,full.ground)[0].point.y).toBeCloseTo(tree.rootY,3);
  });

  it('keeps phone sites and support geometry identical with only fewer shrub leaves',()=>{
    expect(mobile.trees).toEqual(full.trees);expect(mobile.ground).toHaveLength(3);expect(mobile.walls).toHaveLength(1);
    for(let i=0;i<full.ground.length;i++)expect([...full.ground[i].geometry.getAttribute('position').array]).toEqual([...mobile.ground[i].geometry.getAttribute('position').array]);
    expect(full.group.children).toHaveLength(5);expect(mobile.group.children).toHaveLength(5);
    expect(full.group.userData.triangles).toBeLessThan(2600);expect(mobile.group.userData.triangles).toBeLessThan(1600);
    for(const mesh of full.group.children as Mesh[]){expect(mesh.geometry.boundingBox).toBeDefined();expect([...mesh.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);}
    const once=createBULinkCourtDetail({mobile:true}),spies=(once.group.children as Mesh[]).map(mesh=>vi.spyOn(mesh.geometry,'dispose'));
    once.dispose();once.dispose();spies.forEach(spy=>expect(spy).toHaveBeenCalledTimes(1));
  });
});
