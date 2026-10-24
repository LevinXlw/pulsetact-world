import {BoxGeometry,BufferGeometry,CanvasTexture,Color,CylinderGeometry,ExtrudeGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Shape,ShapeGeometry,SphereGeometry,SRGBColorSpace,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {UMD_FULL_BUILDINGS} from './maryland-full-layout';
import {drapeMarylandGeometry,marylandElevation} from './maryland-terrain';
import {createCampusSurface} from './painterly-surfaces';

type Point=readonly [number,number];
type Finish='brick'|'stone'|'trim'|'glass'|'frame'|'roof'|'shade'|'paving'|'bronze'|'wood';
type Edge={x:number;z:number;yaw:number;width:number};
const COLORS:Record<Finish,string>={brick:'#a96851',stone:'#ddd8c6',trim:'#ece6d5',glass:'#435e69',frame:'#c5cbc3',roof:'#889a99',shade:'#354548',paving:'#af7f66',bronze:'#657668',wood:'#8b694c'};
const SURFACES:Record<Finish,string>={brick:'brick',stone:'limestone',trim:'trim',glass:'glass',frame:'frame',roof:'metal',shade:'interiorShade',paving:'pavement',bronze:'bronze',wood:'benchWood'};
const area=(ring:readonly Point[])=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
function tidy(ring:readonly Point[],clockwise=true):Point[]{
  const points=ring.map(p=>[p[0],p[1]] as Point);
  if(points.length>3&&Math.hypot(points[0][0]-points.at(-1)![0],points[0][1]-points.at(-1)![1])<.01)points.pop();
  if((area(points)<0)!==clockwise)points.reverse();return points;
}
function shapeFor(points:readonly Point[],holes:readonly (readonly Point[])[]=[]){
  const shape=new Shape();points.forEach((p,i)=>i?shape.lineTo(p[0],-p[1]):shape.moveTo(p[0],-p[1]));shape.closePath();
  holes.forEach(ring=>{const hole=new Path();ring.forEach((p,i)=>i?hole.lineTo(p[0],-p[1]):hole.moveTo(p[0],-p[1]));hole.closePath();shape.holes.push(hole);});return shape;
}
function inside(point:Point,ring:readonly Point[]){
  let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;
}
function clipZ(points:Point[],boundary:number,keepGreater:boolean){
  const out:Point[]=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],da=(a[1]-boundary)*(keepGreater?1:-1),db=(b[1]-boundary)*(keepGreater?1:-1);if(da>=-1e-7)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,boundary]);}}return out;
}

/** Van Munching's public exterior: surveyed roofline; authored floor heights.
 * The north/south additions, pale horizontal bands, grouped vertical windows,
 * metal gable lanterns and the freestanding gateway clock use UMD photographs.
 * Never replace the concave footprint by its enclosing rectangle: the western
 * outdoor courts remain open, including in the collision geometry.
 */
