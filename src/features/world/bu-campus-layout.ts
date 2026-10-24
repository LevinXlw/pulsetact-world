import {geoToWorld,type WorldPoint} from './geo-coordinates';
import {BU_OFFICIAL_ROAD_SEGMENTS} from './bu-road-data';
import {BU_FULL_BUILDINGS} from './bu-full-layout';
import {BU_GROUND_BUILDINGS} from './bu-campus-footprints';
import {BU_MARSH_ASSEMBLY} from './bu-landmark-layout';
import {BU_SERT_LINK_ENTRY,BU_SERT_PUBLIC_PASSAGES,buSertPoint} from './bu-sert-layout';
import {CDS_DOORS} from './cds-door-layout';
import {buCDSPoint} from './bu-cds-entry-layout';

/** Survey-derived street centre lines; the per-street selection bounds only
 * limit this first playable Charles River / South Campus area. They never
 * stretch or reposition the source geometry. MassGIS / MassDOT January 2026. */
export type BUCampusRoad={id:string;name:string;points:WorldPoint[];width:number;kind:'avenue'|'street'|'mall'|'bridge'|'expressway';sidewalk:number};
export const BU_CAMPUS_BOUNDS={minX:-2820,maxX:270,minZ:330,maxZ:1530};
const selections:Record<string,{minX?:number;maxX?:number;minZ?:number;maxZ?:number}>={
  'COMMONWEALTH AVENUE':{minX:-2770,maxX:-90},'BAY STATE ROAD':{},
  'BABCOCK STREET':{maxZ:1060},'BUICK STREET':{},'HARRY AGGANIS WAY':{},
  'AMORY STREET':{maxZ:1110},'SAINT PAUL STREET':{maxZ:1110},
  'SAINT MARYS STREET':{maxZ:1460},'CUMMINGTON MALL':{},'HINSDALE MALL':{},'BLANDFORD MALL':{},
  'SILBER WAY':{},'UNIVERSITY ROAD':{},'MOUNTFORT STREET':{},'BUSWELL STREET':{},
  'PARK DRIVE':{minX:-1280,maxX:-760,maxZ:1490},'BEACON STREET':{minX:-1450,maxX:260,maxZ:1510},
  'ESSEX STREET':{maxZ:1420},'CARLTON STREET':{maxZ:1460},'ARUNDEL STREET':{},'ABERDEEN STREET':{},
  'DEERFIELD STREET':{},'GRANBY STREET':{},'RALEIGH STREET':{},
  'GARDNER STREET':{minX:-2800},'ASHFORD STREET':{minX:-2800},'MALVERN STREET':{},'ALCORN STREET':{},
  'DUMMER STREET':{minX:-2200},'BOSTON UNIVERSITY BRIDGE':{},
};
function clip(points:number[][],bounds:{minX:number;maxX:number;minZ:number;maxZ:number}):WorldPoint[][]{
  const paths:WorldPoint[][]=[];let current:WorldPoint[]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1];let lo=0,hi=1,valid=true;
    for(const [p,q] of [[-dx,a[0]-bounds.minX],[dx,bounds.maxX-a[0]],[-dz,a[1]-bounds.minZ],[dz,bounds.maxZ-a[1]]]){
      if(Math.abs(p)<1e-9){if(q<0)valid=false;continue;}const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);
    }
    if(!valid||lo>hi){if(current.length>1)paths.push(current);current=[];continue;}
    const start:WorldPoint=[a[0]+dx*lo,a[1]+dz*lo],end:WorldPoint=[a[0]+dx*hi,a[1]+dz*hi];
    if(current.length&&Math.hypot(current.at(-1)![0]-start[0],current.at(-1)![1]-start[1])>.05){paths.push(current);current=[];}
    if(!current.length)current.push(start);current.push(end);
  }
  if(current.length>1)paths.push(current);return paths;
}
export const BU_CAMPUS_ROADS:BUCampusRoad[]=BU_OFFICIAL_ROAD_SEGMENTS.flatMap(source=>{
  const selected=selections[source.name];if(!selected)return [];
  const kind=source.name==='COMMONWEALTH AVENUE'?'avenue':source.name.endsWith('MALL')?'mall':source.name==='BOSTON UNIVERSITY BRIDGE'?'bridge':'street';
  const width=kind==='avenue'?10.2:kind==='mall'?8:kind==='bridge'?14:Math.max(6.4,Math.min(11.8,(source.surfaceWidthFeet??0)*.3048||8.4));
  return clip(source.points,{...BU_CAMPUS_BOUNDS,...selected}).filter(points=>{
    const a=points[0],b=points.at(-1)!;
    // Drop the small traffic turning arcs, not the real transverse intersections.
    return kind!=='avenue'||Math.hypot(b[0]-a[0],b[1]-a[1])>12;
  }).map((points,index)=>({id:source.id+'-'+index,name:source.name,points,width,kind,sidewalk:kind==='avenue'?4.5:kind==='mall'?0:3.0}));
});
export const BU_EXPRESSWAY_SEGMENTS:BUCampusRoad[]=BU_OFFICIAL_ROAD_SEGMENTS.filter(r=>r.name==='MASSACHUSETTS TURNPIKE').flatMap(source=>clip(source.points,BU_CAMPUS_BOUNDS).map((points,index)=>({id:source.id+'-'+index,name:source.name,points,width:12.5,kind:'expressway',sidewalk:0})));

