import {BoxGeometry,BufferGeometry,CanvasTexture,Color,CylinderGeometry,DoubleSide,ExtrudeGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Shape,ShapeGeometry,SphereGeometry,SRGBColorSpace,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {ARIZONA_BUILDINGS,arizonaElevation,drapeArizonaGeometry} from './arizona-geography';
import {createCampusSurface} from './painterly-surfaces';

type Point=readonly [number,number];
type Building=(typeof ARIZONA_BUILDINGS)[number];
type Finish='brick'|'stone'|'trim'|'glass'|'frame'|'roof'|'shade'|'paving'|'wood'|'rust'|'leaf'|'concrete';
type Edge={x:number;z:number;yaw:number;width:number};
const COLORS:Record<Finish,string>={brick:'#a45c42',stone:'#8b8271',trim:'#d8cdb4',glass:'#496d74',frame:'#a8b4ae',roof:'#6e4540',shade:'#35433f',paving:'#c7b99d',wood:'#9dad91',rust:'#9c613e',leaf:'#627c47',concrete:'#b7b6a5'};
const SURFACES:Record<Finish,string>={brick:'brick',stone:'limestone',trim:'trim',glass:'glass',frame:'metal',roof:'metal',shade:'interiorShade',paving:'pavement',wood:'benchWood',rust:'metal',leaf:'trim',concrete:'limestone'};
export const ARIZONA_LANDMARK_IDS=new Set(['arizona-old-main-building','arizona-eller-building',...ARIZONA_BUILDINGS.filter(b=>b.sourceId==='137'||b.id.startsWith('arizona-enr2-building')).map(b=>b.id)]);
const area=(ring:readonly Point[])=>ring.reduce((v,p,i)=>{const q=ring[(i+1)%ring.length];return v+p[0]*q[1]-q[0]*p[1];},0)/2;
function tidy(ring:readonly Point[],clockwise=true){const result=ring.map(p=>[p[0],p[1]] as Point);if(result.length>3&&Math.hypot(result[0][0]-result.at(-1)![0],result[0][1]-result.at(-1)![1])<.01)result.pop();if((area(result)<0)!==clockwise)result.reverse();return result;}
function shapeFor(points:readonly Point[],holes:readonly (readonly Point[])[]=[]){const shape=new Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();for(const ring of holes){const path=new Path();ring.forEach(([x,z],i)=>i?path.lineTo(x,-z):path.moveTo(x,-z));path.closePath();shape.holes.push(path);}return shape;}
function extent(points:readonly Point[]){const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);return{minX,maxX,minZ,maxZ,width:maxX-minX,depth:maxZ-minZ,x:(minX+maxX)/2,z:(minZ+maxZ)/2};}
const rectangle=(x:number,z:number,w:number,d:number)=>tidy([[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]);
function offsetRing(points:Point[],distance:number):Point[]{return points.map((p,i)=>{const previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length],a=[p[0]-previous[0],p[1]-previous[1]],b=[next[0]-p[0],next[1]-p[1]],al=Math.hypot(...a)||1,bl=Math.hypot(...b)||1,n1=[-a[1]/al,a[0]/al],n2=[-b[1]/bl,b[0]/bl],sx=n1[0]+n2[0],sz=n1[1]+n2[1],dot=sx*n1[0]+sz*n1[1],scale=Math.abs(dot)>.1?distance/dot:distance;return[p[0]+sx*scale,p[1]+sz*scale];});}

/** Exterior architectural interpretations, fitted to the shared campus GIS.
 * Old Main's shaded veranda/central west tower, Eller's outdoor court and
 * ENR2's canyon balconies are drawn from official photographs and floor plans.
 * Heights, small details and interior courtyard planting are authored, not a
 * laser scan. Photographs remain source references, not runtime textures.
 */
