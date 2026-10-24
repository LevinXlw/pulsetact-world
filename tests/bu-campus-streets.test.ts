import {describe,expect,it} from 'vitest';
import {BU_CAMPUS_ROADS,BU_FULL_PLACES,BU_TRANSIT_STOPS,BU_WALK_ROUTES,buNavigationBlocked} from '../src/features/world/bu-campus-layout';
import {isWalkableWorld,LANDMARKS,type WorldPoint} from '../src/features/world/charles-geography';
import {navigationGuide} from '../src/features/world/world-destinations';

describe('georeferenced BU street network',()=>{
  it('retains the full campus street extent and the current five B-branch stops',()=>{
    const streets=new Set(BU_CAMPUS_ROADS.map(s=>s.name));
    for(const name of ['COMMONWEALTH AVENUE','BAY STATE ROAD','BABCOCK STREET','CUMMINGTON MALL','BUSWELL STREET','BOSTON UNIVERSITY BRIDGE'])expect(streets.has(name)).toBe(true);
    const xs=BU_CAMPUS_ROADS.flatMap(r=>r.points.map(p=>p[0]));expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThan(2500);
    expect(BU_TRANSIT_STOPS.map(s=>s.name)).toEqual(['Blandford Street','Boston University East','Boston University Central','Amory Street','Babcock Street']);
  });
  it('places every quick-travel arrival clear of the building envelopes',()=>{
    for(const place of BU_FULL_PLACES)expect(buNavigationBlocked(...place.position),`${place.id} at ${place.position}`).toBe(false);
  });
  it('connects the BU Bridge northern approach across its ramp-named shared deck',()=>{
    expect(BU_CAMPUS_ROADS.some(road=>road.id==='massgis-346268-0-0'&&road.kind==='bridge')).toBe(true);
    // The old street-name filter omitted the middle 52 m of the bridge.
    expect(isWalkableWorld(-1521.5,680)).toBe(true);
    const north:WorldPoint=[-1494.499915,589.53334];
    for(const [start,destination] of [[north,LANDMARKS.buMarsh],[LANDMARKS.buMarsh,north]]){
      let current:WorldPoint=[...start];
      for(let step=0;step<6000&&Math.hypot(current[0]-destination[0],current[1]-destination[1])>1;step++){
        const guide=navigationGuide(current,destination),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],distance=Math.hypot(dx,dz),stride=Math.min(.35,distance);
        expect(Number.isFinite(guide.distance),`disconnected bridge at ${current}`).toBe(true);
        expect(distance).toBeGreaterThan(0);
        current=[current[0]+dx/distance*stride,current[1]+dz/distance*stride];
        expect(isWalkableWorld(...current),`bridge route left deck at ${current}`).toBe(true);
      }
      expect(Math.hypot(current[0]-destination[0],current[1]-destination[1])).toBeLessThanOrEqual(1);
    }
  });
  it('provides finite, obstacle-free guides from Marsh Plaza to each new destination',()=>{
    for(const place of BU_FULL_PLACES){
      let current:WorldPoint=[...LANDMARKS.buMarsh];
      for(let step=0;step<16000&&Math.hypot(current[0]-place.position[0],current[1]-place.position[1])>1;step++){
        const guide=navigationGuide(current,place.position),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],distance=Math.hypot(dx,dz),stride=Math.min(.8,distance);
        expect(Number.isFinite(guide.distance),`${place.id} disconnected at ${current}`).toBe(true);
        expect(distance,`${place.id} stalled at ${current}`).toBeGreaterThan(0);
        current=[current[0]+dx/distance*stride,current[1]+dz/distance*stride];
        expect(buNavigationBlocked(...current),`${place.id} route hits building at ${current}; target ${guide.point}`).toBe(false);
      }
      expect(Math.hypot(current[0]-place.position[0],current[1]-place.position[1]),`${place.id} did not arrive from Marsh Plaza; at ${current}, next ${navigationGuide(current,place.position).point}`).toBeLessThanOrEqual(1);
    }
    expect(BU_WALK_ROUTES.length).toBeGreaterThan(100);
  },60000);
});