export function buSegmentProjection(x:number,z:number,a:WorldPoint,b:WorldPoint){
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(length*length||1)));
  return {point:[a[0]+dx*t,a[1]+dz*t] as WorldPoint,distance:Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t),nx:-dz/(length||1),nz:dx/(length||1)};
}
export const BU_ROAD_EDGES=BU_CAMPUS_ROADS.flatMap(road=>road.points.slice(1).map((b,i)=>({a:road.points[i],b,road})));
export function buRoadDistance(x:number,z:number){return Math.min(...BU_ROAD_EDGES.map(({a,b,road})=>buSegmentProjection(x,z,a,b).distance-road.width/2));}
const expresswayEdges=BU_EXPRESSWAY_SEGMENTS.flatMap(road=>road.points.slice(1).map((b,i)=>{const a=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1];return{a,b,dx,dz,lengthSquared:dx*dx+dz*dz,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minZ:Math.min(a[1],b[1]),maxZ:Math.max(a[1],b[1])};}));
export function buExpresswayDistance(x:number,z:number){
  let squared=Infinity;
  for(const edge of expresswayEdges){
    const bx=Math.max(edge.minX-x,0,x-edge.maxX),bz=Math.max(edge.minZ-z,0,z-edge.maxZ);if(bx*bx+bz*bz>=squared)continue;
    const t=Math.max(0,Math.min(1,((x-edge.a[0])*edge.dx+(z-edge.a[1])*edge.dz)/(edge.lengthSquared||1)));
    const dx=x-edge.a[0]-edge.dx*t,dz=z-edge.a[1]-edge.dz*t;squared=Math.min(squared,dx*dx+dz*dz);
  }return Math.sqrt(squared)-6.25;
}
/** Shared land depression for the Mass Pike cut. Bridge decks use the original
 * buElevation; the surrounding land and carriageways both use this offset. */
const cutLattice=new Map<number,number>();
function cutCorner(ix:number,iz:number){const key=ix*8192+iz,cached=cutLattice.get(key);if(cached!==undefined)return cached;const d=buExpresswayDistance(ix*12,iz*12),t=Math.max(0,Math.min(1,(d-1.5)/7)),drop=-4.2*(1-t*t*(3-2*t));cutLattice.set(key,drop);return drop;}
export function buExpresswayDrop(x:number,z:number){
  if(x<BU_CAMPUS_BOUNDS.minX-24||x>BU_CAMPUS_BOUNDS.maxX+24||z<BU_CAMPUS_BOUNDS.minZ-24||z>BU_CAMPUS_BOUNDS.maxZ+24)return 0;
  const gx=x/12,gz=z/12,ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz,a=cutCorner(ix,iz),d=cutCorner(ix+1,iz+1);
  return tx>=tz?a+(cutCorner(ix+1,iz)-a)*tx+(d-cutCorner(ix+1,iz))*tz:a+(d-cutCorner(ix,iz+1))*tx+(cutCorner(ix,iz+1)-a)*tz;
}
export function buCrossesExpressway(x:number,z:number,padding=0){
  for(const {a,b,road} of BU_ROAD_EDGES){const radius=road.width/2+road.sidewalk+1+padding;
    if(road.name==='BAY STATE ROAD'||road.kind==='mall'||x<Math.min(a[0],b[0])-radius||x>Math.max(a[0],b[0])+radius||z<Math.min(a[1],b[1])-radius||z>Math.max(a[1],b[1])+radius)continue;
    if(buSegmentProjection(x,z,a,b).distance<radius)return true;
  }return false;
}

