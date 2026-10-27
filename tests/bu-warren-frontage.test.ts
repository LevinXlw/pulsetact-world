import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const source=BU_FULL_BUILDINGS.find(b=>b.id==='warren-towers')!,base=buElevation(source.x,source.z);
const models=(['full','mobile'] as const).map(detail=>({detail,...createBUFullCampus({buildingIds:new Set(['warren-towers']),includeSpaces:false,signage:false,detail})}));
afterAll(()=>{for(const model of models){const materials=new Set<import('three').Material>();model.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const m of materials)m.dispose();}});

describe('Warren existing Commonwealth retail frontage',()=>{
  for(const model of models){
    const front=model.group.userData.warrenStreetfront as {p:{x:number;z:number;yaw:number};width:number;entryX:number;entryWidth:number;stores:{x:number;width:number}[]};
    const visible=model.group.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible);
    const point=(x:number,y:number,z:number)=>new Vector3(front.p.x+x*Math.cos(front.p.yaw)+z*Math.sin(front.p.yaw),base+y,front.p.z-x*Math.sin(front.p.yaw)+z*Math.cos(front.p.yaw));
    const hit=(x:number,y:number,meshes=visible)=>new Raycaster(point(x,y,4),point(x,y,-2).sub(point(x,y,4)).normalize(),0,6).intersectObjects(meshes,false)[0];
    it(`${model.detail}: opens a recessed two-storey entrance on the actual north facade`,()=>{
      expect(front.p.z).toBeLessThan(source.z);expect(front.width).toBeGreaterThan(160);
      // Between the leaf stiles, above the door transom, and beside the
      // opening: old parking ribbons or an uncut backing wall must not win.
      for(const y of [1.5,4.1,8.3]){
        const glass=hit(front.entryX+.61,y);
        expect(glass?.object.name).toMatch(/:frontageGlass$/);expect(glass.distance).toBeCloseTo(4.65,3);
      }
      const jamb=hit(front.entryX+front.entryWidth/2+.13,4.1);
      expect(jamb?.object.name).toMatch(/:stone$/);expect(jamb.distance).toBeLessThan(4);
      expect(hit(front.entryX+.61,1.5,model.walls)?.distance).toBeCloseTo(4,3);
      expect(model.walls).toHaveLength(1);
      expect([...model.walls[0].userData.campusFootprint].sort()).toEqual([...source.footprint].sort());
    });
    it(`${model.detail}: retains shop glazing below the curved shelter and a level supported threshold`,()=>{
      for(const shop of front.stores){
        const glazing=hit(shop.x+1.27,1.7);
        expect(glazing?.object.name).toMatch(/:frontageGlassDark$/);expect(glazing.distance).toBeCloseTo(4.43,3);
      }
      const entranceFloor=new Raycaster(point(front.entryX+.6,1,-.10),new Vector3(0,-1,0),0,2).intersectObjects(model.ground,false)[0];
      expect(entranceFloor?.point.y).toBeCloseTo(base+.2,3);
      const doorApproach=point(front.entryX,.9,1.2);
      expect(new Raycaster(doorApproach,new Vector3(0,1,0),0,2).intersectObjects(visible,false)).toHaveLength(0);
      const canopy=visible.find(m=>m.name.endsWith(':warrenCanopy'))!;
      expect(canopy).toBeDefined();
      const n=canopy.geometry.getAttribute('normal');
      for(let i=0;i<n.count;i++)expect(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))).toBeCloseTo(1,5);
      // The tall lobby stays clear of both rain-shelter wings.
      expect(new Raycaster(point(front.entryX,8,1.5),new Vector3(0,-1,0),0,7).intersectObject(canopy,false)).toHaveLength(0);
    });
  }
  it('keeps low detail bounded while preserving the same door and shop locations',()=>{
    const [full,mobile]=models;
    expect(mobile.group.userData.warrenStreetfront).toEqual(full.group.userData.warrenStreetfront);
    // The 2026-10-26 tower correction retains real recessed bands and
    // concrete shelves on mobile; only small sash sections become planes.
    expect(mobile.group.userData.districtModels[0].triangles).toBeLessThan(34000);
    expect(mobile.group.children.filter(o=>o.visible).length).toBeLessThanOrEqual(15);
  });
});
