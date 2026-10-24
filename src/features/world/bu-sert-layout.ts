import {BU_FULL_BUILDINGS} from './bu-full-layout';

type Point=readonly[number,number];
export type BUSertPart={id:string;name:string;kind:'union'|'link'|'mugar'|'boiler'|'redstone'|'atrium'|'mechanical'|'pappas'|'bridge';footprint:readonly Point[];bottom:number;top:number;levels:number;surveyed:boolean};

/** Boston GIS 2322 is the pre-2014, joined Sert outline. Split its existing
 * volumes along the axes in BU's 2012 PNF, figures 1-3, 3-2 and 3-13. Redstone
 * is a separately traced addition, not a claim of new surveyed geometry.
 * https://www.bu.edu/community/files/2012/06/FinalPNF-EENF6-15-12Small.pdf
 * Its 76/98-foot roof heights are documented in section 7.4. Other low-building
 * levels are estimated from the published section/elevation and storey counts.
 */
const source=BU_FULL_BUILDINGS.find(building=>building.id==='gsu-mugar')!;
export const BU_SERT_FRAME={x:-1324.827,z:867.156,yaw:-.15750380714639708};
// Keep the existing rigid foundation datum on the southern Mugar facade.
// This is not the public entrance: that is inside the GSU Link. Its threshold
// is fitted separately to the approach grade, without moving the whole complex.
export const BU_SERT_FOUNDATION_ANCHOR=[-1329.3179982208444,952.8118283771768] as const;
export function buSertPoint(x:number,z:number):Point{
  const p=BU_SERT_FRAME,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
  return[p.x+x*c+z*s,p.z-x*s+z*c];
}
export function buSertLocal(point:Point):Point{
  const p=BU_SERT_FRAME,c=Math.cos(p.yaw),s=Math.sin(p.yaw),x=point[0]-p.x,z=point[1]-p.z;
  return[x*c-z*s,x*s+z*c];
}
const polygon=(points:readonly Point[])=>points.map(([x,z])=>buSertPoint(x,z));
function clip(points:readonly Point[],left:number,top:number,right:number,bottom:number):Point[]{
  let ring=points.map(buSertLocal);
  for(const [axis,limit,direction] of [[0,left,1],[0,right,-1],[1,top,1],[1,bottom,-1]]){
    const next:Point[]=[];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],da=(a[axis]-limit)*direction,db=(b[axis]-limit)*direction;
      if(da>=0)next.push(a);
      if((da>=0)!==(db>=0)){const t=da/(da-db);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
    }ring=next;
  }
  return polygon(ring);
}
const unionRing=source.footprint.slice(64,171);
const mugarRing=[...source.footprint.slice(0,4),...source.footprint.slice(47,51),buSertPoint(46.22,65.59),...source.footprint.slice(55,64),...source.footprint.slice(171)];
export const BU_SERT_MUGAR_FOOTPRINT:readonly Point[]=mugarRing;
const existing=(id:string,name:string,kind:BUSertPart['kind'],bounds:readonly[number,number,number,number],top:number,levels:number,bottom=0,ring:readonly Point[]=source.footprint):BUSertPart=>({id,name,kind,footprint:clip(ring,...bounds),bottom,top,levels,surveyed:true});
const traced=(id:string,name:string,kind:BUSertPart['kind'],points:readonly Point[],top:number,levels:number,bottom=0):BUSertPart=>({id,name,kind,footprint:polygon(points),bottom,top,levels,surveyed:false});

