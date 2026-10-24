import {describe,expect,it} from 'vitest';
import {campusSophiaPosition,campusSophiaYaw,campusWalkerInitialDistance,campusWalkerRouteLength,sampleCampusWalker} from '../src/features/real-campus/campus-people';
import {courtPoint} from '../src/features/real-campus/inspection';

const distance = (a:number[], b:number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const headingDifference = (a:number, b:number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
function courtCoordinates(p:number[]) {
  const origin = courtPoint(0, 0), east = courtPoint(1, 0), south = courtPoint(0, 1);
  const ux = east[0] - origin[0], uz = east[1] - origin[1], sx = south[0] - origin[0], sz = south[1] - origin[1];
  const x = p[0] - origin[0], z = p[1] - origin[1], determinant = ux * sz - sx * uz;
  return {u:(x * sz - z * sx) / determinant, s:(z * ux - x * uz) / determinant};
}

describe('campus people placement',()=>{
  it('keeps the entire walking loop inside the paved crosswalk with room for feet',()=>{
    for (let i = 0; i < 1200; i++) {
      const {u,s} = courtCoordinates(sampleCampusWalker(i / 1200 * campusWalkerRouteLength).position);
      expect(Math.abs(u)).toBeLessThanOrEqual(7.600001);
      // The actual paving spans s=92..95; reserve .5 m beside each foot route.
      expect(s).toBeGreaterThan(92.5); expect(s).toBeLessThan(94.5);
    }
    const start = courtCoordinates(sampleCampusWalker(campusWalkerInitialDistance).position);
    expect(start.u).toBeCloseTo(-4, 8); expect(start.s).toBeCloseTo(94.1, 8);
  });

  it('faces along travel and advances one metre per metre, including on bends',()=>{
    const step = .0001;
    for (let i = 0; i < 200; i++) {
      const d = i / 200 * campusWalkerRouteLength, current = sampleCampusWalker(d), next = sampleCampusWalker(d + step);
      const dx = next.position[0] - current.position[0], dz = next.position[1] - current.position[1];
      expect(Math.hypot(dx, dz) / step).toBeCloseTo(1, 5);
      expect(headingDifference(current.yaw, Math.atan2(dx, dz))).toBeLessThan(.001);
    }
  });

  it('joins straights, turns and the wrap without position or heading jumps',()=>{
    const halfLoop = campusWalkerRouteLength / 2;
    for (const seam of [0, 14, halfLoop, halfLoop + 14, campusWalkerRouteLength]) {
      const before = sampleCampusWalker(seam - .0001), after = sampleCampusWalker(seam + .0001);
      expect(distance(before.position, after.position)).toBeLessThan(.000201);
      expect(headingDifference(before.yaw, after.yaw)).toBeLessThan(.001);
    }
  });

  it('wraps negative distances and repeated laps into the same finite pose',()=>{
    for (const d of [-200.4, -1, 0, 17.3, 10000]) {
      const pose = sampleCampusWalker(d), repeated = sampleCampusWalker(d + 7 * campusWalkerRouteLength);
      expect([...pose.position, pose.yaw].every(Number.isFinite)).toBe(true);
      expect(distance(pose.position, repeated.position)).toBeLessThan(1e-8);
      expect(headingDifference(pose.yaw, repeated.yaw)).toBeLessThan(1e-8);
    }
    for (const invalid of [NaN, Infinity, -Infinity]) expect(sampleCampusWalker(invalid)).toEqual(sampleCampusWalker(0));
  });

  it('places Sophia beside the centre path and faces the arriving visitor',()=>{
    const {u,s} = courtCoordinates(campusSophiaPosition), entry = courtPoint(0, 110);
    expect(u).toBeCloseTo(1.1, 8); expect(s).toBeCloseTo(100, 8);
    expect(u + .35).toBeLessThan(2);
    expect(distance(campusSophiaPosition, entry)).toBeGreaterThan(9);
    expect(distance(campusSophiaPosition, entry)).toBeLessThan(11);
    expect(headingDifference(campusSophiaYaw, Math.atan2(entry[0] - campusSophiaPosition[0], entry[1] - campusSophiaPosition[1]))).toBeLessThan(1e-8);
  });
});
