import {describe,expect,it} from 'vitest';
import {buBrownstoneEntry} from '../src/features/world/bu-brownstone-entry';
import {BU_FULL_BUILDINGS} from '../src/features/world/bu-full-layout';
import {BU_PUBLIC_FRONTAGES,buStreetSidewalk} from '../src/features/world/bu-public-realm';
import {buSegmentProjection} from '../src/features/world/bu-campus-layout';
import type {WorldPoint} from '../src/features/world/geo-coordinates';

const midpoint=(a:WorldPoint,b:WorldPoint):WorldPoint=>[(a[0]+b[0])/2,(a[1]+b[1])/2];

describe('shared BU brownstone entrance axes',()=>{
  it('retains the existing 168 Bay State door and stoop placement without mutating its survey outline',()=>{
    const building=BU_FULL_BUILDINGS.find(b=>b.id==='boston-12038')!,before=JSON.stringify(building.footprint);
    const entry=buBrownstoneEntry(building.footprint,building.height)!;
    expect(entry.front.edge.road.name).toBe('BAY STATE ROAD');
    const {p}=entry.front;
    const x=p.x+entry.doorX*Math.cos(p.yaw)+entry.stoopDepth*Math.sin(p.yaw);
    const z=p.z-entry.doorX*Math.sin(p.yaw)+entry.stoopDepth*Math.cos(p.yaw);
    // Measured from the pre-extraction model; changing paving must not move it.
    expect(x).toBeCloseTo(-746.090,3);expect(z).toBeCloseTo(987.115,3);
    expect(entry.doorWidth).toBeCloseTo(1.35,6);expect(entry.stoopDepth).toBeCloseTo(2.45,6);
    expect(entry.rise).toBeCloseTo(1.1,6);
    expect(JSON.stringify(building.footprint)).toBe(before);
  });

  it.each(['boston-12038','boston-12098','boston-12099','boston-12101'])('connects %s from its actual stoop axis to the existing sidewalk',id=>{
    const building=BU_FULL_BUILDINGS.find(b=>b.id===id)!,entry=buBrownstoneEntry(building.footprint,building.height)!;
    const frontage=BU_PUBLIC_FRONTAGES.find(p=>p.buildingId===id&&p.kind==='entrance')!;
    const {p,edge}=entry.front,front=midpoint(frontage.points[0],frontage.points[1]),end=midpoint(frontage.points[2],frontage.points[3]);
    const step:WorldPoint=[p.x+entry.doorX*Math.cos(p.yaw)+entry.stoopDepth*Math.sin(p.yaw),p.z-entry.doorX*Math.sin(p.yaw)+entry.stoopDepth*Math.cos(p.yaw)];
    // Previously these four stoops missed their path centre by 2.19–4.54 m.
    expect(buSegmentProjection(...step,front,end).distance).toBeLessThan(.016);
    expect(Math.hypot(frontage.points[1][0]-frontage.points[0][0],frontage.points[1][1]-frontage.points[0][1])).toBeLessThanOrEqual(1.601);
    for(const point of frontage.points.slice(0,2))expect(Math.min(...building.footprint.map((a,i)=>buSegmentProjection(...point,a,building.footprint[(i+1)%building.footprint.length]).distance))).toBeLessThan(.001);
    for(const point of frontage.points.slice(2))expect(buSegmentProjection(...point,edge.a,edge.b).distance).toBeCloseTo(edge.road.width/2+buStreetSidewalk(edge.road)-.06,3);
    expect(frontage.roadName).toBe(edge.road.name);
  });

  it('uses the same front when straight survey segments are subdivided or the ring is closed and reversed',()=>{
    const building=BU_FULL_BUILDINGS.find(b=>b.id==='boston-12038')!,expected=buBrownstoneEntry(building.footprint,building.height)!;
    const divided=building.footprint.flatMap((a,i)=>[a,midpoint(a,building.footprint[(i+1)%building.footprint.length])]);
    const reversed=[...divided].reverse();reversed.push(reversed[0]);
    const actual=buBrownstoneEntry(reversed,building.height)!;
    expect(actual.front.p.x).toBeCloseTo(expected.front.p.x,8);
    expect(actual.front.p.z).toBeCloseTo(expected.front.p.z,8);
    expect(actual.front.p.yaw).toBeCloseTo(expected.front.p.yaw,8);
    expect(actual.doorX).toBeCloseTo(expected.doorX,8);
    expect(actual.stoopDepth).toBeCloseTo(expected.stoopDepth,8);
    expect(buBrownstoneEntry([[-750,990],[-748,990],[-748,992],[-750,992]],10)).toBeUndefined();
  });
});