/** The median is sampled between the two recorded carriageway axes. */
const avenueEdges=BU_ROAD_EDGES.filter(({a,b,road})=>road.kind==='avenue'&&Math.abs(b[0]-a[0])>Math.abs(b[1]-a[1])*2.2);
function avenueAtX(x:number){return avenueEdges.flatMap(({a,b})=>x>=Math.min(a[0],b[0])-.001&&x<=Math.max(a[0],b[0])+.001?[a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])]:[]);}
export const BU_COMMONWEALTH_MEDIAN:WorldPoint[]=[];
for(let x=-2670;x<=-390;x+=8){const z=avenueAtX(x);if(z.length>=2)BU_COMMONWEALTH_MEDIAN.push([x,(Math.min(...z)+Math.max(...z))/2]);}
export function buAvenueOuterSide(x:number,z:number){const zs=avenueAtX(x);return zs.length<2?-1:Math.abs(z-Math.min(...zs))<Math.abs(z-Math.max(...zs))?-1:1;}

function offsetRoute(points:WorldPoint[],offset:number):WorldPoint[]{
  return points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;return[p[0]-dz/length*offset,p[1]+dx/length*offset];});
}
const sertCourtyardRoutes:WorldPoint[][]=[
  ...BU_SERT_PUBLIC_PASSAGES.map(path=>path.points.map(p=>[...p] as WorldPoint)),
  [[21,71],[21,93],[9,93],[-12,93],[-12,105]].map(([x,z])=>[...buSertPoint(x,z)] as WorldPoint),
  // End outside the closed Link doors; outdoor navigation does not enter interiors.
  [[-12.52,93],[-12.52,78]].map(([x,z])=>[...buSertPoint(x,z)] as WorldPoint),
  [[...buSertPoint(100.4,7)] as WorldPoint,[-1228,875]],
];
const sourceWalks:WorldPoint[][]=BU_CAMPUS_ROADS.flatMap(road=>{
  if(road.kind==='mall')return[road.points];
  const points=road.points[0][0]>road.points.at(-1)![0]?[...road.points].reverse():road.points;
  if(road.kind==='avenue'){
    const middle=points[Math.floor(points.length/2)],side=buAvenueOuterSide(middle[0],middle[1]);
    return[offsetRoute(points,side*(road.width/2+2.7))];
  }
  return[offsetRoute(points,road.width/2+1.5),offsetRoute(points,-road.width/2-1.5)];
}).concat(sertCourtyardRoutes);

