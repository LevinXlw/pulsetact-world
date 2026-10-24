import {BU_STREET_ROUTE,BU_WALK_BOUNDS,LANDMARKS,MIT_STATA_APPROACH,MIT_STATA_PLACES,MIT_STATA_WALK_ROUTES,RIVER_WALK_ROUTE,WORLD_BOUNDS,isNearRoute,type WorldPoint} from './charles-geography';

import {BU_FULL_PLACES,BU_WALK_ROUTES,type BUPlaceId} from './bu-campus-layout';
import {guideCampusPaths} from './campus-paths';
import type {CampusLayout} from './campus-regions';
import {buSertPoint} from './bu-sert-layout';
import {CDS_DOOR_BY_ID,cdsLocalToWorld} from './cds-door-layout';
import {MIT_RESIDENCE_PLACES,MIT_RESIDENCE_WALK_ROUTES,MIT_BAKER_NORTH_ARRIVAL} from './mit-residence-layout';

export type RiverPlaceId='charles'|'harvard-bridge'|'mit-stata'|'mit-stata-west'|'mit-baker'|'mit-baker-entry'|'mit-maseeh'|BUPlaceId;
export type WorldDestination={id:RiverPlaceId;title:string;subtitle:string;position:WorldPoint;radius:number;description:string;note:string;lookAt?:WorldPoint;view?:{pitch:number;distance:number}};
export const WORLD_DESTINATIONS:WorldDestination[]=[
  {id:'charles',title:'查尔斯河畔',subtitle:'从 MIT 出发，沿水岸慢走',position:LANDMARKS.charles,radius:20,description:'离开 Killian Court，走到查尔斯河的剑桥一侧。沿河望向波士顿，也可以顺着步道走到 Harvard Bridge。',note:'河岸漫游 · 可自由拍照'},
  {id:'harvard-bridge',title:'Harvard Bridge',subtitle:'沿桥跨过查尔斯河',position:LANDMARKS.harvardBridge,radius:22,description:'这座桥连接剑桥与波士顿。过桥后沿南岸向西，继续走向 Boston University。',note:'桥面可步行 · 河面不能通行'},
  {id:'bu-beach',title:'BU Beach',subtitle:'树荫下的校园草坪',position:LANDMARKS.buBeach,radius:24,description:'来到 Boston University 北侧的草坪。这里叫 BU Beach，并不是沙滩。草坪与查尔斯河之间隔着道路，可以沿步行桥继续走到河边。',note:'Boston University · 户外探索'},
  {id:'bu-marsh',title:'Marsh Plaza',subtitle:'在校园广场停一停',position:LANDMARKS.buMarsh,radius:20,description:'从河岸走入 BU 校园，在 Marsh Chapel 前的广场停留，看看校园建筑，也为这段河岸漫游留一张影。',note:'Boston University · 户外探索'},
  {id:'bu-questrom',title:'Questrom 商学院',subtitle:'Commonwealth Avenue 上的校园地标',position:LANDMARKS.buQuestrom,radius:20,description:'沿 Commonwealth Avenue 经过数据科学中心，来到 Questrom School of Business。商学院位于 595 Commonwealth Avenue 的 Rafik B. Hariri Building，可以在门前广场观察红砖、石材与玻璃组成的立面。',note:'Boston University · 商学院门前广场'},
  ...BU_FULL_PLACES.map(place=>({...place,view:{pitch:/warren|law|stuvi|cds/.test(place.id)?.16:.13,distance:9.2}})),
  {id:'mit-stata',title:'Stata · Vassar 街前',subtitle:'从北侧观察倾斜体块与金属立面',position:MIT_STATA_PLACES.vassar,radius:12,description:'沿 MIT 东侧绕行到 Vassar Street，在街前观察 Stata Center 的高低体块、砖墙和金属外立面。',note:'MIT · 室外建筑漫步',lookAt:[128.306,-327.122],view:{pitch:.18,distance:7}},
  {id:'mit-stata-west',title:'Stata · 西侧',subtitle:'沿街走到建筑西侧',position:MIT_STATA_PLACES.west,radius:12,description:'从 Vassar 街前沿建筑外侧慢走，换一个角度观察 Stata Center 西侧的体块与庭院关系。',note:'MIT · 室外建筑漫步',lookAt:[58.814,-292.697],view:{pitch:.16,distance:7}},
  {id:'mit-maseeh',title:'Maseeh Hall',subtitle:'Memorial Drive · 砖石庭院与双塔铜顶',position:MIT_RESIDENCE_PLACES.maseeh,radius:10,description:'在 Memorial Drive 的校园侧人行道停留，观察 Maseeh Hall 的退进庭院、砖石窗列与两座铜顶塔。',note:'MIT · 宿舍外观漫步',lookAt:[-114,183],view:{pitch:.2,distance:6}},
  {id:'mit-baker',title:'Baker House',subtitle:'Alvar Aalto · 沿河起伏的砖立面',position:MIT_RESIDENCE_PLACES.baker,radius:10,description:'沿校园侧人行道走到 Baker House，观察起伏的六层砖墙和低层餐厅亭。校园北侧的悬挑楼梯形成另一种轮廓。',note:'MIT · 宿舍外观漫步',lookAt:[-300,279],view:{pitch:.18,distance:6}},
  {id:'mit-baker-entry',title:'Baker · 北入口',subtitle:'Amherst Street · 砖铺前场与悬挑楼梯',position:MIT_BAKER_NORTH_ARRIVAL,radius:6,description:'沿 Amherst 街边走进砖铺前场，绕过树岛，近看花池砖墙、入口台阶和北侧悬挑楼梯。',note:'MIT · 宿舍外观漫步',lookAt:[-293.6,251.2],view:{pitch:.12,distance:4}},
];
WORLD_DESTINATIONS.find(p=>p.id==='bu-marsh')!.lookAt=[-1177.818,944.142];
WORLD_DESTINATIONS.find(p=>p.id==='bu-marsh')!.view={pitch:.14,distance:8.5};
WORLD_DESTINATIONS.find(p=>p.id==='bu-beach')!.lookAt=[-1177.818,944.142];
WORLD_DESTINATIONS.find(p=>p.id==='bu-questrom')!.lookAt=[-627.457,1062.434];
WORLD_DESTINATIONS.find(p=>p.id==='bu-questrom')!.view={pitch:.16,distance:9.2};
WORLD_DESTINATIONS.find(p=>p.id==='bu-new-balance')!.lookAt=[-2456.244,641.129];
WORLD_DESTINATIONS.find(p=>p.id==='bu-new-balance')!.view={pitch:.08,distance:9.2};
// The map/compass and fast travel now lead to the playable glass doorway,
// rather than the older architectural viewing point across the forecourt.
Object.assign(WORLD_DESTINATIONS.find(p=>p.id==='bu-cds')!,{
  position:[...CDS_DOOR_BY_ID.east.exterior.position],
  lookAt:cdsLocalToWorld(CDS_DOOR_BY_ID.east.local),
  view:{pitch:-.08,distance:4.5},
  note:'走近南立面的玻璃门，按 E 或点击「开门进入」',
});

