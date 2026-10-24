import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,MeshStandardMaterial,Raycaster,Vector3} from 'three';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {BU_MARSH_ASSEMBLY} from '../src/features/world/bu-landmark-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const campus=createBostonUniversity({wind:{value:0}}),visible:Mesh[]=[];
campus.group.traverse(object=>{if(object instanceof Mesh&&object.visible)visible.push(object);});
afterAll(()=>campus.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}}));

describe('Marsh photographed facade hierarchy',()=>{
  const assembly=BU_MARSH_ASSEMBLY,fit=assembly.chapelFit,c=Math.cos(assembly.yaw),s=Math.sin(assembly.yaw);
  const base=buElevation(...assembly.foundationAnchor);
  const frontHit=(x:number,y:number)=>{
    const lx=fit.x+x*fit.scaleX,lz=fit.z+30*fit.scaleZ;
    const ray=new Raycaster(new Vector3(assembly.anchor[0]+lx*c+lz*s,base+y,assembly.anchor[1]-lx*s+lz*c),new Vector3(-s,0,-c));
    const hit=ray.intersectObjects(visible,false)[0];expect(hit).toBeDefined();
    return {hit,depth:(hit.point.x-assembly.anchor[0])*s+(hit.point.z-assembly.anchor[1])*c};
  };

  it('frames narrow, dark glazing with a stone niche instead of a full-width blue window',()=>{
    const outer=frontHit(5.2,14),niche=frontHit(3.1,14),glass=frontHit(.22,14);
    expect(outer.hit.object.name).toBe('BU architecture · stone');
    expect(niche.hit.object.name).toBe('BU architecture · stone');
    expect(glass.hit.object.name).toBe('BU architecture · glassStained');
    expect(outer.depth-niche.depth).toBeGreaterThan(.35);
    expect(niche.depth-glass.depth).toBeGreaterThan(.10);
    expect(frontHit(-3.1,14).hit.object.name).toBe('BU architecture · stone');
    const material=(glass.hit.object as Mesh).material as MeshStandardMaterial;
    expect(material.emissiveIntensity).toBe(0);expect(material.metalness).toBe(0);
    expect(material.roughness).toBeGreaterThan(.8);
    // These lower lights are present in the official photo and were missing.
    for(const x of [-1.42,.22,1.82])expect(frontHit(x,8.9).hit.object.name).toBe('BU architecture · glassStained');
  });

  it('keeps the horizontal roof soffit behind the pierced front-wall recess',()=>{
    const roof=visible.filter(mesh=>mesh.name==='BU architecture · roof');
    const fromBelow=(x:number,z:number)=>{
      const lx=fit.x+x*fit.scaleX,lz=fit.z+z*fit.scaleZ;
      const origin=new Vector3(assembly.anchor[0]+lx*c+lz*s,base+18.9,assembly.anchor[1]-lx*s+lz*c);
      return new Raycaster(origin,new Vector3(0,1,0),0,.6).intersectObjects(roof,false);
    };
    // The old full-depth soffit crossed the niche/glazing at eave height,
    // creating a horizontal dark stripe visible from the plaza below.
    for(const x of [-1.5,.1,1.5])expect(fromBelow(x,20.70)).toHaveLength(0);
    // Keep the closed roof underside over the actual nave, rather than
    // removing it altogether and exposing sky from low viewing angles.
    expect(fromBelow(.1,19.8)).toHaveLength(1);
  });

  it('puts the plaza-facing cloister glazing behind a real perforated stone wall',()=>{
    const ring=assembly.wings.find(wing=>wing.id==='sth-link')!.footprint;
    let area=0;ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length];area+=p[0]*q[1]-q[0]*p[1];});
    const edges=ring.map((a,i)=>{
      let b=ring[(i+1)%ring.length];if(area>0)[a,b]=[b,a];
      return {a,b,width:Math.hypot(b[0]-a[0],b[1]-a[1]),yaw:Math.atan2(-(b[1]-a[1]),b[0]-a[0])};
    }).filter(edge=>Math.cos(edge.yaw-assembly.yaw)>.5).sort((a,b)=>b.width-a.width);
    const edge=edges[0],x=(edge.a[0]+edge.b[0])/2,z=(edge.a[1]+edge.b[1])/2;
    const outward=new Vector3(Math.sin(edge.yaw),0,Math.cos(edge.yaw));
    const trace=(offset:number)=>{
      const origin=new Vector3(x+offset*Math.cos(edge.yaw),base+3.2,z-offset*Math.sin(edge.yaw)).addScaledVector(outward,4);
      const hit=new Raycaster(origin,outward.clone().negate(),0,6).intersectObjects(visible,false)[0];
      expect(hit).toBeDefined();return hit;
    };
    const pane=trace(.55),pier=trace(1.95);
    expect(pane.object.name).toBe('BU architecture · glassShade');
    expect(pier.object.name).toBe('BU architecture · stone');
    expect(pane.distance-pier.distance).toBeCloseTo(.26,2);
    // Visual recesses do not create an unverified through-building route.
    const origin=new Vector3(x,base+3.2,z).addScaledVector(outward,4);
    expect(new Raycaster(origin,outward.clone().negate(),0,6).intersectObjects(campus.walls,false).length).toBeGreaterThan(0);
  });
});