export function createMarylandBusinessDistrict(_wind?:{value:number}){
  const building=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId==='039');
  if(!building)throw new Error('Van Munching Hall is absent from the UMD campus data');
  const points=tidy(building.footprint),holes=((building as typeof building&{holes?:Point[][]}).holes??[]).map(r=>tidy(r,false));
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),width=maxX-minX,depth=maxZ-minZ;
  const base=marylandElevation(building.x,building.z),group=new Group();group.name='Maryland · Van Munching Hall and Mayer Mall';
  group.userData.sourceBuildingId='039';group.userData.campusFootprint=points;group.userData.campusHoles=holes;
  const ground:Mesh[]=[],walls:Mesh[]=[],trees:{x:number;z:number;radius:number}[]=[];
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>(),visible:Mesh[]=[];
  const collisionMaterial=new MeshBasicMaterial();collisionMaterial.name='Van Munching collision';
  const add=(finish:Finish,source:BufferGeometry,surface=false)=>{
    let geometry=source;
    if(surface){geometry=drapeMarylandGeometry(source,6);source.dispose();}else geometry.translate(0,base,0);
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${surface?'ground':'building'}:${finish}`,batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const box=(finish:Finish,x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,surface=false)=>{if(w<=0||h<=0||d<=0)return;const geo=new BoxGeometry(w,h,d);geo.rotateY(yaw);geo.translate(x,y,z);add(finish,geo,surface);};
  const plane=(finish:Finish,x:number,y:number,z:number,w:number,h:number,yaw=0)=>{const geo=new PlaneGeometry(w,h);geo.rotateY(yaw);geo.translate(x,y,z);add(finish,geo);};
  const locate=(edge:Edge,x:number,z:number):Point=>[edge.x+x*Math.cos(edge.yaw)+z*Math.sin(edge.yaw),edge.z-x*Math.sin(edge.yaw)+z*Math.cos(edge.yaw)];
  const edgeBox=(f:Finish,e:Edge,x:number,y:number,z:number,w:number,h:number,d:number)=>{const p=locate(e,x,z);box(f,p[0],y,p[1],w,h,d,e.yaw);};
  const edgePlane=(f:Finish,e:Edge,x:number,y:number,z:number,w:number,h:number)=>{const p=locate(e,x,z);plane(f,p[0],y,p[1],w,h,e.yaw);};
  const footprintShape=shapeFor(points,holes),cuts=[minZ+depth*.32,minZ+depth*.70],heights=[17.8,16.5,18.2];
  const heightAt=(z:number)=>heights[z<cuts[0]?0:z<cuts[1]?1:2];
  const zoneBounds=[minZ-1,...cuts,maxZ+1];
  const roofSource=new ShapeGeometry(footprintShape);roofSource.rotateX(-Math.PI/2);
  const roofPosition=roofSource.getAttribute('position'),roofIndex=roofSource.index;
  for(let zone=0;zone<3;zone++){
    const vertices:number[]=[];
    for(let i=0;i<(roofIndex?.count??roofPosition.count);i+=3){
      let triangle:Point[]=[0,1,2].map(n=>{const j=roofIndex?roofIndex.getX(i+n):i+n;return[roofPosition.getX(j),roofPosition.getZ(j)];});
      triangle=clipZ(clipZ(triangle,zoneBounds[zone],true),zoneBounds[zone+1],false);
      for(let n=1;n<triangle.length-1;n++)for(const p of [triangle[0],triangle[n],triangle[n+1]])vertices.push(p[0],heights[zone]+.07,p[1]);
    }
    const roof=new BufferGeometry();roof.setAttribute('position',new Float32BufferAttribute(vertices,3));roof.computeVertexNormals();add('roof',roof);
  }
  roofSource.dispose();
  // Recessed glazing is set behind real punched masonry, not painted on a box.
  function facade(a:Point,b:Point,height:number){
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.12)return;
    const edge:Edge={x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(a[1]-b[1],b[0]-a[0]),width:length};
    const floor=height/4,openings:{x:number;bottom:number;w:number;h:number}[]=[];
    // The recessed eastern stair bay in the South Wing is a full-height
    // gridded glass opening between pale piers, visible in the official photo.
    const stairBay=edge.x>maxX-width*.15&&edge.x<maxX-width*.055&&edge.z>minZ+depth*.71&&edge.z<minZ+depth*.81&&length>7&&Math.abs(a[0]-b[0])<1;
    if(stairBay){
      edgePlane('shade',edge,0,height/2,-.48,length,height);edgePlane('glass',edge,0,height/2,-.20,Math.max(2,length-2.4),height-1.4);
      for(const side of [-1,1])edgeBox('stone',edge,side*(length/2-.60),height/2,.05,1.20,height,.70);
      edgeBox('stone',edge,0,.30,.04,length,.60,.65);edgeBox('stone',edge,0,height-.38,.04,length,.76,.65);edgeBox('trim',edge,0,height+.11,.09,length+.08,.22,.78);
      for(let y=1.3;y<height-.8;y+=1.15)edgeBox('frame',edge,0,y,-.11,length-2.4,.075,.16);
      for(let x=-length/2+1.35;x<length/2-1.1;x+=1.2)edgeBox('frame',edge,x,height/2,-.09,.075,height-1.4,.16);
      return;
    }
    // Broad stone spandrels and paired narrow lights distinguish VMH from the
    // earlier generic Georgian building model. Short curved facets get one bay.
    const count=Math.max(0,Math.floor((length-.65)/3.35)),spacing=length/(count+1);
    for(let row=0;row<4;row++)for(let col=0;col<count;col++){
      const center=-length/2+(col+1)*spacing;
      if(length>8){for(const offset of [-.53,.53])openings.push({x:center+offset,bottom:.9+row*floor,w:.77,h:floor-1.45});}
      else openings.push({x:center,bottom:.9+row*floor,w:Math.min(1.7,spacing*.56),h:floor-1.45});
    }
    for(const [bottom,top,finish]of [[-1.7,floor-.20,'stone'],[floor-.20,height,'brick']] as const){
      const face=new Shape();face.moveTo(-length/2,bottom);face.lineTo(length/2,bottom);face.lineTo(length/2,top);face.lineTo(-length/2,top);face.closePath();
      openings.filter(o=>o.bottom>bottom&&o.bottom+o.h<top).forEach(o=>{const p=new Path();p.moveTo(o.x-o.w/2,o.bottom);p.lineTo(o.x-o.w/2,o.bottom+o.h);p.lineTo(o.x+o.w/2,o.bottom+o.h);p.lineTo(o.x+o.w/2,o.bottom);p.closePath();face.holes.push(p);});
      const g=new ExtrudeGeometry(face,{depth:.48,bevelEnabled:false,steps:1,curveSegments:1});g.translate(0,0,-.48);g.rotateY(edge.yaw);g.translate(edge.x,0,edge.z);add(finish,g);
    }
    edgeBox('stone',edge,0,.32,-.05,length,.64,.62);
    // The stone base stops at the first window sill; upper bands wrap every
    // surveyed corner, retaining the characteristic horizontal white stripes.
    for(let row=1;row<=4;row++)edgeBox('stone',edge,0,row*floor-.32,.045,length,1.02,.63);
    edgeBox('trim',edge,0,height+.13,.10,length+.06,.26,.76);
    edgeBox('stone',edge,0,height-.75,.04,length,.10,.69);
    openings.forEach(o=>{
      edgePlane('shade',edge,o.x,o.bottom+o.h/2,-.45,o.w+.13,o.h+.13);
      edgePlane('glass',edge,o.x,o.bottom+o.h/2,-.36,o.w,o.h);
      for(const dx of [-o.w/2,o.w/2])edgeBox('frame',edge,o.x+dx,o.bottom+o.h/2,-.25,.055,o.h+.10,.12);
      edgeBox('frame',edge,o.x,o.bottom+o.h*.37,-.23,o.w,.065,.14);
      edgeBox('trim',edge,o.x,o.bottom-.045,.015,o.w+.18,.09,.54);
      edgeBox('frame',edge,o.x,o.bottom+o.h+.035,-.24,o.w+.1,.06,.12);
    });
  }
  for(const ring of [points,...holes])for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],splits=[0,1];
    if(Math.abs(a[1]-b[1])>.001)for(const cut of cuts){const t=(cut-a[1])/(b[1]-a[1]);if(t>0&&t<1)splits.push(t);}
    splits.sort((p,q)=>p-q);for(let j=1;j<splits.length;j++){const p=splits[j-1],q=splits[j],av:Point=[a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p],bv:Point=[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q];facade(av,bv,heightAt((av[1]+bv[1])/2));}
  }
  // Close roof-level steps only where a cross-section actually meets the
  // building. Concave courts are excluded by the point-in-polygon test.
  cuts.forEach((z,k)=>{
    const crossings:number[]=[];for(const ring of [points,...holes])for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if((a[1]>z)!==(b[1]>z))crossings.push(a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]));}
    crossings.sort((a,b)=>a-b);for(let i=1;i<crossings.length;i++){const x=(crossings[i-1]+crossings[i])/2;if(!inside([x,z],points)||holes.some(r=>inside([x,z],r)))continue;box('brick',x,(heights[k]+heights[k+1])/2,z,crossings[i]-crossings[i-1],Math.abs(heights[k]-heights[k+1]),.36);}
  });
  const collision=new ExtrudeGeometry(footprintShape,{depth:24,bevelEnabled:false,steps:1,curveSegments:1});collision.rotateX(-Math.PI/2);collision.translate(0,base-1.8,0);collision.computeBoundingBox();collision.computeBoundingSphere();
  const wall=new Mesh(collision,collisionMaterial);wall.name='Van Munching Hall · surveyed concave footprint';wall.userData.campusFootprint=points;wall.userData.campusHoles=holes;wall.visible=false;group.add(wall);walls.push(wall);
  const inBuilding=(x:number,z:number)=>inside([x,z],points)&&!holes.some(h=>inside([x,z],h));
  // Standing-seam gable roof lanterns are visible in UMD's Mayer Mall photo.
  // Each is fitted to an interior stretch of the live footprint, so changing
  // the campus horizontal transform cannot leave an old roof floating outside.
  function roofLantern(zFraction:number,desiredLength:number,rise:number){
    const z=minZ+depth*zFraction,searchX=maxX-width*.16,w=Math.min(width*.20,13.5),d=Math.min(depth*.13,desiredLength),h=heightAt(z);
    if(![[searchX-w/2,z-d/2],[searchX+w/2,z-d/2],[searchX+w/2,z+d/2],[searchX-w/2,z+d/2]].every(([x,pz])=>inBuilding(x,pz)))return;
    box('brick',searchX,h+.8,z,w,1.6,d);box('trim',searchX,h+1.58,z,w+.3,.2,d+.3);
    const verts:number[]=[];const a=[searchX-w/2,h+1.7,z-d/2],b=[searchX+w/2,h+1.7,z-d/2],c=[searchX,h+1.7+rise,z-d/2],e=[searchX-w/2,h+1.7,z+d/2],f=[searchX+w/2,h+1.7,z+d/2],g=[searchX,h+1.7+rise,z+d/2];
    for(const t of [[a,e,g],[a,g,c],[c,g,f],[c,f,b]])for(const p of t)verts.push(...p);
    const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(verts,3));geo.computeVertexNormals();add('roof',geo);
    for(const [end,yaw]of [[z-d/2,Math.PI],[z+d/2,0]]){
      const triangle=new Shape();triangle.moveTo(-w/2,0);triangle.lineTo(w/2,0);triangle.lineTo(0,rise);triangle.closePath();const glass=new ShapeGeometry(triangle);glass.rotateY(yaw);glass.translate(searchX,h+1.7,end);add('glass',glass);
      for(let x=-w/2+1.2;x<w/2;x+=1.2){const gh=rise*(1-Math.abs(x)/(w/2));box('frame',searchX+x,h+1.7+gh/2,end,.055,gh,.08);}
    }
    for(let pz=z-d/2;pz<=z+d/2+.1;pz+=1.15){
      for(const s of [-1,1]){const seam=new BoxGeometry(Math.hypot(w/2,rise),.035,.035);seam.rotateZ(-s*Math.atan2(rise,w/2));seam.translate(searchX+s*w/4,h+1.7+rise/2+.04,pz);add('frame',seam);}
    }
  }
  roofLantern(.12,24,3.2);roofLantern(.47,34,3.6);roofLantern(.83,26,3.2);
  // Preserve the rounded west-side bays from GIS, with a restrained cap that
  // reads as the existing rotunda rather than adding a new cylindrical tower.
  const westBay=points.filter(p=>p[1]<minZ+depth*.34&&p[0]<minX+width*.65);
  if(westBay.length){const wx=(Math.min(...westBay.map(p=>p[0]))+Math.max(...westBay.map(p=>p[0])))/2,wz=(Math.min(...westBay.map(p=>p[1]))+Math.max(...westBay.map(p=>p[1])))/2;if(inBuilding(wx,wz)){const cap=new CylinderGeometry(Math.min(width*.09,6),Math.min(width*.13,8),1.0,24);cap.translate(wx,heightAt(wz)+.5,wz);add('roof',cap);}}
  // East-facing main arrival: broad glazed door group, shallow stone surround,
  // and a low entrance apron. Pick the actual east facade from the live ring.
  const eastEdges=points.map((a,i)=>({a,b:points[(i+1)%points.length]})).filter(({a,b})=>Math.abs(a[0]-b[0])<2&&Math.abs(a[1]-b[1])>8&&(a[0]+b[0])/2>maxX-width*.12);
  const entrance=eastEdges.sort((a,b)=>Math.abs((a.a[1]+a.b[1])/2-(minZ+depth*.55))-Math.abs((b.a[1]+b.b[1])/2-(minZ+depth*.55)))[0];
  if(entrance){const z=(entrance.a[1]+entrance.b[1])/2,x=(entrance.a[0]+entrance.b[0])/2+.12;
    plane('shade',x+.02,2.2,z,7.6,4.4,Math.PI/2);plane('glass',x+.04,2.1,z,6.7,3.8,Math.PI/2);
    for(const side of [-1,1])box('stone',x+.38,2.5,z+side*3.95,.95,5,.55);box('stone',x+.38,4.8,z,.95,.65,8.4);
    for(const n of [-2.2,0,2.2])box('frame',x+.12,2,z+n,.14,3.9,.08);box('frame',x+.12,3.2,z,.14,.09,6.7);
    box('stone',x+2,.07,z,4,.14,9.4,0,true);
    if(typeof document!=='undefined'){
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=144;const ctx=canvas.getContext('2d');
      if(ctx){ctx.fillStyle='#e7dfcb';ctx.fillRect(0,0,1024,144);ctx.fillStyle='#555c50';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='48px Georgia';ctx.fillText('VAN MUNCHING HALL',512,76,990);const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;const plate=new Mesh(new PlaneGeometry(8,1.125),new MeshStandardMaterial({map:texture,roughness:1}));plate.rotation.y=Math.PI/2;plate.position.set(x+.88,base+5.65,z);plate.name='Van Munching entrance lettering';group.add(plate);}
    }
  }
  // Mayer Mall is outside the building's eastern edge. Paths are draped to
  // the shared DEM; they do not flatten the entire district into a plaza.
  const mallX=maxX+17,clockZ=maxZ-8,clockBase=marylandElevation(mallX,clockZ)-base;
  box('paving',mallX,.035,minZ+depth*.53,4.8,.07,depth*.87,0,true);
  box('paving',maxX+11,.045,clockZ,23,.08,8.2,0,true);
  const circle=new CylinderGeometry(6.3,6.3,.12,40);circle.translate(mallX,.08,clockZ);add('stone',circle,true);
  box('stone',mallX,clockBase+.35,clockZ,2.8,.7,2.8);box('stone',mallX,clockBase+1.3,clockZ,2.2,1.3,2.2);
  box('brick',mallX,clockBase+6.8,clockZ,1.55,9.7,1.55);box('stone',mallX,clockBase+11.7,clockZ,1.95,.35,1.95);box('trim',mallX,clockBase+12.6,clockZ,1.85,1.6,1.85);box('roof',mallX,clockBase+13.5,clockZ,2.1,.20,2.1);
  for(let side=0;side<4;side++){
    const yaw=side*Math.PI/2,face:Edge={x:mallX+Math.sin(yaw)*.935,z:clockZ+Math.cos(yaw)*.935,yaw,width:1.7};
    for(let tick=0;tick<12;tick++){const a=tick*Math.PI/6;edgeBox('bronze',face,Math.sin(a)*.57,clockBase+12.6+Math.cos(a)*.57,.025,.045,.09,.025);}
    edgeBox('bronze',face,.2,clockBase+12.6,.04,.47,.055,.035);edgeBox('bronze',face,0,clockBase+12.82,.045,.055,.47,.04);
  }
  const clockWall=new Mesh(new BoxGeometry(2.8,14,2.8),collisionMaterial);clockWall.name='Mayer Mall clock tower';clockWall.position.set(mallX,base+clockBase+7,clockZ);clockWall.visible=false;clockWall.geometry.computeBoundingBox();clockWall.geometry.computeBoundingSphere();group.add(clockWall);walls.push(clockWall);
  // Quiet outdoor seating and the documented western Testudo courtyard.
  for(const fraction of [.23,.48,.73]){const z=minZ+depth*fraction;
    trees.push({x:mallX+7.8,z,radius:3.7});trees.push({x:mallX-6.7,z:z+5,radius:3.2});
    const y=marylandElevation(mallX+4,z)-base;box('wood',mallX+4,y+.55,z,1.65,.14,.52);box('wood',mallX+4,y+.9,z+.24,1.65,.64,.11);for(const dx of [-.61,.61])box('bronze',mallX+4+dx,y+.25,z,.07,.5,.45);
  }
  const court:Point=[minX+width*.30,minZ+depth*.52];
  if(!inBuilding(...court)){
    const y=marylandElevation(...court)-base;box('stone',court[0],y+.48,court[1],1.7,.96,1.4);box('trim',court[0],y+1.0,court[1],1.9,.12,1.6);
    const shell=new SphereGeometry(.66,16,10);shell.scale(1,.40,1.2);shell.translate(court[0],y+1.28,court[1]);add('bronze',shell);
    const head=new SphereGeometry(.19,10,8);head.scale(1,.7,1.4);head.translate(court[0],y+1.26,court[1]-.86);add('bronze',head);
    for(const x of [-.47,.47])for(const z of [-.48,.48]){const foot=new SphereGeometry(.16,8,6);foot.scale(1,.5,1.5);foot.translate(court[0]+x,y+1.13,court[1]+z);add('bronze',foot);}
  }
  const materials=new Map<Finish,MeshStandardMaterial>();
  for(const [key,batch]of batches){
    const geo=mergeGeometries(batch.parts,false);batch.parts.forEach(p=>p.dispose());if(!geo)throw new Error(`Could not batch Van Munching ${key}`);geo.computeBoundingBox();geo.computeBoundingSphere();
    let material=materials.get(batch.finish);if(!material){material=createCampusSurface(SURFACES[batch.finish],{yaw:0}) as MeshStandardMaterial;material.color=new Color(COLORS[batch.finish]);material.name=`Van Munching ${batch.finish}`;material.roughness=batch.finish==='glass'?.5:.92;material.polygonOffset=false;materials.set(batch.finish,material);}
    const mesh=new Mesh(geo,material);mesh.name=`Van Munching ${key}`;mesh.castShadow=!batch.surface&&batch.finish!=='glass';mesh.receiveShadow=true;group.add(mesh);visible.push(mesh);if(batch.surface)ground.push(mesh);
  }
  group.updateMatrixWorld(true);let low=false;
  return{group,ground,walls,trees,lawns:[] as {mesh:Mesh;footprints:{x:number;z:number;width:number;depth:number;yaw:number}[]}[],
    setQuality:(value:boolean)=>{low=value;visible.forEach(mesh=>{mesh.castShadow=!low&&!ground.includes(mesh)&&!mesh.name.includes('glass');});},
    update:(camera:Vector3)=>{const distance=Math.hypot(Math.max(minX-camera.x,0,camera.x-maxX),Math.max(minZ-camera.z,0,camera.z-maxZ));for(const mesh of visible)if(/:(frame|wood|bronze)$/.test(mesh.name))mesh.visible=distance<(low?240:430);},
  };
}