export function createArizonaLandmarks(_wind?:{value:number}){
  const group=new Group();group.name='Arizona · Old Main, Eller and ENR2';
  const ground:Mesh[]=[],walls:Mesh[]=[],trees:{x:number;z:number;radius:number}[]=[],visible:Mesh[]=[];
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[];center:Point}>();
  let base=0,buildingId='',center:Point=[0,0];
  const collisionMaterial=new MeshBasicMaterial({side:DoubleSide});
  const add=(finish:Finish,geometry:BufferGeometry,surface=false,detail=false)=>{
    geometry.translate(0,base,0);const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${buildingId}:${surface?'ground':detail?'detail':'building'}:${finish}`,batch=batches.get(key)??{finish,surface,parts:[],center};batch.parts.push(part);batches.set(key,batch);
  };
  const box=(f:Finish,x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,surface=false,detail=false)=>{if(Math.min(w,h,d)<=0)return;const g=new BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,y,z);add(f,g,surface,detail);};
  const paving=(x:number,z:number,w:number,d:number,yaw=0)=>{const source=new BoxGeometry(w,.10,d);source.rotateY(yaw);source.translate(x,.05,z);const geometry=drapeArizonaGeometry(source,6);source.dispose();geometry.translate(0,-base,0);add('paving',geometry,true);};
  const plane=(f:Finish,x:number,y:number,z:number,w:number,h:number,yaw=0,detail=false)=>{const g=new PlaneGeometry(w,h);g.rotateY(yaw);g.translate(x,y,z);add(f,g,false,detail);};
  const edge=(a:Point,b:Point):Edge=>({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(a[1]-b[1],b[0]-a[0]),width:Math.hypot(a[0]-b[0],a[1]-b[1])});
  const point=(e:Edge,x:number,z=0):Point=>[e.x+x*Math.cos(e.yaw)+z*Math.sin(e.yaw),e.z-x*Math.sin(e.yaw)+z*Math.cos(e.yaw)];
  const eb=(f:Finish,e:Edge,x:number,y:number,z:number,w:number,h:number,d:number,detail=false)=>{const p=point(e,x,z);box(f,p[0],y,p[1],w,h,d,e.yaw,false,detail);};
  const ep=(f:Finish,e:Edge,x:number,y:number,z:number,w:number,h:number,detail=false)=>{const p=point(e,x,z);plane(f,p[0],y,p[1],w,h,e.yaw,detail);};
  const polygon=(f:Finish,points:readonly Point[],holes:readonly (readonly Point[])[],y:number,surface=false)=>{const g=new ShapeGeometry(shapeFor(points,holes));g.rotateX(-Math.PI/2);g.translate(0,y,0);add(f,g,surface);};
  const collision=(points:Point[],holes:Point[][],height:number,name:string,bottom=-.5)=>{const g=new ExtrudeGeometry(shapeFor(points,holes),{depth:height-bottom,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);g.translate(0,base+bottom,0);g.computeBoundingBox();g.computeBoundingSphere();const m=new Mesh(g,collisionMaterial);m.visible=false;m.name=name;m.userData.campusFootprint=points;m.userData.campusHoles=holes;group.add(m);walls.push(m);};
  const column=(f:Finish,x:number,z:number,radius:number,bottom:number,top:number,collide=false)=>{const g=new CylinderGeometry(radius,radius,top-bottom,12);g.translate(x,(top+bottom)/2,z);add(f,g);if(collide){const c=new Mesh(new CylinderGeometry(radius,radius,top-bottom,12),collisionMaterial);c.position.set(x,base+(top+bottom)/2,z);c.visible=false;c.name=`${buildingId} column`;c.geometry.computeBoundingBox();c.geometry.computeBoundingSphere();group.add(c);walls.push(c);}};
  const roofHip=(x:number,z:number,w:number,d:number,y:number,rise:number,flat=.38)=>{
    const p=[[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2]],q=[[x-w*flat/2,y+rise,z-d*flat/2],[x+w*flat/2,y+rise,z-d*flat/2],[x+w*flat/2,y+rise,z+d*flat/2],[x-w*flat/2,y+rise,z+d*flat/2]],v:number[]=[];
    for(let i=0;i<4;i++){const j=(i+1)%4;for(const t of [[p[i],q[i],p[j]],[p[j],q[i],q[j]]])for(const a of t)v.push(...a);}for(const t of [[q[0],q[3],q[2]],[q[0],q[2],q[1]]])for(const a of t)v.push(...a);
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(v,3));g.computeVertexNormals();add('roof',g);
    box('trim',x,y-.12,z,w+.4,.24,d+.4);
  };
  const label=(text:string,x:number,y:number,z:number,width:number,yaw=0)=>{
    if(typeof document==='undefined')return;const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=112;const context=canvas.getContext('2d');if(!context)return;
    context.fillStyle='#dbd0b7';context.fillRect(0,0,1024,112);context.fillStyle='#494b40';context.textAlign='center';context.textBaseline='middle';context.font='48px Georgia';context.fillText(text,512,58,980);
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;const m=new Mesh(new PlaneGeometry(width,width*112/1024),new MeshStandardMaterial({map:texture,roughness:1,side:DoubleSide}));m.position.set(x,base+y,z);m.rotation.y=yaw;m.name=`${buildingId} lettering`;group.add(m);
  };
  function openingsFacade(e:Edge,height:number,rows:number,finish:Finish='brick',bottom=0,modern=false){
    if(e.width<.15)return;const floor=height/rows,spacing=modern?4.7:3.7,count=Math.max(0,Math.floor((e.width-.9)/spacing)),ww=modern?2.3:1.25,wh=Math.min(2.45,floor*.64),openings:{x:number;y:number}[]=[];
    for(let row=0;row<rows;row++)for(let col=0;col<count;col++)openings.push({x:(col-(count-1)/2)*e.width/(count+.65),y:bottom+.65+row*floor});
    const shape=new Shape();shape.moveTo(-e.width/2,bottom-.9);shape.lineTo(e.width/2,bottom-.9);shape.lineTo(e.width/2,bottom+height);shape.lineTo(-e.width/2,bottom+height);shape.closePath();
    for(const o of openings){const h=new Path();h.moveTo(o.x-ww/2,o.y);h.lineTo(o.x-ww/2,o.y+wh);h.lineTo(o.x+ww/2,o.y+wh);h.lineTo(o.x+ww/2,o.y);h.closePath();shape.holes.push(h);}
    const g=new ExtrudeGeometry(shape,{depth:.42,bevelEnabled:false,curveSegments:1});g.translate(0,0,-.42);g.rotateY(e.yaw);g.translate(e.x,0,e.z);add(finish,g);
    for(const o of openings){ep('shade',e,o.x,o.y+wh/2,-.40,ww,wh);ep('glass',e,o.x,o.y+wh/2,-.34,ww-.08,wh-.08);eb('trim',e,o.x,o.y-.04,.03,ww+.20,.13,.54,true);eb('trim',e,o.x,o.y+wh+.08,.03,ww+.24,.17,.54,true);for(const side of [-1,1])eb('frame',e,o.x+side*ww/2,o.y+wh/2,-.22,.065,wh,.16,true);eb('frame',e,o.x,o.y+wh*.45,-.20,ww,.055,.13,true);}
    eb('trim',e,0,bottom+height-.15,.03,e.width+.1,.30,.62);
  }
  function arch(e:Edge,x:number,bottom:number,w:number,h:number){
    const shape=new Shape();shape.moveTo(-w/2,0);shape.lineTo(-w/2,h-w/2);shape.absarc(0,h-w/2,w/2,Math.PI,0,true);shape.lineTo(w/2,0);shape.closePath();const g=new ShapeGeometry(shape);g.rotateY(e.yaw);const p=point(e,x,.29);g.translate(p[0],bottom,p[1]);add('shade',g);
    for(let i=0;i<12;i++){const a=(i+.5)*Math.PI/12,px=x+Math.cos(a)*(w/2+.12),py=bottom+h-w/2+Math.sin(a)*(w/2+.12);const q=point(e,px,.32);const voussoir=new BoxGeometry(.21,w*Math.PI/24+.05,.28);voussoir.rotateZ(Math.PI/2-a);voussoir.rotateY(e.yaw);voussoir.translate(q[0],py,q[1]);add('trim',voussoir,false,true);}
    for(const side of [-1,1])eb('trim',e,x+side*(w/2+.12),bottom+(h-w/2)/2,.32,.23,h-w/2,.3,true);
  }
  function oldMain(b:Building){
    // Official ground GIS distinguishes the cruciform enclosed body from
    // dozens of isolated veranda columns. Do not shrink the surveyed body.
    const body=tidy(b.footprint),bodyBounds=extent(body),cx=bodyBounds.x,cz=bodyBounds.z;
    // The sub-metre stair-door projections in the ground source do not change
    // the veranda roof. Offset its principal cross, avoiding self-intersections
    // from trying to expand each tiny door reveal by three metres.
    const rx=bodyBounds.width/2,rz=bodyBounds.depth/2,sx=bodyBounds.width*.177,sz=bodyBounds.depth*.23;
    const porchInner=tidy([[cx-sx,cz-rz],[cx+sx,cz-rz],[cx+sx,cz-sz],[cx+rx,cz-sz],[cx+rx,cz+sz],[cx+sx,cz+sz],[cx+sx,cz+rz],[cx-sx,cz+rz],[cx-sx,cz+sz],[cx-rx,cz+sz],[cx-rx,cz-sz],[cx-sx,cz-sz]]),outer=offsetRing(porchInner,3.25),bounds=extent(outer);
    const inner=extent(body),floor=2.65,wallTop=8.3,porchRoof=6.55;
    polygon('paving',outer,[tidy(body,false)],floor,true);
    for(let i=0;i<body.length;i++){const e=edge(body[i],body[(i+1)%body.length]);openingsFacade(e,2.25,1,'stone',-.4);openingsFacade(e,5.65,1,'brick',floor);eb('trim',e,0,floor-.13,.03,e.width,.24,.62);}
    polygon('roof',body,[],wallTop);collision(body,[],wallTop,'Old Main enclosed brick rooms');
    // Sloping veranda roof, perimeter posts, brackets and open pale rails.
    const v:number[]=[];
    for(let i=0;i<outer.length;i++){const j=(i+1)%outer.length,a=outer[i],c=outer[j],p=porchInner[i],q=porchInner[j];for(const tri of [[[a[0],porchRoof,a[1]],[p[0],porchRoof+.9,p[1]],[c[0],porchRoof,c[1]]],[[c[0],porchRoof,c[1]],[p[0],porchRoof+.9,p[1]],[q[0],porchRoof+.9,q[1]]]])for(const p of tri)v.push(...p);
      const e=edge(a,c),count=Math.max(1,Math.round(e.width/3.3));
      eb('trim',e,0,porchRoof-.08,0,e.width,.20,.25);
      for(let n=0;n<count;n++){const px=-e.width/2+n*e.width/count,p=point(e,px,-.14);if(Math.abs(p[1]-cz)<3&&p[0]<cx)continue;column('wood',p[0],p[1],.13,floor,porchRoof,true);eb('trim',e,px,porchRoof-.2,-.14,.42,.30,.42,true);eb('trim',e,px,floor+.12,-.14,.32,.23,.32,true);}
      const west=Math.abs(e.x-bounds.minX)<1.5;
      for(let n=0;n<Math.floor(e.width/.42);n++){const px=-e.width/2+(n+.5)*.42,p=point(e,px);if(west&&Math.abs(p[1]-cz)<3.2)continue;eb('wood',e,px,floor+.52,0,.055,.92,.055,true);}
      if(!west||e.width<9){eb('wood',e,0,floor+1,0,e.width,.09,.10,true);eb('wood',e,0,floor+.12,0,e.width,.11,.10,true);}
      else for(const side of [-1,1]){const width=(e.width-6.4)/2;if(width>0){eb('wood',e,side*(e.width+6.4)/4,floor+1,0,width,.09,.10,true);eb('wood',e,side*(e.width+6.4)/4,floor+.12,0,width,.11,.10,true);}}
    }
    const veranda=new BufferGeometry();veranda.setAttribute('position',new Float32BufferAttribute(v,3));veranda.computeVertexNormals();add('roof',veranda);
    // Two crossing mansard volumes follow Old Main's cruciform plan. A full
    // bounding-box roof would cover the open recessed veranda corners.
    roofHip(cx,cz,inner.width*.37,inner.depth+.6,wallTop+.2,3.1,.72);
    roofHip(cx,cz,inner.width+.6,inner.depth*.46,wallTop+.2,3.1,.72);
    // Central west entry tower with paired arched upper lights and steep cap.
    const towerW=Math.min(7.5,inner.width*.38),towerD=Math.min(8.8,inner.depth*.22),towerX=inner.minX+towerW/2-3.25;
    const tower=rectangle(towerX,cz,towerW,towerD);for(let i=0;i<4;i++){const e=edge(tower[i],tower[(i+1)%4]);eb('brick',e,0,7.15,0,e.width,14.3,.48);eb('trim',e,0,13.85,.05,e.width+.30,.34,.62);if(e.x<towerX-.1){arch(e,0,floor,2.45,4.3);for(const x of [-1.05,1.05])arch(e,x,9.1,1.4,2.35);}}
    roofHip(towerX,cz,towerW+.65,towerD+.65,14.4,4.2,.04);collision(tower,[],14.4,'Old Main west entry tower');
    // A low-step exterior stair meets the veranda. Its risers remain under
    // 18cm, with collisions only at solid posts and enclosed rooms.
    const steps=16,run=8.0,stairX=bounds.minX-1.2;
    for(let n=0;n<steps;n++){const h=floor*(n+1)/steps,x=stairX-run+(n+.5)*run/steps;box('paving',x,h/2,cz,run/steps+.015,h,5.2,0,true);}
    box('paving',bounds.minX-.55,floor-.08,cz,1.25,.16,5.2,0,true);
    for(const side of [-1,1]){const angle=Math.atan2(floor,run),g=new BoxGeometry(Math.hypot(run,floor),.07,.07);g.rotateZ(angle);g.translate(stairX-run/2,floor/2+1,cz+side*2.63);add('frame',g,false,true);for(let n=0;n<5;n++)column('frame',stairX-run+n*run/4,cz+side*2.63,.04,floor*n/4,floor*n/4+1.05);}
    // Small dormer gables on both long roof slopes.
    for(const side of [-1,1])for(const t of [-.32,.32]){const x=cx+side*inner.width*.17,z=cz+inner.depth*t;box('trim',x,9.5,z,1.2,1.8,2.0);const e:Edge={x:x+side*.62,z,yaw:side*Math.PI/2,width:2};arch(e,0,8.9,1.05,1.45);roofHip(x,z,1.45,2.3,10.4,.75,.05);}
    label('OLD MAIN',towerX-towerW/2-.26,7.55,cz,3.8,-Math.PI/2);
    group.userData.oldMainVeranda={floorHeight:base+floor,stairPosition:[bounds.minX-5,cz],masonryFootprint:body};
  }
  function eller(b:Building){
    const points=tidy(b.footprint),bounds=extent(points),holes=(b.holes??[]).map(h=>tidy(h,false));
    // The actual GIS ring includes the south-open Witt courtyard. Never add
    // an enclosing south wing or fill this concavity with a rectangular roof.
    const height=16.3,candidates=points.map((p,i)=>edge(p,points[(i+1)%points.length])).filter(e=>e.z>bounds.maxZ-bounds.depth*.18&&Math.abs(Math.cos(e.yaw))>.8&&e.width>10),entry=candidates.sort((a,b)=>Math.abs(a.x-bounds.x)-Math.abs(b.x-bounds.x))[0];
    for(const ring of [points,...holes])for(let i=0;i<ring.length;i++){
      const e=edge(ring[i],ring[(i+1)%ring.length]),entranceFace=entry&&Math.hypot(e.x-entry.x,e.z-entry.z)<.1;
      if(entranceFace)openingsFacade(e,height-8.5,2,'brick',8.5,true);else openingsFacade(e,height,4,'brick',0,true);
      for(const y of [4.1,8.15,12.2])if(!entranceFace||y>8.5)eb('trim',e,0,y,.10,e.width,.28,.70);
      // Eller's upper storey is paler than the red brick lower wings.
      eb('trim',e,0,height-.9,.045,e.width,1.0,.52);eb('concrete',e,0,height+.2,.16,e.width+.25,.34,.92);
    }
    polygon('concrete',points,holes,height+.35);collision(points,holes,height+.4,'Eller McClelland Hall courtyard-preserving footprint');
    // Broad shaded south entrance with paired silver supports and deep glass.
    if(entry){const w=Math.min(25,entry.width-1),depth=5.4;
      ep('shade',entry,0,4.2,.06,w,8.4);ep('glass',entry,0,4.1,.10,w-.3,8.0);
      for(let x=-w/2;x<w/2+.1;x+=2.4)eb('frame',entry,x,4.1,.22,.08,8.1,.12,true);
      for(const y of [1.3,2.7,4.1,5.5,6.9,8.1])eb('frame',entry,0,y,.23,w,.065,.13,true);
      eb('concrete',entry,0,8.55,depth/2,w+2,.5,depth+1.4);
      for(const x of [-w*.40,w*.40]){const p=point(entry,x,depth-.7);column('frame',p[0],p[1],.32,.12,8.4,true);column('trim',p[0],p[1],.47,.04,.28);}
      const p=point(entry,0,depth/2);paving(p[0],p[1],w+4,depth+2,entry.yaw);
      const p2=point(entry,0,.44);label('ELLER COLLEGE OF MANAGEMENT',p2[0],9.2,p2[1],Math.min(17,w),entry.yaw);
      for(const s of [-1,1]){const p=point(entry,s*(w/2+3),depth+1);box('concrete',p[0],.30,p[1],4.1,.6,1.2,entry.yaw);box('wood',p[0],.66,p[1],3.65,.12,.75,entry.yaw,false,true);}
    }
    for(const hole of holes){polygon('paving',tidy(hole),[],.09,true);const c=extent(hole);for(const fraction of [-.24,.24]){box('stone',c.x+c.width*fraction,.35,c.z,2.2,.7,2.2);const g=new SphereGeometry(1.7,8,6);g.scale(1,.55,1);g.translate(c.x+c.width*fraction,1.2,c.z);add('leaf',g,false,true);}}
    group.userData.ellerCourtyard=holes;
  }
  function enr2(_b:Building){
    const wings=ARIZONA_BUILDINGS.filter(b=>b.sourceId==='137'||b.id.startsWith('arizona-enr2-building')),bounds=extent(wings.flatMap(b=>b.footprint)),height=21.2;
    // The official ground-level footprint has FIVE separate curved wings.
    // Model each surveyed ring; the empty middle and the side passages are
    // left empty rather than punching an invented oval out of a solid box.
    const campusBase=base;for(const wing of wings){base=arizonaElevation(wing.x,wing.z);const points=tidy(wing.footprint),holes=(wing.holes??[]).map(h=>tidy(h,false)),wingBounds=extent(points);
      for(let i=0;i<points.length;i++){
        const e=edge(points[i],points[(i+1)%points.length]),toward=(bounds.x-e.x)*Math.sin(e.yaw)+(bounds.z-e.z)*Math.cos(e.yaw),inner=toward>1;
        openingsFacade(e,height,5,'concrete',0,true);
        for(let floor=0;floor<5;floor++){
          const y=.12+floor*4.2,overhang=floor===0?.20:inner?2.1:1.05;
          if(floor>0)eb('concrete',e,0,y-.12,overhang/2,e.width+.06,.26,overhang+.25);
          const count=Math.max(1,Math.floor(e.width/(inner?.50:.78)));
          for(let n=0;n<count;n++)eb('rust',e,(n+.5)*e.width/count-e.width/2,y+(inner?1.06:2),overhang, .085,inner?2.0:3.85,inner?.56:.90,true);
          if(inner&&floor>0&&i%5===0){const p=point(e,0,overhang+.15);for(let vine=0;vine<3;vine++){const leaf=new SphereGeometry(.46,6,5);leaf.scale(.85,1.7+.25*vine,.75);leaf.translate(p[0]+Math.cos(e.yaw)*(vine-1)*.7,y-.6-vine*.23,p[1]-Math.sin(e.yaw)*(vine-1)*.7);add('leaf',leaf,false,true);}}
        }
      }
      polygon('concrete',points,holes,height+.08);collision(points,holes,height,`ENR2 surveyed curved wing ${wing.id}`);
      // Small rooftop plant beds stay on the wing itself, never across sky.
      if(wingBounds.width>12&&wingBounds.depth>12){box('concrete',wingBounds.x,height+.32,wingBounds.z,4.3,.50,2.1);for(let k=0;k<3;k++){const leaf=new SphereGeometry(.75,7,5);leaf.scale(1,.7,.8);leaf.translate(wingBounds.x-1.2+k*1.2,height+.9,wingBounds.z);add('leaf',leaf,false,true);}}
    }
    base=campusBase;const z=bounds.z,width=bounds.width;
    // Open-air upper galleries join the north and south rooms at each end.
    // Their first deck is above pedestrian headroom; the ground remains open.
    for(const side of [-1,1]){const x=bounds.x+side*(width/2-1.6);for(let floor=1;floor<5;floor++){const y=.12+floor*4.2;box('concrete',x,y-.15,z,3.5,.30,bounds.depth*.43);for(const edgeSide of [-1,1]){box('rust',x+edgeSide*1.7,y+1.05,z,.07,.075,bounds.depth*.43);for(let dz=-bounds.depth*.215;dz<bounds.depth*.215;dz+=.6)box('rust',x+edgeSide*1.7,y+.55,z+dz,.075,1.05,.15,0,false,true);}}}
    paving(bounds.x,z,width+3,5.4);
    for(const fraction of [-.24,.24]){const x=bounds.x+width*fraction;box('concrete',x,.35,z-4.8,4.5,.7,1.25);box('wood',x,.73,z-4.8,4.2,.08,1.05,0,false,true);}
    label('ENVIRONMENT + NATURAL RESOURCES 2',bounds.maxX+.65,4.0,z,12,Math.PI/2);
    group.userData.enr2Canyon={wingFootprints:wings.map(b=>b.footprint),entry:[bounds.maxX+2,z],center:[bounds.x,z],source:'official multipart ground outline'};
  }
  let enr2Built=false;for(const b of ARIZONA_BUILDINGS){if(!ARIZONA_LANDMARK_IDS.has(b.id))continue;base=arizonaElevation(b.x,b.z);buildingId=b.id;center=[b.x,b.z];if(b.id.includes('old-main'))oldMain(b);else if(b.id.includes('eller'))eller(b);else if(!enr2Built){enr2(b);enr2Built=true;}}
  const materials=new Map<Finish,MeshStandardMaterial>();
  for(const [key,batch] of batches){const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(g=>g.dispose());if(!geometry)throw new Error(`Arizona landmark batch ${key} failed`);geometry.computeBoundingBox();geometry.computeBoundingSphere();let material=materials.get(batch.finish);if(!material){material=createCampusSurface(SURFACES[batch.finish],{yaw:0}) as MeshStandardMaterial;material.color=new Color(COLORS[batch.finish]);material.roughness=batch.finish==='glass'?.4:.93;material.side=DoubleSide;material.polygonOffset=false;material.name=`Arizona landmark ${batch.finish}`;materials.set(batch.finish,material);}const mesh=new Mesh(geometry,material);mesh.name=key;mesh.userData.landmarkCenter=batch.center;mesh.castShadow=!batch.surface&&batch.finish!=='glass';mesh.receiveShadow=true;group.add(mesh);visible.push(mesh);if(batch.surface)ground.push(mesh);}
  group.updateMatrixWorld(true);let low=false;
  return{group,ground,walls,trees,lawns:[] as {mesh:Mesh;footprints:{x:number;z:number;width:number;depth:number;yaw:number}[]}[],
    setQuality:(value:boolean)=>{low=value;for(const mesh of visible)mesh.castShadow=!low&&!ground.includes(mesh)&&!mesh.name.endsWith(':glass');},
    update:(camera:Vector3)=>{for(const mesh of visible){const c=mesh.userData.landmarkCenter as Point;mesh.visible=!mesh.name.includes(':detail:')||Math.hypot(camera.x-c[0],camera.z-c[1])<(low?180:380);}},
  };
}
