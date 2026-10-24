/**
 * Shared geography for the first Charles River / BU walking extension.
 * Units are metres, east/up/south, in the same EPSG:2249 local frame as campus.glb.
 *
 * The MIT origin and northern Harvard Bridge axis come from the existing Cambridge
 * import. The core BU south bank now uses MassDEP hydrography and Storrow uses
 * MassGIS/MassDOT axes through bu-river-core-layout.ts. Other bank silhouettes,
 * pedestrian path edges and bridge switchbacks remain authored approximations.
 * No OSM extract is used.
 *
 * Geographic references (checked 2026-10-14):
 * https://www.bumc.bu.edu/citylab/files/2023/06/BU-Charles-River-Campus-Map.pdf
 * https://www.bu.edu/articles/2011/the-charles-river-to-the-right/
 * https://www.bu.edu/articles/2009/boston-a-runners-paradise/
 * https://www.bu.edu/chapel/about/directions-contact/
 * https://www.bu.edu/articles/2009/icons-among-us-the-bu-beach/
 * The route follows Harvard Bridge, the southern river path, and the modeled
 * Bay State Road footbridge; Silber Way supplies the second crossing. BU Beach is a lawn behind Marsh
 * Chapel; it is not a sandy beach and is separated from the river by the road.
 */
import {geoToWorld} from './geo-coordinates';
export {geoToWorld};
import type {WorldPoint} from './geo-coordinates';
export type {WorldPoint} from './geo-coordinates';
import {BU_WEST_NORTH_BANK,BU_WEST_SOUTH_BANK} from './bu-river-banks';
import {BU_CAMPUS_BOUNDS,BU_CAMPUS_ROADS,buExpresswayDistance,buCrossesExpressway} from './bu-campus-layout';
import {BU_CORE_SOUTH_BANK,BU_CORE_RIVER_WALK,BU_BAY_STATE_FOOTBRIDGE,BU_RIVER_FOOTBRIDGES,BU_SILBER_RIVER_LINK,buStorrowContains} from './bu-river-core-layout';
import {MIT_RESIDENCE_WALK_ROUTES} from './mit-residence-layout';

/** West -> east. Northern/eastern silhouettes retain the existing map fit;
 * the core southern section is replaced by the source hydrographic shoreline. */
export const NORTH_BANK: WorldPoint[] = [
  ...BU_WEST_NORTH_BANK, [-1600, 602], [-1380, 628], [-1160, 605],
  [-950, 555], [-730, 500], [-510, 443], [-400, 410],
  [-250, 344], [-100, 276], [-37.8756, 236], [100, 185],
  [260, 114], [420, 42], [600, -40],
];

export const SOUTH_BANK: WorldPoint[] = [
  ...BU_WEST_SOUTH_BANK,...BU_CORE_SOUTH_BANK,[360,767],[600,713],
];

/** Existing GIS-fitted bridge axis, extended to its Boston approach (~655 m). */
export const HARVARD_BRIDGE: [WorldPoint, WorldPoint] = [
  [-37.8756, 236], [189.837, 850],
];
export const HARVARD_BRIDGE_WIDTH = 18;
export const RIVER_PATH_WIDTH = 12;

/** Dry-ground spawn / interaction anchors, not building centres. */
export const LANDMARKS: Record<'charles' | 'harvardBridge' | 'buBeach' | 'buMarsh' | 'buCDS' | 'buQuestrom', WorldPoint> = {
  charles: [14, 208],
  harvardBridge: [67.5, 539],
  buBeach: [-1169.748, 907.449],
  buMarsh: [-1177.818, 981],
  buCDS: [-905.618, 1045],
  buQuestrom: [-632, 1098],
};

/** Building anchors are separate so quick travel cannot put a player in a wall. */
export const BU_BUILDING_ANCHORS = {
  marsh: geoToWorld(42.35070, -71.10640),
  cds: geoToWorld(42.35010, -71.10310),
  castle: geoToWorld(42.35087, -71.10364),
  questrom: geoToWorld(42.349612, -71.099727),
};

export const BU_FOOTBRIDGE=BU_BAY_STATE_FOOTBRIDGE;
export {BU_RIVER_FOOTBRIDGES,BU_SILBER_RIVER_LINK};

/** Southern riverside path: bridge landing -> west toward BU, safely inland. */
const harvardDx=HARVARD_BRIDGE[1][0]-HARVARD_BRIDGE[0][0],harvardDz=HARVARD_BRIDGE[1][1]-HARVARD_BRIDGE[0][1],harvardLength=Math.hypot(harvardDx,harvardDz);
const harvardWestWalk=(t:number):WorldPoint=>[HARVARD_BRIDGE[0][0]+harvardDx*t-harvardDz/harvardLength*7.55,HARVARD_BRIDGE[0][1]+harvardDz*t+harvardDx/harvardLength*7.55];
export const SOUTH_RIVER_WALK: WorldPoint[] = [
  // Descend from Harvard Bridge's west sidewalk onto the river side of Storrow;
  // the previous eastern approach crossed the newly restored carriageways.
  HARVARD_BRIDGE[1],harvardWestWalk(1),harvardWestWalk((790-HARVARD_BRIDGE[0][1])/harvardDz),[104,793],...BU_CORE_RIVER_WALK,
];

/** Only the existing west sidewalk and its modeled access ramp override the
 * road below. Match their rectangular 3 m / 6.2 m ribbons, with an edge inset;
 * rounded segment caps would open ground beyond the actual paved endpoints. */
