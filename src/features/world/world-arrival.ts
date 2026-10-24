import {BU_FULL_PLACES,buNavigationBlocked} from './bu-campus-layout';
import {campusSpawn,campusPlaces,insideCampus,walkableCampus,type CampusId} from './campus-regions';
import type {WorldPoint} from './geo-coordinates';
import {marylandNavigationBlocked} from './maryland-layout';
import {arizonaNavigationBlocked} from './arizona-geography';

export type WorldArrival={position:WorldPoint;height:number};
type GroundHeight=(x:number,z:number)=>number|undefined;

/** Resolve only the arrival coordinates. Saved discoveries and lesson progress
 * remain untouched when a newer campus model occupies an older checkpoint. */
export function resolveWorldArrival(campus:CampusId,requested:readonly [number,number]|undefined,groundHeight:GroundHeight,fallback:readonly [number,number]=campusSpawn(campus)):WorldArrival|undefined {
  const blocked=(x:number,z:number)=>campus==='boston'?buNavigationBlocked(x,z):campus==='umd'?marylandNavigationBlocked(x,z):campus==='arizona'?arizonaNavigationBlocked(x,z):false;
  const land=(position:readonly [number,number]):WorldArrival|undefined=>{
    const [x,z]=position;
    if(!Number.isFinite(x)||!Number.isFinite(z)||!walkableCampus(campus,x,z)||blocked(x,z))return;
    const height=groundHeight(x,z);
    if(height===undefined||!Number.isFinite(height))return;
    return{position:[x,z],height};
  };
  if(requested){
    const unchanged=land(requested);if(unchanged)return unchanged;
    // Building centres can have valid terrain underneath. A ground ray alone
    // therefore cannot establish that a returning player is outside the walls.
    if(insideCampus(campus,...requested)&&blocked(...requested)){
      const places=campus==='boston'?BU_FULL_PLACES:campusPlaces(campus);
      const nearby=places.map(place=>({position:place.position,distance:Math.hypot(place.position[0]-requested[0],place.position[1]-requested[1])})).sort((a,b)=>a.distance-b.distance);
      for(const place of nearby){const arrival=land(place.position);if(arrival)return arrival;}
    }
  }
  return land(fallback)??land(campusSpawn(campus));
}
