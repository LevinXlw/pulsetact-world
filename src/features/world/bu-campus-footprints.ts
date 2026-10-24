import {BU_FULL_BUILDINGS,type BUCampusBuilding} from './bu-full-layout';
import {BU_SERT_FRAME,BU_SERT_GROUND_PARTS,BU_SERT_MUGAR_FOOTPRINT,BU_SERT_PARTS,type BUSertPart} from './bu-sert-layout';
import type {WorldPoint} from './geo-coordinates';

type FootprintRecord=BUCampusBuilding&{raised?:boolean;parentId?:string};
function partRecord(part:BUSertPart,footprint=part.footprint):FootprintRecord{
  const xs=footprint.map(p=>p[0]),zs=footprint.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const mugar=part.id.startsWith('mugar'),gsu=part.id.startsWith('gsu');
  return{id:`sert-${part.id}`,name:part.name,address:gsu?'775 Commonwealth Avenue':mugar?'771 Commonwealth Avenue':'765 Commonwealth Avenue',kind:gsu?'academic':'library',x:(minX+maxX)/2,z:(minZ+maxZ)/2,width:maxX-minX,depth:maxZ-minZ,yaw:BU_SERT_FRAME.yaw,height:part.top-part.bottom,groundElevation:null,heightSource:part.id==='redstone-main'?'official-bu':'estimated',heightField:part.id==='redstone-main'?'BU PNF 2012: 76 feet':'BU plan/section interpretation',cityObjectId:part.surveyed?2322:0,universityOwned:true,footprint:footprint.map(p=>[...p] as WorldPoint),footprintSource:part.surveyed?'city-gis-2322-partition':'bu-pnf-2012-plan-trace',raised:part.kind==='bridge',parentId:'gsu-mugar'};
}

/** Current ground-level occupancy. Keep the imported source dataset unchanged;
 * consumers must not reuse its pre-2014 joined GSU/Mugar polygon as collision.
 * Elevated Pappas/library links and the upper-floor overhangs stay walkable below.
 */
export const BU_GROUND_BUILDINGS:FootprintRecord[]=[
  ...BU_FULL_BUILDINGS.filter(building=>building.id!=='gsu-mugar'),
  ...BU_SERT_GROUND_PARTS.map(part=>partRecord(part)),
];

// Search names represent places, not every vertical subdivision of a building.
// The map still shows the actual roof footprint of the raised Pappas connector,
// using a dashed outline so the route below it does not read as a wall crossing.
const mapSert=BU_SERT_PARTS.filter(part=>['gsu','gsu-link','mugar-west','redstone-main','redstone-atrium','pappas','pappas-bridge','redstone-north-bay'].includes(part.id)).map(part=>{
  const record=partRecord(part,part.id==='mugar-west'?BU_SERT_MUGAR_FOOTPRINT:part.footprint);
  if(part.id==='mugar-west'){record.name='Mugar Memorial Library';record.id='sert-mugar';}
  if(part.id==='pappas')record.name='Pappas Law Library / Law Auditorium';
  return record;
});
export const BU_MAP_BUILDINGS:FootprintRecord[]=[...BU_FULL_BUILDINGS.filter(building=>building.id!=='gsu-mugar'),...mapSert];
