import {geoToWorld,type WorldPoint} from './geo-coordinates';
import {BU_FULL_BUILDINGS} from './bu-full-layout';

// City of Boston DOIT.buildings object 9741 is one connected Marsh/STH/CAS
// footprint, not just the chapel. Its custom flag suppresses the whole record
// in the district builder. Preserve its external ring here so custom detail
// cannot accidentally omit the connectors or the western end of CAS again.
// Source: assets-source/charles-bu/landmark-assembly-2026.json.
const marshSurvey=BU_FULL_BUILDINGS.find(b=>b.id==='marsh-sth')!;
// Keep navigation data independent of charles-geography (which imports the
// campus navigation module). This is the same georeferenced chapel anchor.
const marshAnchor=geoToWorld(42.35070,-71.10640),marshYaw=-.145;
const toMarshLocal=([x,z]:WorldPoint):WorldPoint=>{
  const dx=x-marshAnchor[0],dz=z-marshAnchor[1];
  return [dx*Math.cos(marshYaw)-dz*Math.sin(marshYaw),dx*Math.sin(marshYaw)+dz*Math.cos(marshYaw)];
};
const toMarshWorld=([x,z]:WorldPoint):WorldPoint=>[
  marshAnchor[0]+x*Math.cos(marshYaw)+z*Math.sin(marshYaw),
  marshAnchor[1]-x*Math.sin(marshYaw)+z*Math.cos(marshYaw),
];
// Only these two connected wings are split. No convex hull or bounding box:
// both would fill the real plaza recesses and shift the Comm Ave frontage.
function splitWing(ring:WorldPoint[],x:number,side:-1|1):WorldPoint[]{
  const result:WorldPoint[]=[];
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],da=(a[0]-x)*side,db=(b[0]-x)*side;
    if(da>=0)result.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);result.push([x,a[1]+t*(b[1]-a[1])]);}
  }
  return result;
}
const westRing=marshSurvey.footprint.slice(47,98).map(toMarshLocal);
const eastRing=marshSurvey.footprint.slice(13,43).map(toMarshLocal);
export const BU_MARSH_ASSEMBLY={
  sourceObjectId:9741,
  // Sample the foot of the chapel entrance stair: the old CAS junction sample
  // was ~0.48 m below its actual approach and buried the first three treads.
  // cas-east uses this same level so the attached compound remains rigid.
  foundationAnchor:toMarshWorld([-1.8,3.9+24.8*.82]),
  anchor:marshAnchor,yaw:marshYaw,
  footprint:marshSurvey.footprint,
  // Follow the actual inward-facing wing returns and chapel threshold; only
  // the open southern edge uses the existing Comm Ave approach limit.
  plazaFootprint:[...marshSurvey.footprint.slice(32,62).reverse(),toMarshWorld([30.986,57.5]),toMarshWorld([-36.094,57.5])],
  chapelFootprint:[...marshSurvey.footprint.slice(0,14),...marshSurvey.footprint.slice(42,48),...marshSurvey.footprint.slice(97)].map(p=>[...p] as WorldPoint),
  // The old 27 x 42 m aisle envelope exceeded the narrow central projection.
  // Fit its retained facade/roof detail, with the invented side aisles removed.
  // Detail placement remains approximate; collision uses the actual ring above.
  chapelFit:{x:-1.8,z:3.9,scaleX:.85,scaleZ:.82},
  // BU's frontal photo puts the monument west of the entrance, off its axis.
  // This offset is photo-interpreted, not a surveyed sculpture coordinate.
  memorial:{x:-14,z:42},
  wings:[
    // Cuts fall inside the continuous connector necks, before the recessed
    // wing returns. Cutting through those returns produces disjoint polygons.
    {id:'sth',name:'School of Theology · surveyed west wing',height:marshSurvey.height,footprint:splitWing(westRing,-32.25,-1).map(toMarshWorld)},
    {id:'sth-link',name:'Marsh west cloister connection',height:8.5,footprint:splitWing(westRing,-32.25,1).map(toMarshWorld)},
    {id:'cas-west',name:'CAS · surveyed western street frontage',height:marshSurvey.height,footprint:splitWing(eastRing,27.8,1).map(toMarshWorld)},
    {id:'cas-link',name:'Marsh east cloister connection',height:8.5,footprint:splitWing(eastRing,27.8,-1).map(toMarshWorld)},
  ],
} as const;

// Shared authored exterior dimensions. Structural module: project engineer
// Nathan C. Roy (LeMessurier), STRUCTURE, January 2022. Terrace order and the
// east podium orientation: BU/KPMB Town Hall, 3 December 2019, sheets 8–11.
// This is an exterior study, not an as-built footprint survey. See source notes.
export const BU_CDS_MODULE = 23 * .3048;
export const BU_CDS_PLATE = 115 * .3048;
export const BU_CDS_HEIGHT = 305 * .3048;
export const BU_CDS_YAW = -.145;
export const BU_CDS_PODIUM = {x:30,z:10.4,w:170*.3048,d:70*.3048,top:21.7} as const;
export const BU_CDS_STACK = [
  {x:-BU_CDS_MODULE/2,z:-BU_CDS_MODULE/2,bottom:5.6,top:31.2,floors:5},
  {x:BU_CDS_MODULE/2,z:-BU_CDS_MODULE/2,bottom:31.2,top:45.5,floors:3},
  {x:BU_CDS_MODULE/2,z:BU_CDS_MODULE/2,bottom:45.5,top:55.2,floors:2},
  {x:-BU_CDS_MODULE/2,z:BU_CDS_MODULE/2,bottom:55.2,top:69.6,floors:3},
  {x:-BU_CDS_MODULE/2,z:-BU_CDS_MODULE/2,bottom:69.6,top:79.2,floors:2},
] as const;

const [anchorX,anchorZ]=geoToWorld(42.35010,-71.10310);
const towerMin=-(BU_CDS_MODULE+BU_CDS_PLATE)/2,towerMax=(BU_CDS_PLATE-BU_CDS_MODULE)/2;
const left=BU_CDS_PODIUM.x-(BU_CDS_PODIUM.w-1.2)/2,right=BU_CDS_PODIUM.x+(BU_CDS_PODIUM.w-1.2)/2;
const back=BU_CDS_PODIUM.z-1-(BU_CDS_PODIUM.d-2)/2,front=BU_CDS_PODIUM.z-1+(BU_CDS_PODIUM.d-2)/2;
// Union of the two GROUND-LEVEL blocks. Upper cantilevers do not close the
// covered public approach on the map. Keep this module free of Three/builders.
export const BU_CDS_MAP_FEATURE = {
  id:'cds',name:'Duan Family Center for Computing & Data Sciences · CDS',address:'665 Commonwealth Avenue',
  x:anchorX,z:anchorZ,kind:'academic',custom:true,yaw:BU_CDS_YAW,
  width:right-towerMin,depth:front-towerMin,
  footprint:([[towerMin,towerMin],[towerMax,towerMin],[towerMax,back],[right,back],[right,front],[left,front],[left,towerMax],[towerMin,towerMax]] as WorldPoint[])
    .map(([x,z])=>[anchorX+x*Math.cos(BU_CDS_YAW)+z*Math.sin(BU_CDS_YAW),anchorZ-x*Math.sin(BU_CDS_YAW)+z*Math.cos(BU_CDS_YAW)] as WorldPoint),
  footprintSource:'Authored ground-level envelope shared with boston-university.ts; BU/KPMB landscape plan and project structural modules, not city survey',
};
