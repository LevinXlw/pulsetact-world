import fs from 'node:fs';
import path from 'node:path';

// Reproducible local conversion of official UA PDC geographic snapshots.
// All geometry shares this east/south metre projection. No centroid scaling,
// relocation, or invented replacement footprints is performed.
const dir='assets-source/arizona',out='src/features/world';
const load=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const source=load('building-footprints.geojson');
const polygons=f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
const area=ring=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
const largest=f=>polygons(f).sort((a,b)=>Math.abs(area(b[0]))-Math.abs(area(a[0])))[0];
const oldRing=largest(source.features.find(f=>f.properties.SpaceNum===21))[0];
const origin={longitude:(Math.min(...oldRing.map(p=>p[0]))+Math.max(...oldRing.map(p=>p[0])))/2,latitude:(Math.min(...oldRing.map(p=>p[1]))+Math.max(...oldRing.map(p=>p[1])))/2};
const metresLon=111320*Math.cos(origin.latitude*Math.PI/180),metresLat=110905;
const round=n=>Math.round(n*100)/100;
const convert=([lon,lat])=>[round((lon-origin.longitude)*metresLon),round((origin.latitude-lat)*metresLat)];
const bounds={minX:-370,maxX:1030,minZ:-660,maxZ:560};
function inside(p,r){let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function distance(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);}
function simplify(points,tolerance=.3){
  const ring=points.filter((p,i)=>!i||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>.025);
  if(ring.length>3&&Math.hypot(ring[0][0]-ring.at(-1)[0],ring[0][1]-ring.at(-1)[1])<.05)ring.pop();
  const reduce=chain=>{let farthest=0,index=0;for(let i=1;i<chain.length-1;i++){const d=distance(chain[i],chain[0],chain.at(-1));if(d>farthest){farthest=d;index=i;}}return farthest>tolerance?[...reduce(chain.slice(0,index+1)).slice(0,-1),...reduce(chain.slice(index))]:[chain[0],chain.at(-1)];};
  let split=1;for(let i=2;i<ring.length;i++)if(Math.hypot(ring[i][0]-ring[0][0],ring[i][1]-ring[0][1])>Math.hypot(ring[split][0]-ring[0][0],ring[split][1]-ring[0][1]))split=i;
  const result=[...reduce(ring.slice(0,split+1)).slice(0,-1),...reduce([...ring.slice(split),ring[0]]).slice(0,-1)];return result.length>=3?result:ring;
}
function extent(points){return{minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[1])),maxZ:Math.max(...points.map(p=>p[1]))};}
function obb(points){let best;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],theta=Math.atan2(b[1]-a[1],b[0]-a[0]),c=Math.cos(theta),s=Math.sin(theta);const uv=points.map(([x,z])=>[x*c+z*s,-x*s+z*c]),e=extent(uv),ar=(e.maxX-e.minX)*(e.maxZ-e.minZ);if(!best||ar<best.area){const u=(e.minX+e.maxX)/2,v=(e.minZ+e.maxZ)/2;best={area:ar,x:round(u*c-v*s),z:round(u*s+v*c),width:round(e.maxX-e.minX),depth:round(e.maxZ-e.minZ),yaw:round(-theta)};}}const{area:_,...result}=best;return result;}
const aliases=new Map([[21,'old-main'],[108,'eller'],[137,'enr2'],[17,'union'],[55,'library'],[56,'bear-down'],[30,'museum']]);
const buildings=[];
for(const feature of source.features){
  const sourceId=String(feature.properties.SpaceNum),name=feature.properties.Name??`Campus building ${sourceId}`;
  // ILC is below the Mall. Extruding its footprint as a block would close the
  // main outdoor promenade; its mapped paving is retained below.
  if(sourceId==='70')continue;
  const parts=polygons(feature).map(poly=>({footprint:simplify(poly[0].map(convert)),holes:poly.slice(1).map(r=>simplify(r.map(convert))).filter(r=>Math.abs(area(r))>2)})).filter(p=>Math.abs(area(p.footprint))>18).sort((a,b)=>Math.abs(area(b.footprint))-Math.abs(area(a.footprint)));
  const emitted=[];
  for(const [index,part] of parts.entries()){
    const box=obb(part.footprint);if(box.x<bounds.minX+5||box.x>bounds.maxX-5||box.z<bounds.minZ+5||box.z>bounds.maxZ-5)continue;
    const kind=/Parking Garage/i.test(name)?'garage':sourceId==='96'?'arena':['58','61','58.06','98.02'].includes(sourceId)?'stadium':/Residence|Hall$/.test(name)&&/Yuma|Gila|Maricopa|Coronado|Graham|Greenlee|Kaibab|Posada|Manzanita|Navajo|Coconino|Likins|Apache|Arbol|Villa/.test(name)?'residence':/Science|Research|Laborator|Engineering|Environment|Physics|Optical/.test(name)?'lab':'academic';
    const height=({21:13,108:24,137:22,17:21,19:15,55:21,56:16,96:27,58:24,61:29,'58.06':30,30:15})[sourceId]??(kind==='garage'?18:kind==='residence'?23:kind==='lab'?23:16);
    const b={id:`arizona-${aliases.get(Number(sourceId))??sourceId.replace('.','-')}-building${index?`-part-${index+1}`:''}`,name,sourceId,...box,height,kind,footprint:part.footprint,...(part.holes.length?{holes:part.holes}:{})};buildings.push(b);emitted.push(b);
  }
  if(sourceId==='137'&&emitted.length)emitted[0].complexFootprints=emitted.map(b=>({footprint:b.footprint,...(b.holes?{holes:b.holes}:{})}));
}
const surfaces=[];
function clipped(ring){let r=ring;for(const [axis,limit,sign] of [[0,bounds.minX,1],[0,bounds.maxX,-1],[1,bounds.minZ,1],[1,bounds.maxZ,-1]]){const output=[];for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],aIn=(a[axis]-limit)*sign>=0,bIn=(b[axis]-limit)*sign>=0;if(aIn)output.push(a);if(aIn!==bIn){const t=(limit-a[axis])/(b[axis]-a[axis]);output.push([round(a[0]+t*(b[0]-a[0])),round(a[1]+t*(b[1]-a[1]))]);}}r=output;if(!r.length)break;}return r;}
for(const [prefix,files] of [['landscape',['landscape.geojson','landscape-2000.geojson']],['road',['streets.geojson']],['walk',['walks.geojson','walks-2000.geojson','walks-4000.geojson']]]){
  const seen=new Set();
  for(const filename of files){const data=load(filename);if(data.error)throw new Error(`${filename}: ${JSON.stringify(data.error)}`);for(const feature of data.features){const id=feature.properties.OBJECTID;if(seen.has(id))continue;seen.add(id);const kind=prefix==='road'?'road':prefix==='walk'?'paving':[2,3,13,14,15,16].includes(feature.properties.Type)||/Turf/.test(feature.properties.LandscapeCoverType??'')?'grass':'desert';
    for(const [part,poly] of polygons(feature).entries()){const points=clipped(simplify(poly[0].map(convert),.25));if(points.length<3||Math.abs(area(points))<2)continue;const holes=poly.slice(1).map(r=>clipped(simplify(r.map(convert),.25))).filter(r=>r.length>=3&&Math.abs(area(r))>2);surfaces.push({id:`${prefix}-${id}-${part}`,kind,points,...(holes.length?{holes}:{})});}
  }}
}
const hitsBuilding=(p,padding=0)=>buildings.some(b=>{const clearance=padding>0&&b.sourceId==='21'?Math.max(padding,11):padding;const e=b._box??=extent(b.footprint);if(p[0]<e.minX-clearance||p[0]>e.maxX+clearance||p[1]<e.minZ-clearance||p[1]>e.maxZ+clearance)return false;const interior=inside(p,b.footprint)&&!(b.holes??[]).some(h=>inside(p,h));return interior||(clearance>0&&[b.footprint,...(b.holes??[])].some(r=>r.some((a,i)=>distance(p,a,r[(i+1)%r.length])<clearance)));});
const paved=surfaces.filter(s=>s.kind==='paving');
const surfaceHit=(p,s)=>inside(p,s.points)&&!(s.holes??[]).some(h=>inside(p,h));
const onPaving=p=>paved.some(s=>surfaceHit(p,s));
const pointFor=(sourceId,side='south',offset=14)=>{const group=buildings.filter(b=>b.sourceId===sourceId),all=group.flatMap(b=>b.footprint),e=extent(all),center=[(e.minX+e.maxX)/2,(e.minZ+e.maxZ)/2];const target=side==='south'?[center[0],e.maxZ+offset]:side==='north'?[center[0],e.minZ-offset]:side==='west'?[e.minX-offset,center[1]]:[e.maxX+offset,center[1]];let best=target,score=Infinity;for(let x=target[0]-35;x<=target[0]+35;x+=2)for(let z=target[1]-35;z<=target[1]+35;z+=2){const p=[round(x),round(z)];if(hitsBuilding(p,4))continue;const cost=Math.hypot(x-target[0],z-target[1])+(onPaving(p)?0:35);if(cost<score){score=cost;best=p;}}return{position:best,lookAt:center.map(round)};};
const definitions=[
  ['arizona-old-main','Old Main','HISTORIC HEART · 1891','21','west','old-main','砂岩、红砖与环绕廊道组成校园最早的核心建筑。','绕行老楼，在东侧望向 University Mall。'],
  ['arizona-union','Student Union Memorial Center','STUDENT UNION · CAMPUS LIFE','17','south','mall','学生会馆位于 Mall 北侧，步道连接书店、入口广场和校园核心。','沿开放广场向东步行，接上主轴。'],
  ['arizona-library','Main Library','MAIN LIBRARY · LEARNING','55','north','mall','主图书馆位于 Mall 南侧，与 Bear Down 和地下学习中心相邻。','从北侧步道观察层层退进的体量。'],
  ['arizona-bear-down','Bear Down Building','BEAR DOWN · CAMPUS TRADITION','56','west','mall','红砖体育馆如今处于校园学习空间与草坪步道之间。','沿西侧入口广场绕行，寻找传统校园的红砖节奏。'],
  ['arizona-eller','Eller · McClelland Hall','ELLER COLLEGE OF MANAGEMENT','108','south','eller','商学院位于 Speedway 以北，南侧开口通向围合庭院。','穿过南侧广场，从庭院看三翼建筑。'],
  ['arizona-enr2','ENR2','ENVIRONMENT + NATURAL RESOURCES','137','north','south','自然资源大楼以沙漠峡谷为灵感，开放中庭穿过层叠走廊与遮阳空间。','从北侧接近大楼，再进入开放峡谷。'],
  ['arizona-stadium','Arizona Stadium','ARIZONA STADIUM · ATHLETICS','58','west','athletics','校园东南侧的美式橄榄球场，东西看台和周边步道构成体育区。','沿西看台外侧走向 McKale Center。'],
  ['arizona-museum','Arizona State Museum','HISTORIC CAMPUS · MUSEUM','30','east','old-main','历史校园西缘的博物馆建筑，红砖与林荫步道连接 Old Main。','从东侧沿历史校园步道返回主楼。'],
];
const points=definitions.map(([id,title,subtitle,sourceId,side,district,description,note])=>({id,title,subtitle,...pointFor(sourceId,side),radius:22,district,description,note,view:{pitch:.2,distance:13}}));
const mall={id:'arizona-mall',title:'University Mall',subtitle:'UNIVERSITY MALL · TUCSON',position:[480,8],lookAt:[20,0],radius:30,district:'mall',description:'Old Main 以东的长草坪轴线，连接学生会馆、图书馆与体育区。',note:'沿草坪两侧的步道探索，不同方向能看见不同年代的校园。',view:{pitch:.18,distance:13}};
points.splice(1,0,mall);
const spawn=points[0].position,paths=[];
const cell=6,cols=Math.floor((bounds.maxX-bounds.minX)/cell)+1,rows=Math.floor((bounds.maxZ-bounds.minZ)/cell)+1;
const world=id=>[round(bounds.minX+(id%cols)*cell),round(bounds.minZ+Math.floor(id/cols)*cell)];
const index=p=>Math.round((p[1]-bounds.minZ)/cell)*cols+Math.round((p[0]-bounds.minX)/cell);
const blocked=new Uint8Array(cols*rows),costs=new Float32Array(cols*rows);
const surfaceBuckets=new Map();for(const s of surfaces){const e=extent(s.points);for(let x=Math.floor(e.minX/80);x<=Math.floor(e.maxX/80);x++)for(let z=Math.floor(e.minZ/80);z<=Math.floor(e.maxZ/80);z++){const key=`${x}:${z}`,bucket=surfaceBuckets.get(key)??[];bucket.push(s);surfaceBuckets.set(key,bucket);}}
for(let id=0;id<blocked.length;id++){const p=world(id);blocked[id]=hitsBuilding(p,3)?1:0;const covering=(surfaceBuckets.get(`${Math.floor(p[0]/80)}:${Math.floor(p[1]/80)}`)??[]).filter(s=>surfaceHit(p,s));costs[id]=covering.some(s=>s.kind==='paving')?1:covering.some(s=>s.kind==='grass')?2.7:covering.some(s=>s.kind==='road')?1.8:4;}
function clearLine(a,b){const n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/1.4);for(let i=0;i<=n;i++)if(hitsBuilding([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n],2.8))return false;return true;}
function closest(p){const initial=index(p);if(!blocked[initial]&&clearLine(p,world(initial)))return initial;let best,cost=Infinity;for(let z=-7;z<=7;z++)for(let x=-7;x<=7;x++){const id=initial+z*cols+x;if(id<0||id>=blocked.length||blocked[id])continue;const candidate=world(id),d=Math.hypot(candidate[0]-p[0],candidate[1]-p[1]);if(d<cost&&clearLine(p,candidate)){cost=d;best=id;}}if(best===undefined)throw new Error(`No route node near ${p}`);return best;}
function route(a,b){const start=closest(a),goal=closest(b),scores=new Float64Array(blocked.length).fill(Infinity),parents=new Int32Array(blocked.length).fill(-1),queue=[];scores[start]=0;
  const push=(id,score)=>{let i=queue.length;queue.push([id,score]);while(i){const p=(i-1)>>1;if(queue[p][1]<=score)break;queue[i]=queue[p];i=p;}queue[i]=[id,score];};
  const pop=()=>{const first=queue[0],last=queue.pop();if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&queue[child+1][1]<queue[child][1])child++;if(queue[child][1]>=last[1])break;queue[i]=queue[child];i=child;}queue[i]=last;}return first;};push(start,0);
  while(queue.length){const[id,score]=pop();if(score>scores[id]+.001)continue;if(id===goal)break;const col=id%cols,row=Math.floor(id/cols);for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const x=col+dx,z=row+dz;if(x<0||z<0||x>=cols||z>=rows)continue;const next=z*cols+x;if(blocked[next]||dx&&dz&&(blocked[row*cols+x]||blocked[z*cols+col]))continue;const cost=score+Math.hypot(dx,dz)*(costs[id]+costs[next])/2;if(cost<scores[next]){scores[next]=cost;parents[next]=id;push(next,cost);}}}
  if(!Number.isFinite(scores[goal]))throw new Error(`Disconnected route ${a} -> ${b}`);const chain=[];for(let node=goal;node>=0;node=parents[node]){chain.push(world(node));if(node===start)break;}chain.reverse();const joined=[a,...chain,b],simplified=[joined[0]];for(let i=1;i<joined.length-1;i++){const prev=simplified.at(-1),current=joined[i],next=joined[i+1],cross=(current[0]-prev[0])*(next[1]-current[1])-(current[1]-prev[1])*(next[0]-current[0]);if(Math.abs(cross)<.01&&clearLine(prev,next))continue;simplified.push(current);}simplified.push(b);for(let i=1;i<simplified.length;i++)if(!clearLine(simplified[i-1],simplified[i]))throw new Error('Route intersects building');return simplified;}
