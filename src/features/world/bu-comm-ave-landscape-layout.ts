import {BU_OFFICIAL_ROAD_SEGMENTS} from './bu-road-data';
import {BU_FULL_BUILDINGS} from './bu-full-layout';
import {BU_MARSH_ASSEMBLY} from './bu-landmark-layout';

export type BUCASPoint=readonly [number,number];
export const BU_CAS_LANDSCAPE_BOUNDS=Object.freeze({minX:-1140,maxX:-975,minZ:990,maxZ:1050});
export const BU_CAS_CLEAR_WALK_DEPTH=Object.freeze({min:1.85,max:5.25});
/** Geometry is georeferenced; planting/bench spacing and these generous entry
 * openings are photo estimates, not a surveyed inventory of doors. */
export const BU_CAS_ENTRY_GAPS=Object.freeze([
  [-1124,-1116],[-1077,-1067],[-1048,-1035],[-1017,-1009],[-987,-978],
].map(v=>Object.freeze(v as [number,number])));
const northRoads=BU_OFFICIAL_ROAD_SEGMENTS.filter(r=>r.name==='COMMONWEALTH AVENUE'&&['massgis-360819-0','massgis-360817-0'].includes(r.id));
const roadEdges=northRoads.flatMap(r=>r.points.slice(1).map((b,i)=>{
  const first=r.points[i],a=first[0]<b[0]?first:b,end=first[0]<b[0]?b:first;
  const length=Math.hypot(end[0]-a[0],end[1]-a[1]);
  return {a,b:end,dx:(end[0]-a[0])/length,dz:(end[1]-a[1])/length,length};
}));
const frontRings=[BU_FULL_BUILDINGS.find(b=>b.id==='cas-east')!.footprint,BU_MARSH_ASSEMBLY.wings.find(b=>b.id==='cas-west')!.footprint];
const cross=(a:BUCASPoint,b:BUCASPoint)=>a[0]*b[1]-a[1]*b[0];
function facadeDistance(origin:BUCASPoint,normal:BUCASPoint){
  let hit=Infinity;
  for(const ring of frontRings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],edge:BUCASPoint=[b[0]-a[0],b[1]-a[1]],den=cross(normal,edge);
    if(Math.abs(den)<1e-8)continue;
    const delta:BUCASPoint=[a[0]-origin[0],a[1]-origin[1]],d=cross(delta,edge)/den,t=cross(delta,normal)/den;
    if(d>0&&t>=0&&t<=1)hit=Math.min(hit,d);
  }return hit;
}
/** d=0 is the outside of the existing 10.2 m north carriageway; positive d
 * points toward CAS. Keep this aligned with the shared street width. */
export function buCASFrameAt(x:number){
  const edge=roadEdges.find(e=>x>=e.a[0]&&x<=e.b[0]);if(!edge)return null;
  const z=edge.a[1]+(x-edge.a[0])*edge.dz/edge.dx,nx=edge.dz,nz=-edge.dx;
  const origin:BUCASPoint=[x+nx*5.1,z+nz*5.1];
  return {origin,dx:edge.dx,dz:edge.dz,nx,nz,depth:facadeDistance(origin,[nx,nz])};
}
export function buCASPointAt(x:number,d:number):BUCASPoint{
  const f=buCASFrameAt(x);if(!f)throw new Error(`No surveyed CAS street edge at ${x}`);
  return [f.origin[0]+f.nx*d,f.origin[1]+f.nz*d];
}
export function buCASCoordinates(x:number,z:number){
  let best:{sourceX:number;depth:number;facadeDepth:number;distance:number}|null=null;
  for(const e of roadEdges){
    const t=Math.max(0,Math.min(e.length,(x-e.a[0])*e.dx+(z-e.a[1])*e.dz));
    const px=e.a[0]+e.dx*t,pz=e.a[1]+e.dz*t,distance=Math.hypot(x-px,z-pz),f=buCASFrameAt(px);
    if(f&&(!best||distance<best.distance))best={sourceX:px,depth:(x-px)*e.dz-(z-pz)*e.dx-5.1,facadeDepth:f.depth,distance};
  }return best;
}
/** Use for OLD street-tree roots AND their old square pits. This deliberately
 * also clears old roots from entry gaps and the unobstructed central walk. It
 * excludes south carriageway, buildings, Bay State Road and Marsh Plaza. */
export function buCASLandscapeReplaces(x:number,z:number){
  const b=BU_CAS_LANDSCAPE_BOUNDS;if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)return false;
  const p=buCASCoordinates(x,z);
  return !!p&&p.sourceX>=-1137&&p.sourceX<=-979&&p.depth>=-.15&&p.depth<=Math.min(14,p.facadeDepth-.7)&&p.facadeDepth<25;
}
export function buCASIsEntry(sourceX:number,padding=0){return BU_CAS_ENTRY_GAPS.some(([a,b])=>sourceX>=a-padding&&sourceX<=b+padding);}
export type BUCASBed={readonly id:string;readonly row:'street'|'building';readonly from:number;readonly to:number;readonly near:number;readonly far:number;readonly benchX:number|null};
const modules=[[-1136,-1126],[-1114,-1101],[-1098,-1080],[-1065,-1051],[-1033,-1020],[-1007,-990]] as const;
export const BU_CAS_BEDS:readonly BUCASBed[]=Object.freeze(modules.flatMap(([from,to],index)=>{
  const depth=Math.min(...[from,(from+to)/2,to].map(x=>buCASFrameAt(x)?.depth??0));
  if(depth<9||depth>25)return [];
  return [Object.freeze({id:`cas-street-${index}`,row:'street' as const,from,to,near:.30,far:1.55,benchX:(from+to)/2}),
    Object.freeze({id:`cas-building-${index}`,row:'building' as const,from:from+.7,to:to-.8,near:5.65,far:Math.min(10.2,depth-1.4),benchX:null})];
}));
export const BU_CAS_CLEAR_WALK:readonly BUCASPoint[]=Object.freeze(Array.from({length:34},(_,i)=>Object.freeze(buCASPointAt(-1138+i*4.8,2.7))));
export const BU_CAS_TREE_SITES=Object.freeze(BU_CAS_BEDS.flatMap((bed,i)=>{
  const xs=bed.row==='street'?[bed.from+2.3,bed.to-2.5]:[(bed.from+bed.to)/2-1.4];
  return xs.filter(x=>!buCASIsEntry(x,1)).map((x,j)=>{
    const p=buCASPointAt(x,bed.row==='street'?.91:Math.min(bed.far-.9,7.4));
    return Object.freeze({x:p[0],z:p[1],radius:bed.row==='street'?3.3+(i%3)*.18:4.25+(i%2)*.3,height:bed.row==='street'?12.2+(j%2)*.7:14.8+(i%3)*.35});
  });
}));
