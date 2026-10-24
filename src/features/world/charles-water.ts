import {createCampusWaterMaterial,createCampusWaterShoreField,type CampusWaterQuality} from './campus-water';
import {NORTH_BANK,SOUTH_BANK} from './charles-geography';

/** Same sparse river polygon on phone and desktop, with a 32 KiB bank-distance
 * field. This is proximity to the shore, not surveyed river depths. */
export function createCharlesWaterMaterial(time:{value:number},quality:CampusWaterQuality='desktop'){
  const banks=[NORTH_BANK,SOUTH_BANK],points=banks.flat();
  const shore=createCampusWaterShoreField(banks,[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]);
  const material=createCampusWaterMaterial({name:'Charles River natural water',time,quality,shore});
  material.addEventListener('dispose',()=>shore.texture.dispose());
  return material;
}
