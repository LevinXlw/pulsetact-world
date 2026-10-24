import { afterAll,beforeAll,describe, expect, it } from 'vitest';
import {Mesh,Vector3,type BufferGeometry,type Material} from 'three';
import {
  geoToWorld, HARVARD_BRIDGE, isWalkableWorld, isWithinWorldBounds,
  LANDMARKS, RIVER_WALK_ROUTE,SOUTH_RIVER_WALK,isCharlesWater,
} from '../src/features/world/charles-geography';
import {BU_CORE_STORROW_ROADS,BU_RIVER_FOOTBRIDGES,BU_SILBER_RIVER_LINK,buFootbridgeHeights,buStorrowContains} from '../src/features/world/bu-river-core-layout';
import {BU_OFFICIAL_ROAD_SEGMENTS} from '../src/features/world/bu-road-data';
import {buElevation} from '../src/features/world/bu-terrain';
import {createCharlesRiver} from '../src/features/world/charles-river';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {createCampusGroundSampler} from '../src/features/world/campus-ground-sampler';

describe('Charles River and BU geography', () => {
  it('keeps new landmarks in the existing Cambridge coordinate frame', () => {
    expect(geoToWorld(42.35915, -71.09205)).toEqual([0, 0]);
    // Independent checkpoints from the imported MIT manifest and its Python converter.
    const spawn = geoToWorld(42.35865, -71.09185);
    expect(spawn[0]).toBeCloseTo(16.742, 2);
    expect(spawn[1]).toBeCloseTo(55.459, 2);
    const chapel = geoToWorld(42.35070, -71.10640);
    expect(chapel[0]).toBeCloseTo(-1177.818, 2);
    expect(chapel[1]).toBeCloseTo(944.142, 2);
  });

  it('allows the complete walking route without opening the surrounding water', () => {
    for (let i = 1; i < RIVER_WALK_ROUTE.length; i++) {
      const a = RIVER_WALK_ROUTE[i - 1], b = RIVER_WALK_ROUTE[i];
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        expect(isWalkableWorld(x, z), `route segment ${i}, point ${x},${z}`).toBe(true);
      }
    }
    for (const point of Object.values(LANDMARKS)) expect(isWalkableWorld(...point)).toBe(true);
    expect(isWalkableWorld(-500, 680)).toBe(false);
    expect(isWalkableWorld(-1000, 720)).toBe(false);
  });

  it('permits the bridge deck but rejects stepping off either side over water', () => {
    const [a, b] = HARVARD_BRIDGE, dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz), x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
    expect(length).toBeGreaterThan(640);
    expect(length).toBeLessThan(680);
    expect(isWalkableWorld(x, z)).toBe(true);
    for (const side of [-1, 1]) {
      expect(isWalkableWorld(x + side * dz / length * 10, z - side * dx / length * 10)).toBe(false);
    }
  });

  it('allows the built Harvard west-side turn without opening adjacent Storrow',()=>{
    // Navigation rounds this corner while remaining on the 3 m bridge walk.
    expect(isWalkableWorld(159.64075792630473,793.4769263852392)).toBe(true);
    for(const i of [1,2]){
      const a=SOUTH_RIVER_WALK[i],b=SOUTH_RIVER_WALK[i+1],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      for(const t of [.1,.5,.9])for(const side of [-1,1]){
        const offset=side*(i===1?1.3:2.9),x=a[0]+dx*t-dz/length*offset,z=a[1]+dz*t+dx/length*offset;
        expect(isWalkableWorld(x,z),`existing Harvard access ${x},${z}`).toBe(true);
      }
    }
    // These nearby carriageway points have no access paving above them.
    for(const [x,z] of [[155.344,798.064],[189.853,792.567]]){
      expect(buStorrowContains(x,z)).toBe(true);
      expect(isWalkableWorld(x,z),`Storrow remains closed at ${x},${z}`).toBe(false);
    }
  });

  it('rejects invalid save coordinates and distant parts of the broader map', () => {
    expect(isWithinWorldBounds(NaN, 0)).toBe(false);
    expect(isWithinWorldBounds(0, Infinity)).toBe(false);
    expect(isWithinWorldBounds(100000, 100000)).toBe(false);
    expect(isWithinWorldBounds(-1700, 1000)).toBe(true);
    // The former empty west-side boundary is now part of the BU street network.
    expect(isWalkableWorld(-1700, 1000)).toBe(true);
    expect(isWalkableWorld(-2900, 1500)).toBe(false);
    expect(isWalkableWorld(53.5, 52.5)).toBe(true);
  });
});

