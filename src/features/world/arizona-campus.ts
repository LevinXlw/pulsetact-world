import {BoxGeometry,BufferGeometry,Color,CylinderGeometry,DoubleSide,ExtrudeGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Shape,ShapeGeometry,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {createArizonaEnvironment,arizonaBoundaryDistance,arizonaInside,arizonaSegmentDistance} from './arizona-environment';
import {ARIZONA_BUILDINGS,ARIZONA_BOUNDS,ARIZONA_SURFACES,ARIZONA_PATHS,arizonaElevation,drapeArizonaGeometry} from './arizona-geography';
import {ARIZONA_LANDMARK_IDS,createArizonaLandmarks} from './arizona-landmarks';

type Point=readonly [number,number];
type Building=(typeof ARIZONA_BUILDINGS)[number];
type Placement={x:number;z:number;yaw:number};
type Finish='brick'|'brickPale'|'sandstone'|'stucco'|'trim'|'glass'|'frame'|'roof'|'shade'|'paving'|'brickWalk'|'road'|'grass'|'desert'|'wood'|'white'|'red';
type Opening={x:number;bottom:number;width:number;height:number;door?:boolean};
const CELL=240;
const COLORS:Record<Finish,string>={brick:'#a65f48',brickPale:'#bd7b61',sandstone:'#d4b892',stucco:'#d6c7a9',trim:'#e6d5b2',glass:'#698891',frame:'#8b8171',roof:'#a29883',shade:'#3e514f',paving:'#c6b99c',brickWalk:'#a9745a',road:'#8e9087',grass:'#869a5e',desert:'#bdab81',wood:'#897158',white:'#e9dfbd',red:'#a5483c'};
const SURFACES:Record<Finish,string>={brick:'brick',brickPale:'brick',sandstone:'limestone',stucco:'trim',trim:'trim',glass:'glass',frame:'metal',roof:'metal',shade:'interiorShade',paving:'pavement',brickWalk:'brick',road:'road',grass:'grass',desert:'road',wood:'benchWood',white:'trim',red:'trim'};
const area=(points:readonly Point[])=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
function oriented(ring:readonly Point[],clockwise=true):Point[]{
  const points=ring.map(p=>[p[0],p[1]] as Point);if(points.length>3&&Math.hypot(points[0][0]-points.at(-1)![0],points[0][1]-points.at(-1)![1])<.01)points.pop();
  if((area(points)<0)!==clockwise)points.reverse();return points;
}
function shapeFor(points:readonly Point[],holes:readonly (readonly Point[])[]=[]){
  const shape=new Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
  for(const ring of holes){const hole=new Path();ring.forEach(([x,z],i)=>i?hole.lineTo(x,-z):hole.moveTo(x,-z));hole.closePath();shape.holes.push(hole);}return shape;
}

/** Arizona's Tucson main campus. Horizontal footprints and routes come from
 * campus geography; facade rhythms, heights and planted species are authored
 * exterior interpretations. The desert ground is deliberately not a turf sheet.
 */
export function createArizonaCampus(wind:{value:number}){
  const group=new Group();group.name='University of Arizona · Tucson';
  const ground:Mesh[]=[],walls:Mesh[]=[],visible:Mesh[]=[],batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>();
  const invisible=new MeshBasicMaterial({side:DoubleSide});invisible.name='Arizona footprint collision';
  let zone='0:0',base=0;
  const zoneAt=(x:number,z:number)=>`${Math.floor(x/CELL)}:${Math.floor(z/CELL)}`;
  const local=(p:Placement,x:number,z:number):Point=>[p.x+x*Math.cos(p.yaw)+z*Math.sin(p.yaw),p.z-x*Math.sin(p.yaw)+z*Math.cos(p.yaw)];
  const add=(finish:Finish,geometry:BufferGeometry,surface=false)=>{
    if(surface){const source=geometry;geometry=drapeArizonaGeometry(source,12);source.dispose();}
    else geometry.translate(0,base,0);
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${zone}:${surface?'ground':'architecture'}:${finish}`,batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const box=(finish:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number,d:number,surface=false)=>{
    if(w<.001||h<.001||d<.001)return;const [xx,zz]=local(p,x,z),geometry=new BoxGeometry(w,h,d);geometry.rotateY(p.yaw);geometry.translate(xx,y,zz);add(finish,geometry,surface);
  };
  const plane=(finish:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number)=>{
    const [xx,zz]=local(p,x,z),geometry=new PlaneGeometry(w,h);geometry.rotateY(p.yaw);geometry.translate(xx,y,zz);add(finish,geometry);
  };
  const edge=(a:Point,b:Point):Placement=>({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(a[1]-b[1],b[0]-a[0])});
  const roof=(points:readonly Point[],holes:readonly (readonly Point[])[],y:number,finish:Finish='roof')=>{
    const geometry=new ShapeGeometry(shapeFor(points,holes));geometry.rotateX(-Math.PI/2);geometry.translate(0,y,0);add(finish,geometry);
  };
  const solidCollision=(b:Building,points:Point[],holes:Point[][])=>{
    const geometry=new ExtrudeGeometry(shapeFor(points,holes),{depth:b.height+2.5,bevelEnabled:false,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.translate(0,base-2.5,0);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,invisible);mesh.name=b.name;mesh.visible=false;mesh.userData.campusFootprint=points;mesh.userData.campusHoles=holes;group.add(mesh);walls.push(mesh);
  };
  const aperture=(p:Placement,o:Opening,modern:boolean)=>{
    // Glass is recessed inside the physically cut masonry opening. The reveal
    // and sill are visible in oblique views instead of stickers over a solid box.
    plane('shade',p,o.x,o.bottom+o.height/2,-.47,o.width,o.height);
    plane('glass',p,o.x,o.bottom+o.height/2,-.445,o.width-.07,o.height-.05);
    box(modern?'frame':'sandstone',p,o.x,o.bottom-.045,.015,o.width+.20,.11,.62);
    for(const side of [-1,1])box(modern?'frame':'sandstone',p,o.x+side*(o.width/2+.05),o.bottom+o.height/2,-.06,.10,o.height+.14,.50);
    box(modern?'frame':'sandstone',p,o.x,o.bottom+o.height+.065,-.06,o.width+.22,.13,.5);
    plane('frame',p,o.x,o.bottom+o.height/2,-.39,.065,o.height);
    if(o.height>1.8)plane('frame',p,o.x,o.bottom+o.height*.6,-.385,o.width,.06);
    if(o.door){for(const side of [-1,1]){box('frame',p,o.x+side*.15,o.bottom+1.12,-.30,.04,.38,.12);plane('wood',p,o.x+side*o.width*.25,o.bottom+.32,-.38,o.width*.5-.07,.54);}}
  };
  const facade=(p:Placement,width:number,height:number,kind:string,finish:Finish,entrance=false)=>{
    const modern=kind==='modern'||kind==='lab',floors=Math.max(1,Math.min(7,Math.round(height/(modern?4.2:3.7)))),floorHeight=(height-.45)/floors;
    const spacing=modern?5.9:5.6,count=Math.max(0,Math.floor((width-1)/spacing)),windowWidth=modern?2.8:1.9,windowHeight=Math.min(2.15,floorHeight*.58),openings:Opening[]=[];
    for(let row=0;row<floors;row++)for(let col=0;col<count;col++){
      const x=(col-(count-1)/2)*spacing;if(entrance&&row===0&&Math.abs(x)<3.2)continue;
      openings.push({x,bottom:.60+row*floorHeight,width:windowWidth,height:windowHeight});
    }
    if(entrance&&width>8)openings.push({x:0,bottom:.24,width:2.8,height:2.75,door:true});
    const shape=new Shape();shape.moveTo(-width/2,-2.5);shape.lineTo(width/2,-2.5);shape.lineTo(width/2,height);shape.lineTo(-width/2,height);shape.closePath();
    for(const o of openings){const hole=new Path();hole.moveTo(o.x-o.width/2,o.bottom);hole.lineTo(o.x-o.width/2,o.bottom+o.height);hole.lineTo(o.x+o.width/2,o.bottom+o.height);hole.lineTo(o.x+o.width/2,o.bottom);hole.closePath();shape.holes.push(hole);}
    const [x,z]=local(p,0,-.46),geometry=new ExtrudeGeometry(shape,{depth:.46,bevelEnabled:false,curveSegments:1});geometry.rotateY(p.yaw);geometry.translate(x,0,z);add(finish,geometry);
    openings.forEach(o=>aperture(p,o,modern));
    box('sandstone',p,0,.06,-.12,width,.30,.64);
    box('trim',p,0,height-.17,.12,width+.14,.25,.72);
    box('sandstone',p,0,height-.5,.04,width,.13,.55);
    // Deep projecting lintels and sun fins are a meaningful Sonoran detail.
    for(const o of openings)if(!o.door){box(modern?'sandstone':'brickPale',p,o.x,o.bottom+o.height+.22,.24,o.width+.50,.14,1.0);if(modern)for(const s of [-1,1])box('sandstone',p,o.x+s*(o.width/2+.16),o.bottom+o.height/2,.21,.16,o.height+.58,.96);}
    if(floors>2)for(let floor=1;floor<floors;floor++)box('sandstone',p,0,floor*floorHeight-.04,.03,width,.14,.52);
    if(entrance&&width>9){
      // Walkable entrance slab: keep the only riser at 12cm. Portico posts
      // are outside the 3.2m clear central approach and have visible collision.
      box('paving',p,0,.06,1.2,6.6,.12,2.8,true);box('trim',p,0,3.6,1.25,7.2,.25,3.3);
      for(const s of [-1,1]){box('sandstone',p,s*3.0,1.85,2.2,.36,3.5,.36);const [cx,cz]=local(p,s*3,2.2),collision=new Mesh(new BoxGeometry(.36,3.5,.36),invisible);collision.position.set(cx,base+1.85,cz);collision.rotation.y=p.yaw;collision.visible=false;collision.name=`Arizona shaded entrance post`;collision.geometry.computeBoundingBox();collision.geometry.computeBoundingSphere();group.add(collision);walls.push(collision);}
    }
  };
  const garage=(b:Building,points:Point[],holes:Point[][])=>{
    const floors=Math.max(3,Math.round(b.height/3.25)),height=floors*3.25;
    // Open deck bands retain the concave surveyed footprint, including any
    // light wells. No solid opaque parking block closes the visible openings.
    solidCollision(b,points,holes);
    for(let floor=0;floor<=floors;floor++)roof(points,holes,floor*3.25+.15,'paving');
    for(const ring of [points,...holes])for(let i=0;i<ring.length;i++){
      const a=ring[i],c=ring[(i+1)%ring.length],width=Math.hypot(c[0]-a[0],c[1]-a[1]),p=edge(a,c);if(width<.2)continue;
      for(let floor=0;floor<floors;floor++){
        box('sandstone',p,0,floor*3.25+.58,0,width,.9,.45);box('shade',p,0,floor*3.25+2,-.8,width,1.85,.08);
      }
      for(let x=-width/2+.3;x<width/2;x+=6.6)box('sandstone',p,x,height/2,0,.54,height,.65);
      box('trim',p,0,height+.3,0,width,.60,.6);
    }
  };
  const arena=(b:Building,points:Point[],holes:Point[][])=>{
    solidCollision(b,points,holes);
    for(const ring of [points,...holes])for(let i=0;i<ring.length;i++){
      const a=ring[i],c=ring[(i+1)%ring.length],p=edge(a,c),width=Math.hypot(a[0]-c[0],a[1]-c[1]);if(width<.12)continue;
      box('sandstone',p,0,b.height*.22,-.15,width,b.height*.44,.65);
      box('glass',p,0,b.height*.66,-.42,width,b.height*.40,.1);
      box('trim',p,0,b.height-.55,.2,width,1.1,1.1);
      box('sandstone',p,0,b.height*.45,.15,width,.45,.8);
      for(let x=-width/2+.2;x<width/2;x+=4.2)box('sandstone',p,x,b.height*.68,.1,.28,b.height*.55,.85);
    }
    roof(points,holes,b.height-.1,'stucco');
    for(let layer=1;layer<=3;layer++){
      const scale=1-layer*.075,ring=points.map(([x,z])=>[b.x+(x-b.x)*scale,b.z+(z-b.z)*scale] as Point);
      roof(ring,[],b.height+layer*.7,'stucco');
    }
  };
  const clipX=(ring:Point[],boundary:number,greater:boolean)=>{
    const out:Point[]=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],da=(a[0]-boundary)*(greater?1:-1),db=(b[0]-boundary)*(greater?1:-1);if(da>=-1e-7)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([boundary,a[1]+(b[1]-a[1])*t]);}}return out;
  };
  const stadiumParts=ARIZONA_BUILDINGS.filter(b=>b.kind==='stadium'&&!/Hillenbrand|baseball|softball/i.test(b.name));
  const stadiumCenterX=stadiumParts.length?(Math.min(...stadiumParts.flatMap(b=>b.footprint.map(p=>p[0])))+Math.max(...stadiumParts.flatMap(b=>b.footprint.map(p=>p[0]))))/2:0;
  const stadium=(b:Building,points:Point[],holes:Point[][])=>{
    solidCollision(b,points,holes);const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
    // Concrete seating terraces follow the surveyed stand silhouette. Their
    // tier heights are authored; the central field remains entirely unroofed.
    for(let x=minX;x<maxX-.05;x+=1.45){
      const end=Math.min(maxX,x+1.45),ring=clipX(clipX(points,x,true),end,false);if(ring.length<3)continue;
      const clippedHoles=holes.map(h=>clipX(clipX(h,x,true),end,false)).filter(h=>h.length>=3),height=2.6+Math.min(b.height-2.6,Math.abs((x+end)/2-stadiumCenterX)*.28);
      roof(ring,clippedHoles,height,'paving');
      for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length],width=Math.hypot(a[0]-c[0],a[1]-c[1]);if(width>.12)box('sandstone',edge(a,c),0,height-.24,0,width,.48,.08);}
    }
    // A continuous sloping concrete soffit closes the underside of the steps.
    // Without it an outside view saw sky through the single-sided seating caps.
    const soffit=new ShapeGeometry(shapeFor(points,holes));soffit.rotateX(-Math.PI/2);const positions=soffit.getAttribute('position');
    for(let i=0;i<positions.count;i++)positions.setY(i,2.0+Math.min(b.height-2.6,Math.abs(positions.getX(i)-stadiumCenterX)*.28));soffit.computeVertexNormals();add('paving',soffit);
    let perimeter=0,nextColumn=2;
    for(let i=0;i<points.length;i++){
      const a=points[i],c=points[(i+1)%points.length],p=edge(a,c),width=Math.hypot(a[0]-c[0],a[1]-c[1]);if(width<.2)continue;
      box('brick',p,0,1.55,-.12,width,3.1,.5);
      // Column spacing follows the whole perimeter, not each tiny GIS segment.
      // A digitised sill break must not start another 24m-high column.
      for(;nextColumn<perimeter+width;nextColumn+=9.5){const along=nextColumn-perimeter-width/2,[cx]=local(p,along,-.1),height=2.0+Math.min(b.height-2.6,Math.abs(cx-stadiumCenterX)*.28);box('sandstone',p,along,height/2,-.1,.55,height,.72);}
      perimeter+=width;
    }
  };
  const paths=ARIZONA_PATHS,segments=paths.flatMap(path=>path.slice(1).map((b,i)=>({a:path[i],b})));
  const pathDistance=(p:Point)=>Math.min(...segments.map(({a,b})=>arizonaSegmentDistance(p,a,b)));

  // Mineral campus ground is continuous beneath all surfaces and courtyards.
  // Tessellation makes the elevation sampler and visual terrain agree locally.
  for(let x=ARIZONA_BOUNDS.minX;x<ARIZONA_BOUNDS.maxX;x+=CELL)for(let z=ARIZONA_BOUNDS.minZ;z<ARIZONA_BOUNDS.maxZ;z+=CELL){
    const w=Math.min(CELL,ARIZONA_BOUNDS.maxX-x),d=Math.min(CELL,ARIZONA_BOUNDS.maxZ-z),geometry=new PlaneGeometry(w,d,Math.ceil(w/12),Math.ceil(d/12));geometry.rotateX(-Math.PI/2);geometry.translate(x+w/2,-.025,z+d/2);zone=zoneAt(x+w/2,z+d/2);add('desert',geometry,true);
  }
  for(const surface of ARIZONA_SURFACES){
    const points=surface.points;if(points.length<3)continue;zone=zoneAt(points[0][0],points[0][1]);
    const finish:Finish=['grass','lawn'].includes(surface.kind)?'grass':['road','parking'].includes(surface.kind)?'road':['brick','brickWalk'].includes(surface.kind)?'brickWalk':['garden','desert','sand'].includes(surface.kind)?'desert':'paving';
    const geometry=new ShapeGeometry(shapeFor(points,surface.holes??[]));geometry.rotateX(-Math.PI/2);geometry.translate(0,finish==='grass'?.012:finish==='road'?.027:.045,0);add(finish,geometry,true);
    if(surface.kind==='parking'){
      const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
      const inside=(p:Point)=>arizonaInside(p,points)&&!(surface.holes??[]).some(h=>arizonaInside(p,h));
      for(let z=minZ+4;z<maxZ-5;z+=13)for(let x=minX+3;x<maxX-3;x+=2.9){
        if(![[x-.12,z-2.5],[x+.12,z-2.5],[x-.12,z+2.5],[x+.12,z+2.5]].every(p=>inside(p as [number,number])))continue;
        box('white',{x,z,yaw:0},0,.048,0,.09,.016,5.0,true);
      }
      for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],length=Math.hypot(a[0]-b[0],a[1]-b[1]);if(length>.2)box('sandstone',edge(a,b),0,.065,0,length,.13,.22,true);}
    }
  }
  // Use the route network for guide logic only. Rendering broad invented paths
  // across surveyed surfaces would erase plazas and create building crossings.
  for(const b of ARIZONA_BUILDINGS){
    if(ARIZONA_LANDMARK_IDS.has(b.id))continue;
    zone=zoneAt(b.x,b.z);base=arizonaElevation(b.x,b.z);const points=oriented(b.footprint),holes=(b.holes??[]).map(h=>oriented(h,false));
    if(points.length<3)continue;
    if(b.kind==='garage'){garage(b,points,holes);continue;}
    if(b.kind==='arena'||/McKale/i.test(b.name)){arena(b,points,holes);continue;}
    if(b.kind==='stadium'){stadium(b,points,holes);continue;}
    const finish:Finish=b.kind==='modern'||b.kind==='lab'?'sandstone':b.kind==='residence'?'brickPale':'brick';
    const faces=points.map((a,i)=>{const c=points[(i+1)%points.length];return {p:edge(a,c),width:Math.hypot(c[0]-a[0],c[1]-a[1])};}).filter(f=>f.width>.12);
    const front=faces.filter(f=>f.width>9).sort((a,c)=>pathDistance([a.p.x,a.p.z])-pathDistance([c.p.x,c.p.z]))[0];
    solidCollision(b,points,holes);
    for(const face of faces)facade(face.p,face.width,b.height,b.kind,finish,face===front);
    for(const ring of holes)for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length],length=Math.hypot(a[0]-c[0],a[1]-c[1]);if(length>.12)facade(edge(a,c),length,b.height,b.kind,finish);}
    roof(points,holes,b.height-.10);
    // Small rooftop service enclosures are placed only where their complete
    // outline fits inside the actual building, never over an open courtyard.
    if(arizonaInside([b.x,b.z],points)&&!holes.some(h=>arizonaInside([b.x,b.z],h))&&arizonaBoundaryDistance([b.x,b.z],points)>5&&!holes.some(h=>arizonaBoundaryDistance([b.x,b.z],h)<5)){
      const p={x:b.x,z:b.z,yaw:b.yaw};box('stucco',p,0,b.height+.80,0,5.2,1.8,4.2);box('roof',p,0,b.height+1.76,0,5.45,.16,4.45);
    }
  }
  const materials=new Map<string,MeshStandardMaterial>();
  for(const [key,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(p=>p.dispose());if(!geometry)throw new Error(`Arizona batching failed: ${key}`);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const materialKey=`${batch.finish}:${batch.surface?'ground':'solid'}`;
    let material=materials.get(materialKey);if(!material){
      material=createCampusSurface(SURFACES[batch.finish],{yaw:0}) as MeshStandardMaterial;material.color=new Color(COLORS[batch.finish]);material.name=`Arizona ${batch.finish}`;material.polygonOffset=false;material.roughness=batch.finish==='glass'?.5:1;
      if(batch.surface&&batch.finish!=='desert'){
        // Thin real layers share an 8m height lattice. A depth bias keeps those
        // centimetre differences stable in a kilometre-scale overview.
        material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=batch.finish==='grass'?-2:-5;
      }
      if(batch.finish==='paving'&&!batch.surface)material.side=DoubleSide;
      materials.set(materialKey,material);
    }
    const mesh=new Mesh(geometry,material);mesh.name=`Arizona ${key}`;mesh.castShadow=!batch.surface&&batch.finish!=='glass';mesh.receiveShadow=true;group.add(mesh);visible.push(mesh);if(batch.surface)ground.push(mesh);
  }
  const landmarks=createArizonaLandmarks(wind);group.add(landmarks.group);ground.push(...landmarks.ground);walls.push(...landmarks.walls);
  const environment=createArizonaEnvironment({bounds:ARIZONA_BOUNDS,buildings:ARIZONA_BUILDINGS,surfaces:ARIZONA_SURFACES,paths,elevation:arizonaElevation,wind});group.add(environment.group);walls.push(...environment.walls);
  group.userData.buildingCount=ARIZONA_BUILDINGS.length;group.userData.plants=environment.plants;group.userData.landmarkIds=[...ARIZONA_LANDMARK_IDS];group.updateMatrixWorld(true);
  let lowQuality=false;
  return {group,ground,walls,trees:[] as {x:number;z:number;radius:number}[],lawns:[] as {mesh:Mesh;footprints:{x:number;z:number;width:number;depth:number;yaw:number}[]}[],
    setQuality:(low:boolean)=>{lowQuality=low;visible.forEach(mesh=>{mesh.castShadow=!low&&!ground.includes(mesh)&&!mesh.name.endsWith(':glass');});landmarks.setQuality(low);environment.setQuality(low);},
    update:(camera:Vector3)=>{
      landmarks.update(camera);environment.update(camera);const reach=lowQuality?310:540;
      for(const mesh of visible){if(!/:(frame|wood|trim)$/.test(mesh.name))continue;const b=mesh.geometry.boundingBox!,dx=Math.max(b.min.x-camera.x,0,camera.x-b.max.x),dz=Math.max(b.min.z-camera.z,0,camera.z-b.max.z);mesh.visible=dx*dx+dz*dz<reach*reach;}
    },
  };
}
