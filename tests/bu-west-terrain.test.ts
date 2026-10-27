import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3,type Material} from 'three';
import {BU_WEST_TERRAIN_DATA} from '../src/features/world/bu-west-terrain-data';
import {buDEMWeight,buElevation,buWestSurveyElevation} from '../src/features/world/bu-terrain';
import {BU_SIDEWALK_JOIN_PATCHES} from '../src/features/world/bu-public-realm';
import {createBUCampusStreets} from '../src/features/world/bu-campus-streets';
import {createCharlesRiver} from '../src/features/world/charles-river';
import {CampusCollision} from '../src/features/real-campus/campus-collision';

const baseline=JSON.parse(readFileSync('assets-source/charles-bu/west-terrain-baseline-20261027.json','utf8'));
describe('West Campus measured terrain and desktop sidewalk continuity',()=>{
  let streets:ReturnType<typeof createBUCampusStreets>;
  beforeAll(()=>{streets=createBUCampusStreets();},30000);
  afterAll(()=>{const materials=new Set<Material>();streets.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());});
  it('preserves the independent USGS sample and acquisition provenance',()=>{
    const data=BU_WEST_TERRAIN_DATA;
    expect(data.values).toHaveLength(data.grid.columns*data.grid.rows);
    expect(data.grid.step).toBe(12);
    expect(data.datasets.some(d=>d.id===45630&&d.verticalDatum.includes('1988'))).toBe(true);
    for(const p of baseline.points){
      expect(buDEMWeight(p.x,p.z)).toBe(1);
      expect(buWestSurveyElevation(p.x,p.z)).toBeCloseTo(p.surveyBilinearHeight,8);
      // Only the explicitly reconstructed residence terrace supersedes a raw
      // sample; preserve that source observation, not its former render height.
      if(p.x===-2328&&p.z===672)expect(buElevation(p.x,p.z)).toBeCloseTo(13.03,2);
      else expect(buElevation(p.x,p.z)).toBeCloseTo(p.surveyBilinearHeight,8);
    }
  });
  it('replaces the artificial Babcock ramp without lowering the measured southern street',()=>{
    const old=baseline.points.filter((p:{x:number;z:number})=>p.x===-2400&&[816,852].includes(p.z));
    expect(Math.abs(old[1].previousModelHeight-old[0].previousModelHeight)).toBeGreaterThan(7);
    expect(Math.abs(buElevation(-2400,852)-buElevation(-2400,816))).toBeLessThan(.2);
    expect(buElevation(-2400,816)).toBeGreaterThan(13);
    expect(buElevation(-2400,852)).toBeGreaterThan(12.9);
  });
  it('keeps fades and the existing central overlap continuous',()=>{
    for(const x of [-2760,-2712,-1608,-1560,-1512])for(const z of [600,744,912,1008])
      expect(Math.abs(buElevation(x-.001,z)-buElevation(x+.001,z))).toBeLessThan(.005);
    for(const z of [540,588,600,1008,1056])for(const x of [-2400,-2160,-1800])
      expect(Math.abs(buElevation(x,z-.001)-buElevation(x,z+.001))).toBeLessThan(.005);
  });
  it('renders the Babcock sidewalk bevels at the same measured height as their walking surfaces',()=>{
    const paving=streets.ground.filter(m=>m.name==='BU street ground paving');
    const joins=BU_SIDEWALK_JOIN_PATCHES.filter(p=>p[0][0]>-2400&&p[0][0]<-2360&&p[0][1]>680&&p[0][1]<750);
    expect(joins.length).toBeGreaterThanOrEqual(4);
    for(const patch of joins){
      const x=patch.reduce((n,p)=>n+p[0],0)/patch.length,z=patch.reduce((n,p)=>n+p[1],0)/patch.length;
      const hits=new Raycaster(new Vector3(x,100,z),new Vector3(0,-1,0),0,150).intersectObjects(paving,false);
      expect(hits.length,`missing Babcock join at ${x},${z}`).toBeGreaterThan(0);
      expect(hits[0].point.y).toBeCloseTo(buElevation(x,z)+.105,3);
    }
    for(const [x,z] of [[-2400,816],[-2406,852],[-2390,744]]){
      const hit=new Raycaster(new Vector3(x,100,z),new Vector3(0,-1,0),0,150).intersectObjects(streets.ground,false)[0];
      expect(hit).toBeDefined();expect(hit.point.y-buElevation(x,z)).toBeGreaterThan(.035);expect(hit.point.y-buElevation(x,z)).toBeLessThan(.2);
    }
  });
  it('drapes the actual northern ground tile to the expanded survey instead of leaving it at 5.2 m',()=>{
    const river=createCharlesRiver(new CampusCollision(),{value:0});
    try{
      for(const [x,z] of [[-2400,552],[-2364,576],[-2400,600]]){
        const hit=new Raycaster(new Vector3(x,100,z),new Vector3(0,-1,0),0,150).intersectObjects(river.ground,false)[0];
        expect(hit).toBeDefined();expect(hit.point.y).toBeCloseTo(buElevation(x,z),4);
      }
    }finally{
      const materials=new Set<Material>();river.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
      materials.forEach(m=>m.dispose());river.group.clear();
    }
  });
});