export function nearestDestination(position:WorldPoint){
  return WORLD_DESTINATIONS.map(point=>({point,distance:Math.hypot(position[0]-point.position[0],position[1]-point.position[1])}))
    .filter(item=>item.distance<=item.point.radius).sort((a,b)=>a.distance-b.distance)[0]?.point;
}

export function regionAt(position:WorldPoint){
  if(MIT_RESIDENCE_WALK_ROUTES.some(route=>isNearRoute(...position,route,9)))return {id:'mit',title:position[0]<-240?'Baker House':'Maseeh Hall · 河畔宿舍',eyebrow:'CAMBRIDGE · MASSACHUSETTS',label:'MIT',detail:'MEMORIAL DRIVE · RESIDENCES',description:'沿校园侧人行道，看看波浪砖墙、铜顶与查尔斯河。'};
  if((position[0]>=BU_WALK_BOUNDS.minX&&position[0]<=BU_WALK_BOUNDS.maxX&&position[1]>=BU_WALK_BOUNDS.minZ&&position[1]<=BU_WALK_BOUNDS.maxZ)||Math.min(Math.hypot(position[0]-LANDMARKS.buBeach[0],position[1]-LANDMARKS.buBeach[1]),Math.hypot(position[0]-LANDMARKS.buMarsh[0],position[1]-LANDMARKS.buMarsh[1]))<300)
    return {id:'bu',title:'Boston University',eyebrow:'BOSTON · MASSACHUSETTS',label:'BOSTON UNIVERSITY',detail:'CHARLES RIVER CAMPUS',description:'沿主街、河岸和住宅街区，探索 BU 的四个校园分区。'};
  if(position[1]<=160&&Math.hypot(position[0]-34,position[1]-5)<190)
    return {id:'mit',title:'Killian Court',eyebrow:'CAMBRIDGE · MASSACHUSETTS',label:'MIT',detail:'KILLIAN COURT',description:'沿着庭院，收集三个小小的发现。'};
  if(MIT_STATA_WALK_ROUTES.some(route=>isNearRoute(...position,route,8)))
    return {id:'mit',title:position[1]<-200?'Stata Center':'MIT 东侧校园',eyebrow:'CAMBRIDGE · MASSACHUSETTS',label:'MIT',detail:'STATA CENTER · VASSAR STREET',description:'沿东侧路径走到 Stata Center，在 Vassar 街前与西侧观察建筑。'};
  return {id:'charles',title:'Charles River',eyebrow:'CAMBRIDGE ↔ BOSTON',label:'CHARLES RIVER',detail:'RIVERSIDE WALK',description:'沿步道走向 Harvard Bridge，过桥后向西前往 BU。'};
}