export const BU_SERT_PARTS:readonly BUSertPart[]=[
  existing('gsu','George Sherman Union','union',[-100,-10,-22,110],17.92,3,0,unionRing),
  // One occupied connector, with a two-storey-high south window wall.
  // Height estimated from BU's 2023 GSU exterior photograph, not a survey;
  // PNF §4.3.4 explicitly describes the original two-storey-high entry glazing.
  existing('gsu-link','GSU–Mugar Link','link',[-25,65.12,0,74.54],7.4,1),
  existing('mugar-west','Mugar west stack','mugar',[-8,-1,18.25,86],21.7,6,0,mugarRing),
  existing('mugar-east-five','Mugar east upper step','mugar',[18.25,-1,27.2,65.59],18.3,5,0,mugarRing),
  existing('mugar-east-four','Mugar east middle step','mugar',[27.2,-1,36.6,65.59],15.0,4,0,mugarRing),
  existing('mugar-east-three','Mugar east lower step','mugar',[36.6,-1,46.22,65.59],11.7,3,0,mugarRing),
  existing('central-boiler','Central Boiler Plant','boiler',[46.22,13.79,78.53,30.99],4.8,1),
  // The 1982 Mugar entrance/stairs at local x46.22..52.95, z52.26..65.59
  // were removed for the addition. The old city outline must not fill this slot.
  traced('redstone-main','Sumner M. Redstone Building','redstone',[[50,0],[70.5,0],[70.5,12.4],[78.4,12.4],[78.4,40.17],[74,40.17],[74,56],[82,56],[82,65.59],[50,65.59]],23.1648,5),
  traced('redstone-atrium','Robert T. Butler Atrium','atrium',[[74,40.17],[94.35,40.17],[94.35,53],[82,53],[82,56],[74,56]],10.8,2),
  traced('redstone-plant','Redstone setback mechanical floor','mechanical',[[56,12.4],[78.4,12.4],[78.4,40.17],[74,40.17],[74,56],[56,56]],29.8704,1,23.1648),
  traced('redstone-north-bay','Redstone cantilevered north lounge','bridge',[[44,0],[70.5,0],[70.5,11.8],[44,11.8]],23.1648,1,19.0),
  traced('pappas-base','Law Auditorium recessed ground floor','pappas',[[104.3,22.4],[123.8,22.4],[123.8,59.6],[104.3,59.6]],4.5,1),
  existing('pappas','Pappas Law Library','pappas',[102.89,21,125.17,59.61],14.2,2,4.5),
  // This is an elevated, enclosed library connection; the ground-level route
  // between Pappas and the tower remains outdoors and must not get a solid wall.
  existing('pappas-bridge','Pappas third-floor link','bridge',[97.54,30.56,103,40.02],13.2,1,8.8),
];

/** Plain footprint records shared with 2D navigation/offline phone baking.
 * Raised roof equipment and the third-floor bridge do not close ground paths.
 */
export const BU_SERT_GROUND_PARTS=BU_SERT_PARTS.filter(part=>part.bottom===0);
/** The public entrance faces Commonwealth Ave, with GSU left and Mugar right.
 * The anchor is the centre of the Link's GIS south edge, not a measured door.
 * https://www.bu.edu/reservations/gsu/
 * https://www.bu.edu/library/find-access/borrowing/bu-libraries-2-go/
 */
export const BU_SERT_LINK_ENTRY={
  local:[-12.52,74.534] as const,
  position:buSertPoint(-12.52,74.534),
  arrival:buSertPoint(-12.52,91),
} as const;
export const BU_SERT_PUBLIC_PASSAGES=[
  {id:'law-east-west',width:5.2,points:polygon([[21,71],[48,71],[86,71],[115,71]])},
  {id:'pappas-tower',width:3.2,points:polygon([[100.4,7],[100.4,48],[100.4,65],[115,71]])},
] as const;
export const BU_SERT_FORECOURTS:readonly {id:string;footprint:readonly Point[];pavingStyle?:'stone'|'brick'}[]=[
  {id:'redstone-entry-forecourt',footprint:polygon([[82.1,56],[94.5,56],[94.5,53.2],[98.4,53.2],[98.4,64],[116,64],[116,73.6],[21,73.6],[21,65.9],[82.1,65.9]])},
  {id:'mugar-forecourt',footprint:polygon([[-22.5,85.5],[18.8,85.5],[18.8,102],[-22.5,102]])},
  {id:'gsu-link-approach',pavingStyle:'brick',footprint:polygon([[-22.4,74.534],[-.25,74.534],[-.25,85.5],[-22.4,85.5]])},
] as const;
