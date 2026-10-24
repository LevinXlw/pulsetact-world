// Reproducible adaptation of the public MD iMAP / UMD Facilities roofline data.
// Buildings keep surveyed footprint shapes; spacing is expanded for a walkable
// stylized game and the previously published six landmarks remain untouched.
import fs from 'node:fs';
const sourcePath='assets-source/maryland/umd-official-buildings.geojson';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8').replace(/^\uFEFF/,''));
const outerRings=f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates.map(p=>p[0]):[f.geometry.coordinates[0]];
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1]},0)/2);
const largest=f=>outerRings(f).sort((a,b)=>area(b)-area(a))[0];
const center=p=>[(Math.min(...p.map(p=>p[0]))+Math.max(...p.map(p=>p[0])))/2,(Math.min(...p.map(p=>p[1]))+Math.max(...p.map(p=>p[1])))/2];
const lib=center(largest(source.features.find(f=>f.properties.BUILDINGID==='035'))),admin=center(largest(source.features.find(f=>f.properties.BUILDINGID==='077')));
const mx=86300,mz=111300,dx=(admin[0]-lib[0])*mx,dz=-(admin[1]-lib[1])*mz,len=Math.hypot(dx,dz),cos=dx/len,sin=dz/len,scale=320/len;
const convert=p=>{const x=(p[0]-lib[0])*mx,z=-(p[1]-lib[1])*mz;return [-160+(x*cos+z*sin)*scale,(-x*sin+z*cos)*scale]};
const round=v=>Math.round(v*100)/100;
const rpoint=p=>p.map(round);
const ids=`164 031 145 998 166 799 382 981 425 414 218 360 096 071 063 244 224 054 044 250 061 079 039 026 256 007 022 029 415 242 036 040 147 251 023 974 309 119 069 997 296 015 047 162 158 046 010 398 227 245 088 255 159 406 140 008 403 252 432 038 032 052 016 109 338 428 143 407 091 246 098 060 258 225 233 122 237 093 254 259 146 070 059 014 080 017 121 253 231 381 257 103 379 021 064 142 975 249 083 144 996 223 399 090 247 082 068 097 115 243 081 051 099 404 179 085 042 108 240 386 084 419 037 413 409 065 417 062 202 089 030 141 241 238 156 110 429 073 388 226 232 239 004`.split(' ');
const residences=new Set(`031 998 981 425 096 063 244 061 250 256 022 029 242 023 974 069 997 015 245 008 252 032 016 246 098 060 258 122 254 259 070 014 017 121 253 021 064 975 249 996 247 097 243 051 099 240 419 065 062 030 241 238 239`.split(' '));
const modern=new Set(`382 415 296 406 432 338 428 225 237 381 223 090 115 085 413 429 226`.split(' '));
const garages=new Set(`218 403 404 179 202`.split(' '));
const dining=new Set(`026 251 257`.split(' '));
const athletics=new Set(`414 309 158 159 379 399 068 388 409 004`.split(' '));
const arts=new Set(`145 386 146 417 141 156`.split(' '));
const districtFor=(id,p)=>{
 if(['360','403','414','409','338','428','398'].includes(id))return 'athletics';
 if(['388','407','162','158','159','379','309','218'].includes(id))return 'stadium';
 if(['386','141','417','146','145','143','164','166','156'].includes(id))return 'arts';
 if(id==='039'||id==='404')return 'business';
 if(['079','080','007','004'].includes(id))return 'east-gateway';
 if(Number(id)>=238&&Number(id)<=250)return 'leonardtown';
 if(p[1]>120)return 'south-residential';
 if(residences.has(id))return p[1]>-115?'central':'north-residential';
 if(['251','257','068','399','381'].includes(id))return 'north-residential';
 if(p[0]>165&&p[1]<-210)return 'engineering';
 if(p[1]<-300)return 'science';
 return 'central';
};
const hull=points=>{
 const p=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const lower=[],upper=[];
 for(const x of p){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),x)<=0)lower.pop();lower.push(x)}
 for(const x of p.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),x)<=0)upper.pop();upper.push(x)}
 return lower.slice(0,-1).concat(upper.slice(0,-1));
};
function fit(p){
 let best;const convex=hull(p);
 for(let i=0;i<convex.length;i++){
  const a=convex[i],b=convex[(i+1)%convex.length],yaw=Math.atan2(-(b[1]-a[1]),b[0]-a[0]),c=Math.cos(yaw),s=Math.sin(yaw);
  const q=p.map(([x,z])=>[x*c-z*s,x*s+z*c]),lo=[Math.min(...q.map(a=>a[0])),Math.min(...q.map(a=>a[1]))],hi=[Math.max(...q.map(a=>a[0])),Math.max(...q.map(a=>a[1]))];
  const width=hi[0]-lo[0],depth=hi[1]-lo[1];if(best&&best.width*best.depth<=width*depth)continue;
  const x=(lo[0]+hi[0])/2,z=(lo[1]+hi[1])/2;best={x:x*c+z*s,z:-x*s+z*c,width,depth,yaw};
 }
 return best;
}
function simplify(p,tolerance=.65){
 const q=p.slice();if(Math.hypot(q[0][0]-q.at(-1)[0],q[0][1]-q.at(-1)[1])<.1)q.pop();
 const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)};
 const rdp=(path,tol)=>{let far=0,index=0;for(let i=1;i<path.length-1;i++){const d=distance(path[i],path[0],path.at(-1));if(d>far){far=d;index=i}}if(far<=tol)return[path[0],path.at(-1)];return rdp(path.slice(0,index+1),tol).slice(0,-1).concat(rdp(path.slice(index),tol))};
 let far=1;for(let i=2;i<q.length;i++)if(Math.hypot(q[i][0]-q[0][0],q[i][1]-q[0][1])>Math.hypot(q[far][0]-q[0][0],q[far][1]-q[0][1]))far=i;
 const run=tol=>rdp(q.slice(0,far+1),tol).slice(0,-1).concat(rdp(q.slice(far).concat([q[0]]),tol).slice(0,-1));
 let out=run(tolerance);if(area(out)/area(q)<.97||area(out)/area(q)>1.03)out=run(.15);
 if(area(out)/area(q)<.95||area(out)/area(q)>1.05)throw new Error('Footprint simplification changed topology');return out;
}
const old=[[-160,0,60,105],[160,0,46,94],[-66,-88,92,30],[55,-88,80,30],[-61,88,96,30],[64,88,84,30],[-185,-236,92,64],[230,-140,42,84],[110,220,30,64],[78,234,34,24]];
const obstacles=old.map(([x,z,w,d])=>({minX:x-w/2-10,maxX:x+w/2+10,minZ:z-d/2-10,maxZ:z+d/2+10,id:'existing'}));
const legacyPaths=[ [[-116,14],[116,14]], [[-116,-155],[-116,145]], [[116,-155],[116,145]], [[-210,-155],[116,-155]], [[-185,-155],[-185,-182]], [[116,-140],[190,-140]], [[-116,145],[170,145]], [[110,145],[110,172]] ];
for(const [a,b]of legacyPaths)obstacles.push({minX:Math.min(a[0],b[0])-12,maxX:Math.max(a[0],b[0])+12,minZ:Math.min(a[1],b[1])-12,maxZ:Math.max(a[1],b[1])+12,id:'existing-path'});
function box(b,pad=0){const c=Math.abs(Math.cos(b.yaw)),s=Math.abs(Math.sin(b.yaw)),w=b.width*c+b.depth*s,d=b.width*s+b.depth*c;return{minX:b.x-w/2-pad,maxX:b.x+w/2+pad,minZ:b.z-d/2-pad,maxZ:b.z+d/2+pad,id:b.id}}
const overlaps=(a,b)=>a.minX<b.maxX&&a.maxX>b.minX&&a.minZ<b.maxZ&&a.maxZ>b.minZ;
const buildings=[];
for(const id of ids){
 const f=source.features.find(f=>f.properties.BUILDINGID===id);if(!f)throw new Error('Unknown '+id);
 const p=simplify(largest(f).map(convert)),obb=fit(p),raw=[obb.x,obb.z];
 const district=districtFor(id,raw),kind=garages.has(id)?'garage':dining.has(id)?'dining':residences.has(id)?'residence':modern.has(id)?'modern':arts.has(id)?'arts':athletics.has(id)?'athletics':id==='360'?'arena':id==='398'?'greenhouse':'academic';
 const target=[raw[0]*1.65,raw[1]*1.7];
 // Keep a generous pedestrian belt around the already published central model.
 if(Math.abs(target[0])<280&&target[1]>-300&&target[1]<150){if(raw[1]<-115)target[1]-=100;else if(raw[0]<-180)target[0]-=45;else if(raw[1]>40)target[1]+=145;}
 if(district==='south-residential'&&target[1]<350)target[1]+=95;
 let height=kind==='residence'?14:kind==='modern'?23:kind==='garage'?16:kind==='greenhouse'?6:kind==='dining'?11:kind==='arts'?17:kind==='athletics'?13:18;
 if(['256','252','258','254','259','253','419','425'].includes(id))height=30;
 if(id==='360')height=25;if(id==='432')height=30;if(id==='429')height=25;if(id==='039')height=21;if(id==='080')height=11;if(['108','109','110','119','103'].includes(id))height=7;
 if(['388','409','414'].includes(id))height=4.5;if(id==='159')height=6;
 const b={id:'umd-building-'+id,name:f.properties.NAME,district,x:target[0],z:target[1],width:obb.width,depth:obb.depth,height,yaw:obb.yaw,kind,footprint:p.map(([x,z])=>[x-obb.x+target[0],z-obb.z+target[1]]),sourceBuildingId:id};
 if(id==='388')b.name='Kehoe Track at Ludwig Field';if(id==='251')b.name='251 North / Denton Dining';
 buildings.push(b);
}
// Newer landmarks present on the 2025 university map but absent from the older
// statewide footprint snapshot. Shapes and heights are authored approximations.
const authored=[
 ['434','Pyon-Chen Hall','north-residential',-270,-700,66,28,27,'residence'],
 ['435','Johnson-Whittle Hall','north-residential',-380,-720,60,30,27,'residence'],
 ['436','Yahentamitsi Dining Hall','north-residential',-320,-635,72,38,12,'dining'],
 ['228','E.A. Fernandez IDEA Factory','engineering',470,-540,38,32,22,'modern'],
 ['433','Thurgood Marshall Hall','east-gateway',420,50,70,42,22,'modern'],
 ['438','Stanley R. Zupnik Hall','engineering',440,-875,55,38,24,'modern'],
 ['secu','SECU Stadium','stadium',-465,-565,148,118,25,'stadium'],
];
for(const [id,name,district,x,z,width,depth,height,kind]of authored)buildings.push({id:'umd-building-'+id,name,district,x,z,width,depth,height,yaw:0,kind,sourceBuildingId:id,footprint:[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]].map(([a,b])=>[x+a,z+b])});
// Resolve only close-range overlap introduced by spacing changes and the legacy
// core; keep each GIS footprint intact and record its displacement in metadata.
buildings.sort((a,b)=>b.width*b.depth-a.width*a.depth);
for(const b of buildings){
 const original=[b.x,b.z];let found=false;
 for(let radius=0;radius<=240&&!found;radius+=8){
  const candidates=radius===0?[[0,0]]:Array.from({length:32},(_,i)=>[Math.cos(i*Math.PI/16)*radius,Math.sin(i*Math.PI/16)*radius]);
  for(const [dx,dz]of candidates){b.x=original[0]+dx;b.z=original[1]+dz;if(!obstacles.some(o=>overlaps(box(b,8),o))){found=true;break}}
 }
 if(!found)throw new Error('Unable to place '+b.name);
 const shift=[b.x-original[0],b.z-original[1]];b.footprint=b.footprint.map(([x,z])=>rpoint([x+shift[0],z+shift[1]]));
 b.layoutOffset=rpoint(shift);for(const key of ['x','z','width','depth','height','yaw'])b[key]=round(b[key]);obstacles.push(box(b,8));
}
buildings.sort((a,b)=>a.sourceBuildingId.localeCompare(b.sourceBuildingId));
const districts=[
 {id:'central',name:'中央学术区',center:[0,-250],description:'McKeldin Mall、Hornbake、科学与人文学科院楼'},
 {id:'arts',name:'西部艺术与设计区',center:[-760,-350],description:'Clarice 表演艺术中心、Tawes、Knight 与建筑学院'},
 {id:'stadium',name:'体育场与校友区',center:[-520,-540],description:'SECU Stadium、Cole、Riggs 与 Ludwig Field'},
 {id:'north-residential',name:'北部住宿与生活区',center:[-430,-850],description:'Denton、Ellicott、Cambridge 住宿社区与 Eppley'},
 {id:'athletics',name:'北部运动与生态区',center:[120,-1250],description:'XFINITY Center、球场、温室与 Chesapeake'},
 {id:'science',name:'科学与校园农场',center:[100,-680],description:'物理、公共卫生、生物研究与校园农场'},
 {id:'engineering',name:'工程与计算机区',center:[510,-620],description:'Iribe、Clark、Kim Engineering、IDEA Factory'},
 {id:'south-residential',name:'南部住宿与历史校园',center:[-70,440],description:'South Hill、Washington Quad 与 South Campus Commons'},
 {id:'business',name:'商学院与南部入口',center:[-460,470],description:'Van Munching 商学院与 Mowatt Lane'},
 {id:'east-gateway',name:'东部校园入口',center:[490,170],description:'Rossborough Inn、Turner、Ritchie 与公共政策学院'},
 {id:'leonardtown',name:'Leonardtown 社区',center:[950,320],description:'东南侧林荫住宅与社区中心'},
];
const bounds={minX:-1380,maxX:1170,minZ:-1790,maxZ:830};
const spaces=[
 {id:'umd-laplata-beach',name:'La Plata Beach',district:'north-residential',kind:'lawn',x:-310,z:-860,width:95,depth:65,yaw:0},
 {id:'umd-cambridge-quad',name:'Cambridge Community Quad',district:'north-residential',kind:'quad',x:-65,z:-800,width:70,depth:50,yaw:0},
 {id:'umd-washington-quad',name:'Washington Quad',district:'south-residential',kind:'quad',x:25,z:440,width:65,depth:55,yaw:0},
 {id:'umd-campus-farm',name:'Campus Farm',district:'science',kind:'farm',x:235,z:-820,width:95,depth:90,yaw:0},
 {id:'umd-engineering-field',name:'Engineering Recreation Field',district:'engineering',kind:'field',x:660,z:-780,width:90,depth:65,yaw:0},
 {id:'umd-golf-landscape',name:'University Golf Course',district:'arts',kind:'golf',x:-1120,z:-1030,width:340,depth:520,yaw:0},
 {id:'umd-ludwig-field',name:'Kehoe Track at Ludwig Field',district:'stadium',kind:'track',x:-780,z:-210,width:145,depth:95,yaw:0},
 {id:'umd-shipley-field',name:'Bob Turtle Smith Stadium / Shipley Field',district:'stadium',kind:'baseball',x:-235,z:-470,width:100,depth:100,yaw:0},
 {id:'umd-softball-field',name:'Maryland Softball Stadium Field',district:'athletics',kind:'softball',x:350,z:-1410,width:95,depth:95,yaw:0},
 {id:'umd-hockey-field',name:'Field Hockey & Lacrosse Field',district:'athletics',kind:'hockey',x:650,z:-1135,width:110,depth:70,yaw:0},
];
// Open-space markings must not run underneath neighboring building models.
const spaceObstacles=[...old.map(([x,z,w,d])=>({minX:x-w/2-4,maxX:x+w/2+4,minZ:z-d/2-4,maxZ:z+d/2+4})),...buildings.map(b=>box(b,4))];
for(const s of spaces){
 const original=[s.x,s.z];let found=false;
 for(let r=0;r<220&&!found;r+=8)for(let a=0;a<(r===0?1:32);a++){
  s.x=original[0]+Math.cos(a*Math.PI/16)*r;s.z=original[1]+Math.sin(a*Math.PI/16)*r;
  if(!spaceObstacles.some(o=>overlaps(box(s),o))){found=true;break}
 }
 if(!found)throw new Error('Open space has no clear footprint '+s.name);
 s.x=round(s.x);s.z=round(s.z);spaceObstacles.push(box(s,4));
}
// Build collision-safe walkways across the GIS-derived districts. This is an
// authored pedestrian network, not a claim to reproduce every campus sidewalk.
const padBoxes=[...old.map(([x,z,w,d])=>({minX:x-w/2-10,maxX:x+w/2+10,minZ:z-d/2-10,maxZ:z+d/2+10})),...buildings.map(b=>box(b,10))];
const inside=(p,o)=>p[0]>o.minX&&p[0]<o.maxX&&p[1]>o.minZ&&p[1]<o.maxZ;
const blocked=p=>padBoxes.some(o=>inside(p,o));
function clear(a,b){for(const o of padBoxes){let t0=0,t1=1;for(const [axis,min,max]of [[0,o.minX,o.maxX],[1,o.minZ,o.maxZ]]){const d=b[axis]-a[axis];if(Math.abs(d)<1e-8){if(a[axis]<=min||a[axis]>=max){t0=2;break}}else{let s=(min-a[axis])/d,t=(max-a[axis])/d;if(s>t)[s,t]=[t,s];t0=Math.max(t0,s);t1=Math.min(t1,t);if(t0>=t1)break}}if(t0<t1&&t1>0&&t0<1)return false}return true}
function freeNear(p){if(!blocked(p))return rpoint(p);for(let r=12;r<140;r+=12)for(let a=0;a<24;a++){const q=[p[0]+Math.cos(a*Math.PI/12)*r,p[1]+Math.sin(a*Math.PI/12)*r];if(!blocked(q))return rpoint(q)}throw new Error('No clear point '+p)}
const step=15,key=p=>p.join(','),snap=p=>p.map(v=>Math.round(v/step)*step);
function route(start,end){
 if(clear(start,end))return [start,end];
 const gridNear=p=>{const q=snap(p);for(let r=0;r<12;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;const n=[q[0]+dx*step,q[1]+dz*step];if(!blocked(n)&&clear(p,n))return n}throw new Error('No reachable grid node '+p)};
 const s=gridNear(start),t=gridNear(end);
 const open=[{p:s,g:0,f:0}],cost=new Map([[key(s),0]]),parent=new Map();let last,iterations=0;
 while(open.length&&iterations++<90000){
  let index=0;for(let i=1;i<open.length;i++)if(open[i].f<open[index].f)index=i;
  const current=open.splice(index,1)[0];if(current.g!==cost.get(key(current.p)))continue;
  if(Math.hypot(current.p[0]-t[0],current.p[1]-t[1])<step*.5){last=current.p;break}
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
   const p=[current.p[0]+dx*step,current.p[1]+dz*step];if(p[0]<bounds.minX+15||p[0]>bounds.maxX-15||p[1]<bounds.minZ+15||p[1]>bounds.maxZ-15||!clear(current.p,p))continue;
   const g=current.g+Math.hypot(dx,dz)*step,k=key(p);if(g>=(cost.get(k)??Infinity))continue;cost.set(k,g);parent.set(k,current.p);open.push({p,g,f:g+Math.hypot(p[0]-t[0],p[1]-t[1])});
  }
 }
 if(!last)throw new Error('Route failed '+start+' to '+end);
 const path=[end];for(let p=last;p;p=parent.get(key(p)))path.push(p);path.push(start);path.reverse();
 const out=[start];for(let i=0;i<path.length-1;){let next=i+1;for(let j=i+2;j<path.length;j++)if(clear(path[i],path[j]))next=j;else break;out.push(path[next]);i=next}return out.filter((p,i)=>i===0||key(p)!==key(out[i-1]));
}
const places=[];
const placeDefs=[
 ['umd-hornbake','147','Hornbake 图书馆','中央广场与图书馆的石材立面。'],
 ['umd-clarice','386','Clarice 表演艺术中心','沿西部校园漫步，来到音乐与表演艺术中心。'],
 ['umd-secu','secu','SECU Stadium','看台、球场与校友区连接成校园体育核心。'],
 ['umd-eppley','068','Eppley 休闲中心','北部校园的休闲运动中心与 Aquatic Center。'],
 ['umd-north-residences','436','北部住宿社区','Yahentamitsi、Pyon-Chen 与 Johnson-Whittle 组成新的住宿广场。'],
 ['umd-xfinity','360','XFINITY Center','沿 Paint Branch 方向进入北部竞技体育区。'],
 ['umd-science','415','科学与校园农场','物理科学综合楼、实验教学区与校园农场。'],
 ['umd-iribe','432','Brendan Iribe Center','玻璃与砖石相间的计算机科学中心。'],
 ['umd-clark','429','A. James Clark Hall','沿工程区步道探索 Clark、Kim 与 IDEA Factory。'],
 ['umd-south-hill','026','South Hill 与 Washington Quad','穿行红砖宿舍、南部餐厅和庭院绿地。'],
 ['umd-van-munching','039','Van Munching 商学院','商学院的红砖院落连接南部校园入口。'],
 ['umd-rossborough','080','Rossborough Inn','历史旅馆、东部入口与 Ritchie Coliseum。'],
 ['umd-leonardtown','250','Leonardtown 社区','东南侧的社区中心、住宅与林荫小径。'],
];
for(const [id,bid,title,description]of placeDefs){
 const b=buildings.find(b=>b.sourceBuildingId===bid),wideView=id==='umd-iribe'||id==='umd-xfinity';
 const p=freeNear(id==='umd-secu'?[b.x+b.width/2+28,b.z]:[b.x,b.z+Math.abs(Math.sin(b.yaw))*b.width/2+Math.abs(Math.cos(b.yaw))*b.depth/2+23+(wideView?22:0)]);
 places.push({id,title,subtitle:b.name,position:p,lookAt:[b.x,b.z],view:wideView?{pitch:.28,distance:15}:{pitch:.17,distance:12},radius:20,description,note:'室外探索 · 可沿校园步道前往相邻分区',district:b.district});
}
const paths=[],network=[[-210,-155],[-116,-155],[116,-155],[-116,145],[116,145]];
// District ring, with branches to every modeled building rather than only the
// destination cards; connected intersections are resolved by campus-paths.ts.
const backbone=[[-300,-160],[-350,-350],[-680,-600],[-800,-900],[-420,-1100],[-90,-1150],[200,-1380],[350,-1140],[520,-900],[700,-600],[700,-260],[550,100],[850,260],[900,450],[450,550],[0,630],[-430,570],[-600,300],[-620,0],[-980,-350],[-1190,-600],[-1100,-1200],[-900,-1550],[70,-1670]];
function connect(p){
 p=freeNear(p);let nearest=network[0],dist=Infinity;for(const n of network){const d=Math.hypot(p[0]-n[0],p[1]-n[1]);if(d<dist){dist=d;nearest=n}}
 const path=route(nearest,p);paths.push(path);network.push(...path.slice(1));return p;
}
for(const p of backbone)connect(p);
for(const place of places)connect(place.position);
for(const b of buildings){
 const bb=box(b),entries=[[b.x,bb.maxZ+18],[bb.maxX+18,b.z],[b.x,bb.minZ-18],[bb.minX-18,b.z]];let linked=false;
 for(const entry of entries){try{connect(freeNear(entry));linked=true;break}catch{}}
 if(!linked)console.warn('No individual spur:',b.name);
}
for(const [a,b]of [[[0,630],[450,550]],[[-420,-1100],[350,-1140]],[[-620,0],[-430,570]],[[-350,-350],[700,-260]],[[200,-1380],[70,-1670]]])paths.push(route(freeNear(a),freeNear(b)));
// Verify authored navigation geometrically before emitting data.
for(const path of paths)for(let i=1;i<path.length;i++)if(!clear(path[i-1],path[i]))throw new Error('Unsafe segment '+path[i-1]+' '+path[i]);
for(const p of places)if(blocked(p.position))throw new Error('Unsafe arrival '+p.id);
const header=`import type {WorldPoint} from './charles-geography';\nimport type {CampusDistrict,CampusPlace} from './campus-regions';\n\n/** Public UMD Facilities roofline topology, adapted to the game's existing core.\n * Distances and building heights are authored; this is not a surveying model.\n * Rebuild: node scripts/prepare-maryland-full-layout.mjs. */\nexport type UMDBuildingKind='academic'|'residence'|'modern'|'arena'|'stadium'|'arts'|'garage'|'dining'|'athletics'|'greenhouse';\nexport type UMDFullBuilding={id:string;name:string;district:string;x:number;z:number;width:number;depth:number;height:number;yaw:number;kind:UMDBuildingKind;footprint:WorldPoint[];sourceBuildingId:string;layoutOffset?:WorldPoint};\n`;
const stringify=JSON.stringify;
const lines=a=>'[\n'+a.map(v=>'  '+stringify(v)).join(',\n')+'\n]';
const out=header+`export const UMD_FULL_BOUNDS=${stringify(bounds)};\nexport const UMD_DISTRICTS:CampusDistrict[]=${lines(districts)};\nexport const UMD_FULL_BUILDINGS:UMDFullBuilding[]=${lines(buildings)};\nexport const UMD_FULL_SPACES=${lines(spaces)};\nexport const UMD_FULL_PATHS:WorldPoint[][]=${lines(paths)};\nexport const UMD_FULL_PLACES:CampusPlace[]=${lines(places)};\n`;
fs.writeFileSync('src/features/world/maryland-full-layout.ts',out);
fs.writeFileSync('assets-source/maryland/full-campus-references.json',JSON.stringify({retrieved:'2026-10-15',scope:'Main College Park campus including west arts/golf landscape, north athletics and residential communities, engineering, south residence/business and Leonardtown. Excludes remote research facilities, Discovery District and outlying graduate housing.',sources:[{url:'https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/2',title:'UMD Buildings, Maryland iMAP',credit:'MD iMAP, University of Maryland Facilities Management',publishedMetadata:'September 2012; maintained roofline layer includes subsequent updates',use:'Building IDs, names, footprint topology. Public query/extract service; attribution retained. Snapshot is not current construction status.'},{url:'https://umdconf.umd.edu/drupal/current_map.pdf',title:'2025 University of Maryland Campus Map',credit:'Conferences & Visitor Services / Facilities Management',use:'District adjacency, new landmark names and public campus coverage.'},{url:'https://facilities.umd.edu/info-resources/building-inventory',title:'UMD Facilities Building Inventory',use:'Building-name reference'}],adaptation:{anchor:'McKeldin and Miller Administration east-west axis',horizontalFootprintScale:scale,centerSpacingX:1.65,centerSpacingZ:1.7,existingCoreLandmarksPreserved:6,heights:'Authored visual approximations, not measured or surveyed',paths:'Authored collision-safe outdoor walking routes; not survey-exact sidewalk data',newerAuthoredBuildingIds:authored.map(a=>a[0]),modelCount:buildings.length,fastTravelCount:places.length,paths:paths.length},buildings:buildings.map(({id,name,sourceBuildingId,layoutOffset})=>({id,name,sourceBuildingId,layoutOffset}))},null,2));
console.log(JSON.stringify({buildings:buildings.length,footprintVertices:buildings.reduce((s,b)=>s+b.footprint.length,0),paths:paths.length,pathSegments:paths.reduce((s,p)=>s+p.length-1,0),places:places.length,bounds}));
const fidelity=buildings.filter(b=>!authored.some(a=>a[0]===b.sourceBuildingId)).map(b=>({name:b.name,retainedArea:area(b.footprint)/area(largest(source.features.find(f=>f.properties.BUILDINGID===b.sourceBuildingId)).map(convert))}));
console.log('Footprint area retained:',fidelity.filter(f=>f.retainedArea<.9||f.retainedArea>1.1));
// District corrections are part of the reproducible build, not a manual edit.
await import('./refine-maryland-districts.mjs');
