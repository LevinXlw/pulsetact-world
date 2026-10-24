import {BU_CDS_SOUTH_DOORS,buCDSPoint} from './bu-cds-entry-layout';
import {BU_CDS_MAP_FEATURE,BU_CDS_YAW} from './bu-landmark-layout';
import {buElevation} from './bu-terrain';

export type CDSDoorId='west'|'east';
type Point=readonly [number,number];
export type CDSDoorPose={position:[number,number];lookAt:[number,number];height:number;/** Avatar yaw, not the camera's backwards-facing orbit yaw. */yaw:number};
export type CDSDoor={
  id:CDSDoorId;title:string;local:Point;width:number;
  threshold:{exteriorHeight:number;interiorHeight:number};
  exterior:CDSDoorPose;interior:CDSDoorPose;
};
export const CDS_DOOR_TRIGGER={halfWidth:1.15,exteriorNear:.25,exteriorFar:2.8,interiorNear:.15,interiorFar:2.5,heightTolerance:.3} as const;
const foundation=buElevation(BU_CDS_MAP_FEATURE.x,BU_CDS_MAP_FEATURE.z);

/** Original CDS local frame, with no exterior GLB sample-origin translation.
 * Door axes are shared authored approximations from the existing exterior,
 * not new measured positions. Its public apron follows the source DEM.
 */
export function cdsWorldToLocal(position:Point):[number,number]{
  const dx=position[0]-BU_CDS_MAP_FEATURE.x,dz=position[1]-BU_CDS_MAP_FEATURE.z;
  const c=Math.cos(BU_CDS_YAW),s=Math.sin(BU_CDS_YAW);
  return [dx*c-dz*s,dx*s+dz*c];
}
export const cdsLocalToWorld=(position:Point):[number,number]=>buCDSPoint(...position);

/** Height reference for the narrow exterior landing, matching its threshold
 * and DEM apron endpoints. Walk collision remains the authority for placement;
 * this reference only rejects other storeys/invalid vertical trigger positions.
 */
export function cdsDoorExteriorHeight(door:Pick<CDSDoor,'local'|'threshold'>,local:Point){
  const [x,z]=local,p=buCDSPoint(x,z),end=buCDSPoint(x,22.5);
  const t=Math.max(0,Math.min(1,(z-door.local[1]-.16)/(22.5-door.local[1]-.16)));
  return Math.max(buElevation(...p)+.039,door.threshold.exteriorHeight*(1-t)+(buElevation(...end)+.041)*t);
}

export const CDS_DOORS:readonly CDSDoor[]=BU_CDS_SOUTH_DOORS.map((source,index)=>{
  const id:CDSDoorId=index===0?'west':'east';
  const local=source.local,threshold={exteriorHeight:foundation+source.floor+.05,interiorHeight:0};
  const exteriorPosition=buCDSPoint(local[0],local[1]+1.9);
  const door:CDSDoor={id,title:index===0?'CDS 西侧入口':'CDS 东侧入口',local,width:source.width,threshold,
    exterior:{position:exteriorPosition,lookAt:buCDSPoint(local[0],local[1]+7),height:0,yaw:BU_CDS_YAW},
    interior:{position:[local[0],local[1]-2.25],lookAt:[local[0],local[1]-8],height:0,yaw:Math.PI},
  };
  door.exterior.height=cdsDoorExteriorHeight(door,[local[0],local[1]+1.9]);
  return door;
});
export const CDS_DOOR_BY_ID:Readonly<Record<CDSDoorId,CDSDoor>>={west:CDS_DOORS[0],east:CDS_DOORS[1]};

/** Exterior input is world XZ + absolute feet Y; interior input is the room's
 * local XZ + local feet Y. A door only activates on its own front side, within
 * the clear doorway width and on the first storey. No circular POI radius.
 */
export function getNearCDSDoor(position:Point,height:number,inside=false):CDSDoor|undefined{
  if(!Number.isFinite(position[0])||!Number.isFinite(position[1])||!Number.isFinite(height))return;
  const local=inside?position:cdsWorldToLocal(position),bounds=CDS_DOOR_TRIGGER;
  return CDS_DOORS.find(door=>{
    const lateral=Math.abs(local[0]-door.local[0]),distance=inside?door.local[1]-local[1]:local[1]-door.local[1];
    if(lateral>bounds.halfWidth||distance<(inside?bounds.interiorNear:bounds.exteriorNear)||distance>(inside?bounds.interiorFar:bounds.exteriorFar))return false;
    const expected=inside?door.threshold.interiorHeight:cdsDoorExteriorHeight(door,local);
    return Math.abs(height-expected)<=bounds.heightTolerance;
  });
}

/** Mutable per-visit data may be shared by UI and renderer without importing
 * React or writing animation state to the outdoor save. Openness is 0..1.
 */
export type CDSDoorAnimationState={doorId:CDSDoorId|null;phase:'closed'|'opening'|'open'|'closing';openness:number};
export function createCDSDoorAnimationState():CDSDoorAnimationState{return {doorId:null,phase:'closed',openness:0};}
