import {BU_FULL_BUILDINGS} from './bu-full-layout';
import {BU_ROAD_EDGES} from './bu-campus-layout';
import {buClipSidewalkToJunctions} from './bu-public-realm';
import type {WorldPoint} from './geo-coordinates';

const building=BU_FULL_BUILDINGS.find(b=>b.id==='warren-towers')!;
const ring=building.footprint;
// The north frontage is collinear in the City footprint. Use its two extreme
// vertices, not a rectangular building AABB or a newly authored street edge.
const north=ring.filter(p=>p[1]<building.z+1&&p[0]<-895.6);
const west=north.reduce((a,b)=>a[0]<b[0]?a:b),east=north.reduce((a,b)=>a[0]>b[0]?a:b);
const length=Math.hypot(east[0]-west[0],east[1]-west[1]);
const dx=(east[0]-west[0])/length,dz=(east[1]-west[1])/length;
export const BU_WARREN_FRONT=Object.freeze({west,east,length,dx,dz,nx:dz,nz:-dx,buildingAnchor:[building.x,building.z] as WorldPoint});
/** Shares the existing photograph-estimated entrance location and dimensions
 * with the Warren facade. These are not measured door survey coordinates. */
export const BU_WARREN_ENTRY=Object.freeze({along:length*.551,width:12.5,thresholdDepth:.38,rampDepth:2.4});
export const BU_WARREN_PAVER_WIDTH=.4064; // EPNF existing 16 inch infiltration strip.
export function buWarrenPoint(along:number,depth:number):WorldPoint{
  return [west[0]+dx*along+dz*depth,west[1]+dz*along-dx*depth];
}
export function buWarrenCoordinates(x:number,z:number){
  return {along:(x-west[0])*dx+(z-west[1])*dz,depth:(x-west[0])*dz-(z-west[1])*dx};
}
const cross=(a:WorldPoint,b:WorldPoint)=>a[0]*b[1]-a[1]*b[0];
const avenues=BU_ROAD_EDGES.filter(e=>e.road.name==='COMMONWEALTH AVENUE');
/** Intersect every real carriageway segment, rather than clamping a 166 m
 * facade to one nearest segment's endpoint (which left triangular grass gaps).
 * Positive depth points from the building toward the south carriageway. */
export function buWarrenCurbDepth(along:number){
  const origin=buWarrenPoint(along,0),normal:WorldPoint=[dz,-dx];let result=Infinity;
  for(const {a,b,road} of avenues){
    const vx=b[0]-a[0],vz=b[1]-a[1],len=Math.hypot(vx,vz);
    if(len<.001)continue;
    const nx=-vz/len,nz=vx/len;
    for(const side of [-1,1]){
      const start:WorldPoint=[a[0]+nx*road.width/2*side,a[1]+nz*road.width/2*side],edge:WorldPoint=[vx,vz],den=cross(normal,edge);
      if(Math.abs(den)<1e-9)continue;
      const delta:WorldPoint=[start[0]-origin[0],start[1]-origin[1]],depth=cross(delta,edge)/den,t=cross(delta,normal)/den;
      // Parallel curb offsets do not share their centerline's end point at a
      // bend. A bounded 30 cm corner extension closes that millimetre-scale
      // join, instead of accidentally returning the FAR side of this road.
      if(depth>0&&depth<18&&t>=-.30/len&&t<=1+.30/len)result=Math.min(result,depth);
    }
  }
  if(!Number.isFinite(result))throw new Error(`Warren frontage has no source street edge at ${along}`);
  return result;
}

/** Preserve the four actual, already accepted runtime tree/pit sites. They are
 * procedural placements, not a claimed 2026 arboricultural survey. None blocks
 * the main entrance, so this pass neither deletes nor duplicates those trees. */
export const BU_WARREN_RETAINED_TREE_PITS=Object.freeze([
  [-1049.2834123525677,1058.9847448997334],[-1016.2287394853753,1064.434392704568],
  [-981.5744537710896,1070.1476784188537],[-921.4175907655055,1079.7887138398157],
].map(p=>Object.freeze(p as WorldPoint)));
const clip=(points:WorldPoint[],distance:(p:WorldPoint)=>number)=>{
  const result:WorldPoint[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b);
    if(da>=0)result.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
  }return result;
};
function excludePits(input:WorldPoint[][]){
  let parts=input;
  for(const [x,z] of BU_WARREN_RETAINED_TREE_PITS){
    const half=.966,planes=[(p:WorldPoint)=>p[0]-x+half,(p:WorldPoint)=>x+half-p[0],(p:WorldPoint)=>p[1]-z+half,(p:WorldPoint)=>z+half-p[1]];
    const next:WorldPoint[][]=[];
    for(const part of parts){
      if(!part.some(p=>p[0]>=x-half&&p[0]<=x+half&&p[1]>=z-half&&p[1]<=z+half)&&
        (Math.max(...part.map(p=>p[0]))<x-half||Math.min(...part.map(p=>p[0]))>x+half||Math.max(...part.map(p=>p[1]))<z-half||Math.min(...part.map(p=>p[1]))>z+half)){next.push(part);continue;}
      let remaining=part;
      for(const plane of planes){const outside=clip(remaining,p=>-plane(p));if(outside.length>2)next.push(outside);remaining=clip(remaining,plane);if(remaining.length<3)break;}
    }parts=next;
  }return parts.filter(p=>p.length>2&&Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0))>.00001);
}
export type BUWarrenPavingPatch={finish:'concrete'|'pavers';points:WorldPoint[]};
export const BU_WARREN_PAVING:readonly BUWarrenPavingPatch[]=Object.freeze((()=>{
  const cuts=new Set<number>([.03,length-.03]);
  for(let s=2;s<length;s+=2)cuts.add(s);
  const entry=BU_WARREN_ENTRY;
  for(const shift of [-entry.width/2-1,-entry.width/2,0,entry.width/2,entry.width/2+1])cuts.add(entry.along+shift);
  const sorted=[...cuts].sort((a,b)=>a-b),patches:BUWarrenPavingPatch[]=[];
  const add=(finish:BUWarrenPavingPatch['finish'],points:WorldPoint[])=>{
    for(const part of excludePits(buClipSidewalkToJunctions(points,'COMMONWEALTH AVENUE')))patches.push({finish,points:part});
  };
  for(let i=1;i<sorted.length;i++){
    const a=sorted[i-1],b=sorted[i],ca=buWarrenCurbDepth(a)-.22,cb=buWarrenCurbDepth(b)-.22;
    const entryPanel=Math.abs((a+b)/2-entry.along)<entry.width/2;
    const near=entryPanel?entry.thresholdDepth:.012;
    // Keep the physical joint at the top of the shallow entrance transition;
    // no coplanar overlay over the facade's existing stone threshold.
    add('concrete',[buWarrenPoint(a,near),buWarrenPoint(b,near),buWarrenPoint(b,entry.rampDepth),buWarrenPoint(a,entry.rampDepth)]);
    add('concrete',[buWarrenPoint(a,entry.rampDepth),buWarrenPoint(b,entry.rampDepth),buWarrenPoint(b,cb-BU_WARREN_PAVER_WIDTH),buWarrenPoint(a,ca-BU_WARREN_PAVER_WIDTH)]);
    add('pavers',[buWarrenPoint(a,ca-BU_WARREN_PAVER_WIDTH),buWarrenPoint(b,cb-BU_WARREN_PAVER_WIDTH),buWarrenPoint(b,cb),buWarrenPoint(a,ca)]);
  }return patches;
})());
