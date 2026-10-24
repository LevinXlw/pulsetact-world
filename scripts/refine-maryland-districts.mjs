// Apply the SAME geographic transform to roads, terrain and district footprints.
// Run after prepare-maryland-full-layout.mjs and before prepare-maryland-roads.mjs.
import fs from 'node:fs';
const file='src/features/world/maryland-full-layout.ts';
let text=fs.readFileSync(file,'utf8');
const read=name=>JSON.parse(text.match(new RegExp(`${name}[^=]*=(\\[[\\s\\S]+?\\]);`))[1]);
const buildings=read('UMD_FULL_BUILDINGS'),paths=read('UMD_FULL_PATHS'),places=read('UMD_FULL_PLACES');
const source=JSON.parse(fs.readFileSync('assets-source/maryland/umd-official-buildings.geojson','utf8').replace(/^\uFEFF/,''));
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1]},0)/2);
const polygons=f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];
const largest=f=>polygons(f).sort((a,b)=>area(b[0])-area(a[0]))[0];
const center=p=>[(Math.min(...p.map(p=>p[0]))+Math.max(...p.map(p=>p[0])))/2,(Math.min(...p.map(p=>p[1]))+Math.max(...p.map(p=>p[1])))/2];
const lib=center(largest(source.features.find(f=>f.properties.BUILDINGID==='035'))[0]);
const admin=center(largest(source.features.find(f=>f.properties.BUILDINGID==='077'))[0]);
const mx=86300,mz=111300,dx=(admin[0]-lib[0])*mx,dz=-(admin[1]-lib[1])*mz,len=Math.hypot(dx,dz),cos=dx/len,sin=dz/len,scale=320/len;
const round=v=>Math.round(v*100)/100,rpoint=p=>p.map(round);
const convert=([lon,lat])=>{const x=(lon-lib[0])*mx,z=-(lat-lib[1])*mz;return rpoint([(-160+(x*cos+z*sin)*scale)*1.65,(-x*sin+z*cos)*scale*1.7])};
const hull=points=>{
 const p=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lo=[],hi=[];
 for(const x of p){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),x)<=0)lo.pop();lo.push(x)}
 for(const x of p.slice().reverse()){while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),x)<=0)hi.pop();hi.push(x)}
 return lo.slice(0,-1).concat(hi.slice(0,-1));
};
function fit(p){
 let best;const convex=hull(p);
 for(let i=0;i<convex.length;i++){
  const a=convex[i],b=convex[(i+1)%convex.length],yaw=Math.atan2(-(b[1]-a[1]),b[0]-a[0]),c=Math.cos(yaw),s=Math.sin(yaw);
  const q=p.map(([x,z])=>[x*c-z*s,x*s+z*c]),lo=[Math.min(...q.map(a=>a[0])),Math.min(...q.map(a=>a[1]))],hi=[Math.max(...q.map(a=>a[0])),Math.max(...q.map(a=>a[1]))];
  const width=hi[0]-lo[0],depth=hi[1]-lo[1];if(best&&best.width*best.depth<=width*depth)continue;
  const x=(lo[0]+hi[0])/2,z=(lo[1]+hi[1])/2;best={x:x*c+z*s,z:-x*s+z*c,width,depth,yaw};
 }return Object.fromEntries(Object.entries(best).map(([k,v])=>[k,k==='yaw'?v:round(v)]));
}
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)};
function simplify(p){
 const q=p.slice();if(distance(q[0],q.at(-1),q.at(-1))<.1)q.pop();
 // Bound error against the original vertices. Repeatedly removing a shallow
 // corner accumulates error on curved facades such as Van Munching's rotundas.
 const rdp=path=>{let far=0,index=0;for(let i=1;i<path.length-1;i++){const d=distance(path[i],path[0],path.at(-1));if(d>far){far=d;index=i}}if(far<=.16)return [path[0],path.at(-1)];return rdp(path.slice(0,index+1)).slice(0,-1).concat(rdp(path.slice(index)))};
 let split=1;for(let i=2;i<q.length;i++)if(distance(q[i],q[0],q[0])>distance(q[split],q[0],q[0]))split=i;
 return rdp(q.slice(0,split+1)).slice(0,-1).concat(rdp(q.slice(split).concat([q[0]])).slice(0,-1));
}
const changed=[];
for(const b of buildings.filter(b=>b.district==='business'||b.district==='engineering')){
 const f=source.features.find(f=>f.properties.BUILDINGID===b.sourceBuildingId);if(!f)continue;
 const rings=largest(f).map(r=>simplify(r.map(convert)));const before=area(b.footprint);
 Object.assign(b,fit(rings[0]),{footprint:rings[0],holes:rings.slice(1),layoutOffset:[0,0],surveyAligned:true});
 changed.push({id:b.sourceBuildingId,name:b.name,areaBefore:round(before),areaAfter:round(area(b.footprint)),vertices:b.footprint.length,holes:b.holes.length});
}
// Optional current-campus corrections are independently sourced, since the
// older statewide roofline snapshot predates these buildings.
const currentFile='assets-source/maryland/engineering-current-footprints.json';
if(fs.existsSync(currentFile))for(const current of JSON.parse(fs.readFileSync(currentFile,'utf8')).buildings){
 const b=buildings.find(b=>b.sourceBuildingId===current.id);if(!b)throw Error('Unknown current building '+current.id);
 const footprint=current.geographicFootprint.map(convert);
 Object.assign(b,fit(footprint),{footprint,holes:[],layoutOffset:[0,0],surveyAligned:true});
 for(const part of ['terraceFootprint','bridgeFootprint'])if(current[part])b[part]=current[part].map(convert);
}
const box=(b,pad=0)=>{const c=Math.abs(Math.cos(b.yaw)),s=Math.abs(Math.sin(b.yaw)),w=b.width*c+b.depth*s,d=b.width*s+b.depth*c;return {minX:b.x-w/2-pad,maxX:b.x+w/2+pad,minZ:b.z-d/2-pad,maxZ:b.z+d/2+pad}};
const old=[[-160,0,60,105],[160,0,46,94],[-66,-88,92,30],[55,-88,80,30],[-61,88,96,30],[64,88,84,30],[-185,-236,92,64],[230,-140,42,84],[110,220,30,64],[78,234,34,24]];
const pads=[...old.map(([x,z,w,d])=>({minX:x-w/2-5,maxX:x+w/2+5,minZ:z-d/2-5,maxZ:z+d/2+5})),...buildings.map(b=>box(b,6))];
const inside=(p,o)=>p[0]>o.minX&&p[0]<o.maxX&&p[1]>o.minZ&&p[1]<o.maxZ;
const blocked=p=>pads.some(o=>inside(p,o));
function clear(a,b){for(const o of pads){let t0=0,t1=1;for(const [axis,min,max]of [[0,o.minX,o.maxX],[1,o.minZ,o.maxZ]]){const d=b[axis]-a[axis];if(Math.abs(d)<1e-8){if(a[axis]<=min||a[axis]>=max){t0=2;break}}else{let s=(min-a[axis])/d,t=(max-a[axis])/d;if(s>t)[s,t]=[t,s];t0=Math.max(t0,s);t1=Math.min(t1,t);if(t0>=t1)break}}if(t0<t1&&t1>0&&t0<1)return false}return true}
const relocated=new Map();
function freeNear(p){const k=p.join(',');if(relocated.has(k))return relocated.get(k);let result=p;
 if(blocked(p)||!reachableNear(p)){let found=false;for(let r=4;r<240&&!found;r+=4)for(let a=0;a<32;a++){const q=rpoint([p[0]+Math.cos(a*Math.PI/16)*r,p[1]+Math.sin(a*Math.PI/16)*r]);if(!blocked(q)&&reachableNear(q)){result=q;found=true;break}}if(!found)throw Error('No free point '+p)}
 relocated.set(k,result);return result;
}
const step=12,key=p=>p.join(','),snap=p=>p.map(v=>Math.round(v/step)*step);
// Discard enclosed pockets of overlapping conservative navigation bounds.
// Actual walking collision still uses each concave building footprint.
const reachable=new Set(),queue=[[-120,12]];reachable.add(key(queue[0]));
for(let i=0;i<queue.length;i++)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
 const p=[queue[i][0]+dx*step,queue[i][1]+dz*step],k=key(p);
 if(reachable.has(k)||p[0]<-1365||p[0]>1155||p[1]<-1775||p[1]>815||blocked(p)||!clear(queue[i],p))continue;
 reachable.add(k);queue.push(p);
}
const reachableNear=p=>{const s=snap(p);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const q=[s[0]+dx*step,s[1]+dz*step];if(reachable.has(key(q))&&clear(p,q))return q}return undefined};
function route(start,end){
 if(clear(start,end))return [start,end];
 const gridNear=p=>reachableNear(p)??(()=>{throw Error('No reachable grid node '+p)})();
 const s=gridNear(start),t=gridNear(end),open=[{p:s,g:0,f:0}],cost=new Map([[key(s),0]]),parent=new Map();let last,iterations=0;
 while(open.length&&iterations++<120000){let index=0;for(let i=1;i<open.length;i++)if(open[i].f<open[index].f)index=i;
  const cur=open.splice(index,1)[0];if(cur.g!==cost.get(key(cur.p)))continue;if(key(cur.p)===key(t)){last=cur.p;break}
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const p=[cur.p[0]+dx*step,cur.p[1]+dz*step];if(p[0]<-1365||p[0]>1155||p[1]<-1775||p[1]>815||!clear(cur.p,p))continue;const g=cur.g+Math.hypot(dx,dz)*step,k=key(p);if(g>=(cost.get(k)??Infinity))continue;cost.set(k,g);parent.set(k,cur.p);open.push({p,g,f:g+Math.hypot(p[0]-t[0],p[1]-t[1])})}
 }
 if(!last)throw Error('Route failed '+start+' to '+end);
 const path=[end];for(let p=last;p;p=parent.get(key(p)))path.push(p);path.push(start);path.reverse();
 const out=[start];for(let i=0;i<path.length-1;){let next=i+1;for(let j=i+2;j<path.length;j++)if(clear(path[i],path[j]))next=j;else break;out.push(path[next]);i=next}return out.filter((p,i)=>i===0||key(p)!==key(out[i-1]));
}
let rerouted=0;
const repaired=paths.map(path=>{const moved=path.map(freeNear),out=[moved[0]];for(let i=1;i<moved.length;i++){const segment=route(moved[i-1],moved[i]);if(segment.length>2)rerouted++;out.push(...segment.slice(1))}return out});
for(const p of places){p.position=freeNear(p.position);const b=buildings.find(b=>b.name===p.subtitle);if(b?.surveyAligned)p.lookAt=[b.x,b.z]}
const lines=a=>'[\n'+a.map(v=>'  '+JSON.stringify(v)).join(',\n')+'\n]';
text=text.replace('footprint:WorldPoint[];sourceBuildingId:', 'footprint:WorldPoint[];holes?:WorldPoint[][];surveyAligned?:boolean;sourceBuildingId:');
text=text.replace('holes?:WorldPoint[][];surveyAligned?:boolean;', 'holes?:WorldPoint[][];terraceFootprint?:WorldPoint[];bridgeFootprint?:WorldPoint[];surveyAligned?:boolean;');
for(const [name,value] of [['UMD_FULL_BUILDINGS',buildings],['UMD_FULL_PATHS',repaired],['UMD_FULL_PLACES',places]])text=text.replace(new RegExp(`(${name}[^=]*=)\\[[\\s\\S]+?\\];`),(_,prefix)=>prefix+lines(value)+';');
fs.writeFileSync(file,text);
fs.writeFileSync('assets-source/maryland/district-alignment.json',JSON.stringify({date:'2026-10-15',source:'https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/2',coordinateSystem:'Existing road/DEM frame, x=1.65 and z=1.7 applied to ALL vertices; no independent centroid spacing or greedy relocation in corrected districts.',limitations:'Roofline topology from public GIS snapshot. Heights and facade detail remain authored. Other campus districts retain the earlier adapted layout.',changed,rerouted},null,2));
console.log(JSON.stringify({changed:changed.length,rerouted,arrivals:places.filter(p=>p.district==='engineering'||p.district==='business').map(p=>({id:p.id,position:p.position}))}));
