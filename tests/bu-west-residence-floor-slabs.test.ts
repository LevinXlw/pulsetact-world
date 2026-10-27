import {readFileSync} from 'node:fs';
import {afterAll,describe,expect,it} from 'vitest';
import {DoubleSide,Mesh,Raycaster,Vector3,type Material} from 'three';
import {createBUFullCampus} from '../src/features/world/bu-full-campus';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {buElevation} from '../src/features/world/bu-terrain';
import {BOSTON_DAYLIGHT} from '../src/features/world/campus-daylight';

type Campus=ReturnType<typeof createBUFullCampus>;
const record=JSON.parse(readFileSync('assets-source/charles-bu/west-residence-floor-slabs-20261026.json','utf8'));
const legacyFoundations=JSON.parse(readFileSync('assets-source/charles-bu/west-dining-separation-20261026.json','utf8')).towerChecks;
const ids=['claflin-hall','sleeper-hall'];
const towers=ids.map(id=>BU_FULL_BUILDINGS.find(b=>b.id===id)!);
const built:Campus[]=[];
function build(detail:'full'|'mobile'='full',selected=ids){
  const campus=createBUFullCampus({buildingIds:new Set(selected),includeSpaces:false,signage:false,detail});
  campus.group.updateMatrixWorld(true);
  // Include both faces conservatively: a leak must survive all possible casters.
  campus.group.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.side=DoubleSide;});
  built.push(campus);return campus;
}
const visible=(c:Campus)=>c.group.children.filter((o):o is Mesh=>o instanceof Mesh&&o.visible);
const direction=new Vector3(...BOSTON_DAYLIGHT.offset).normalize();
afterAll(()=>{
  for(const campus of built){const materials=new Set<Material>();
    campus.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    materials.forEach(m=>m.dispose());campus.group.clear();
  }
});

describe('Claflin and Sleeper structural floor sunlight occlusion',()=>{
  it.each(['full','mobile'] as const)('retains 12 real floor plates per tower without filling the lobby in isolated %s geometry',detail=>{
    const campus=build(detail),meshes=visible(campus);
    const concrete=meshes.filter(m=>/:concrete$/.test(m.name));
    for(const tower of towers){
      const ground=buElevation(tower.x,tower.z);
      const ray=new Raycaster(new Vector3(tower.x,ground+tower.height-.5,tower.z),new Vector3(0,-1,0),0,tower.height);
      const levels=[...new Set(ray.intersectObjects(concrete,false)
        .filter(h=>Math.abs(h.face?.normal.y??0)>.99)
        .map(h=>Number((h.point.y-ground).toFixed(3))))].sort((a,b)=>a-b);
      expect(levels).toHaveLength(24);
      for(let floor=0;floor<12;floor++){
        expect(levels[floor*2]).toBeCloseTo(3.7+floor*(tower.height-3.7)/12,2);
        expect(levels[floor*2+1]-levels[floor*2]).toBeCloseTo(.22,2);
      }
      expect(levels[0]).toBeCloseTo(3.7,2);
    }
    const models=campus.group.userData.districtModels as {triangles:number}[];
    const triangles=models.reduce((n,m)=>n+m.triangles,0);
    // Terrain skirts add geometry below the unchanged occupied floor plates.
    const previous=detail==='full'?17732:8432;
    expect(triangles).toBeGreaterThan(previous);expect(triangles).toBeLessThan(previous+6000);
    expect((campus.group.userData.westResidenceFloorSlabs as {triangles:number}[]).reduce((n,m)=>n+m.triangles,0)).toBe(1464);
    if(detail==='full')expect(meshes).toHaveLength(24);
  });

  it('keeps the original glass openings but blocks the six recorded cross-building sunlight paths',()=>{
    const campus=build(),meshes=visible(campus);
    for(const sample of record.cpuSunlightEvidence.before.examples){
      const tower=towers.find(t=>t.name===sample.building)!;
      const delta=buElevation(tower.x,tower.z)-legacyFoundations.find((t:{id:string})=>t.id===tower.id).foundation;
      // Preserve the recorded ray relative to its tower after the measured
      // 2026-10-27 terrain uplift; historical absolute Y remains in the source.
      const origin=new Vector3().fromArray(sample.ground);origin.y+=.03+delta;
      const ray=new Raycaster(origin,direction,0,150);
      const pane=ray.intersectObjects(meshes,false)[0];
      expect(pane.object.name).toMatch(/:glass/);
      expect(pane.point.distanceTo(new Vector3().fromArray(sample.paneAt).add(new Vector3(0,delta,0)))).toBeLessThan(.002);
      const blocked=ray.intersectObjects(meshes.filter(m=>m.castShadow),false)[0];
      expect(blocked).toBeDefined();expect(blocked.object.name).toMatch(/:concrete$/);
      expect(blocked.distance).toBeGreaterThan(pane.distance+.05);
    }
    expect(meshes.filter(m=>/:glass/.test(m.name)).every(m=>!m.castShadow)).toBe(true);
    campus.setQuality(true);expect(meshes.some(m=>m.castShadow)).toBe(false);
    campus.setQuality(false);expect(meshes.filter(m=>/:concrete$/.test(m.name)).every(m=>m.castShadow)).toBe(true);
    expect(meshes.filter(m=>/:glass/.test(m.name)).every(m=>!m.castShadow)).toBe(true);
  });

  it('removes all deep leaks from the recorded 2 m sunlight sample grid',()=>{
    const campus=build(),meshes=visible(campus),casters=meshes.filter(m=>m.castShadow);
    let leaks=0;
    for(let x=-2355;x<=-2270;x+=2)for(let z=630;z<=725;z+=2){
      const ray=new Raycaster(new Vector3(x,buElevation(x,z)+.03,z),direction,0,150);
      const first=ray.intersectObjects(meshes,false)[0];
      if(!first||!/:glass/.test(first.object.name)||ray.intersectObjects(casters,false).length)continue;
      const span=ray.intersectObjects(campus.walls,false);
      if(span.length>=2&&span[span.length-1].distance-span[0].distance>=10)leaks++;
    }
    expect(record.cpuSunlightEvidence.before.unobstructedDeepRays).toBe(140);
    expect(leaks).toBe(0);
  });

  it('keeps Rich Hall outside this bounded repair',()=>{
    expect(build('full',['rich-hall']).group.userData.westResidenceFloorSlabs).toBeUndefined();
  });
});