// The restored CAS/STH links close the former east-side shortcut. Follow the
// open Law/Mugar forecourts around the west end of Theology to Comm Ave, then
// approach Marsh Plaza from the south. Do not cut through a low connector.
export const BU_CAMPUS_ROUTE:WorldPoint[]=[LANDMARKS.buBeach,...[[129,22],[129,62],[115,62],[115,71],[21,71],[21,102],[163,102]].map(([x,z])=>[...buSertPoint(x,z)] as WorldPoint),LANDMARKS.buMarsh];
export const NAVIGATION_ROUTE:WorldPoint[]=[...RIVER_WALK_ROUTE,...BU_CAMPUS_ROUTE.slice(1),...BU_STREET_ROUTE.slice(1)];
export const NAVIGATION_PATHS:WorldPoint[][]=[NAVIGATION_ROUTE,...BU_WALK_ROUTES,...MIT_STATA_WALK_ROUTES,...MIT_RESIDENCE_WALK_ROUTES];
const graphLayout:CampusLayout={bounds:WORLD_BOUNDS,spawn:NAVIGATION_ROUTE[0],lookTarget:LANDMARKS.buMarsh,route:NAVIGATION_ROUTE,paths:NAVIGATION_PATHS,points:[],mapBuildings:[]};
const stataEastApproach=MIT_STATA_APPROACH.slice(1);
/** Follow the connected sidewalk graph in both directions, including branches. */
export function navigationGuide(position:WorldPoint,destination:WorldPoint){
  // The eastern teaching blocks lie inside the old circular MIT boundary.
  // Returning from Stata must follow their outer path until clear of them.
  const inCourtyard=(point:WorldPoint)=>point[1]<=160&&Math.hypot(point[0]-34,point[1]-5)<190&&!isNearRoute(...point,stataEastApproach,8);
  if(inCourtyard(position)&&inCourtyard(destination))return{point:destination,distance:Math.hypot(position[0]-destination[0],position[1]-destination[1]),viaRoute:false};
  return guideCampusPaths(graphLayout,position,destination);
}