const navigationBuildings=[...BU_GROUND_BUILDINGS.filter(b=>!b.custom),{footprint:BU_MARSH_ASSEMBLY.footprint,holes:[]}].map(b=>({ring:b.footprint,holes:b.holes??[],minX:Math.min(...b.footprint.map(p=>p[0]))-1,maxX:Math.max(...b.footprint.map(p=>p[0]))+1,minZ:Math.min(...b.footprint.map(p=>p[1]))-1,maxZ:Math.max(...b.footprint.map(p=>p[1]))+1}));
const legacyFootprints=[
  {x:-905.618,z:1009.527,w:48,d:42},{x:-950.507,z:924.206,w:27,d:23},{x:-627.457,z:1062.434,w:94,d:40},
];
export function buNavigationBlocked(x:number,z:number){
  for(const b of legacyFootprints){const dx=x-b.x,dz=z-b.z,c=Math.cos(-.145),s=Math.sin(-.145);if(Math.abs(dx*c-dz*s)<b.w/2+1.15&&Math.abs(dx*s+dz*c)<b.d/2+1.15)return true;}
  for(const b of navigationBuildings){
    if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)continue;
    const containment:boolean[]=[];
    for(const ring of [b.ring,...b.holes]){
      let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[i],p=ring[j];if(((a[1]>z)!==(p[1]>z))&&x<(p[0]-a[0])*(z-a[1])/(p[1]-a[1])+a[0])inside=!inside;
        if(buSegmentProjection(x,z,a,p).distance<.85)return true;
      }containment.push(inside);
    }
    if(containment[0]&&!containment.slice(1).some(Boolean))return true;
  }return false;
}
function safeLeg(a:WorldPoint,b:WorldPoint){const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.25);for(let i=0;i<=n;i++){const t=n?i/n:0;if(buNavigationBlocked(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))return false;}return true;}
// Split only the obstructed portions. The unchanged sidewalk linework still
// follows GIS; hand-modelled core facades cannot introduce a through-wall route.
export const BU_WALK_ROUTES:WorldPoint[][]=[];
for(const route of sourceWalks){
  let current:WorldPoint[]=[];
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.3));
    if(safeLeg(a,b)){if(!current.length)current.push(a);current.push(b);continue;}
    for(let j=0;j<=n;j++){
      const p:WorldPoint=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n];
      if(buNavigationBlocked(...p)){if(current.length>1)BU_WALK_ROUTES.push(current);current=[];}
      else if(!current.length)current=[p];else current[current.length===1?1:current.length-1]=p;
    }
  }if(current.length>1)BU_WALK_ROUTES.push(current);
}
// Actual junction corners have separate offset endpoints. Join them explicitly
// across unobstructed intersection pavement, never across a building or the cut.
const walkEdges=BU_WALK_ROUTES.flatMap((route,path)=>route.slice(1).map((b,i)=>({a:route[i],b,path})));
const walkEnds=BU_WALK_ROUTES.flatMap((route,path)=>[{point:route[0],path},{point:route.at(-1)!,path}]);
const connectorKeys=new Set<string>();
for(const {point,path} of walkEnds){
  const options=walkEdges.filter(e=>e.path!==path).map(e=>({...e,...buSegmentProjection(...point,e.a,e.b)})).filter(e=>e.distance>.01&&e.distance<18).sort((a,b)=>a.distance-b.distance);
  for(const next of options.slice(0,4)){
    const key=[point,next.point].map(p=>p.map(v=>v.toFixed(2)).join(',')).sort().join(':');if(connectorKeys.has(key)||!safeLeg(point,next.point))continue;
    const midpoint:WorldPoint=[(point[0]+next.point[0])/2,(point[1]+next.point[1])/2];if(buExpresswayDistance(...midpoint)<1&&!buCrossesExpressway(...midpoint))continue;
    connectorKeys.add(key);BU_WALK_ROUTES.push([point,next.point]);
  }
}
// Link the established Marsh Plaza / river arrival walk to the real avenue.
for(const anchor of [[-1177.818,981],[-1175,1000],[-1155,1006],[-945,1037],[-905.618,1045],[-830,1065],[-705,1083],[-632,1098]] as WorldPoint[]){
  const targets=walkEdges.map(e=>buSegmentProjection(...anchor,e.a,e.b)).filter(p=>p.distance<35).sort((a,b)=>a.distance-b.distance);
  const target=targets.find(p=>safeLeg(anchor,p.point));if(target)BU_WALK_ROUTES.push([anchor,target.point]);
}
// The playable CDS doors supersede the old architectural viewing point as
// destinations. Include their existing public apron in the graph: otherwise
// the off-path recovery (>2.5 m) sends a player back to the sidewalk every time
// they start the final ~17 m approach. Follow each clear door axis before
// joining the surveyed sidewalk; do not take a shortcut across podium columns.
export const BU_CDS_DOOR_WALK_ROUTES:WorldPoint[][]=CDS_DOORS.flatMap(door=>{
  const arrival:WorldPoint=[...door.exterior.position],approach=buCDSPoint(door.local[0],25.5);
  const target=walkEdges.map(e=>buSegmentProjection(...approach,e.a,e.b)).filter(p=>p.distance<35).sort((a,b)=>a.distance-b.distance).find(p=>safeLeg(approach,p.point));
  return target&&safeLeg(arrival,approach)?[[arrival,approach,target.point]]:[];
});
BU_WALK_ROUTES.push(...BU_CDS_DOOR_WALK_ROUTES);

export const BU_TRANSIT_STOPS=[
  {name:'Blandford Street',position:geoToWorld(42.349293,-71.100258)},
  {name:'Boston University East',position:geoToWorld(42.349735,-71.103889)},
  {name:'Boston University Central',position:geoToWorld(42.350082,-71.106865)},
  {name:'Amory Street',position:geoToWorld(42.350992,-71.114748)},
  {name:'Babcock Street',position:geoToWorld(42.351616,-71.119924)},
];

