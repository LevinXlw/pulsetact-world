import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buElevation} from '../src/features/world/bu-terrain';
import {buBrownstoneEntry} from '../src/features/world/bu-brownstone-entry';

type Model=ReturnType<typeof createBUFullCampus>;
const models:Model[]=[];
function create(id:string,detail:'full'|'mobile'){
  const model=createBUFullCampus({buildingIds:new Set([id]),detail,includeSpaces:false,signage:false});
  model.group.updateMatrixWorld(true);models.push(model);return model;
}
function visible(model:Model){return model.group.children.filter((mesh):mesh is Mesh=>mesh instanceof Mesh&&mesh.visible);}
const house=BU_FULL_BUILDINGS.find(b=>b.id==='boston-12068')!,base=buElevation(house.x,house.z);
function northRay(model:Model,x:number,height:number){
  return new Raycaster(new Vector3(x,base+height,974),new Vector3(0,0,1),0,10).intersectObjects(visible(model),false)[0];
}
afterAll(()=>{
  for(const model of models){
    const materials=new Set<import('three').Material>();
    model.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
    for(const material of materials)material.dispose();model.group.clear();
  }
});

describe('Bay State mapped bows retain the envelope and gain continuous windows',()=>{
  it.each(['full','mobile'] as const)('shows three street-facing sash bays across short GIS facets in %s',detail=>{
    const model=create(house.id,detail);
    // 192 Bay State's curved north frontage consists of ~0.42 m survey
    // segments. The previous per-edge minimum erased every one of these panes.
    for(const x of [-834.2,-833,-831.6])for(const height of [1.8,5.85,10.05]){
      const hit=northRay(model,x,height);expect(hit,`${x},${height}`).toBeDefined();expect(hit.object.name).toMatch(/:glass$/);
    }
    for(const x of [-833.65,-832.15])expect(northRay(model,x,5.85).object.name).toMatch(/:brick$/);
    const window=northRay(model,-833,5.85),spandrel=northRay(model,-833,4.4);
    expect(spandrel.object.name).toMatch(/:brick$/);
    if(detail==='full')expect(window.distance-spandrel.distance).toBeCloseTo(.29,2);
    else expect(window.distance-spandrel.distance).toBeCloseTo(-.035,2);
    // A full doorway/interior is not punched through the physical envelope.
    const wallHit=new Raycaster(new Vector3(-833,base+5.85,974),new Vector3(0,0,1),0,10).intersectObjects(model.walls,false)[0];
    expect(wallHit).toBeDefined();expect(wallHit.point.z).toBeCloseTo(977.666,2);
  });

  it('joins the centre window across GIS vertices without duplicate jambs or gaps',()=>{
    const model=create(house.id,'full');let previous:number|undefined;
    // This sightline crosses several of the original curved survey edges
    // within one window. Only its two real ends should have vertical reveals.
    for(let x=-833.24;x<=-832.58;x+=.0125){
      const hit=northRay(model,x,5.85);expect(hit).toBeDefined();expect(hit.object.name).toMatch(/:glass$/);
      if(previous!==undefined)expect(Math.abs(hit.point.z-previous)).toBeLessThan(.015);previous=hit.point.z;
    }
  });

  it('closes the floor junction and faces both horizontal reveals into the window opening',()=>{
    const model=create(house.id,'full'),meshes=visible(model);
    // Sample within the recessed volume. Street-level oblique views must see
    // the sill from above and the head from below, not their culled back faces.
    for(const x of [-834.2,-833,-831.6]){
      const window=northRay(model,x,5.85),origin=new Vector3(x,base+5.85,window.point.z-.14);
      const sill=new Raycaster(origin,new Vector3(0,-1,0),0,1.5).intersectObjects(meshes,false)[0];
      const head=new Raycaster(origin,new Vector3(0,1,0),0,1.5).intersectObjects(meshes,false)[0];
      expect(sill,`sill ${x}`).toBeDefined();expect(head,`head ${x}`).toBeDefined();
      expect(sill.point.y-base).toBeCloseTo(4.80888,3);expect(sill.face!.normal.y).toBeGreaterThan(.99);
      expect(head.point.y-base).toBeCloseTo(6.92888,3);expect(head.face!.normal.y).toBeLessThan(-.99);
    }
    // The new upper envelope must start at the floor, not inherit the old
    // extruded facade's 16 cm plinth allowance without its closing geometry.
    for(const x of [-834.2,-833.65,-833,-832.15,-831.6])for(const y of [4.06,4.12,4.2]){
      const hit=northRay(model,x,y);expect(hit,`floor junction ${x},${y}`).toBeDefined();expect(hit.object.name).toMatch(/:brick$/);
      expect(hit.point.z).toBeLessThan(979);
    }
  });

  it.each(['full','mobile'] as const)('keeps GIS collision, road clearance and selected-house budget in %s',detail=>{
    const ids=['boston-12057','boston-12059','boston-12068','boston-12069'];
    for(const id of ids){
      const source=BU_FULL_BUILDINGS.find(b=>b.id===id)!,model=create(id,detail),wall=model.walls[0];
      expect(model.walls).toHaveLength(1);
      expect((wall.userData.campusFootprint as number[][]).map(point=>point.join(',')).sort()).toEqual(source.footprint.map(point=>point.join(',')).sort());
      const triangles=model.group.userData.districtModels[0].triangles;
      expect(triangles).toBeLessThan(detail==='mobile'?725:4200);
      for(const mesh of visible(model)){
        const geometry=mesh.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
        expect(geometry.getAttribute('campusBaseHeight').count).toBe(position.count);
        for(let i=0;i<position.count;i++)expect([position.getX(i),position.getY(i),position.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i)].every(Number.isFinite)).toBe(true);
      }
      const corridor=new Raycaster(new Vector3(-850,buElevation(-850,965)+1.2,965),new Vector3(1,0,0),0,80);
      expect(corridor.intersectObjects(model.walls,false)).toHaveLength(0);
    }
    // 195 has a three-sided polygonal bay, not the many-segment round bow.
    // Its existing facade is deliberately left alone in this scoped pass.
    const unchanged=create('boston-12069',detail);
    expect(unchanged.group.userData.districtModels[0].triangles).toBe(detail==='mobile'?518:3300);
  });

  it.each(['full','mobile'] as const)('uses the same model-door axis as the public entry paving in %s',detail=>{
    const source=BU_FULL_BUILDINGS.find(b=>b.id==='boston-12038')!,entry=buBrownstoneEntry(source.footprint,source.height)!;
    const model=create(source.id,detail),p=entry.front.p,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    const x=p.x+entry.doorX*c,z=p.z-entry.doorX*s,y=buElevation(source.x,source.z)+entry.rise+.8;
    const ray=new Raycaster(new Vector3(x+s*2,y,z+c*2),new Vector3(-s,0,-c),0,4);
    const hits=ray.intersectObjects(visible(model),false);
    // The existing central frame (or compact mobile door pane) may be in front
    // of the timber backing; both must still sit on the shared door axis.
    expect(hits[0].object.name).toMatch(/:(wood|frame|glassDark)$/);
    expect(hits.some(hit=>/:wood$/.test(hit.object.name))).toBe(true);
    expect(model.ground.length).toBeGreaterThan(0);
  });
});
