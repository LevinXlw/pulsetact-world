import {BackSide,BufferGeometry,Color,CylinderGeometry,DoubleSide,Float32BufferAttribute,Group,IcosahedronGeometry,Matrix4,Mesh,MeshBasicMaterial,MeshLambertMaterial,Path,Shape,ShapeGeometry,SphereGeometry,type Material,type Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {CampusCollision} from '../real-campus/campus-collision';
import {openPortico,type PorticoOpening} from '../real-campus/portico';
import {createCampusGroundSampler} from './campus-ground-sampler';
import type {CampusId,CampusLayout} from './campus-regions';
import type {WorldAssets} from './scene-assets';
import {configureBUGroundLayer} from './bu-ground-layers';

type Point=readonly [number,number];
type Building={x:number;z:number;width:number;depth:number;yaw:number;label?:string;name?:string;height?:number;kind?:string;footprint?:readonly Point[];holes?:readonly (readonly Point[])[]};
type Height=(x:number,z:number)=>number;
type Finish='brick'|'stone'|'roof'|'glass'|'trim'|'grass'|'paving'|'brickPaving'|'road'|'desert'|'bark'|'leaf'|'gravel'|'rail';
const colors:Record<Finish,string>={brick:'#a87663',stone:'#b7b7a1',roof:'#737e75',glass:'#64898c',trim:'#d5cbb1',grass:'#9aa97b',paving:'#c3bda5',brickPaving:'#9a7663',road:'#6e7777',desert:'#cbb58e',bark:'#897860',leaf:'#79986d',gravel:'#8d8980',rail:'#aeb7b6'};
const floorFinishes=new Set<Finish>(['grass','paving','brickPaving','road','desert']);

/** Offline replacement only. Physics remains in the landmark builder; the
 * phone receives these already-transformed vertices in its ordinary campus GLB. */
function replaceMobileLandmarkVisual(group:Group,oldVisual:Group,source:Group,toWorld:readonly number[],label:'CDS'|'Questrom'):Group{
  if(toWorld.length!==16||toWorld.some(value=>!Number.isFinite(value)))throw new Error(`Invalid ${label} mobile placement matrix`);
  const placed=new Group();placed.name=`BU ${label} refined mobile visual`;placed.matrixAutoUpdate=false;placed.matrix.copy(new Matrix4().fromArray(toWorld));
  const originals=new Set<Material>(),materials=new Map<string,MeshLambertMaterial>();
  source.traverse(object=>{
    if(!(object instanceof Mesh))return;
    if(Array.isArray(object.material))throw new Error(`${label} mobile source must have one material per mesh`);
    const original=object.material as Material&{color:Color};originals.add(original);
    const finish=String(original.userData.bu_source_material??original.name.split(' · ')[0]);
    const isGround=object.userData.buGround===true||object.userData.ground===true;
    // The existing phone HD tier chooses XZ brick courses from this label.
    // Keep the source finish too, but do not shade an entry apron as a wall.
    const surfaceLabel=isGround&&/^brick/i.test(finish)?`${finish} · brickPaving`:finish;
    // The desktop glass tint is darkened for environment reflections. Lambert
    // has no reflection pass, so retain the earlier readable mobile glass tint.
    const glassTint=/^glass/i.test(finish)?object.userData.originalMaterial?.color:undefined;
    const color=Array.isArray(glassTint)&&glassTint.length===3&&glassTint.every(Number.isFinite)?new Color().fromArray(glassTint):original.color.clone();
    const key=`${original.uuid}:${isGround}:${color.toArray().join(',')}`;
    let material=materials.get(key);
    if(!material){
      material=new MeshLambertMaterial({color,side:DoubleSide});material.name=`BU ${label} refined · ${surfaceLabel}`;
      if(isGround)configureBUGroundLayer(material,'surface');
      materials.set(key,material);
    }
    object.material=material;object.name=`BU ${label} refined · ${surfaceLabel} · ${object.name}`;
    object.castShadow=false;object.receiveShadow=true;
    // Visible ground is an overlay. The separate original landmark ground/walls
    // remain the sole physics source, including the terrain foundation skirts.
    delete object.userData.mobileGround;delete object.userData.mobileWall;
  });
  // Imported source materials are separate resources; never dispose the old
  // landmark skin's shared materials or its shared collision-ground geometry.
  originals.forEach(material=>material.dispose());
  placed.add(source);group.remove(oldVisual);group.add(placed);
  return placed;
}
export function replaceMobileCDSVisual(landmarks:{group:Group;cds:{visual:Group}},source:Group,toWorld:readonly number[]):Group{
  return replaceMobileLandmarkVisual(landmarks.group,landmarks.cds.visual,source,toWorld,'CDS');
}
export function replaceMobileQuestromVisual(landmarks:{group:Group;questrom:{visual:Group}},source:Group,toWorld:readonly number[]):Group{
  return replaceMobileLandmarkVisual(landmarks.group,landmarks.questrom.visual,source,toWorld,'Questrom');
}

/** Offline-only builder, never imported by the mobile browser. Selected BU
 * landmarks reuse the authored geometry here; the phone receives a welded,
 * texture-free GLB through mobile-campus.ts and constructs no desktop scene. */
export async function buildMobileCampus(signal:AbortSignal,campus:CampusId):Promise<WorldAssets>{
  const model=new Group();model.name=`${campus} · mobile campus`;
  const retiredVisuals:Group[]=[];
  const collision=new CampusCollision(),wind={value:0},ground:Mesh[]=[],walls:Mesh[]=[];
  const batches=new Map<string,{finish:Finish;ground:boolean;wall:boolean;positions:number[]}>();
  let disposed=false;
  const add=(finish:Finish,positions:ArrayLike<number>,isGround=false,wall=false)=>{
    const key=`${finish}:${isGround}:${wall}`;let batch=batches.get(key);
    if(!batch){batch={finish,ground:isGround,wall,positions:[]};batches.set(key,batch);}
    // Avoid spread on long arrays, which can exceed mobile call-stack limits.
    for(let i=0;i<positions.length;i++)batch.positions.push(positions[i]);
  };
  const primitive=(finish:Finish,geometry:BufferGeometry)=>{
    const g=geometry.index?geometry.toNonIndexed():geometry;add(finish,g.getAttribute('position').array);
    if(g!==geometry)g.dispose();geometry.dispose();
  };
  const polygon=(finish:Finish,ring:readonly Point[],holes:readonly (readonly Point[])[],height:Height,offset=0,isGround=true)=>{
    // Thin overlays need only millimetres of separation once terrain and
    // walking use the same lattice; this leaves room for the bounded drape error.
    if(isGround&&campus!=='boston')offset*=.2;
    if(ring.length<3)return;const shape=new Shape();ring.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    for(const hole of holes){const path=new Path();hole.forEach(([x,z],i)=>i?path.lineTo(x,-z):path.moveTo(x,-z));path.closePath();shape.holes.push(path);}
    const g=new ShapeGeometry(shape);
    const p=g.getAttribute('position'),idx=g.getIndex(),positions:number[]=[];
    const emit=(a:Point,b:Point,c:Point,depth=0)=>{
      const ab=Math.hypot(a[0]-b[0],a[1]-b[1]),bc=Math.hypot(b[0]-c[0],b[1]-c[1]),ca=Math.hypot(c[0]-a[0],c[1]-a[1]);
      let first=a,second=b,third=c,max=ab;if(bc>max){first=b;second=c;third=a;max=bc;}if(ca>max){first=c;second=a;third=b;max=ca;}
      const middle:Point=[(first[0]+second[0])/2,(first[1]+second[1])/2];
      const ay=height(...a),by=height(...b),cy=height(...c);
      const deviation=Math.max(
        Math.abs(height((a[0]+b[0])/2,(a[1]+b[1])/2)-(ay+by)/2),
        Math.abs(height((b[0]+c[0])/2,(b[1]+c[1])/2)-(by+cy)/2),
        Math.abs(height((c[0]+a[0])/2,(c[1]+a[1])/2)-(cy+ay)/2),
        Math.abs(height((a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3)-(ay+by+cy)/3));
      // Check every edge plus the interior. Checking only the longest edge can
      // miss a terrace or hill break entirely inside a broad paving triangle.
      if((isGround||campus==='boston'&&finish==='rail')&&depth<14&&max>.5&&(max>60||deviation>.04)){
        emit(first,middle,third,depth+1);emit(middle,second,third,depth+1);return;
      }
      for(const [x,z] of [a,b,c])positions.push(x,height(x,z)+offset,z);
    };
    for(let i=0;i<(idx?.count??p.count);i+=3){const point=(j:number):Point=>{const k=idx?idx.getX(i+j):i+j;return[p.getX(k),-p.getY(k)];};emit(point(0),point(1),point(2));}
    add(finish,positions,isGround);g.dispose();
  };
  const ribbon=(points:readonly Point[],width:number,finish:Finish,height:Height,offset=.04,isGround=true)=>{
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;
      const nx=(b[1]-a[1])/length*width/2,nz=-(b[0]-a[0])/length*width/2,count=Math.ceil(length/12);
      for(let j=0;j<count;j++){
        const t=j/count,u=(j+1)/count,ax=a[0]+(b[0]-a[0])*t,az=a[1]+(b[1]-a[1])*t,bx=a[0]+(b[0]-a[0])*u,bz=a[1]+(b[1]-a[1])*u;
        const ring:Point[]=[[ax+nx,az+nz],[bx+nx,bz+nz],[bx-nx,bz-nz],[ax-nx,az-nz]];
        polygon(finish,ring,[],height,offset,isGround);
      }
      // Rounded joins prevent holes in the physical deck at bridge bends.
      const join:Point[]=Array.from({length:8},(_,k)=>[b[0]+Math.cos(k*Math.PI/4)*width/2,b[1]+Math.sin(k*Math.PI/4)*width/2]);polygon(finish,join,[],height,offset,isGround);
    }
  };
  const footprint=(b:Building):readonly Point[]=>{
    if(b.footprint)return b.footprint;
    const c=Math.cos(b.yaw),s=Math.sin(b.yaw);return[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz])=>[b.x+sx*b.width/2*c+sz*b.depth/2*s,b.z-sx*b.width/2*s+sz*b.depth/2*c]);
  };
  const building=(b:Building,height:Height,index:number)=>{
    const outer=footprint(b),base=height(b.x,b.z),h=Math.max(4,b.height??(index<2?22:17));let holes=b.holes??[];
    // Sporting bowls keep their pitches open; a footprint's bounds are not a solid arena.
    if((b.kind==='stadium'||/stadium/i.test(b.name??''))&&!holes.length)holes=[outer.map(p=>[b.x+(p[0]-b.x)*.65,b.z+(p[1]-b.z)*.65] as Point)];
    const finish:Finish=b.kind==='modern'||b.kind==='law'?'stone':campus==='upenn'&&index===0?'stone':'brick';
    const faces:number[]=[],windows:number[]=[],trim:number[]=[];
    const quad=(out:number[],a:Point,b:Point,low:number,high:number)=>{out.push(a[0],low,a[1],b[0],low,b[1],a[0],high,a[1],a[0],high,a[1],b[0],low,b[1],b[0],high,b[1]);};
    for(const ring of [outer,...holes])for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      // Rigid floors above the real central BU slope need a basement wall down
      // to the low side; a centre-sampled box otherwise hovers above the ground.
      const bottom=campus==='boston'?Math.min(base-.2,height(...a)-.15,height(...b)-.15,height((a[0]+b[0])/2,(a[1]+b[1])/2)-.15):base-.2;
      quad(faces,a,b,bottom,base+h);
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<7)continue;
      const nx=-dz/length*.045,nz=dx/length*.045;
      const floors=Math.min(6,Math.max(1,Math.floor(h/4.2))),count=Math.min(14,Math.floor(length/4));
      for(let floor=0;floor<floors;floor++)for(let j=0;j<count;j++){
        const t=(j+.5)/count,half=Math.min(.85/length,.32/count),p:Point=[a[0]+dx*(t-half)+nx,a[1]+dz*(t-half)+nz],q:Point=[a[0]+dx*(t+half)+nx,a[1]+dz*(t+half)+nz];
        quad(windows,p,q,base+1.4+floor*(h-1.5)/floors,base+3.0+floor*(h-1.5)/floors);
      }
      quad(trim,[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],base+h-.35,base+h);
    }
    add(finish,faces,false,true);add('glass',windows);add('trim',trim);
    polygon('roof',outer,holes,()=>base+h+.02,0,false);
  };
  const terrain=(bounds:CampusLayout['bounds'],height:Height,finish:Finish)=>{
    // Match the physical height lattice exactly, including its world-aligned
    // diagonals. The additional vertices are baked once and indexed in GLB.
    const cell=campus==='umd'?12.5:campus==='arizona'?8:20,minX=Math.floor(bounds.minX/cell)*cell,minZ=Math.floor(bounds.minZ/cell)*cell,nx=Math.ceil((bounds.maxX-minX)/cell),nz=Math.ceil((bounds.maxZ-minZ)/cell);
    const p:number[]=[],indices:number[]=[],vertices=new Map<string,number>();
    const vertex=(x:number,z:number)=>{const key=`${x}:${z}`;let id=vertices.get(key);if(id===undefined){id=p.length/3;vertices.set(key,id);p.push(x,height(x,z),z);}return id;};
    for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
      const x=minX+ix*cell,z=minZ+iz*cell,a=height(x,z),b=height(x+cell,z),c=height(x,z+cell),d=height(x+cell,z+cell);
      // Most Maryland cells are the original 12.5m lattice; only the refined
      // engineering/business districts need the four 6.25m subcells.
      const split=campus==='umd'&&Math.max(Math.abs(height(x+cell/2,z)-(a+b)/2),Math.abs(height(x,z+cell/2)-(a+c)/2),Math.abs(height(x+cell/2,z+cell/2)-(a+d)/2),Math.abs(height(x+cell,z+cell/2)-(b+d)/2),Math.abs(height(x+cell/2,z+cell)-(c+d)/2))>.00001;
      const count=split?2:1,step=cell/count;
      for(let sz=0;sz<count;sz++)for(let sx=0;sx<count;sx++){const px=x+sx*step,pz=z+sz*step,v0=vertex(px,pz),v1=vertex(px+step,pz),v2=vertex(px,pz+step),v3=vertex(px+step,pz+step);indices.push(v0,v2,v3,v0,v3,v1);}
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    const mesh=new Mesh(g,new MeshLambertMaterial({color:colors[finish],side:DoubleSide}));mesh.name='Mobile terrain';model.add(mesh);ground.push(mesh);
  };
  const tree=(x:number,z:number,height:Height,desert=false,bu=false)=>{
    const y=height(x,z),seed=Math.sin(x*.72+z*.19),h=desert?7.5:6.8+seed;
    const trunk=new CylinderGeometry(desert?.16:.22,desert?.24:.34,h,5,1);trunk.translate(x,y+h/2,z);primitive('bark',trunk);
    if(bu){
      // Five overlapping lobes keep an avenue canopy at 100 triangles/tree.
      // The geometry is baked once; phones allocate no foliage textures.
      for(let i=0;i<5;i++){
        const angle=i*Math.PI/2+seed,r=i===4?0:1.7;
        const crown=new IcosahedronGeometry(i===4?2.7:2.5,0);
        crown.scale(1,.9+seed*.1,1);crown.translate(x+Math.cos(angle)*r,y+h+(i===4?1.6:0),z+Math.sin(angle)*r);primitive('leaf',crown);
      }
    }else{const crown=new IcosahedronGeometry(desert?2.3:3.1,0);crown.scale(1,desert?.45:1.1,1);crown.translate(x,y+h,z);primitive('leaf',crown);}
  };
  const addSky=()=>{
    const geometry=new SphereGeometry(3900,24,12),p=geometry.getAttribute('position'),a=new Float32Array(p.count*3),top=new Color('#80b9d0'),bottom=new Color(campus==='arizona'?'#d6d9be':'#d3dfc6'),color=new Color();
    for(let i=0;i<p.count;i++){color.copy(bottom).lerp(top,Math.max(0,Math.min(1,p.getY(i)/3200)));a[i*3]=color.r;a[i*3+1]=color.g;a[i*3+2]=color.b;}
    geometry.setAttribute('color',new Float32BufferAttribute(a,3));const sky=new Mesh(geometry,new MeshBasicMaterial({vertexColors:true,side:BackSide,depthWrite:false}));sky.name='Mobile seamless gradient sky';sky.renderOrder=-1;sky.frustumCulled=false;model.add(sky);return sky;
  };
  let height:Height=()=>0,sky:Mesh;
  try{
    if(campus==='boston'){
      const [bytes,manifest,{createCharlesRiver},{BU_FULL_BUILDINGS},{BU_CAMPUS_ROADS,BU_COMMONWEALTH_MEDIAN,buAvenueOuterSide,buExpresswayDrop},{buElevation},{createBostonUniversity},{BU_COURTYARD_PUBLIC_SEGMENTS,BU_PUBLIC_FRONTAGES,BU_SIDEWALK_JOIN_PATCHES,BU_TRANSIT_PLATFORM_DETAILS,buClipSidewalkToJunctions,buStreetSidewalk},{createBUFullCampus},{createBUCampusStreets},cdsBytes,cdsPlacement,questromBytes,questromPlacement]=await Promise.all([
        fetch('/data/mobile/mit-base.glb',{signal}).then(async r=>{if(!r.ok)throw new Error('移动端校园读取失败');return r.arrayBuffer();}),
        fetch('/data/mobile/mit-detail.json',{signal}).then(r=>r.json()) as Promise<{porticoOpening:PorticoOpening;courtyardFacades:PorticoOpening[];dome:{center:number[];base:number;radius:number};trees:{x:number;z:number;radius:number}[]}>,
        import('./charles-river'),import('./bu-full-layout'),import('./bu-campus-layout'),import('./bu-terrain'),import('./boston-university'),import('./bu-public-realm'),import('./bu-full-campus'),import('./bu-campus-streets'),
        fetch('/assets-source/charles-bu/blender/full/cds-mobile-source.glb',{signal}).then(async r=>{if(!r.ok)throw new Error('CDS mobile source could not be read');return r.arrayBuffer();}),
        fetch('/assets-source/charles-bu/blender/full/input/manifest.json',{signal}).then(async r=>{if(!r.ok)throw new Error('CDS mobile placement could not be read');return r.json() as Promise<{toWorld:number[]}>;}),
        fetch('/assets-source/charles-bu/blender/questrom/questrom-mobile-source.glb',{signal}).then(async r=>{if(!r.ok)throw new Error('Questrom mobile source could not be read');return r.arrayBuffer();}),
        fetch('/assets-source/charles-bu/blender/questrom/input/manifest.json',{signal}).then(async r=>{if(!r.ok)throw new Error('Questrom mobile placement could not be read');return r.json() as Promise<{toWorld:number[]}>;}),
      ]);
      signal.throwIfAborted();const base=await new GLTFLoader().parseAsync(bytes,'');model.add(base.scene);
      // The compact shell retains the replacement stone dome. Remove the
      // surveyed crown underneath it, just as the desktop scene does, or the
      // two nearly coplanar drum surfaces shimmer through the portico opening.
      openPortico(base.scene,manifest.porticoOpening,manifest.dome,manifest.courtyardFacades);
      const floorNames=new Set(['grass','pavement','steps','porticoFloor','road','arterial']);
      base.scene.traverse(object=>{if(!(object instanceof Mesh))return;const original=Array.isArray(object.material)?object.material[0]:object.material,name=original.name,isGround=floorNames.has(name)||name.includes('orthophotography');
        const finish:Finish=name==='grass'?'grass':name.includes('orthophotography')?'grass':name==='road'||name==='arterial'?'road':isGround?'paving':name.toLowerCase().includes('glass')?'glass':'stone';
        object.material=new MeshLambertMaterial({color:colors[finish],side:DoubleSide});original.dispose();object.geometry.computeBoundingBox();object.geometry.computeBoundingSphere();if(isGround)ground.push(object);else walls.push(object);
      });
      model.updateMatrixWorld(true);collision.rebuild(ground,walls,createCampusGroundSampler(ground));
      const river=createCharlesRiver(collision,wind);model.add(river.group);ground.push(...river.ground);walls.push(...river.walls);river.setQuality(true);
      const landmarks=createBostonUniversity({wind});model.add(landmarks.group);ground.push(...landmarks.ground);walls.push(...landmarks.walls);landmarks.setQuality(true);
      const cdsSource=await new GLTFLoader().parseAsync(cdsBytes,'');signal.throwIfAborted();
      retiredVisuals.push(landmarks.cds.visual);replaceMobileCDSVisual(landmarks,cdsSource.scene,cdsPlacement.toWorld);
      const questromSource=await new GLTFLoader().parseAsync(questromBytes,'');signal.throwIfAborted();
      retiredVisuals.push(landmarks.questrom.visual);replaceMobileQuestromVisual(landmarks,questromSource.scene,questromPlacement.toWorld);
      const signatureIds=new Set(['gsu-mugar','cas-east','warren-towers','warren-services','stuvi-one','stuvi-south-tower','stuvi-north-tower','stuvi-north-core','stuvi-north-connectors','law-tower','agganis','fitrec']);
      // Keep the corrected dining/tower partition, facade material divisions,
      // recessed windows and floor plates in the actual phone export. These
      // three formerly fell back to generic six-row brick boxes here.
      for(const id of ['west-dining','claflin-hall','sleeper-hall'])signatureIds.add(id);
      // Recovered Commonwealth frontage must keep the dedicated tower/bay
      // silhouettes and real openings in the exported phone scene as well.
      for(const id of ['commonwealth-580','commonwealth-566','commonwealth-560'])signatureIds.add(id);
      for(const [x,z,count] of [[-650,990,20],[-1110,1240,10]]){
        const houses=BU_FULL_BUILDINGS.filter(b=>b.kind==='brownstone'&&!b.custom).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));
        houses.slice(0,count).forEach(b=>signatureIds.add(b.id));
      }
      // Retain the reviewed 180/192 bows and the 127/125 pair directly facing
      // the Bay State arrival, using the same bounded mobile builder.
      for(const id of ['boston-12057','boston-12068','boston-12097','boston-12180'])signatureIds.add(id);
      const district=createBUFullCampus({buildingIds:signatureIds,includeSpaces:true,signage:false,detail:'mobile'});
      model.add(district.group);ground.push(...district.ground);walls.push(...district.walls);district.setQuality(true);
      const {createBUWarrenStreetscape}=await import('./bu-warren-streetscape');
      const warrenForecourt=createBUWarrenStreetscape({mobile:true});model.add(warrenForecourt.group);ground.push(...warrenForecourt.ground);
      // Use the same surveyed West platform/paving and retaining-wall breaks
      // as desktop, so the phone route does not walk through an omitted wall.
      const {createBUWestTerrace}=await import('./bu-west-terrace');
      const westTerrace=createBUWestTerrace();model.add(westTerrace.group);ground.push(...westTerrace.ground);walls.push(...westTerrace.walls);westTerrace.setQuality(true);
      BU_FULL_BUILDINGS.forEach((b,i)=>{if(!b.custom&&!signatureIds.has(b.id))building(b,buElevation,i);});
      for(const road of BU_CAMPUS_ROADS){
        const sidewalk=buStreetSidewalk(road),roadHeight:Height=road.kind==='expressway'?(x,z)=>buElevation(x,z)+buExpresswayDrop(x,z):buElevation;
        const route=road.points[0][0]>road.points.at(-1)![0]?[...road.points].reverse():road.points;
        if(sidewalk)for(let i=1;i<route.length;i++){
          const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.01)continue;
          const nx=-dz/length,nz=dx/length;
          const sides=road.kind==='avenue'?[buAvenueOuterSide((a[0]+b[0])/2,(a[1]+b[1])/2)]:[-1,1];
          for(const side of sides){
            const inner=side*road.width/2,outer=side*(road.width/2+sidewalk);
            const corners:[number,number][]=[[a[0]+nx*inner,a[1]+nz*inner],[b[0]+nx*inner,b[1]+nz*inner],[b[0]+nx*outer,b[1]+nz*outer],[a[0]+nx*outer,a[1]+nz*outer]];
            for(const patch of buClipSidewalkToJunctions(corners,road.name))polygon('paving',patch,[],roadHeight,.105);
          }
        }
        ribbon(road.points,road.width,'road',roadHeight,.045);
      }
      for(const points of BU_SIDEWALK_JOIN_PATCHES)polygon('paving',points,[],buElevation,.105);
      for(const frontage of BU_PUBLIC_FRONTAGES)polygon(frontage.kind==='entrance'?'brickPaving':'paving',frontage.points,[],buElevation,.102);
      // Preserve the recognisable Green Line reservation and rebuilt stations
      // with flat, welded geometry; no shelter textures or runtime builders.
      ribbon(BU_COMMONWEALTH_MEDIAN,10.2,'gravel',buElevation,.073);
      for(const offset of [-2.45,-1.015,1.015,2.45]){
        const rail:Point[]=BU_COMMONWEALTH_MEDIAN.map(([x,z],i,list)=>{const a=list[Math.max(0,i-1)],b=list[Math.min(list.length-1,i+1)],length=Math.hypot(b[0]-a[0],b[1]-a[1]);return[x-(b[1]-a[1])/length*offset,z+(b[0]-a[0])/length*offset];});
        ribbon(rail,.09,'rail',buElevation,.192,false);
      }
      for(const stop of BU_TRANSIT_PLATFORM_DETAILS)for(const side of [-1,1]){
        const x=stop.position[0]+stop.nx*side*stop.platformOffset,z=stop.position[1]+stop.nz*side*stop.platformOffset;
        const ends:Point[]=[-1,1].map(sign=>[x+stop.dx*stop.platformLength/2*sign,z+stop.dz*stop.platformLength/2*sign]);
        ribbon(ends,stop.width,'paving',buElevation,.19);
      }
      for(const segment of BU_COURTYARD_PUBLIC_SEGMENTS)ribbon(segment,3.4,'paving',buElevation,.11);
      for(const t of manifest.trees.filter((_,i)=>i%2===0))tree(t.x,t.z,(x,z)=>collision.groundHeight(x,z)??3);
      for(const t of river.trees.filter((_,i)=>i%2===0))tree(t.x,t.z,buElevation);
      const streets=createBUCampusStreets();
      const {BU_WARREN_RETAINED_TREE_PITS}=await import('./bu-warren-streetscape-layout');
      const treeStride=Math.max(1,Math.ceil(streets.trees.length/180));
      for(const [index,t] of streets.trees.entries())if(index%treeStride===0||BU_WARREN_RETAINED_TREE_PITS.some(p=>Math.hypot(p[0]-t.x,p[1]-t.z)<.1))tree(t.x,t.z,buElevation,false,true);
      const discardedGeometry=new Set<BufferGeometry>(),discardedMaterials=new Set<Material>();
      streets.group.traverse(object=>{if(object instanceof Mesh){discardedGeometry.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])discardedMaterials.add(m);}});
      discardedGeometry.forEach(g=>g.dispose());discardedMaterials.forEach(m=>m.dispose());streets.group.clear();
      height=buElevation;
    }else{
      const {REMOTE_LAYOUTS}=await import('./campus-regions'),layout=REMOTE_LAYOUTS[campus];let buildings:Building[]=layout.mapBuildings;
      if(campus==='umd'){
        const [{marylandElevation},{UMD_FULL_BUILDINGS},{UMD_ROAD_SURFACES},{MARYLAND_DETAIL_STREETS}]=await Promise.all([import('./maryland-terrain'),import('./maryland-full-layout'),import('./maryland-road-layout'),import('./maryland-street-layout')]);height=marylandElevation;
        buildings=[...layout.mapBuildings.slice(0,10),...UMD_FULL_BUILDINGS];
        for(const surface of UMD_ROAD_SURFACES)polygon(surface.material==='asphalt'?'road':'paving',surface.polygon,[],height,.045);
        for(const street of MARYLAND_DETAIL_STREETS){ribbon(street.points,street.width+5,'paving',height,.07);ribbon(street.points,street.width,'road',height,.08);}
      }else if(campus==='arizona'){
        const {ARIZONA_BUILDINGS,ARIZONA_SURFACES,arizonaElevation}=await import('./arizona-geography');height=arizonaElevation;buildings=ARIZONA_BUILDINGS;
        for(const surface of ARIZONA_SURFACES)polygon(surface.kind==='road'?'road':surface.kind==='lawn'?'grass':surface.kind==='desert'?'desert':'paving',surface.points,surface.holes??[],height,.045);
      }
      signal.throwIfAborted();terrain(layout.bounds,height,campus==='arizona'?'desert':'grass');buildings.forEach((b,i)=>building(b,height,i));
      for(const path of layout.paths??[layout.route])ribbon(path,3.6,'paving',height,.085);
      // A fixed, sparse tree budget, outside both walking routes and footprints.
      const paths=layout.paths??[layout.route];let trees=0;
      for(const path of paths)for(let i=1;i<path.length&&trees<100;i+=3){const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<10)continue;
        const x=(a[0]+b[0])/2-dz/length*9,z=(a[1]+b[1])/2+dx/length*9;
        if(buildings.some(b=>Math.hypot(x-b.x,z-b.z)<Math.hypot(b.width,b.depth)/2+3))continue;tree(x,z,height,campus==='arizona');trees++;
      }
    }
    for(const batch of batches.values()){
      if(!batch.positions.length)continue;const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(batch.positions,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const material=new MeshLambertMaterial({color:colors[batch.finish],side:DoubleSide});if(floorFinishes.has(batch.finish)){material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-2;}
      if(campus==='boston'&&batch.ground)configureBUGroundLayer(material,batch.finish==='grass'?'terrain':'surface');
      const mesh=new Mesh(geometry,material);mesh.name=`Mobile ${batch.finish}`;model.add(mesh);if(batch.ground)ground.push(mesh);if(batch.wall)walls.push(mesh);batch.positions.length=0;
    }
    batches.clear();sky=addSky();model.updateMatrixWorld(true);
    const sampler=campus==='boston'?createCampusGroundSampler(ground):height;
    ground.forEach(mesh=>{mesh.userData.mobileGround=true;});walls.forEach(mesh=>{mesh.userData.mobileWall=true;});
    collision.rebuild(ground,walls,sampler);signal.throwIfAborted();
  }catch(error){dispose();throw error;}
  function dispose(){
    if(disposed)return;disposed=true;collision.clear();const geometry=new Set<BufferGeometry>(),materials=new Set<Material>();
    for(const root of [model,...retiredVisuals])root.traverse(object=>{if(!(object instanceof Mesh))return;geometry.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);});
    geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());model.clear();batches.clear();
    retiredVisuals.forEach(group=>group.clear());retiredVisuals.length=0;
  }
  return{model,collision,wind,setQuality:()=>{},update:(camera:Vector3)=>{sky.position.copy(camera);},dispose};
}