export type BUPlaceId=`bu-${string}`;
export type BUFullPlace={id:BUPlaceId;title:string;subtitle:string;position:WorldPoint;radius:number;description:string;note:string;lookAt:WorldPoint};
function front(roadName:string,lat:number,lon:number,world?:WorldPoint):{position:WorldPoint;lookAt:WorldPoint}{
  const lookAt=world??geoToWorld(lat,lon);
  const options=BU_ROAD_EDGES.filter(e=>e.road.name===roadName).map(({a,b,road})=>({...buSegmentProjection(...lookAt,a,b),road})).sort((a,b)=>a.distance-b.distance);
  const nearest=options[0],sign=(lookAt[0]-nearest.point[0])*nearest.nx+(lookAt[1]-nearest.point[1])*nearest.nz>=0?1:-1;
  const offset=nearest.road.width/2+(nearest.road.kind==='avenue'?2.7:1.5);
  return {position:[nearest.point[0]+nearest.nx*sign*offset,nearest.point[1]+nearest.nz*sign*offset],lookAt};
}
const buildingCentres:Partial<Record<BUPlaceId,WorldPoint>>={
  'bu-gsu':[-1391,939],'bu-law':[-1268,888],'bu-mugar':[-1340,900],
  'bu-com':[-841,1148],'bu-warren':[-980,1095],'bu-photonics':[-1179,1107],
  'bu-cfa':[-1795,859],'bu-cgs':[-1852,858],'bu-fitrec':[-2010,817],'bu-agganis':[-2111,780],
  'bu-stuvi':[-1968,763],'bu-stuvi2':[-2120,664],'bu-kilachand':[-403,980],'bu-towers':[-635,1018],
};
for(const [placeId,buildingId] of [['bu-booth','booth-theatre'],['bu-yawkey','yawkey-center'],['bu-kilachand-center','kilachand-center']] as const){
  const building=BU_FULL_BUILDINGS.find(b=>b.id===buildingId)!;buildingCentres[placeId]=[building.x,building.z];
}
function place(id:BUPlaceId,title:string,subtitle:string,road:string,lat:number,lon:number,description:string):BUFullPlace{return{id,title,subtitle,...front(road,lat,lon,buildingCentres[id]),radius:24,description,note:'Boston University · 户外探索'};}
/** Entrance-side arrivals, not building-centre teleports. The landmark addresses
 * follow BU's published campus map; destinations are projected to GIS sidewalks. */
