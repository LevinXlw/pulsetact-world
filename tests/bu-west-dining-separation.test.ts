import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3,type Material} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {BU_GROUND_BUILDINGS,BU_MAP_BUILDINGS} from '../src/features/world/bu-campus-footprints';
import {buElevation} from '../src/features/world/bu-terrain';

type Point=readonly[number,number];
type Campus=ReturnType<typeof createBUFullCampus>;
const ids=['west-dining','claflin-hall','sleeper-hall'];
const parts=ids.map(id=>BU_FULL_BUILDINGS.find(b=>b.id===id)!);
const dining=parts[0],original=dining.terrainReference!.footprint;
const record=JSON.parse(readFileSync('assets-source/charles-bu/west-dining-separation-20261026.json','utf8'));
const built:Campus[]=[];
const build=(selected:string[],detail:'full'|'mobile')=>{
  const campus=createBUFullCampus({buildingIds:new Set(selected),includeSpaces:false,signage:false,detail});
  campus.group.updateMatrixWorld(true);built.push(campus);return campus;
};
const visible=(campus:Campus)=>campus.group.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const area=(ring:readonly Point[])=>Math.abs(ring.reduce((sum,a,i)=>{
  const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];
},0)/2);
function exteriorEdges(rings:readonly (readonly Point[])[]){
  const edges=new Map<string,number>();
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const a=ring[i].join(','),b=ring[(i+1)%ring.length].join(',');
    const key=[a,b].sort().join('|');edges.set(key,(edges.get(key)??0)+1);
  }
  expect([...edges.values()].every(count=>count<=2)).toBe(true);
  return [...edges].filter(([,count])=>count===1).map(([edge])=>edge).sort();
}
function inside(ring:readonly Point[],x:number,z:number){
  let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;
}
afterAll(()=>{
  for(const campus of built){const materials=new Set<Material>();
    campus.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    materials.forEach(m=>m.dispose());campus.group.clear();
  }
});

describe('West Dining shares the surveyed assembly without covering its towers',()=>{
  it('partitions the exact original outer perimeter and occupied area without overlapped components',()=>{
    expect(hash(original)).toBe(record.originalFootprintSha256);
    expect(exteriorEdges(parts.map(b=>b.footprint))).toEqual(exteriorEdges([original]));
    expect(parts.reduce((sum,b)=>sum+area(b.footprint),0)).toBeCloseTo(area(original),6);
    // Offset samples avoid boundary ambiguity; the fine grid also covers the
    // narrow neck where the former Claflin closing chord crossed the GIS ring.
    let mismatch=0;
    for(let x=-2370.13;x<-2250;x+=.23)for(let z=670.17;z<765;z+=.23){
      if(parts.filter(b=>inside(b.footprint,x,z)).length!==(inside(original,x,z)?1:0))mismatch++;
    }
    expect(mismatch).toBe(0);
  });

  it('retains tower plan placement and exterior vertices while surveyed terrain supersedes legacy heights',()=>{
    expect(dining.terrainReference!.anchor).toEqual(record.originalAnchor);
    // The archived 2026-10-26 heights remain historical evidence. West USGS
    // terrain now replaces the artificial 5.2 m plateau (bu-west-terrain.test.ts).
    for(const previous of record.towerChecks){
      const tower=parts.find(b=>b.id===previous.id)!;
      for(const key of ['x','z','width','depth','yaw','height'] as const)expect(tower[key]).toBe(previous[key]);
      expect(buElevation(tower.x,tower.z)).toBeGreaterThan(12);
      expect(buElevation(tower.x,tower.z)).toBeLessThan(14);
      expect(hash(tower.id==='claflin-hall'?tower.footprint.slice(1):tower.footprint)).toBe(previous.footprintSha256);
    }
  });

  it.each(['full','mobile'] as const)('keeps the %s collision, ground occupancy and map on the same separated footprints',detail=>{
    const campus=build(ids,detail);
    for(const part of parts){
      const wall=campus.walls.find(w=>w.name===part.name)!;
      expect(wall.userData.campusFootprint.map((p:Point)=>p.join(',')).sort()).toEqual(part.footprint.map(p=>p.join(',')).sort());
      expect(BU_MAP_BUILDINGS.find(b=>b.id===part.id)!.footprint).toEqual(part.footprint);
      expect(BU_GROUND_BUILDINGS.find(b=>b.id===part.id)!.footprint).toEqual(part.footprint);
      const anchor=part.terrainReference?.anchor??[part.x,part.z];
      const bounds=new Box3().setFromObject(wall),base=buElevation(anchor[0],anchor[1]);
      expect(bounds.min.y).toBeLessThanOrEqual(Math.min(base-.14,...part.footprint.map(p=>buElevation(...p)-.29)));
      expect(bounds.max.y).toBeCloseTo(base+part.height,3);
    }
  });

  it.each(['full','mobile'] as const)('exposes the two original tower lobby panes with no dining skin or roof over them in %s',detail=>{
    const campus=build(ids,detail),diningOnly=build(['west-dining'],detail);
    const checks=[
      {id:'claflin-hall',a:original[13],b:original[14]},
      {id:'sleeper-hall',a:original[64],b:original[65]},
    ];
    for(const check of checks){
      const tower=parts.find(b=>b.id===check.id)!,x=(check.a[0]+check.b[0])/2,z=(check.a[1]+check.b[1])/2;
      const dx=check.b[0]-check.a[0],dz=check.b[1]-check.a[1],length=Math.hypot(dx,dz),y=buElevation(tower.x,tower.z)+1.5;
      const ray=new Raycaster(new Vector3(x+dz/length*5,y,z-dx/length*5),new Vector3(-dz/length,0,dx/length),0,8);
      expect(ray.intersectObjects(visible(diningOnly),false)).toHaveLength(0);
      const hit=ray.intersectObjects(visible(campus),false)[0];expect(hit).toBeDefined();
      expect(hit.object.name).toMatch(/:glass(?:Light|Dark)?$/);
      expect(ray.intersectObjects(campus.walls,false).length).toBeGreaterThan(0);
      const downward=new Raycaster(new Vector3(tower.x,30,tower.z),new Vector3(0,-1,0),0,35);
      expect(downward.intersectObjects(visible(diningOnly),false)).toHaveLength(0);
    }
  });
});
