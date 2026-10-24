import {afterAll,describe,expect,it,vi} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {createBUWarrenStreetscape,BU_WARREN_WALK_OFFSET,buWarrenWalkHeight} from '../src/features/world/bu-warren-streetscape';
import {BU_WARREN_ENTRY,BU_WARREN_FRONT,BU_WARREN_PAVING,BU_WARREN_PAVER_WIDTH,BU_WARREN_RETAINED_TREE_PITS,buWarrenPoint,buWarrenCoordinates,buWarrenCurbDepth} from '../src/features/world/bu-warren-streetscape-layout';
import {BU_ROAD_EDGES,buSegmentProjection} from '../src/features/world/bu-campus-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const scene=createBUWarrenStreetscape(),ray=new Raycaster();
const surface=(s:number,d:number)=>{const p=buWarrenPoint(s,d);ray.set(new Vector3(p[0],25,p[1]),new Vector3(0,-1,0));return ray.intersectObjects(scene.ground,false)[0];};
afterAll(()=>scene.dispose());
describe('Warren continuous Commonwealth sidewalk',()=>{
  it('ties the actual City north facade to each real street segment rather than clamping to one endpoint',()=>{
    expect(BU_WARREN_FRONT.length).toBeCloseTo(166.507,3);
    expect(BU_WARREN_PAVER_WIDTH).toBeCloseTo(.4064,6);
    // Cross the original nearest-segment endpoint failure, including 84..104 m
    // where the old infill degenerated to a fan and left grass beside the doors.
    for(let s=12;s<BU_WARREN_FRONT.length-12;s+=.61){
      const curb=buWarrenCurbDepth(s);expect(curb).toBeGreaterThan(6);expect(curb).toBeLessThan(9);
      for(const d of [2.7,curb-2.7]){
        const hit=surface(s,d);expect(hit,`Unpaved frontage s=${s} d=${d}`).toBeDefined();
        const p=buWarrenPoint(s,d);expect(hit.point.y).toBeCloseTo(buWarrenWalkHeight(...p),3);
        expect(hit.point.y-buElevation(...p)).toBeGreaterThan(.112);
      }
      expect(surface(s,curb+.4),`Paving covers the carriageway at ${s}`).toBeUndefined();
    }
  });

  it('joins the original level threshold continuously without changing facade/collider placement',()=>{
    const building=createBUFullCampus({buildingIds:new Set(['warren-towers']),includeSpaces:false,signage:false,detail:'mobile'});
    const front=building.group.userData.warrenStreetfront;
    const doorway=[front.p.x+front.entryX*Math.cos(front.p.yaw),front.p.z-front.entryX*Math.sin(front.p.yaw)];
    const expected=buWarrenPoint(BU_WARREN_ENTRY.along,0);
    expect(doorway[0]).toBeCloseTo(expected[0],3);expect(doorway[1]).toBeCloseTo(expected[1],3);
    expect(front.entryWidth).toBe(BU_WARREN_ENTRY.width);expect(building.walls).toHaveLength(1);
    const allGround=[...building.ground,...scene.ground],entry=BU_WARREN_ENTRY;
    for(const x of [-5,-2,0,2,5]){
      let previous:number|undefined;
      for(let d=-.15;d<4;d+=.055){
        const p=buWarrenPoint(entry.along+x,d);ray.set(new Vector3(p[0],12,p[1]),new Vector3(0,-1,0));
        const hit=ray.intersectObjects(allGround,false)[0];expect(hit,`Unsupported door approach at ${x},${d}`).toBeDefined();
        if(previous!==undefined)expect(Math.abs(hit.point.y-previous)).toBeLessThan(.012);previous=hit.point.y;
      }
    }
    expect(surface(entry.along,entry.thresholdDepth+.002)?.point.y).toBeCloseTo(buElevation(...BU_WARREN_FRONT.buildingAnchor)+.2,3);
    const materials=new Set<import('three').Material>();building.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());
  });

  it('retains all four existing tree pits and keeps side-street carriageways uncovered',()=>{
    expect(scene.trees).toHaveLength(0);expect(scene.walls).toHaveLength(0);
    for(const p of BU_WARREN_RETAINED_TREE_PITS){
      const c=buWarrenCoordinates(...p);expect(Math.abs(c.along-BU_WARREN_ENTRY.along)).toBeGreaterThan(10);
      for(const dx of [-.92,0,.92])for(const dz of [-.92,0,.92]){
        ray.set(new Vector3(p[0]+dx,25,p[1]+dz),new Vector3(0,-1,0));expect(ray.intersectObjects(scene.ground,false)).toHaveLength(0);
      }
    }
    // Every actual polygon vertex, including the corners of clipping fragments,
    // must remain outside the Cummington/Hinsdale carriageway masks.
    const sideRoads=BU_ROAD_EDGES.filter(e=>e.road.name!=='COMMONWEALTH AVENUE');
    for(const patch of BU_WARREN_PAVING)for(const p of patch.points){
      for(const edge of sideRoads){
        const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz);
        const along=((p[0]-edge.a[0])*dx+(p[1]-edge.a[1])*dz)/length;
        // Existing road strips have square ends, not capsule end caps.
        if(along>0&&along<length)expect(buSegmentProjection(...p,edge.a,edge.b).distance).toBeGreaterThanOrEqual(edge.road.width/2+.0249);
      }
    }
  });

  it('keeps both quality levels small, gives upward ground normals, and disposes once',()=>{
    const mobile=createBUWarrenStreetscape({mobile:true});let triangles=0;
    expect(scene.ground).toHaveLength(2);expect(mobile.ground).toHaveLength(4);
    const pavers=scene.ground[1].material as import('three').Material;
    expect(pavers.name).toBe('pavingBrick'); // Mobile HD matcher uses this name.
    expect(pavers.customProgramCacheKey()).toContain('surface-paving-bu');
    expect(pavers.customProgramCacheKey()).toContain('-brick-'); // XZ paving, not vertical wall bond.
    for(let index=0;index<mobile.ground.length;index++){
      const mesh=mobile.ground[index],g=mesh.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal');
      triangles+=p.count/3;expect([...p.array].every(Number.isFinite)).toBe(true);
      if(index<2){
        expect([...p.array]).toEqual([...scene.ground[index].geometry.getAttribute('position').array]);
        for(let i=0;i<n.count;i++)expect(n.getY(i)).toBeGreaterThan(.97);
      }
      expect(mesh.userData.buGround).toBe(true);expect(mesh.userData.mobileGround).toBe(true);
    }
    expect(triangles).toBeLessThan(4500);expect(BU_WARREN_WALK_OFFSET).toBeGreaterThan(.105);
    const spies=mobile.ground.map(m=>vi.spyOn(m.geometry,'dispose'));mobile.dispose();mobile.dispose();spies.forEach(s=>expect(s).toHaveBeenCalledTimes(1));
  });
  it('restores only the four mobile tree pits, below a safe low rim and above the old sidewalk',()=>{
    const mobile=createBUWarrenStreetscape({mobile:true});
    expect(mobile.group.userData.warrenTreePits.count).toBe(4);expect(scene.group.userData.warrenTreePits.count).toBe(0);
    expect(mobile.walls).toHaveLength(0);expect(mobile.trees).toHaveLength(0);
    for(const [x,z] of BU_WARREN_RETAINED_TREE_PITS){
      for(const [dx,dz,top,name] of [[0,0,.112,'soil'],[.9,0,.15,'granite'],[-.9,0,.15,'granite'],[0,.9,.15,'granite'],[0,-.9,.15,'granite']] as const){
        ray.set(new Vector3(x+dx,25,z+dz),new Vector3(0,-1,0));const hit=ray.intersectObjects(mobile.ground,false)[0];
        expect(hit?.object.name).toBe(`BU Warren tree pits · ${name}`);
        expect(hit.point.y-buElevation(x+dx,z+dz)).toBeCloseTo(top,3);
      }
    }
    // Added low frames cannot silently spread along the rest of the frontage.
    for(const mesh of mobile.ground.slice(2)){
      const p=mesh.geometry.getAttribute('position');
      for(let i=0;i<p.count;i++)expect(BU_WARREN_RETAINED_TREE_PITS.some(([x,z])=>Math.abs(p.getX(i)-x)<.966&&Math.abs(p.getZ(i)-z)<.966)).toBe(true);
    }
    mobile.dispose();
  });
});
