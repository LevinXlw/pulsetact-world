import {BU_CDS_MAP_FEATURE,BU_CDS_MODULE,BU_CDS_PLATE,BU_CDS_PODIUM,BU_CDS_YAW} from './bu-landmark-layout';
import type {WorldPoint} from './geo-coordinates';

/** Public ground-floor frontage interpreted from BU/KPMB's 3 Dec 2019
 * landscape plan (sheet 8), not an as-built door survey. Keep the two existing
 * ground envelopes and the previous east-podium column grid. The plan supports
 * an open glazed public edge and continuous paving, not a new opaque plinth.
 * https://www.bu.edu/cpo/files/2019/12/19.12.03_Student-Town-Hall-Slide-Deck-_v1.pdf
 */
export const BU_CDS_GROUND_TOWER={x:-BU_CDS_MODULE/2,z:-BU_CDS_MODULE/2,w:BU_CDS_PLATE,d:BU_CDS_PLATE,top:5.6} as const;
export const BU_CDS_GROUND_PODIUM={x:BU_CDS_PODIUM.x,z:BU_CDS_PODIUM.z-1,w:BU_CDS_PODIUM.w-1.2,d:BU_CDS_PODIUM.d-2,top:5.6} as const;
export function buCDSPoint(x:number,z:number):WorldPoint{
  const c=Math.cos(BU_CDS_YAW),s=Math.sin(BU_CDS_YAW);
  return[BU_CDS_MAP_FEATURE.x+x*c+z*s,BU_CDS_MAP_FEATURE.z-x*s+z*c];
}
const towerMin=BU_CDS_GROUND_TOWER.x-BU_CDS_GROUND_TOWER.w/2;
const towerFront=BU_CDS_GROUND_TOWER.z+BU_CDS_GROUND_TOWER.d/2;
const podiumLeft=BU_CDS_GROUND_PODIUM.x-BU_CDS_GROUND_PODIUM.w/2;
const podiumRight=BU_CDS_GROUND_PODIUM.x+BU_CDS_GROUND_PODIUM.w/2;
const podiumFront=BU_CDS_GROUND_PODIUM.z+BU_CDS_GROUND_PODIUM.d/2;
// Door axes are authored, not measured. Offset 2.2 m east of the previous
// axes so the retained x=28/42 columns no longer bisect their entry approaches.
export const BU_CDS_SOUTH_DOORS=[30.2,44.2].map(x=>({
  local:[x,podiumFront] as const,width:2.9,floor:.10,
  position:buCDSPoint(x,podiumFront),approach:buCDSPoint(x,25.5),
  placement:'Authored podium door axis adjusted to clear the retained column grid; not a measured entrance location',
}));
/** Fill only the L-shaped gap to the existing apron at local z=22.5.
 * No extension into Granby/Comm Ave, no parcel-wide slab or terrain flattening.
 * Automatic BU_PUBLIC_FRONTAGES skips the custom CDS envelope.
 */
export const BU_CDS_ENTRY_PAVING:readonly WorldPoint[]=[
  [towerMin,towerFront],[podiumLeft,towerFront],[podiumLeft,podiumFront],
  [podiumRight,podiumFront],[podiumRight,22.5],[towerMin,22.5],
].map(([x,z])=>buCDSPoint(x,z));