export const BU_FULL_PLACES:BUFullPlace[]=[
  place('bu-cds','Duan 数据科学中心','665 Commonwealth Avenue','COMMONWEALTH AVENUE',42.35010,-71.10310,'沿 Commonwealth Avenue 走近错落叠置的玻璃体块，观察数据科学中心与周围红砖校园的关系。'),
  place('bu-castle','The Castle','225 Bay State Road','BAY STATE ROAD',42.35087,-71.10364,'沿 Bay State Road 走到 Dahod Family Alumni Center。这里的尖山墙、砂岩立面与凸窗来自都铎复兴式建筑语言。'),
  place('bu-gsu','George Sherman Union','775 Commonwealth Avenue','COMMONWEALTH AVENUE',42.35082,-71.10880,'来到中央校园的学生生活中心，继续向北可以看见 Mugar Library 和法学院高楼。'),
  place('bu-law','School of Law','765 Commonwealth Avenue','BAY STATE ROAD',42.35136,-71.10772,'从北侧校园步道观察法学院的高层立面，回望查尔斯河和中央校园。'),
  place('bu-mugar','Mugar Memorial Library','771 Commonwealth Avenue','BAY STATE ROAD',42.35110,-71.10875,'在图书馆和学生中心之间停留。图书馆与法学院、GSU 构成 BU 中央校园的重要建筑群。'),
  place('bu-warren','Warren Towers','700 Commonwealth Avenue','COMMONWEALTH AVENUE',42.34936,-71.10430,'在 Commonwealth Avenue 南侧观察三座宿舍塔楼和共同的底座。'),
  place('bu-com','College of Communication','640 Commonwealth Avenue','COMMONWEALTH AVENUE',42.34915,-71.10225,'沿主街南侧步行到传播学院，继续向南进入 Cummington Mall 工程与理科楼群。'),
  place('bu-photonics','Photonics Center','8 St. Mary’s Street','SAINT MARYS STREET',42.34915,-71.10621,'从 St. Mary’s Street 看光子学中心，并沿真实桥路跨过 Mass Pike 前往南校区。'),
  place('bu-engineering','Engineering · Cummington Mall','44 Cummington Mall','CUMMINGTON MALL',42.34879,-71.10275,'沿 Cummington Mall 的人行道探索工程学院周边。街道保留车辆与后勤通行，步行空间沿两侧展开。'),
  place('bu-kilachand-center','Kilachand Center · 生命科学与工程','610 Commonwealth Avenue','COMMONWEALTH AVENUE',42.3491,-71.1014,'沿主街南侧来到 Rajen Kilachand Center。这里是生命科学与工程研究中心，与 Bay State Road 上的 Kilachand Hall 宿舍是两个不同地点。'),
  place('bu-cfa','College of Fine Arts','855 Commonwealth Avenue','COMMONWEALTH AVENUE',42.35118,-71.11325,'来到西部艺术校园，沿 Commonwealth Avenue 观察学院连续的街道立面。'),
  place('bu-booth','Joan & Edgar Booth Theatre','820 Commonwealth Avenue','COMMONWEALTH AVENUE',42.3507,-71.1137,'从 Commonwealth Avenue 南侧走近 Booth Theatre，与街对面的艺术学院共同构成校园的表演艺术区域。'),
  place('bu-cgs','College of General Studies','871 Commonwealth Avenue','COMMONWEALTH AVENUE',42.35135,-71.11518,'从艺术学院向西继续步行，经过通识学院和 Amory Street 绿线车站。'),
  place('bu-fitrec','Fitness & Recreation Center','915 Commonwealth Avenue','COMMONWEALTH AVENUE',42.35155,-71.11735,'在 FitRec 的街道入口停留，继续向西是 Agganis Arena，北侧通向 Student Village。'),
  place('bu-agganis','Agganis Arena','925 Commonwealth Avenue','COMMONWEALTH AVENUE',42.35210,-71.11875,'来到西校区的体育馆，在入口前观察长跨屋顶、玻璃和砖墙的组合。'),
  place('bu-stuvi','Student Village','10 Buick Street','BUICK STREET',42.35228,-71.11657,'沿 Buick Street 进入 Student Village，观察高层宿舍与西校园体育建筑的天际线。'),
  place('bu-stuvi2','Student Village II','33 Harry Agganis Way','HARRY AGGANIS WAY',42.35310,-71.11870,'从 Harry Agganis Way 到达 Student Village II，继续向北可望见河岸。'),
  place('bu-nickerson','Nickerson Field · West Campus','273–285 Babcock Street','BABCOCK STREET',42.35317,-71.12020,'来到 Nickerson Field 西侧，沿 Babcock Street 观察 West Campus 宿舍、看台和体育中心。'),
  place('bu-new-balance','New Balance Field · Langsam Garage','285 Babcock Street · Alcorn Street','ALCORN STREET',42.35306,-71.12272,'在 Alcorn Street 一侧观察架在 Langsam 停车楼之上的曲棍球场。可从南侧缓坡走上球场边缘，停车层保留开放柱列。'),
  place('bu-south','South Campus','Buswell Street · Park Drive','BUSWELL STREET',42.34771,-71.10544,'跨过 Mass Pike 的实际街桥后进入 South Campus，在 Buswell Street 的砖石住宅街区散步。'),
  place('bu-bay-state','Bay State Road','Brownstones · 林荫住宅街','BAY STATE ROAD',42.35036,-71.09915,'沿树荫中的 Bay State Road 探索成排的 brownstones。这条街与 Commonwealth Avenue 平行，连接东部宿舍和中央校园。'),
  place('bu-kilachand','Kilachand Hall','91 Bay State Road','BAY STATE ROAD',42.35014,-71.09618,'来到东校园的 Kilachand Hall，沿 Bay State Road 向西返回校园核心，向东可以继续走向 Kenmore。'),
  place('bu-yawkey','Yawkey Center · Marciano Commons','100 Bay State Road','BAY STATE ROAD',42.3500,-71.0980,'来到 Bay State Road 与 Deerfield Street 附近的学生服务中心，在街边观察底层公共空间与上层砖石立面的组合。'),
  place('bu-towers','The Towers','140 Bay State Road','BAY STATE ROAD',42.35030,-71.09942,'在 Bay State Road 南侧观察 The Towers，继续穿过 Silber Way 可以回到 Questrom 和 Commonwealth Avenue。'),
  place('bu-danielsen','Danielsen Hall','512 Beacon Street · East Campus','BEACON STREET',42.350873,-71.090309,'沿 Beacon Street 向东走过 Kenmore 和 Charlesgate，来到 Danielsen Hall。宿舍面向街道，背后是查尔斯河，周围保留连续的 brownstone 住宅街景。'),
  place('bu-bridge','Boston University Bridge','连接波士顿与剑桥','BOSTON UNIVERSITY BRIDGE',42.35130,-71.11045,'在 BU Bridge 的人行道上眺望查尔斯河，观察校园与两岸交通走廊的空间关系。'),
];
// Outdoor arrival viewpoints leave room to read the whole landmark. The field
// approach follows the open passage between the West Campus dormitory wings.
const nickersonArrival=BU_FULL_PLACES.find(p=>p.id==='bu-nickerson')!;
const nickersonStreet:WorldPoint=[...nickersonArrival.position];
nickersonArrival.position=[-2211,678];nickersonArrival.lookAt=[-2232.965,642.358];
nickersonArrival.description='从 Babcock Street 穿过宿舍之间的步行通道，来到 Nickerson Field 的场边。这里可以看见球场、看台和 Student Village 的高楼。';
const agganisArrival=BU_FULL_PLACES.find(p=>p.id==='bu-agganis')!;
agganisArrival.position=[-2114,Math.max(...avenueAtX(-2114))+7.8];agganisArrival.lookAt=[-2111.582,807];
const stuviArrival=BU_FULL_PLACES.find(p=>p.id==='bu-stuvi2')!;
const stuviStreet:WorldPoint=[...stuviArrival.position];
stuviArrival.position=[-2196,668];stuviArrival.lookAt=[-2123.314,637.352];
// A larger northward move would place the player on Storrow Drive. Use the
// northeast forecourt instead, looking at the surveyed tower rather than its
// low western annex; the short spur stays south of the road and outside walls.
const lawArrival=BU_FULL_PLACES.find(p=>p.id==='bu-law')!;
const lawStreet:WorldPoint=[...lawArrival.position],lawTower=BU_FULL_BUILDINGS.find(b=>b.id==='law-tower')!;
lawArrival.position=[-1228,875];lawArrival.lookAt=[lawTower.x,lawTower.z];
const mugarArrival=BU_FULL_PLACES.find(p=>p.id==='bu-mugar')!;
mugarArrival.position=[...BU_SERT_LINK_ENTRY.arrival];mugarArrival.lookAt=[...BU_SERT_LINK_ENTRY.position];
mugarArrival.description='来到面向 Commonwealth Avenue 的 GSU Link 共享入口前。Mugar 图书馆入口位于连廊内右侧，GSU Food Hall 位于左侧；沿室外前场可以继续走向法学院。';
const gsuArrival=BU_FULL_PLACES.find(p=>p.id==='bu-gsu')!;
gsuArrival.position=[...buSertPoint(-18.5,99)];gsuArrival.lookAt=[...BU_SERT_LINK_ENTRY.position];
gsuArrival.description='从 Commonwealth Avenue 走近学生中心，沿前场前往 GSU 与 Mugar 之间的 The Link 共享入口。';
export const BU_COURTYARD_PATHS:WorldPoint[][]=[
  [nickersonStreet,[-2343,669],nickersonArrival.position],
  [stuviStreet,[-2166,664],stuviArrival.position,nickersonArrival.position],
  [lawStreet,lawArrival.position],
  ...sertCourtyardRoutes,
];
BU_WALK_ROUTES.push(...BU_COURTYARD_PATHS);
// Arrival spurs avoid a guide oscillating between an entrance and a nearby
// parallel sidewalk. They also make each destination a real graph endpoint.
for(const place of BU_FULL_PLACES){
  const targets=walkEdges.map(e=>buSegmentProjection(...place.position,e.a,e.b)).filter(p=>p.distance<18).sort((a,b)=>a.distance-b.distance);
  const target=targets.find(p=>safeLeg(place.position,p.point));if(target&&target.distance>.02)BU_WALK_ROUTES.push([target.point,place.position]);
}

export const BU_STREET_SOURCES=[
  'https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/MassDOTRoads_gdb/FeatureServer/0',
  'https://www.bu.edu/parentsprogram/files/2020-boston-university-calendar-ISSUU.pdf',
  'https://maps.bu.edu/?id=647',
];
