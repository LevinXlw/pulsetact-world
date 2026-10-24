import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {BU_CDS_MAP_FEATURE,BU_CDS_MODULE,BU_CDS_PLATE,BU_CDS_HEIGHT,BU_CDS_STACK,BU_CDS_YAW,BU_MARSH_ASSEMBLY} from '../src/features/world/bu-landmark-layout';
import {BU_BUILDING_ANCHORS,LANDMARKS} from '../src/features/world/charles-geography';
import {buElevation} from '../src/features/world/bu-terrain';

const campus=createBostonUniversity({wind:{value:0}});
afterAll(()=>campus.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}}));
describe('BU documented landmark envelopes',()=>{
  it('uses fixed structural plates and one-bay shifts while retaining the documented height',()=>{
    expect(BU_CDS_PLATE).toBeCloseTo(35.052,6);expect(BU_CDS_HEIGHT).toBeCloseTo(92.964,6);
    for(let i=1;i<BU_CDS_STACK.length;i++) {
      const a=BU_CDS_STACK[i-1],b=BU_CDS_STACK[i];
      expect(Math.hypot(b.x-a.x,b.z-a.z)).toBeCloseTo(BU_CDS_MODULE,6);
      expect(b.bottom).toBe(a.top);
    }
  });
  it('maps the two rendered ground blocks rather than filling their uncovered courtyard',()=>{
    const walls=campus.walls.filter(w=>w.name.startsWith('CDS ')&&!w.userData.foundationSkirt);expect(walls).toHaveLength(2);
    const inside=(x:number,z:number)=>{let yes=false;const ring=BU_CDS_MAP_FEATURE.footprint;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
    const ray=new Raycaster();
    for(let x=-24;x<58;x+=2.5)for(let z=-24;z<24;z+=2.5) {
      const wx=BU_CDS_MAP_FEATURE.x+x*Math.cos(BU_CDS_YAW)+z*Math.sin(BU_CDS_YAW),wz=BU_CDS_MAP_FEATURE.z-x*Math.sin(BU_CDS_YAW)+z*Math.cos(BU_CDS_YAW);
      ray.set(new Vector3(wx,20,wz),new Vector3(0,-1,0));
      expect(inside(wx,wz)).toBe(ray.intersectObjects(walls,false).length>0);
    }
  });
  it('keeps arrival points clear and the merged geometry within the mobile bake budget',()=>{
    const ray=new Raycaster();for(const id of ['buMarsh','buCDS','buQuestrom'] as const){const [x,z]=LANDMARKS[id];ray.set(new Vector3(x,200,z),new Vector3(0,-1,0));expect(ray.intersectObjects(campus.walls,false)).toHaveLength(0);}
    let triangles=0,meshes=0;campus.group.traverse(object=>{if(object instanceof Mesh&&object.visible){triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;meshes++;}});
    // Compound wings and street-level CDS glazing/DEM paving replace the old
    // incomplete envelope. CDS public-edge refinement adds fewer than 1k
    // triangles; integration also checks the complete mobile GLB byte budget.
    expect(triangles).toBeLessThan(111000);expect(meshes).toBeLessThanOrEqual(39);
  });
  it('has two genuinely recessed Marsh portals and a traversable stair approach',()=>{
    const [cx,cz]=BU_BUILDING_ANCHORS.marsh,c=Math.cos(-.145),s=Math.sin(-.145);
    const fit=BU_MARSH_ASSEMBLY.chapelFit,foundation=buElevation(...BU_MARSH_ASSEMBLY.foundationAnchor);
    const world=(x:number,y:number,z:number)=>{x=fit.x+x*fit.scaleX;z=fit.z+z*fit.scaleZ;return new Vector3(cx+x*c+z*s,foundation+y,cz-x*s+z*c);};
    const ray=new Raycaster(),visible:Mesh[]=[];campus.group.traverse(o=>{if(o instanceof Mesh&&o.visible)visible.push(o);});
    const depthAt=(x:number)=>{ray.set(world(x,2.8,30),new Vector3(-s,0,-c));const hit=ray.intersectObjects(visible,false)[0];expect(hit).toBeDefined();return (hit.point.x-cx)*s+(hit.point.z-cz)*c;};
    const pier=depthAt(0);for(const x of [-1.75,1.75])expect(pier-depthAt(x)).toBeGreaterThan(.28);
    const heights:number[]=[];
    for(let step=0;step<8;step++) {
      ray.set(world(1,50,24.55-step*.44),new Vector3(0,-1,0));
      const hit=ray.intersectObjects(campus.ground,false)[0];expect(hit).toBeDefined();heights.push(hit.point.y);
    }
    for(let i=1;i<heights.length;i++)expect(heights[i]-heights[i-1]).toBeCloseTo(.15,3);
    expect(heights.at(-1)).toBeCloseTo(foundation+1.2,3);
    // Side approaches follow the shared terrain, outside the rigid stair.
    const side=world(5.5,50,23);ray.set(side,new Vector3(0,-1,0));
    expect(ray.intersectObjects(campus.ground,false)[0].point.y).toBeCloseTo(buElevation(side.x,side.z)+.045,2);
  });
  it('restores the entire connected city9741 footprint without filling Marsh Plaza',()=>{
    const inside=(x:number,z:number)=>{let yes=false;const ring=BU_MARSH_ASSEMBLY.footprint;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
    const names=new Set(['Marsh Chapel · surveyed nave footprint',...BU_MARSH_ASSEMBLY.wings.map(w=>w.name)]);
    const walls=campus.walls.filter(w=>names.has(w.name));expect(walls).toHaveLength(5);
    const ray=new Raycaster(),occupied=(x:number,z:number)=>{ray.set(new Vector3(x,100,z),new Vector3(0,-1,0));return ray.intersectObjects(walls,false).length>0;};
    // Independent audit samples: the former blank CAS frontage and both links.
    for(const [x,z] of [[-1138.347,985.277],[-1160.484,963.853],[-1204.940,956.857]]){
      expect(inside(x,z)).toBe(true);expect(occupied(x,z)).toBe(true);
    }
    // Whole footprint, including concave returns: catches a bounding box or
    // accidental gaps in a partition even when the three audit points pass.
    for(let x=-1305.37;x<-1117;x+=3.7)for(let z=927.13;z<1002;z+=3.7)expect(occupied(x,z)).toBe(inside(x,z));
    const [cx,cz]=BU_BUILDING_ANCHORS.marsh,c=Math.cos(-.145),s=Math.sin(-.145);
    for(const [x,z] of [[-20,32],[0,36],[20,32],[0,48],[0,-18]]){
      const wx=cx+x*c+z*s,wz=cz-x*s+z*c;expect(inside(wx,wz)).toBe(false);expect(occupied(wx,wz)).toBe(false);
    }
    // The plaza now reaches the real side returns, not just a 48 m rectangle
    // with strips of underlying terrain between paving and the buildings.
    for(const [x,z] of [[-29,32],[25,32],[-20,20]]){
      ray.set(new Vector3(cx+x*c+z*s,100,cz-x*s+z*c),new Vector3(0,-1,0));
      expect(ray.intersectObjects(campus.ground,false)[0]?.object.name).toBe('BU ground · granite');
    }
    const east=BU_MARSH_ASSEMBLY.wings.find(w=>w.id==='cas-west')!;
    for(const point of [[-1120.444,976.936],[-1120.444,998.812]])expect(east.footprint.some(p=>Math.hypot(p[0]-point[0],p[1]-point[1])<1e-8)).toBe(true);
  });
  it('uses rigid sampled foundations and moves the memorial off the entrance axis',()=>{
    const foundation=buElevation(...BU_MARSH_ASSEMBLY.foundationAnchor);
    for(const wall of campus.walls.filter(w=>w.name.startsWith('Marsh ')||w.name.startsWith('School of Theology')||w.name.startsWith('CAS ·')))expect(wall.position.y).toBeCloseTo(foundation,5);
    const memorial=campus.walls.find(w=>w.name==='Free at Last memorial base')!;
    expect(BU_MARSH_ASSEMBLY.memorial.x).toBeLessThan(-10);
    expect(memorial.position.y-.43).toBeCloseTo(buElevation(memorial.position.x,memorial.position.z),5);
    campus.group.traverse(object=>{if(object instanceof Mesh&&object.visible){const geometry=object.geometry;expect(geometry.getAttribute('campusBaseHeight').count).toBe(geometry.getAttribute('position').count);}});
  });
  it('closes the north-side terrain gap with visible masonry and collision',()=>{
    // The surveyed north nave edge is well below the entrance foundation in
    // the real DEM. A ray below the old body base must hit the new foundation.
    const a=[-1185.374,929.589],b=[-1180.349,930.395];
    const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,base=buElevation(...BU_MARSH_ASSEMBLY.foundationAnchor);
    expect(base-buElevation(x,z)).toBeGreaterThan(.7);
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),outward=new Vector3((b[1]-a[1])/length,0,-(b[0]-a[0])/length);
    const origin=new Vector3(x,base-.4,z).addScaledVector(outward,2),ray=new Raycaster(origin,outward.clone().negate(),0,3);
    const collisions=ray.intersectObjects(campus.walls,false);
    expect(collisions[0]?.object.userData.foundationSkirt).toBe(true);
    const visible:Mesh[]=[];campus.group.traverse(o=>{if(o instanceof Mesh&&o.visible)visible.push(o);});
    const hit=ray.intersectObjects(visible,false)[0];expect(hit).toBeDefined();
    expect(hit.distance).toBeCloseTo(collisions[0].distance,2);
  });
});
