import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {isCampusWater,type CampusEnvironment} from '../src/features/real-campus/environment';
it('allows crossing the modeled bridge while blocking the water beside it',()=>{
 const e:CampusEnvironment={cellSize:2,waterRuns:[[-10,0,20]],greenRuns:[],waterArea:40,greenArea:0,bridge:{start:[0,0],end:[0,20],width:4}};
 expect(isCampusWater(e,1,1)).toBe(false);expect(isCampusWater(e,4,1)).toBe(true);
});
it('keeps land gaps navigable and water cells blocked with exact run boundaries',()=>{
 const environment:CampusEnvironment={cellSize:2,waterRuns:[[0,0,10],[14,0,8]],greenRuns:[],waterArea:36,greenArea:0};
 expect(isCampusWater(environment,5,1)).toBe(true);expect(isCampusWater(environment,10,1)).toBe(false);expect(isCampusWater(environment,12,1)).toBe(false);expect(isCampusWater(environment,14,1)).toBe(true);expect(isCampusWater(environment,5,2)).toBe(false);
});
it('classified surface cells stay inside the campus bounds and match recorded areas',()=>{
 const environment=JSON.parse(readFileSync('public/data/killian/environment.json','utf8')) as CampusEnvironment;
 for(const [runs,area] of [[environment.waterRuns,environment.waterArea],[environment.greenRuns,environment.greenArea],[environment.roadRuns!,environment.roadArea!]] as const){
  expect(runs.reduce((sum,[x,z,width])=>{expect(x).toBeGreaterThanOrEqual(-420);expect(z).toBeGreaterThanOrEqual(-420);expect(x+width).toBeLessThanOrEqual(420);expect(z+environment.cellSize).toBeLessThanOrEqual(420);return sum+width*environment.cellSize;},0)).toBe(area);
 }
});
