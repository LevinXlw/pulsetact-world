import type {Position} from '../../types';
import {courtPoint} from './inspection';
// Forward root travel / source clip duration, measured during FBX conversion.
export const campusWalkingSpeed=1.283276;

const halfStraight = 7, radius = .6, centerS = 93.5;
const straightLength = halfStraight * 2, arcLength = Math.PI * radius;
const origin = courtPoint(0, 0), courtU = courtPoint(1, 0), courtS = courtPoint(0, 1);
const ux = courtU[0] - origin[0], uz = courtU[1] - origin[1];
const sx = courtS[0] - origin[0], sz = courtS[1] - origin[1];

export const campusWalkerRouteLength = 2 * (straightLength + arcLength);
export const campusWalkerInitialDistance = 3;
export const campusSophiaPosition:Position = courtPoint(1.1, 100);
const entry = courtPoint(0, 110);
export const campusSophiaYaw = Math.atan2(entry[0] - campusSophiaPosition[0], entry[1] - campusSophiaPosition[1]);

/** Metres around the paved crosswalk, with tangent-continuous turns at each end. */
export function sampleCampusWalker(distance:number):{position:Position; yaw:number} {
  const finiteDistance = Number.isFinite(distance) ? distance : 0;
  let along = ((finiteDistance % campusWalkerRouteLength) + campusWalkerRouteLength) % campusWalkerRouteLength;
  let u:number, s:number, du:number, ds:number;
  if (along < straightLength) {
    u = -halfStraight + along; s = centerS + radius; du = 1; ds = 0;
  } else if ((along -= straightLength) < arcLength) {
    const angle = along / radius;
    u = halfStraight + radius * Math.sin(angle); s = centerS + radius * Math.cos(angle);
    du = Math.cos(angle); ds = -Math.sin(angle);
  } else if ((along -= arcLength) < straightLength) {
    u = halfStraight - along; s = centerS - radius; du = -1; ds = 0;
  } else {
    const angle = (along - straightLength) / radius;
    u = -halfStraight - radius * Math.sin(angle); s = centerS - radius * Math.cos(angle);
    du = -Math.cos(angle); ds = Math.sin(angle);
  }
  return {position:courtPoint(u, s), yaw:Math.atan2(ux * du + sx * ds, uz * du + sz * ds)};
}
