import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS,BU_FULL_SPACES} from '../src/features/world/bu-full-layout';
import {buElevation,buDEMWeight} from '../src/features/world/bu-terrain';
import {BU_SERT_FOUNDATION_ANCHOR,BU_SERT_PARTS,BU_SERT_PUBLIC_PASSAGES,buSertPoint,buSertLocal} from '../src/features/world/bu-sert-layout';

const mobileIds=new Set(['warren-services','warren-towers','stuvi-one','stuvi-south-tower','stuvi-north-tower','stuvi-north-core','stuvi-north-connectors','law-tower']);
type Campus=ReturnType<typeof createBUFullCampus>;
const created:Campus[]=[];
function build(ids:ReadonlySet<string>,detail:'full'|'mobile'='full'){
  const model=createBUFullCampus({buildingIds:ids,includeSpaces:false,signage:false,detail});created.push(model);return model;
}
function visible(model:Campus){return model.group.children.filter((child):child is Mesh=>child instanceof Mesh&&child.visible);}
function roofAt(model:Campus,x:number,z:number){
  return new Raycaster(new Vector3(x,220,z),new Vector3(0,-1,0),0,250).intersectObjects(visible(model),false)[0]?.point.y;
}
afterAll(()=>{
  for(const model of created){
    const materials=new Set<import('three').Material>();
    model.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
    for(const material of materials)material.dispose();model.group.clear();
  }
});

