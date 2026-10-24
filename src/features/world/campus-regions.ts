import {WORLD_SPAWN,WORLD_PORTICO} from './world-locations';
import {isWalkableWorld,isWithinWorldBounds,type WorldPoint} from './charles-geography';
import {MARYLAND_LAYOUT} from './maryland-layout';
import {PENN_LAYOUT} from './penn-layout';
import {ARIZONA_LAYOUT} from './arizona-layout';
import {guideCampusPaths} from './campus-paths';

export type CampusId='boston'|'umd'|'upenn'|'arizona';
export type RemoteCampusId=Exclude<CampusId,'boston'>;
export type CampusPlaceId='umd-library'|'umd-mall'|'umd-administration'|'umd-stamp'|'umd-armory'|'umd-chapel'
  |'umd-hornbake'|'umd-clarice'|'umd-secu'|'umd-eppley'|'umd-north-residences'|'umd-xfinity'|'umd-science'
  |'umd-iribe'|'umd-clark'|'umd-south-hill'|'umd-van-munching'|'umd-rossborough'|'umd-leonardtown'
  |'penn-college'|'penn-green'|'penn-fisher'
  |'arizona-old-main'|'arizona-mall'|'arizona-union'|'arizona-library'|'arizona-bear-down'
  |'arizona-eller'|'arizona-enr2'|'arizona-stadium'|'arizona-museum';
export type CampusDistrict={id:string;name:string;center:WorldPoint;description:string};
export type CampusPlace={id:CampusPlaceId;title:string;subtitle:string;position:WorldPoint;lookAt?:WorldPoint;view?:{pitch:number;distance:number};radius:number;description:string;note:string;district?:string};
export type CampusLayout={
  bounds:{minX:number;maxX:number;minZ:number;maxZ:number};
  spawn:WorldPoint;lookTarget:WorldPoint;route:WorldPoint[];points:CampusPlace[];
  /** Connected walkways; route remains the principal promenade. */
  paths?:WorldPoint[][];
  districts?:CampusDistrict[];
  mapBuildings:{x:number;z:number;width:number;depth:number;yaw:number;label:string;district?:string;footprint?:WorldPoint[];holes?:WorldPoint[][]}[];
};
export const REMOTE_LAYOUTS:Record<RemoteCampusId,CampusLayout>={umd:MARYLAND_LAYOUT,upenn:PENN_LAYOUT,arizona:ARIZONA_LAYOUT};
export const CAMPUS_REGIONS=[
  {id:'boston' as const,title:'Boston · 大学城',short:'Boston',eyebrow:'CAMBRIDGE ↔ BOSTON · MASSACHUSETTS',label:'MIT · BOSTON UNIVERSITY',detail:'CHARLES RIVER',description:'从 Killian Court 出发，沿查尔斯河走到 BU。',color:'#77906b'},
  {id:'umd' as const,title:'University of Maryland',short:'UMD',eyebrow:'COLLEGE PARK · MARYLAND',label:'UNIVERSITY OF MARYLAND',detail:'COLLEGE PARK',description:'从 McKeldin Mall 出发，走进艺术、工程、体育与生活区。',color:'#a46b53'},
  {id:'upenn' as const,title:'University of Pennsylvania',short:'UPenn',eyebrow:'PHILADELPHIA · PENNSYLVANIA',label:'UNIVERSITY OF PENNSYLVANIA',detail:'COLLEGE GREEN',description:'在树荫与石砌拱券之间，寻找校园的不同年代。',color:'#577b79'},
  {id:'arizona' as const,title:'University of Arizona',short:'Arizona',eyebrow:'TUCSON · ARIZONA',label:'UNIVERSITY OF ARIZONA',detail:'SONORAN CAMPUS',description:'从 Old Main 的环廊出发，穿过棕榈与阳光下的 University Mall。',color:'#b57955'},
];
export function normalizeCampus(value:unknown):CampusId{return value==='umd'||value==='upenn'||value==='arizona'?value:'boston';}
export function campusRegion(id:CampusId){return CAMPUS_REGIONS.find(region=>region.id===id)!;}
export function campusSpawn(id:CampusId):WorldPoint{return id==='boston'?[...WORLD_SPAWN]:[...REMOTE_LAYOUTS[id].spawn];}
export function campusLookTarget(id:CampusId):WorldPoint{return id==='boston'?[...WORLD_PORTICO]:[...REMOTE_LAYOUTS[id].lookTarget];}
export function campusPlaces(id:CampusId):CampusPlace[]{return id==='boston'?[]:REMOTE_LAYOUTS[id].points;}
export const ALL_CAMPUS_PLACES=Object.values(REMOTE_LAYOUTS).flatMap(layout=>layout.points);
export function campusForPlace(id:string):RemoteCampusId|undefined{return (Object.keys(REMOTE_LAYOUTS) as RemoteCampusId[]).find(campus=>REMOTE_LAYOUTS[campus].points.some(point=>point.id===id));}
export function insideCampus(id:CampusId,x:number,z:number){
  if(!Number.isFinite(x)||!Number.isFinite(z))return false;
  if(id==='boston')return isWithinWorldBounds(x,z);
  const b=REMOTE_LAYOUTS[id].bounds;return x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;
}
export function walkableCampus(id:CampusId,x:number,z:number){return id==='boston'?isWalkableWorld(x,z):insideCampus(id,x,z);}
export function nearestCampusPlace(id:CampusId,position:WorldPoint){
  return campusPlaces(id).map(point=>({point,distance:Math.hypot(position[0]-point.position[0],position[1]-point.position[1])}))
    .filter(item=>item.distance<=item.point.radius).sort((a,b)=>a.distance-b.distance)[0]?.point;
}

/** Follow the authored campus paths; never direct the player through a facade. */
export function campusNavigationGuide(id:RemoteCampusId,position:WorldPoint,destination:WorldPoint){
  return guideCampusPaths(REMOTE_LAYOUTS[id],position,destination);
}
