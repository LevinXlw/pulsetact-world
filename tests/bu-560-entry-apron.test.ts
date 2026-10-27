import {afterAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Mesh,Raycaster,Vector3,type Material} from 'three';
import {BU_SOURCE_FRONTAGES,BU_PUBLIC_FRONTAGES,buPublicRealmContains} from '../src/features/world/bu-public-realm';
import {BU_GROUND_BUILDINGS} from '../src/features/world/bu-campus-footprints';
import {buRoadDistance} from '../src/features/world/bu-campus-layout';
import {createBUCampusStreets} from '../src/features/world/bu-campus-streets';
import {buElevation} from '../src/features/world/bu-terrain';
const patches=BU_SOURCE_FRONTAGES.filter(p=>p.buildingId==='commonwealth-560');
const inside=(x:number,z:number,ring:readonly(readonly[number,number])[])=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
const streets=createBUCampusStreets(),visible:Mesh[]=[];streets.group.traverse(o=>{if(o instanceof Mesh&&o.visible)visible.push(o);});streets.group.updateMatrixWorld(true);
afterAll(()=>{const mats=new Set<Material>();streets.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);}});mats.forEach(m=>m.dispose());});
describe('560 curved entry apron shared by desktop and mobile',()=>{
  it('fills only the measured eastern arc with bounded photo-backed patches',()=>{
    expect(patches.length).toBeGreaterThanOrEqual(27);const total=patches.reduce((s,p)=>s+p.area,0);expect(total).toBeGreaterThan(40);expect(total).toBeLessThan(110);
    for(const p of patches){expect(BU_PUBLIC_FRONTAGES).toContain(p);expect(p.kind).toBe('frontage');expect(p.area).toBeLessThan(30);for(const [x,z]of p.points){expect(x).toBeGreaterThan(-499);expect(x).toBeLessThan(-487);expect(z).toBeGreaterThan(1149);expect(z).toBeLessThan(1168);}}
  });
  it('keeps a continuous paved route from the actual curved entry to the existing sidewalk',()=>{
    for(let x=-493.8;x<=-488.5;x+=.05)expect(buPublicRealmContains(x,1158.1),`grass gap at ${x}`).toBe(true);
    // The west service side and the adjoining tower are outside this addition.
    expect(patches.some(p=>inside(-530,1162,p.points))).toBe(false);expect(patches.some(p=>inside(-555,1155,p.points))).toBe(false);
  });
  it('never crosses the occupied footprints or the carriageway in dense area samples',()=>{
    let checked=0;for(let x=-498.1;x<-487;x+=.11)for(let z=1149.7;z<1167;z+=.11){if(!patches.some(p=>inside(x,z,p.points)))continue;checked++;expect(buRoadDistance(x,z)).toBeGreaterThan(.01);expect(BU_GROUND_BUILDINGS.some(b=>inside(x,z,b.footprint)&&!(b.holes??[]).some(h=>inside(x,z,h)))).toBe(false);}expect(checked).toBeGreaterThan(2000);
  });
  it('actually emits desktop paving and is consumed by the common mobile frontage loop',()=>{
    for(const x of [-493.7,-492,-490,-488.6]){const z=1158.1,y=buElevation(x,z),hit=new Raycaster(new Vector3(x,y+1,z),new Vector3(0,-1,0),0,2).intersectObjects(visible,false)[0];expect(hit).toBeDefined();expect(hit.object.name).toMatch(/paving/i);expect(hit.point.y).toBeCloseTo(y+.102,2);}
    const mobile=readFileSync('src/features/world/mobile-campus-build.ts','utf8');expect(mobile).toContain('for(const frontage of BU_PUBLIC_FRONTAGES)polygon');
  });
});