describe('BU core riverfront geometry',()=>{
  let river:ReturnType<typeof createCharlesRiver>;
  const collision=new CampusCollision();
  beforeAll(()=>{
    river=createCharlesRiver(collision,{value:0});
    river.group.updateMatrixWorld(true);collision.rebuild(river.ground,river.walls,createCampusGroundSampler(river.ground));
  });
  afterAll(()=>{
    const geometry=new Set<BufferGeometry>(),materials=new Set<Material>();
    river.group.traverse(object=>{if(object instanceof Mesh){geometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
    geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  });

  it('retains the two surveyed Storrow axes and source carriageway widths',()=>{
    expect(BU_CORE_STORROW_ROADS.filter(r=>!r.ramp).length).toBeGreaterThanOrEqual(2);
    for(const road of BU_CORE_STORROW_ROADS){
      const source=BU_OFFICIAL_ROAD_SEGMENTS.find(r=>r.id===road.id)!;
      if(source.surfaceWidthFeet)expect(road.width).toBeCloseTo(source.surfaceWidthFeet*.3048,6);
      for(const p of road.points){
        const distances=source.points.slice(1).map((b,i)=>{
          const a=source.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));
          return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
        });expect(Math.min(...distances)).toBeLessThan(.001);
      }
    }
    // The old shore+32 m boulevard did not follow either of these axes.
    expect(buStorrowContains(-1006.547,891.876)).toBe(true);
    expect(buStorrowContains(-1006.417,880.603)).toBe(true);
    expect(isWalkableWorld(-1006.547,891.876)).toBe(false);
  });

  it('keeps both bridge decks above Storrow and lands them on the DEM',()=>{
    expect(BU_RIVER_FOOTBRIDGES.map(b=>b.id)).toEqual(['bay-state','silber-way']);
    for(const bridge of BU_RIVER_FOOTBRIDGES){
      const heights=buFootbridgeHeights(bridge.points,buElevation),a=bridge.points[1],b=bridge.points[2];let crossed=0;
      for(let t=0;t<=1;t+=.025){
        const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
        if(!buStorrowContains(x,z))continue;crossed++;
        const deck=collision.groundHeight(x,z)!;
        expect(deck-.32-(buElevation(x,z)+.045),`${bridge.id} road clearance`).toBeGreaterThan(4.7);
        expect(deck).toBeCloseTo(heights[1],2);
      }
      expect(crossed).toBeGreaterThan(10);
      const last=bridge.points.at(-1)!;
      expect(collision.groundHeight(...last)).toBeCloseTo(buElevation(...last)+.065,1);
    }
  });

  it('has finite geometry and continuous collision-free walking over both bridges',()=>{
    river.group.traverse(object=>{
      if(!(object instanceof Mesh))return;const p=object.geometry.getAttribute('position');
      for(let i=0;i<p.array.length;i++)if(!Number.isFinite(p.array[i]))throw new Error(`${object.name} has a nonfinite vertex at ${i}`);
    });
    const origin=new Vector3(),direction=new Vector3();
    for(const route of [RIVER_WALK_ROUTE,BU_SILBER_RIVER_LINK,...BU_RIVER_FOOTBRIDGES.map(b=>b.points)]){
      // MIT geometry is outside this focused build; begin at the south bank.
      const walk=route===RIVER_WALK_ROUTE?route.slice(7):route;
      for(const reverse of [false,true]){
        const points=reverse?[...walk].reverse():walk;
        for(let i=1;i<points.length;i++){
          const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(length/.5);let previous=a,y=collision.groundHeight(...a)!;
          direction.set(b[0]-a[0],0,b[1]-a[1]).normalize();
          for(let j=1;j<=n;j++){
            const p:[number,number]=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n],height=collision.groundHeight(...p);
            expect(height,`missing ground ${p}`).toBeDefined();
            expect(Math.abs(height!-y),`step at ${p}`).toBeLessThan(.68);
            origin.set(previous[0],y+.9,previous[1]);
            expect(collision.distance(origin,direction,length/n+.28),`wall at ${p}`).toBeUndefined();
            expect(isWalkableWorld(...p),`boundary at ${p}`).toBe(true);
            expect(isCharlesWater(...p),`route in river ${p}`).toBe(false);
            previous=p;y=height!;
          }
        }
      }
    }
  });
});
