/** CDS public interior study in its own local metre frame (x east, z south).
 * The public-space arrangement follows BU's 2019 DPIR Figs 2-12/2-13 and
 * 2023 opening photographs. Dimensions/door axes are authored estimates,
 * matching the interior model, not a surveyed or seamless exterior fit.
 */
export const CDS_INTERIOR_LEVELS = {first:0,second:5.6} as const;
export const CDS_INTERIOR_SPAWN:[number,number] = [44.2,16.8];
export const CDS_INTERIOR_LOOK_AT:[number,number] = [34,12];
export const CDS_INTERIOR_EXITS = [
  {id:'cds-south-main',title:'返回 Commonwealth Avenue',position:[30.2,18.15] as [number,number],radius:1.55},
  {id:'cds-south-east',title:'返回 Commonwealth Avenue',position:[44.2,18.15] as [number,number],radius:1.55},
] as const;
export const CDS_INTERIOR_OUTLINE = [
  [-21.0312,-21.0312],[14.0208,-21.0312],[14.0208,-.268],
  [55.308,-.268],[55.308,19.068],[4.692,19.068],
  [4.692,14.0208],[-21.0312,14.0208],
] as const;

/** The narrow inset keeps the player's centre away from exterior glazing.
 * This is only the envelope gate; real floor/void/obstacle proxies determine
 * which places inside it are reachable on the player's current storey.
 */
export function isInsideCDSInterior(x:number,z:number){
  const margin=.18;
  return Number.isFinite(x)&&Number.isFinite(z)
    &&x>=-21.0312+margin&&x<=55.308-margin
    &&z>=-21.0312+margin&&z<=19.068-margin
    &&(x<=14.0208-margin||z>=-.268+margin)
    &&(x>=4.692+margin||z<=14.0208-margin);
}

// Walking centre lines, including approach/landing points. Heights are not
// forced by the controller: it samples the exported physical treads.
export const CDS_INTERIOR_GRAND_ROUTE:readonly (readonly [number,number])[] = [
  [31.2,13.04],[30.05,13.04],[6.96,13.04],[5.92,13.04],[5.92,11],
];
const butterflyCenter=[21.620498657226562,3.803403854370117] as const;
const butterflyTangent1=[20.376955032348633,2.5020205974578857] as const;
const butterflyTangent2=[23.41422462463379,3.6532318592071533] as const;
const startAngle=Math.atan2(butterflyTangent1[1]-butterflyCenter[1],butterflyTangent1[0]-butterflyCenter[0]);
let endAngle=Math.atan2(butterflyTangent2[1]-butterflyCenter[1],butterflyTangent2[0]-butterflyCenter[0]);
while(endAngle<startAngle)endAngle+=Math.PI*2;
export const CDS_INTERIOR_BUTTERFLY_ROUTE:readonly (readonly [number,number])[] = [
  [13.6,9.0],[14.1,8.5],butterflyTangent1,
  ...Array.from({length:23},(_,i)=>{const angle=startAngle+(endAngle-startAngle)*(i+1)/24;return [butterflyCenter[0]+Math.cos(angle)*1.8,butterflyCenter[1]+Math.sin(angle)*1.8] as const;}),
  butterflyTangent2,[24,10.65],[24,11.4],[27.8,11.4],
];