for(const destination of points.slice(1))paths.push(route(spawn,destination.position));
// Additional east/west Mall and southern links form loops instead of forcing
// every journey to go back through the historic gateway.
for(const [a,b]of[[1,2],[1,3],[3,4],[3,7],[6,7],[4,6]])paths.push(route(points[a].position,points[b].position));
for(const b of buildings)delete b._box;
const districts=[{id:'old-main',name:'历史校园',center:[-150,10],description:'Old Main 与早期红砖校园。'},{id:'mall',name:'University Mall',center:[420,0],description:'学生会馆、图书馆与中央长草坪。'},{id:'eller',name:'Eller 商学院',center:points.find(p=>p.id==='arizona-eller').lookAt,description:'Speedway 北侧的 McClelland Hall。'},{id:'south',name:'南部科学区',center:[-130,390],description:'ENR2 的峡谷中庭与科学教学建筑。'},{id:'athletics',name:'体育区',center:[600,320],description:'Arizona Stadium 和 McKale Center。'}];
const serialize=o=>JSON.stringify(o);
const geography=`import type {WorldPoint} from './charles-geography';
import {createArizonaTerrain} from './arizona-terrain';
export type ArizonaBuilding={id:string;name:string;sourceId:string;x:number;z:number;width:number;depth:number;yaw:number;height:number;kind:string;footprint:WorldPoint[];holes?:WorldPoint[][];complexFootprints?:{footprint:WorldPoint[];holes?:WorldPoint[][]}[]};
export type ArizonaSurface={id:string;kind:string;points:WorldPoint[];holes?:WorldPoint[][]};
// Generated from official UA PDC footprint, walk, road and landscape polygons.
// East/south metres; one transform for every vertex. Heights are visual estimates.
export const ARIZONA_ORIGIN=${serialize(origin)};
export const ARIZONA_BOUNDS=${serialize(bounds)};
export const ARIZONA_BUILDINGS:ArizonaBuilding[]=${serialize(buildings)};
export const ARIZONA_SURFACES:ArizonaSurface[]=${serialize(surfaces)};
export const ARIZONA_PATHS:WorldPoint[][]=${serialize(paths)};
const terrain=createArizonaTerrain(ARIZONA_ORIGIN,ARIZONA_BUILDINGS,${metresLon},${metresLat});
export const arizonaElevation=terrain.elevation;
export const drapeArizonaGeometry=terrain.drape;
export const arizonaRawElevation=terrain.rawElevation;
export function arizonaPointInside(point:WorldPoint,ring:WorldPoint[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function arizonaNavigationBlocked(x:number,z:number){const p:WorldPoint=[x,z];return ARIZONA_BUILDINGS.some(b=>arizonaPointInside(p,b.footprint)&&!(b.holes??[]).some(h=>arizonaPointInside(p,h)));}
`;
fs.writeFileSync(path.join(out,'arizona-geography.ts'),geography);
fs.writeFileSync(path.join(out,'arizona-layout.ts'),`import type {CampusLayout} from './campus-regions';\nimport {ARIZONA_BOUNDS,ARIZONA_BUILDINGS,ARIZONA_PATHS} from './arizona-geography';\nexport const ARIZONA_LAYOUT={bounds:ARIZONA_BOUNDS,spawn:${serialize(spawn)},lookTarget:[0,0],route:ARIZONA_PATHS[0],paths:ARIZONA_PATHS,districts:${serialize(districts)},points:${serialize(points)},mapBuildings:ARIZONA_BUILDINGS.map(b=>({...b,label:b.name}))} satisfies CampusLayout;\n`);
fs.writeFileSync(path.join(dir,'geography-references.json'),JSON.stringify({prepared:new Date().toISOString(),publisher:'University of Arizona Planning, Design and Construction Enterprise GIS',service:'https://services.maps.arizona.edu/pdc/rest/services/SubtleCanvasTilesBridgesTechPark/MapServer',layers:{buildings:21,walks:34,streets:37,landscape:30},origin,transform:{metresLon,metresLat,axes:'east/south',horizontalScale:1},bounds,scope:'Tucson main campus core plus McClelland Hall; not the medical campus or a cadastral boundary',limitations:['Building heights and facade details are authored estimates.','Ground uses USGS 3DEP 192×192 DEM samples, filtered and blended narrowly at building footprints; it is not a detailed curb/stair survey.','Subterranean ILC is not extruded above University Mall.','Footprint fragments smaller than 18 square metres are omitted; mapped exterior polygons simplified at 0.3m.','Route graph is generated through verified open space with paving preference; landscaping placement is illustrative.'],counts:{buildings:buildings.length,surfaces:surfaces.length,paths:paths.length,points:points.length},places:points.map(p=>({id:p.id,position:p.position}))},null,2));
console.log(JSON.stringify({origin,counts:{buildings:buildings.length,surfaces:surfaces.length,paths:paths.length},landmarks:buildings.filter(b=>['21','108','137','17','55','56'].includes(b.sourceId)).map(({id,x,z,width,depth,holes})=>({id,x,z,width,depth,holes:holes?.length??0})),points:points.map(p=>({id:p.id,position:p.position}))},null,2));