describe('BU district architecture preserves actual envelopes',()=>{
  let mobile:Campus;
  beforeAll(()=>{mobile=build(mobileIds,'mobile');});
  it('bakes the major tower skyline within a bounded mobile geometry budget',()=>{
    let triangles=0;
    for(const mesh of visible(mobile)){
      const position=mesh.geometry.getAttribute('position');triangles+=(mesh.geometry.index?.count??position.count)/3;
      for(let index=0;index<position.count;index++){
        expect(Number.isFinite(position.getX(index))&&Number.isFinite(position.getY(index))&&Number.isFinite(position.getZ(index))).toBe(true);
      }
      expect(mesh.geometry.boundingSphere?.radius).toBeGreaterThan(0);
    }
    // Warren now preserves its narrow-end/long-side real openings in the
    // offline mobile export; allow their recorded ~15.6k triangle increase.
    expect(triangles).toBeGreaterThan(35000);expect(triangles).toBeLessThan(82000);
    expect(mobile.walls).toHaveLength(mobileIds.size);
    expect(mobile.group.userData.districtModels.map((model:{id:string})=>model.id).sort()).toEqual([...mobileIds].sort());
  });
  it('keeps collision on the exact GIS footprint and at the existing terrain datum',()=>{
    for(const id of mobileIds){
      const source=BU_FULL_BUILDINGS.find(building=>building.id===id)!;
      const wall=mobile.walls.find(wall=>wall.name===source.name)!;
      const actual=(wall.userData.campusFootprint as [number,number][]).map(point=>point.join(',')).sort();
      const expected=source.footprint.map(point=>point.join(',')).sort();
      expect(actual).toEqual(expected);
      const bounds=new Box3().setFromObject(wall),datum=id==='law-tower'?buElevation(...BU_SERT_FOUNDATION_ANCHOR):buElevation(source.x,source.z);
      if(buDEMWeight(source.x,source.z)>0||source.footprint.some(p=>buDEMWeight(...p)>0))expect(bounds.min.y).toBeLessThanOrEqual(Math.min(datum-.14,...source.footprint.map(p=>buElevation(...p)-.29)));
      else expect(bounds.min.y).toBeCloseTo(datum,3);
      expect(bounds.max.y).toBeCloseTo(datum+source.height,3);
    }
  });
  it('closes DEM-edge foundations even when the building centre is outside the survey core',()=>{
    const buildings=build(new Set(['warren-towers','boston-11622','danielsen-hall']),'mobile');
    buildings.group.updateMatrixWorld(true);
    for(const id of ['warren-towers','boston-11622']){
      const source=BU_FULL_BUILDINGS.find(b=>b.id===id)!,base=buElevation(source.x,source.z);
      expect(buDEMWeight(source.x,source.z)).toBe(0);
      // Check the actual north wall below the rigid floor, where the previous
      // centre-only gate left a 16–20 cm gap. Both visible and collision walls
      // must now close it; roof levels and the GIS envelope stay unchanged.
      const edge=source.footprint.map((a,i)=>{const b=source.footprint[(i+1)%source.footprint.length];return{a,b,x:(a[0]+b[0])/2,z:(a[1]+b[1])/2};}).sort((a,b)=>buElevation(a.x,a.z)-buElevation(b.x,b.z))[0];
      const y=(base+buElevation(edge.x,edge.z))/2,dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz);
      expect(base-y).toBeGreaterThan(.05);
      const hit=(meshes:Mesh[])=>[-1,1].some(side=>new Raycaster(new Vector3(edge.x+dz/length*side,y,edge.z-dx/length*side),new Vector3(-dz/length*side,0,dx/length*side),0,2).intersectObjects(meshes,false).length>0);
      const wall=buildings.walls.find(w=>w.name===source.name)!;
      expect(hit(visible(buildings))).toBe(true);expect(hit([wall])).toBe(true);
      expect(new Box3().setFromObject(wall).max.y).toBeCloseTo(base+source.height,3);
    }
    const unaffected=BU_FULL_BUILDINGS.find(b=>b.id==='danielsen-hall')!,wall=buildings.walls.find(w=>w.name===unaffected.name)!;
    expect(unaffected.footprint.every(p=>buDEMWeight(...p)===0)).toBe(true);
    expect(new Box3().setFromObject(wall).min.y).toBeCloseTo(buElevation(unaffected.x,unaffected.z),3);
  });
  it('retains three high Warren towers and low visible gaps above the shared podium',()=>{
    const warren=build(new Set(['warren-towers']),'mobile');
    const source=BU_FULL_BUILDINGS.find(building=>building.id==='warren-towers')!,datum=buElevation(source.x,source.z);
    const point=(x:number)=>[source.x+x*Math.cos(source.yaw),source.z-x*Math.sin(source.yaw)];
    // Roof-plan trace: A/B/C run east to west; the western terrace means the
    // three towers are not centred symmetrically on the entire podium.
    for(const fraction of [-.210,.065,.340]){
      const [x,z]=point(source.width*fraction),height=roofAt(warren,x,z);
      expect(height).toBeDefined();expect(height!-datum).toBeGreaterThan(59);
    }
    for(const fraction of [-.0725,.2025]){
      const [x,z]=point(source.width*fraction),height=roofAt(warren,x,z);
      expect(height).toBeDefined();expect(height!-datum).toBeGreaterThan(13);expect(height!-datum).toBeLessThan(16);
    }
  });
  it('renders Warren service parking as a low garage rather than three extra towers',()=>{
    const service=build(new Set(['warren-services']));
    const source=BU_FULL_BUILDINGS.find(building=>building.id==='warren-services')!,datum=buElevation(source.x,source.z);
    const box=new Box3();for(const mesh of visible(service))box.expandByObject(mesh);
    expect(box.max.y-datum).toBeLessThan(11.3);
    expect(service.ground).toHaveLength(0);
    // Open slots between the floor edges have deep dark backing, not dormitory
    // glass. An exterior sightline sees through the outer column plane.
    expect(visible(service).some(mesh=>mesh.name.endsWith(':shade'))).toBe(true);
    expect(visible(service).some(mesh=>mesh.name.endsWith(':glass'))).toBe(false);
  });
  it('does not add sports grounds or unrelated blocks to a selected offline bake',()=>{
    const empty=build(new Set());expect(empty.group.children).toHaveLength(0);expect(empty.walls).toHaveLength(0);expect(empty.ground).toHaveLength(0);
  });
  it.each(['full','mobile'] as const)('gives Law real facade depth, solid core returns and a closed crown in %s',detail=>{
    const law=build(new Set(['law-tower']),detail),meshes=visible(law),datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    const source=BU_FULL_BUILDINGS.find(building=>building.id==='law-tower')!;
    const hit=(x:number,z:number,y:number,towardZ:number)=>{
      const a=buSertPoint(x,z),b=buSertPoint(x,towardZ);
      return new Raycaster(new Vector3(a[0],datum+y,a[1]),new Vector3(b[0]-a[0],0,b[1]-a[1]).normalize(),0,10).intersectObjects(meshes,false)[0];
    };
    const crown=hit(87.2,46,76,35),window=hit(87.2,46,47,35),intermediate=hit(87.2,46,24,35),core=hit(80,42,45,32);
    expect(crown.object.name).toMatch(/:concrete$/);
    expect(window.object.name).toMatch(/:glass$/);
    expect(intermediate.object.name).toMatch(/:concrete$/);
    expect(core.object.name).toMatch(/:concrete$/);
    expect(crown.distance-window.distance).toBeLessThan(-.5);
    // The north end retains glazing in the intermediate zone; do not mirror
    // the solid southern panel onto every side of the tower again.
    expect(hit(87.2,-5,24,5).object.name).toMatch(/:glass$/);
    const bounds=new Box3();for(const mesh of meshes)bounds.expandByObject(mesh);
    expect(bounds.max.y-datum).toBeCloseTo(source.height,3);
    const triangles=law.group.userData.districtModels[0].triangles;
    expect(triangles).toBeLessThan(detail==='mobile'?7000:8000);
  });
  it.each(['full','mobile'] as const)('places the Butler doorway behind its header and beside the existing curtain glass in %s',detail=>{
    const sert=build(new Set(['gsu-mugar']),detail),meshes=visible(sert),datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    const hit=(x:number,y:number)=>{
      const a=buSertPoint(x,56),b=buSertPoint(x,50);
      return new Raycaster(new Vector3(a[0],datum+y,a[1]),new Vector3(b[0]-a[0],0,b[1]-a[1]).normalize(),0,6).intersectObjects(meshes,false)[0];
    };
    const door=hit(87.45,1.5),neighbor=hit(90,1.5),header=hit(87.45,3.25);
    expect(door.object.name).toMatch(/:glassDark$/);
    expect(neighbor.object.name).toMatch(/:glass$/);
    expect(header.object.name).toMatch(/:frame$/);
    expect(door.distance-neighbor.distance).toBeGreaterThan(.3);
    expect(door.distance-header.distance).toBeGreaterThan(.45);
    expect(buSertLocal([door.point.x,door.point.z])[1]).toBeCloseTo(52.38,2);
    // Keep the new visual door on the reviewed atrium envelope; this remains
    // a closed exterior entrance, not an accidental route into empty geometry.
    const wall=sert.walls.find(mesh=>mesh.name==='Robert T. Butler Atrium')!;
    const bounds=new Box3().setFromObject(wall);
    expect(bounds.max.y-datum).toBeCloseTo(10.8,3);
  });
  it('splits the Sert assembly into low connectors, stepped Mugar and the later Redstone addition',()=>{
    const sert=build(new Set(['gsu-mugar']),'mobile'),datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    const top=(x:number,z:number)=>roofAt(sert,...buSertPoint(x,z))!-datum;
    for(const [x,z,height] of [[-12,70,7.4],[9,42,21.7],[22,42,18.3],[31,42,15],[41,42,11.7],[60,47,29.8704],[60,61,23.1648],[87,48,10.8]])expect(top(x,z)).toBeCloseTo(height,2);
    expect(sert.walls).toHaveLength(BU_SERT_PARTS.length);
    // No 17.92 m shell may remain across the low Link or historic courtyard.
    expect(sert.walls.some(wall=>wall.name==='George Sherman Union / Mugar Memorial Library')).toBe(false);
    let triangles=0;for(const mesh of visible(sert))triangles+=(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3;
    // Photo-calibrated Mugar/GSU retain real recessed openings on mobile;
    // the recorded assembly is 24,118 triangles (previously 22,702).
    expect(triangles).toBeLessThan(25000);
  });
  it('keeps the Law–Mugar public paths open while the Pappas third-floor bridge spans overhead',()=>{
    const sert=build(new Set(['gsu-mugar','law-tower']),'mobile'),datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    for(const route of BU_SERT_PUBLIC_PASSAGES)for(let i=0;i<route.points.length-1;i++){
      const a=route.points[i],b=route.points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],distance=Math.hypot(dx,dz);
      for(const lateral of [-.7,0,.7]){
        const ray=new Raycaster(new Vector3(a[0]+dz/distance*lateral,datum+1.2,a[1]-dx/distance*lateral),new Vector3(dx/distance,0,dz/distance),.05,distance-.05);
        expect(ray.intersectObjects(sert.walls,false)).toHaveLength(0);
      }
    }
    const [x,z]=buSertPoint(100.4,35),ray=new Raycaster(new Vector3(x,datum+1.2,z),new Vector3(0,1,0),0,20);
    const overhead=ray.intersectObjects(sert.walls,false)[0];expect(overhead).toBeDefined();expect(overhead.point.y-datum).toBeCloseTo(8.8,3);
  });
  it('gives Pappas four separate north-light roof vaults and drapes only the public paving',()=>{
    const sert=build(new Set(['gsu-mugar']),'mobile'),datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    for(let row=0;row<4;row++){
      const peak=roofAt(sert,...buSertPoint(114,24.4+row*8.65))!-datum;
      const trough=roofAt(sert,...buSertPoint(114,32.2+row*8.65))!-datum;
      expect(peak).toBeGreaterThan(16.4);expect(trough).toBeLessThan(15.2);
    }
    const [x,z]=buSertPoint(60,71),hits=new Raycaster(new Vector3(x,100,z),new Vector3(0,-1,0)).intersectObjects(sert.ground,false);
    expect(hits[0].point.y).toBeCloseTo(buElevation(x,z)+.16,2);
  });
  it('anchors southern entrances to their grade and closes exposed riverside basements',()=>{
    const sert=build(new Set(['gsu-mugar','law-tower']),'mobile'),datum=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    expect(Math.abs(datum-buElevation(...buSertPoint(-52,98.2)))).toBeLessThan(.2);
    for(const [x,z] of [[-50,29],[22,-4],[89,-4]]){
      const a=buSertPoint(x,z),b=buSertPoint(x,z+10),y=datum-.6;
      expect(y).toBeGreaterThan(buElevation(...a)+.1);
      const direction=new Vector3(b[0]-a[0],0,b[1]-a[1]).normalize(),ray=new Raycaster(new Vector3(a[0],y,a[1]),direction,0,10);
      expect(ray.intersectObjects(visible(sert),false).length).toBeGreaterThan(0);
      expect(ray.intersectObjects(sert.walls,false).length).toBeGreaterThan(0);
    }
    let previous=-Infinity;
    for(let z=67;z>=53.1;z-=1){
      const [x,wz]=buSertPoint(87,z),ray=new Raycaster(new Vector3(x,100,wz),new Vector3(0,-1,0));
      const height=ray.intersectObjects(sert.ground,false)[0].point.y;
      expect(height).toBeGreaterThanOrEqual(previous-.001);expect(height-buElevation(x,wz)).toBeGreaterThan(.1);
      if(Number.isFinite(previous))expect(height-previous).toBeLessThan(.2);previous=height;
    }
  });
  it('keeps brownstone masonry frames finite and the selected mobile neighborhood compact',()=>{
    const ids=new Set(['boston-883','boston-1843','boston-12058','boston-12069','boston-12068']);
    const houses=build(ids,'mobile');let triangles=0;
    for(const mesh of visible(houses)){
      const geometry=mesh.geometry,position=geometry.getAttribute('position'),datum=geometry.getAttribute('campusBaseHeight'),yaw=geometry.getAttribute('campusYaw');
      expect(datum.count).toBe(position.count);expect(yaw.count).toBe(position.count);
      triangles+=position.count/3;
      for(let index=0;index<position.count;index++)expect(Number.isFinite(datum.getX(index))&&Number.isFinite(yaw.getX(index))).toBe(true);
    }
    expect(triangles).toBeLessThan(5000);
    expect(houses.walls).toHaveLength(ids.size);
    for(const wall of houses.walls){
      const source=BU_FULL_BUILDINGS.find(building=>building.name===wall.name)!;
      expect((wall.userData.campusFootprint as number[][]).map(point=>point.join(',')).sort()).toEqual(source.footprint.map(point=>point.join(',')).sort());
    }
    // Fine foliage/fences are excluded from phone geometry, while the actual
    // timber entrances and contrasting masonry remain present.
    expect(visible(houses).some(mesh=>mesh.name.endsWith(':wood'))).toBe(true);
    expect(visible(houses).some(mesh=>mesh.name.includes(':hedge'))).toBe(false);
  });
  it('keeps Nickerson paint above its turf and terrain across the whole pitch',()=>{
    const sports=createBUFullCampus({buildingIds:new Set(),signage:false});created.push(sports);
    const field=BU_FULL_SPACES.find(space=>/Nickerson/i.test(space.name))!;
    const yaw=field.yaw+(field.width<field.depth?Math.PI/2:0);
    const paint=sports.ground.filter(mesh=>mesh.name.endsWith(':white'));
    const turf=sports.ground.filter(mesh=>mesh.name.endsWith(':turf'));
    for(const [dx,dz] of [[0,0],[0,-24],[0,24],[-53.0352,0],[53.0352,0]]){
      const x=field.x+dx*Math.cos(yaw)+dz*Math.sin(yaw),z=field.z-dx*Math.sin(yaw)+dz*Math.cos(yaw);
      const ray=new Raycaster(new Vector3(x,100,z),new Vector3(0,-1,0));
      const white=ray.intersectObjects(paint,false)[0],grass=ray.intersectObjects(turf,false)[0];
      expect(white).toBeDefined();expect(grass).toBeDefined();
      expect(white.point.y-grass.point.y).toBeCloseTo(.013,3);
      expect(grass.point.y).toBeCloseTo(buElevation(x,z)+.095,2);
    }
    for(const mesh of paint){
      const material=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
      expect(material.userData.buGroundLayer).toBe('marking');expect(material.depthTest).toBe(true);expect(material.depthWrite).toBe(true);
    }
    for(const mesh of turf){
      const material=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
      expect(material.userData.buGroundLayer).toBe('surface');expect(material.polygonOffset).toBe(false);
    }
  });
});
