import {surfaceGeometry} from './surface-geometry.mjs';
import {foliageCluster} from './foliage-geometry.mjs';
import {buildPortico} from './portico-geometry.mjs';
import {buildCourtyardFacade,buildCourtyardGround,courtyardFacadeIndices,courtyardColors} from './courtyard-geometry.mjs';
import * as T from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {FontLoader} from 'three/examples/jsm/loaders/FontLoader.js';
import {TextGeometry} from 'three/examples/jsm/geometries/TextGeometry.js';
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}};
const root='public/data/killian',source=JSON.parse(await readFile(`${root}/facades.json`,'utf8')),facades=source.facades,dome=source.dome;
const environment=JSON.parse(await readFile(`${root}/environment.json`,'utf8'));
const porticoStudy=JSON.parse(await readFile('assets-source/killian-reference/portico-study.json','utf8'));
const font=new FontLoader().parse(JSON.parse(await readFile('node_modules/three/examples/fonts/optimer_regular.typeface.json','utf8')));
await writeFile(`${root}/font-LICENSE.txt`,await readFile('node_modules/three/examples/fonts/LICENSE'));
const data=await readFile('public/data/campuses/mit/campus.glb'),jlen=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+jlen).toString()),start=28+jlen;
const ai=doc.meshes[0].primitives[1].attributes.POSITION,a=doc.accessors[ai],v=doc.bufferViews[a.bufferView];
const coords=new Float32Array(data.buffer.slice(data.byteOffset+start+v.byteOffset,data.byteOffset+start+v.byteOffset+v.byteLength));
const terrain=new T.Mesh(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(coords,3)),new T.MeshBasicMaterial({side:T.DoubleSide})),ray=new T.Raycaster();
const heightCache=new Map();
const height=(x,z)=>{const key=`${x.toFixed(3)},${z.toFixed(3)}`;if(heightCache.has(key))return heightCache.get(key);ray.set(new T.Vector3(x,200,z),new T.Vector3(0,-1,0));const y=ray.intersectObject(terrain)[0]?.point.y??4;heightCache.set(key,y);return y;};
const batches=new Map(),scene=new T.Scene();
const colors={stone:'#d5cdb8',trim:'#ded4b9',glass:'#364b51',metal:'#55554b',bark:'#675341',leaf:'#527744',leafLight:'#718b4d',grass:'#9da982',pavement:'#d0cbbd',steps:'#d1c9b4',porticoFloor:'#d1c9b4',porticoWall:'#d5cdb8',bronze:'#708276',lettering:'#69685d'};
colors.water='#527e87';
colors.road='#b6bbb9';
Object.assign(colors,{bridgeDeck:'#777b7b',bridgeWalk:'#c8c9c1',bridgeRail:'#526164',bridgeSupport:'#b2b1a6'});
Object.assign(colors,{arterial:'#636b70',roadMarking:'#e4e2d5'});
Object.assign(colors,{columnStone:'#c9c3b4',entranceDoor:'#26302e',entranceFrame:'#68452f'});
Object.assign(colors,{benchWood:'#71543a',benchMetal:'#343f3b'});
Object.assign(colors,{porticoStone:'#d0c8b7',porticoTrim:'#d2ccbd',columnTrim:'#cec8b9',porticoGlass:'#74818a',windowFrame:'#72796d',windowInterior:'#192027',interiorShade:'#353a39',doorGlass:'#536267',entrancePanel:'#534232',doorHardware:'#ad9764',stepNosing:'#ccc6b8'});
Object.assign(colors,courtyardColors);
function put(g,kind,matrix){if(g.index)g=g.toNonIndexed();if(!g.getAttribute('uv'))g.setAttribute('uv',new T.BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2));if(matrix)g.applyMatrix4(matrix);if(kind.startsWith('leaf')){const p=g.getAttribute('position');kind+=`@${Math.floor(p.getX(0)/100)},${Math.floor(p.getZ(0)/100)}`;}if(!batches.has(kind))batches.set(kind,[]);batches.get(kind).push(g);}
function matrix(x,y,z,sx=1,sy=1,sz=1,rot=0){return new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),rot),new T.Vector3(sx,sy,sz));}
function box(kind,x,y,z,w,h,d,rot=0){
 const g=new T.BoxGeometry(w,h,d),p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv');
 // Project each face in local metres: a long lintel must not stretch one scan.
 const repeat=['pavement','steps','porticoFloor'].includes(kind)?4:2;
 for(let i=0;i<p.count;i++){
  const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));
  uv.setXY(i,(nx>.5?p.getZ(i):p.getX(i))/repeat,(ny>.5?p.getZ(i):p.getY(i))/repeat);
 }
 put(g,kind,matrix(x,y,z,1,1,1,rot));
}
function worldBox(f,kind,x,y,depth,w,h,d){const n=f.normal,t=[n[2],0,-n[0]];if(kind==='metal'){put(new T.PlaneGeometry(w,h),kind,matrix(f.center[0]+t[0]*x+n[0]*depth,y,f.center[2]+t[2]*x+n[2]*depth,1,1,1,Math.atan2(n[0],n[2])));return;}box(kind,f.center[0]+t[0]*x+n[0]*depth,y,f.center[2]+t[2]*x+n[2]*depth,w,h,d,Math.atan2(n[0],n[2]));}
let windows=0;
const windowsByModel={};
const extensionModels=new Set(['CAM_IVRJC-BXJZD-X6ABS','CAM_CQMYN-XKY6H-I7J3C','CAM_CW7MH-H5BCN-PPGCW','CAM_ME1KO-1JBIG-12R97','CAM_MNJTM-TPVUN-KZN3Z','CAM_TLJEH-BZQZ7-XG4P4','CAM_KHMI4-9TDEE-EZ75Q']);
function onSurface(f,x,y){return f.surface.some(([a,b,c])=>{
 const cross=(p,q)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);
 const signs=[cross(a,b),cross(b,c),cross(c,a)];return signs.every(s=>s>=-.001)||signs.every(s=>s<=.001);
});}
function fitsSurface(f,x,y,w,h){return [-.5,0,.5].every(u=>[-.5,0,.5].every(v=>onSurface(f,x+w*u,y+h*v)));}
let platformHeight=0,porticoSample;
const courtyardFacades=[];
for(const [facadeIndex,f] of facades.entries()){
 const front=f.portico&&f.width<46;const bottom=Math.max(f.bottom+2,4.5),roof=f.top;
 if(front){
  const sample=buildPortico({facade:f,study:porticoStudy,put,matrix,worldBox,height,font});
  platformHeight=sample.floor;porticoSample=sample.manifest;
  windows+=sample.windowCount;windowsByModel[f.model]=(windowsByModel[f.model]||0)+sample.windowCount;
  continue;
 }
 if(courtyardFacadeIndices.includes(facadeIndex)){
  const elevation=buildCourtyardFacade({facade:f,index:facadeIndex,worldBox,height});
  courtyardFacades.push(elevation);
  windows+=elevation.openings.length;
  windowsByModel[f.model]=(windowsByModel[f.model]||0)+elevation.openings.length;
  continue;
 }
 const floors=4,cols=Math.max(2,Math.floor((f.width-3)/3.1));
 for(let row=0;row<floors;row++)for(let col=0;col<cols;col++){
  if(f.portico)continue;
  const x=(col-(cols-1)/2)*(f.width-3)/cols,w=1.45,h=2.65,y=bottom+2+row*4.35,recess=0;
  if(y+h/2>roof-1.5)continue;
  if(extensionModels.has(f.model)&&!fitsSurface(f,x,y,w+.4,h+.4))continue;
  windows++;windowsByModel[f.model]=(windowsByModel[f.model]||0)+1;
  worldBox(f,'glass',x,y,recess+.05,w,h,.11);
  for(const sign of [-1,1]){worldBox(f,'trim',x+sign*(w/2+.10),y,recess+.19,.16,h+.28,.30);worldBox(f,'trim',x,y+sign*(h/2+.1),recess+.20,w+.35,.18,.35);}
  for(const t of [-1,0,1])worldBox(f,'metal',x+t*w/4,y,recess+.23,.045,h,.05);
  for(let k=1;k<6;k++)worldBox(f,'metal',x,y-h/2+h*k/6,recess+.23,w,.045,.05);
 }
 for(const y of [bottom-.3,roof-.7,roof-.05]){
  if(!extensionModels.has(f.model))worldBox(f,'trim',0,y,.2,f.width,.24,.65);
  else for(let x=-f.width/2+.5;x<f.width/2;x+=1){const w=Math.min(1,f.width/2-x+.5);if(fitsSurface(f,x,y,w,.26))worldBox(f,'trim',x,y,.2,w,.24,.65);}
 }
}
// Smooth the measured crown's circular profile without changing its surveyed height.
const domeCurve=new T.CatmullRomCurve3(dome.profile.map(([r,y])=>new T.Vector3(r,y,0)),false,'centripetal');
const profile=[new T.Vector2(dome.profile[0][0],dome.base),...domeCurve.getPoints(40).map(p=>new T.Vector2(p.x,p.y))];
const crown=new T.LatheGeometry(profile,96),crownUV=crown.getAttribute('uv');
let arc=0;const arcLengths=profile.map((p,i)=>{if(i)arc+=p.distanceTo(profile[i-1]);return arc;});
for(let i=0;i<crownUV.count;i++){const row=i%profile.length;crownUV.setXY(i,crownUV.getX(i)*Math.PI*dome.profile[0][0],arcLengths[row]/2);}
put(crown,'stone',matrix(dome.center[0],0,dome.center[1]));
const top=dome.profile.at(-1);put(new T.CylinderGeometry(top[0],top[0],.12,96),'bronze',matrix(dome.center[0],top[1],dome.center[1]));
for(const [radius,y] of [dome.profile[0],[dome.profile[0][0],36.8]]){
 const g=new T.TorusGeometry(radius+.07,.14,8,96);g.rotateX(Math.PI/2);put(g,'trim',matrix(dome.center[0],y,dome.center[1]));
}
for(const t of [.10,.15,.20]){const p=domeCurve.getPoint(t),g=new T.TorusGeometry(p.x+.03,.045,6,96);g.rotateX(Math.PI/2);put(g,'bronze',matrix(dome.center[0],p.y,dome.center[1]));}
const portico=facades.find(f=>f.portico&&f.width<46),N=portico.normal,U=[N[2],0,-N[0]];
// Front drum plaque and repeated shallow panels are visible in the local photo.
// Keep the surveyed barrel radius; dimensions below are reference-based approximations.
const drum={center:[dome.center[0],0,dome.center[1]],normal:N};
const drumRadius=dome.profile[0][0];
worldBox(drum,'trim',0,32.1,drumRadius+.05,4.8,1.45,.22);
const dateText=new TextGeometry('MCMXVI',{font,size:1,depth:.012,curveSegments:3,bevelEnabled:false});
dateText.computeBoundingBox();const dateBounds=dateText.boundingBox;
dateText.translate(-(dateBounds.min.x+dateBounds.max.x)/2,-dateBounds.min.y,0);
dateText.scale(3.8/(dateBounds.max.x-dateBounds.min.x),.8/(dateBounds.max.y-dateBounds.min.y),1);
put(dateText,'lettering',matrix(dome.center[0]+N[0]*(drumRadius+.18),31.7,dome.center[1]+N[2]*(drumRadius+.18),1,1,1,Math.atan2(N[0],N[2])));
for(let i=0;i<64;i++){
 const angle=i*Math.PI*2/64,n=[Math.sin(angle),0,Math.cos(angle)],panel={center:drum.center,normal:n};
 worldBox(panel,'trim',0,34.7,drumRadius+.06,.13,1.05,.15);
}
for(const y of [34.12,35.28]){const g=new T.TorusGeometry(drumRadius+.07,.08,6,128);g.rotateX(Math.PI/2);put(g,'trim',matrix(dome.center[0],y,dome.center[1]));}
const xy=(u,s)=>[portico.center[0]+U[0]*u+N[0]*s,portico.center[2]+U[2]*u+N[2]*s];
function patch(u0,u1,s0,s1,kind,lift=.06){const p=[],uv=[],colors=[],nx=Math.ceil((u1-u0)/3),nz=Math.ceil((s1-s0)/3),repeat=kind==='grass'?3:4;
 const vertex=(i,j)=>{const u=u0+(u1-u0)*i/nx,s=s0+(s1-s0)*j/nz,[x,z]=xy(u,s);
  // Slow spatial variation breaks the repeated scan without adding another texture.
  const tone=1+.045*Math.sin(u*.18+s*.06)+.035*Math.cos(s*.22-u*.05);
  return {v:[x,height(x,z)+lift,z],uv:[u/repeat,s/repeat],color:[tone,tone,tone]};};
 const verts=Array.from({length:nx+1},(_,i)=>Array.from({length:nz+1},(_,j)=>vertex(i,j)));
 for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)for(const [a,b] of [[i,j],[i,j+1],[i+1,j],[i+1,j],[i,j+1],[i+1,j+1]]){p.push(...verts[a][b].v);uv.push(...verts[a][b].uv);colors.push(...verts[a][b].color);}
 const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));if(kind==='grass')g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();put(g,kind);
}
patch(-46,46,7,92,'grass');
// Courtyard-facing GIS walls lie around u = +/-54 m, with the rear wings at s = -5 m.
// Fill the apron up to those walls so aerial-photo shadows do not compete with live shadows.
patch(-54.2,-46,-5,95,'pavement');patch(46,54.2,-5,95,'pavement');
patch(-46,46,92,95,'pavement');patch(-46,-22,-5,7,'pavement');patch(22,46,-5,7,'pavement');patch(-22,22,3.4,7,'pavement');
// Solid edging is added below against the finished paving, replacing the old
// independently sampled flat strips that could emerge through the stone.
// Extend the central green toward the river, staying inside the measured wings at u=+/-54 m.
// These rectilinear paths approximate the visible aerial layout; they are not surveyed paths.
for(const [u0,u1] of [[-46,-2],[2,46]])for(const [s0,s1] of [[95,128],[131,152]])patch(u0,u1,s0,s1,'grass');
patch(-2,2,95,152,'pavement');patch(-46,46,128,131,'pavement');patch(-49,49,152,155,'pavement');
patch(-49,-46,95,152,'pavement');patch(46,49,95,152,'pavement');
// Finish the existing demonstration route to the mapped northern road edge.
patch(-2,2,155,173,'pavement',.12);
patch(-158,210,173,178,'pavement',.12);
patch(-158,210,177.85,178.03,'trim',.16);
// Side courts remain inside the surveyed inner walls (approximately |u|=102, s=100..146).
// Align their crossing with the existing central path; leave a paved margin next to the walls.
for(const side of [-1,1]){
 const court=(u0,u1,s0,s1,kind,lift=.06)=>patch(side<0?-u1:u0,side<0?-u0:u1,s0,s1,kind,lift);
 for(const [s0,s1] of [[106,128],[131,139]])court(51,97,s0,s1,'grass');
 court(49,100,128,131,'pavement');
 for(const [u0,u1] of [[49,51],[97,100]])court(u0,u1,104,141,'pavement');
 for(const [s0,s1] of [[104,106],[139,141]])court(51,97,s0,s1,'pavement');
 for(const [s0,s1] of [[106,128],[131,139]]){
  court(50.82,51,s0,s1,'trim',.075);court(97,97.18,s0,s1,'trim',.075);
 }
}
// Edging must follow the rendered paving, whose 3 m grid interpolates the GIS
// terrain differently from a new direct terrain sample at the same location.
const pavingProbe=new T.Mesh(mergeGeometries(batches.get('pavement')),new T.MeshBasicMaterial({side:T.DoubleSide}));
const pavingHeightCache=new Map();
const pavingHeight=(x,z)=>{
 const key=`${x.toFixed(5)},${z.toFixed(5)}`;
 if(pavingHeightCache.has(key))return pavingHeightCache.get(key);
 ray.set(new T.Vector3(x,200,z),new T.Vector3(0,-1,0));
 const y=ray.intersectObject(pavingProbe)[0]?.point.y??height(x,z)+.06;
 pavingHeightCache.set(key,y);return y;
};
const courtyardGround=buildCourtyardGround({xy,pavingHeight,put});
pavingProbe.geometry.dispose();pavingProbe.material.dispose();
// Small seating set on the outer paved margins; illustrative placements.
for(const side of [-1,1])for(const s of [110,121,136]){
 const [x,z]=xy(side*98.65,s),y=height(x,z)+.12,angle=Math.atan2(U[2],-U[0]);
 for(let slat=0;slat<4;slat++)box('benchWood',x+U[0]*(slat-1.5)*.13,y+.46,z+U[2]*(slat-1.5)*.13,1.8,.075,.105,angle);
 for(const along of [-.65,.65]){const px=x+N[0]*along,pz=z+N[2]*along;box('benchMetal',px,y+.24,pz,.1,.46,.42,angle);}
}
// Continuous Memorial Drive ribbons replace fragmented map-color patches along the core riverfront.
// Alignment follows sampled road bands; widths and markings remain demo approximations.
const southRoad=u=>u<-70?201+(u+135)/65*4:u<0?205+(u+70)/70*8:u<50?213+u/50*4:217;
function roadRibbon(u0,u1,center,width,kind,lift=.15){
 const p=[],uv=[];
 for(let u=u0;u<u1;u+=3){const end=Math.min(u1,u+3);for(const [a,side] of [[u,-1],[u,1],[end,-1],[end,-1],[u,1],[end,1]]){const w=typeof width==='function'?width(a):width,s=center(a)+side*w/2,[x,z]=xy(a,s);p.push(x,height(x,z)+lift,z);uv.push(a/3,s/3);}}
 const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));if(kind==='grass')g.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(p.length).fill(1),3));g.computeVertexNormals();put(g,kind);
}
// The mapped green median replaces aerial-image shadows between carriageways.
roadRibbon(-135,210,u=>(189+southRoad(u)-5.5)/2,u=>southRoad(u)-5.5-189,'grass',.12);
for(const center of [()=>183.5,southRoad]){
 roadRibbon(-135,210,center,11,'arterial');
 for(const offset of [-5.1,5.1])roadRibbon(-135,210,u=>center(u)+offset,.1,'roadMarking',.18);
 for(let u=-132;u<205;u+=9)roadRibbon(u,u+4,center,.12,'roadMarking',.18);
}
let seed=481;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const trees=[];
function tree(x,z,h,leafCount=1100){
 const y=height(x,z);trees.push({x,z,radius:.42});
 put(new T.CylinderGeometry(.19,.46,h*.65,9),'bark',matrix(x,y+h*.325,z));
 const clusters=[];
 for(let k=0;k<8;k++){
  const angle=k*Math.PI/4+rnd()*.7,reach=2.8+rnd()*2,end=new T.Vector3(Math.cos(angle)*reach,h*.6+rnd()*3,Math.sin(angle)*reach),begin=new T.Vector3(0,h*.4,0),direction=end.clone().sub(begin),g=new T.CylinderGeometry(.055,.17,direction.length(),6);
  clusters.push({center:end.clone().add(new T.Vector3(0,1.2,0)),width:2.1+rnd()*1.4,height:2.4+rnd()*1.5});
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),direction.clone().normalize()));g.translate(x+(begin.x+end.x)/2,y+(begin.y+end.y)/2,z+(begin.z+end.z)/2);put(g,'bark');
  for(const side of [-1,1]){
   const from=begin.clone().lerp(end,.7),tip=end.clone().add(new T.Vector3(Math.cos(angle+side*.65)*1.4,1.3,Math.sin(angle+side*.65)*1.4));
   const delta=tip.clone().sub(from),twig=new T.CylinderGeometry(.018,.065,delta.length(),5);
   twig.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));
   twig.translate(x+(from.x+tip.x)/2,y+(from.y+tip.y)/2,z+(from.z+tip.z)/2);put(twig,'bark');
  }
 }
 for(let k=0;k<leafCount;k++){
  const cluster=clusters[k%clusters.length],theta=rnd()*Math.PI*2,v=rnd()*2-1,r=Math.cbrt(rnd()),spread=Math.sqrt(1-v*v),xx=x+cluster.center.x+Math.cos(theta)*r*spread*cluster.width,zz=z+cluster.center.z+Math.sin(theta)*r*spread*cluster.width,yy=y+cluster.center.y+v*r*cluster.height;
  const g=foliageCluster(.38+rnd()*.22);g.rotateX(rnd()*Math.PI);g.rotateY(rnd()*Math.PI);g.scale(1,.8,1);g.translate(xx,yy,zz);put(g,k%3?'leaf':'leafLight');
 }
}
for(const side of [-1,1])for(const s of [16,32,48,64,80]){const [x,z]=xy(side*(37+rnd()*4),s);tree(x,z,15+rnd()*4);}
for(const side of [-1,1])for(const s of [104,119,139,149]){const [x,z]=xy(side*35,s);tree(x,z,12+rnd()*2);}
for(const side of [-1,1])for(const s of [113,135]){const [x,z]=xy(side*86,s);tree(x,z,8+rnd()*2);}
// Classified map cells preserve roads and bridges as holes in the water layer.
for(const [kind,runs] of [['water',environment.waterRuns],['grass',environment.greenRuns],['road',environment.roadRuns]]){
 const exclude=(x,z)=>{const dx=x-portico.center[0],dz=z-portico.center[2],u=dx*U[0]+dz*U[2],s=dx*N[0]+dz*N[2];const b=environment.bridge,t=(z-b.start[1])/(b.end[1]-b.start[1]),onBridge=t>=0&&t<=1&&Math.abs(x-b.start[0]-(b.end[0]-b.start[0])*t)<11;const onRoad=u>=-138&&u<=213&&(Math.abs(s-183.5)<7||Math.abs(s-southRoad(u))<7);return kind!=='water'&&(onBridge||onRoad||(Math.abs(u)<104&&s>-7&&s<157));};
 put(surfaceGeometry(runs,environment.cellSize,kind,height,exclude),kind);
}
// Reject map-derived tree candidates where a surveyed building is above the terrain.
const bp=doc.meshes[0].primitives[0].attributes.POSITION,ba=doc.accessors[bp],bv=doc.bufferViews[ba.bufferView];
const buildingCoords=new Float32Array(data.buffer.slice(data.byteOffset+start+bv.byteOffset,data.byteOffset+start+bv.byteOffset+bv.byteLength));
const buildingProbe=new T.Mesh(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(buildingCoords,3)),new T.MeshBasicMaterial({side:T.DoubleSide}));
const treeStart=trees.length;
for(const [x,z] of environment.treeCandidates){
 const y=height(x,z);let blocked=false;
 for(const [dx,dz] of [[0,0],[-5,0],[5,0],[0,-5],[0,5]]){ray.set(new T.Vector3(x+dx,200,z+dz),new T.Vector3(0,-1,0));if(ray.intersectObject(buildingProbe).some(hit=>hit.point.y>y+1)){blocked=true;break;}}
 if(!blocked&&trees.every(t=>Math.hypot(t.x-x,t.z-z)>10))tree(x,z,9+rnd()*4,450);
}
environment.placedTrees=trees.length-treeStart;
await writeFile(`${root}/environment.json`,JSON.stringify(environment));
buildingProbe.geometry.dispose();buildingProbe.material.dispose();
// A continuous deck replaces the unfinished aerial-only bridge strip inside the scene boundary.
const bridge=environment.bridge,bx=bridge.end[0]-bridge.start[0],bz=bridge.end[1]-bridge.start[1],bridgeLength=Math.hypot(bx,bz),bridgeAngle=Math.atan2(bx,bz),bridgeY=height(...bridge.start)+.04;
bridge.deckHeight=bridgeY;
const bridgePoint=(t,side=0)=>[bridge.start[0]+bx*t+bz/bridgeLength*side,bridge.start[1]+bz*t-bx/bridgeLength*side];
const [mx,mz]=bridgePoint(.5);box('bridgeDeck',mx,bridgeY-.18,mz,12,.36,bridgeLength,bridgeAngle);
// Resolve the source terrain/overpass seam with a short, continuous approach surface.
const approachZ=198,approachX=bridge.start[0]+bx/bz*(approachZ-bridge.start[1]),approachY=height(approachX,approachZ)+.04;
const approachHeight=z=>z<206?approachY+(4.13-approachY)*(z-198)/8:z<220?4.13+(4.30-4.13)*(z-206)/14:4.30+(bridgeY-4.30)*(z-220)/16;
const approachPositions=[],approachUV=[];
for(let z=approachZ;z<236;z+=2)for(const [row,side] of [[z,-1],[z+2,-1],[z,1],[z,1],[z+2,-1],[z+2,1]]){
 const x=bridge.start[0]+bx/bz*(row-236),px=x+bz/bridgeLength*side*8,pz=row-bx/bridgeLength*side*8;
 approachPositions.push(px,approachHeight(row),pz);approachUV.push(side*2,row/4);
}
const approachGeometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(approachPositions,3)).setAttribute('uv',new T.Float32BufferAttribute(approachUV,2));approachGeometry.computeVertexNormals();put(approachGeometry,'bridgeDeck');
bridge.approach={start:[approachX,approachZ],end:bridge.start,width:16};
for(const side of [-1,1]){
 const [x,z]=bridgePoint(.5,side*7.5);box('bridgeWalk',x,bridgeY-.08,z,3,.2,bridgeLength,bridgeAngle);
 const [rx,rz]=bridgePoint(.5,side*8.8);
 for(const y of [.55,1.05])box('bridgeRail',rx,bridgeY+y,rz,.08,.08,bridgeLength,bridgeAngle);
 for(let distance=0;distance<=bridgeLength;distance+=4){const [px,pz]=bridgePoint(distance/bridgeLength,side*8.8);box('bridgeRail',px,bridgeY+.54,pz,.09,1.08,.09,bridgeAngle);}
}
for(const t of [.2,.5,.8]){const [x,z]=bridgePoint(t);box('bridgeSupport',x,(bridgeY-.36)/2,z,12,bridgeY-.36,2.5,bridgeAngle);}
// Lightweight lane dashes stay on the deck; these are approximate markings.
for(let distance=4;distance<bridgeLength-4;distance+=9){const [x,z]=bridgePoint(distance/bridgeLength);box('trim',x,bridgeY+.012,z,.12,.008,4,bridgeAngle);}
await writeFile(`${root}/environment.json`,JSON.stringify(environment));
const vegetationScene=new T.Scene();
for(const [batch,geometries] of batches){const kind=batch.split('@')[0],merged=mergeGeometries(geometries);const material=new T.MeshStandardMaterial({name:kind,color:colors[kind],vertexColors:kind==='grass'||kind.startsWith('leaf'),roughness:kind==='water'?.32:kind==='glass'?.28:.88,metalness:kind==='water'?.3:kind==='glass'?.25:0,side:kind.startsWith('leaf')?T.DoubleSide:T.FrontSide});const mesh=new T.Mesh(merged,material);mesh.name=batch;(kind.startsWith('leaf')?vegetationScene:scene).add(mesh);for(const g of geometries)g.dispose();}
const glb=await new GLTFExporter().parseAsync(scene,{binary:true});await writeFile(`${root}/detail.glb`,Buffer.from(glb));
const vegetation=await new GLTFExporter().parseAsync(vegetationScene,{binary:true});await writeFile(`${root}/vegetation.glb`,Buffer.from(vegetation));
const packedCore=gzipSync(Buffer.from(glb),{level:9}),packedVegetation=gzipSync(Buffer.from(vegetation),{level:9});
await writeFile(`${root}/detail.glb.gz`,packedCore);await writeFile(`${root}/vegetation.glb.gz`,packedVegetation);
await writeFile(`${root}/detail-manifest.json`,JSON.stringify({version:8,porticoSample,courtyardFacades,courtyardGround,delivery:{core:'detail.glb',coreGzip:'detail.glb.gz',coreGzipBytes:packedCore.length,vegetation:'vegetation.glb',vegetationGzip:'vegetation.glb.gz',vegetationBytes:vegetation.byteLength,vegetationGzipBytes:packedVegetation.length},vegetation:{chunks:vegetationScene.children.length,style:'three tapered blades per cluster with secondary branches',treePositions:'unchanged from previous deterministic layout',species:'generic broadleaf approximation'},runtimeVegetation:{style:'instanced broadleaf alpha-cutout clusters and branched trunks',source:'src/features/real-campus/courtyard-vegetation.ts',legacyAssetLoaded:false},frontDetails:{entranceBays:3,drumPlaque:"MCMXVI",basis:"Local front photograph; dimensions approximate; doors closed"},windows,windowsByModel,columns:10,steps:5,platformHeight,dome,porticoOpening:{center:portico.center,normal:portico.normal,width:portico.width,bottom:portico.bottom,top:portico.top},trees,bytes:glb.byteLength,sourceModels:Object.keys(windowsByModel),description:'Measured GIS anchors retained. Building 10 preserves the existing photo-informed portico. Six court-facing elevations of Buildings 3 and 4 now have replacement walls with recessed glazing, window sills and cornice profiles; their opening rhythm and dimensions remain approximate. Remaining elevations use generic repeated details. Terrain-following low stone edging and paving joints retain the existing route. No Tripo or Google mesh used.'},null,2));
console.log({windows,trees:trees.length,bytes:glb.byteLength});