function isHarvardRiverAccess(x:number,z:number){
  return [1,2].some(i=>{
    const a=SOUTH_RIVER_WALK[i],b=SOUTH_RIVER_WALK[i+1],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const along=((x-a[0])*dx+(z-a[1])*dz)/length;
    return along>=0&&along<=length&&Math.abs((x-a[0])*dz-(z-a[1])*dx)/length<=(i===1?1.35:2.95);
  });
}

/** Continuous route from Killian Court to BU Beach; no jump across the water. */
export const RIVER_WALK_ROUTE: WorldPoint[] = [
  [53.5, 52.5], [70, 125], [52, 172], LANDMARKS.charles,
  [-51.9685, 198], HARVARD_BRIDGE[0], HARVARD_BRIDGE[1],
  ...SOUTH_RIVER_WALK.slice(1), ...BU_FOOTBRIDGE.slice(1), LANDMARKS.buBeach,
];

/** Exterior viewing points, deliberately separate from unverified doorways. */
export const MIT_STATA_PLACES:Record<'vassar'|'west',WorldPoint>={vassar:[145,-340],west:[65,-305]};
/** The original teaching buildings close the direct northward line from
 * Killian. Follow the open eastern edge, then the Vassar frontage. */
export const MIT_STATA_APPROACH:WorldPoint[]=[
  RIVER_WALK_ROUTE[0],[112,102],[124,110],[194,70],[284,12],[286,2],
  [240,-144],[188,-244],[180,-292],[176,-324],[172,-328],MIT_STATA_PLACES.vassar,
];
export const MIT_STATA_WEST_ROUTE:WorldPoint[]=[
  MIT_STATA_PLACES.vassar,[132,-336],[124,-332],[116,-328],MIT_STATA_PLACES.west,
];
export const MIT_STATA_WALK_ROUTES=[MIT_STATA_APPROACH,MIT_STATA_WEST_ROUTE];

export const WORLD_BOUNDS = { minX: -3050, maxX: 700, minZ: -370, maxZ: 1600 };
export const BU_WALK_BOUNDS = BU_CAMPUS_BOUNDS;

/** The south-facing campus sidewalk, clear of CAS, CDS and Questrom facades. */
export const BU_STREET_ROUTE:WorldPoint[]=[
  LANDMARKS.buMarsh,[-1175,1000],[-1155,1006],[-945,1037],LANDMARKS.buCDS,
  [-830,1065],[-705,1083],LANDMARKS.buQuestrom,
];

export function isWithinWorldBounds(x: number, z: number) {
  return Number.isFinite(x) && Number.isFinite(z)
    && x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX
    && z >= WORLD_BOUNDS.minZ && z <= WORLD_BOUNDS.maxZ;
}

export function distanceToSegment(x: number, z: number, a: WorldPoint, b: WorldPoint) {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared)) : 0;
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}

export function isNearRoute(x: number, z: number, route: WorldPoint[], radius: number) {
  return route.some((point, i) => i > 0 && distanceToSegment(x, z, route[i - 1], point) <= radius);
}

/** Gameplay boundary follows rendered ground corridors; swimming is not enabled. */
const waterBoundary=[...NORTH_BANK,...[...SOUTH_BANK].reverse()];
export function isCharlesWater(x:number,z:number){
  let inside=false;
  for(let i=0,j=waterBoundary.length-1;i<waterBoundary.length;j=i++){
    const a=waterBoundary[i],b=waterBoundary[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
export function isWalkableWorld(x: number, z: number) {
  if (!isWithinWorldBounds(x, z)) return false;
  if (Math.hypot(x - 34, z - 5) <= 190 && z <= 160) return true;
  if(MIT_STATA_WALK_ROUTES.some(route=>isNearRoute(x,z,route,6)))return true;
  if(MIT_RESIDENCE_WALK_ROUTES.some(route=>isNearRoute(x,z,route,1.5)))return true;
  if (distanceToSegment(x, z, ...HARVARD_BRIDGE) < 8.1) return true;
  if (isHarvardRiverAccess(x,z)) return true;
  if (x >= BU_WALK_BOUNDS.minX && x <= BU_WALK_BOUNDS.maxX
    && z >= BU_WALK_BOUNDS.minZ && z <= BU_WALK_BOUNDS.maxZ) {
    // Storrow is not a pedestrian shortcut. These two elevated crossings keep
    // the campus/river connection while the highway stays outside walk bounds.
    if(BU_RIVER_FOOTBRIDGES.some(bridge=>isNearRoute(x,z,bridge.points,bridge.width/2-.15)))return true;
    if(isCharlesWater(x,z))return BU_CAMPUS_ROADS.some(road=>road.kind==='bridge'&&isNearRoute(x,z,road.points,road.width/2+road.sidewalk-.35));
    if(buStorrowContains(x,z,.2))return false;
    if(buExpresswayDistance(x,z)<3&&!buCrossesExpressway(x,z))return false;
    return true;
  }
  // Keep bridge movement inside its existing 18 m deck. Wider riverside ground
  // is allowed only off the river, never by expanding this bridge corridor.
  if (distanceToSegment(x, z, ...HARVARD_BRIDGE) < 8.1) return true;
  const northApproach = RIVER_WALK_ROUTE.slice(0, 6);
  return isNearRoute(x, z, northApproach, 7)
    || isNearRoute(x, z, SOUTH_RIVER_WALK, 7)
    || isNearRoute(x, z, BU_FOOTBRIDGE, 2.6)
    || distanceToSegment(x, z, BU_FOOTBRIDGE[BU_FOOTBRIDGE.length - 1], LANDMARKS.buBeach) < 7;
}
