import {BoxGeometry,BufferGeometry,CanvasTexture,Color,CylinderGeometry,ExtrudeGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Quaternion,Shape,ShapeGeometry,SRGBColorSpace,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {UMD_FULL_BUILDINGS,UMD_FULL_BOUNDS,UMD_FULL_PATHS,UMD_FULL_SPACES} from './maryland-full-layout';
import {marylandElevation,drapeMarylandGeometry} from './maryland-terrain';
import {createMarylandBusinessDistrict} from './maryland-business-detail';
import {createMarylandEngineeringDistrict,MARYLAND_ENGINEERING_DETAIL_IDS} from './maryland-engineering-detail';

type Finish='brick'|'brickLight'|'stone'|'concrete'|'trim'|'roof'|'glass'|'glassLight'|'frame'|'shade'|'wood'|'paving'|'grass'|'track'|'red'|'white';
type Placement={x:number;z:number;yaw:number};
type Point=readonly [number,number];
type Building=(typeof UMD_FULL_BUILDINGS)[number];
type Opening={x:number;bottom:number;width:number;height:number;door?:boolean};
const UP=new Vector3(0,1,0),UNIT=new Vector3(1,1,1);
const ORIGIN:Placement={x:0,z:0,yaw:0};
const CELL=240;
const DETAILED_BUILDINGS=new Set<string>(['039',...MARYLAND_ENGINEERING_DETAIL_IDS]);

/** Outdoor campus architecture follows the official Facilities footprint data.
 * Heights, facade rhythm and roof details are authored, compressed game models;
 * the scene intentionally does not claim measured interiors or a survey model.
 */
export function createMarylandFullCampus(_wind:{value:number}) {
  const group=new Group();group.name='Maryland · complete campus districts';
  const ground:Mesh[]=[],walls:Mesh[]=[],shadowMeshes:Mesh[]=[];
  const trees:{x:number;z:number;radius:number}[]=[];
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>();
  const transform=new Matrix4(),rotation=new Quaternion(),position=new Vector3();
  const invisible=new MeshBasicMaterial();invisible.name='UMD district collision';
  let zone='0:0';
  // A building is rigid and horizontal on its terrain platform. Outdoor
  // surfaces, markings and kerbs follow the shared elevation field instead.
  let buildingBaseY:number|undefined;
  const zoneAt=(x:number,z:number)=>`${Math.floor(x/CELL)}:${Math.floor(z/CELL)}`;
  const local=(p:Placement,x:number,z:number)=>({x:p.x+x*Math.cos(p.yaw)+z*Math.sin(p.yaw),z:p.z-x*Math.sin(p.yaw)+z*Math.cos(p.yaw)});
  const shifted=(p:Placement,x:number,z:number):Placement=>({...local(p,x,z),yaw:p.yaw});
  const put=(finish:Finish,geometry:BufferGeometry,x:number,y:number,z:number,yaw=0,surface=false)=>{
    rotation.setFromAxisAngle(UP,yaw);position.set(x,y,z);transform.compose(position,rotation,UNIT);geometry.applyMatrix4(transform);
    if(surface||buildingBaseY===undefined){
      const source=geometry;
      // The common 12.5m height lattice already defines the exact terrain.
      // Extra subdivisions inside a planar cell add no silhouette detail.
      geometry=drapeMarylandGeometry(source,surface&&finish==='grass'?24:12);source.dispose();
    }
    else geometry.translate(0,buildingBaseY,0);
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${zone}:${surface?'ground':'building'}:${finish}`,batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const box=(f:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number,d:number,surface=false)=>{
    if(w<=0||h<=0||d<=0)return;const at=local(p,x,z);put(f,new BoxGeometry(w,h,d),at.x,y,at.z,p.yaw,surface);
  };
  const plane=(f:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number)=>{
    const at=local(p,x,z);put(f,new PlaneGeometry(w,h),at.x,y,at.z,p.yaw);
  };
  const collider=(name:string,p:Placement,w:number,h:number,d:number,bottom=0)=>{
    const mesh=new Mesh(new BoxGeometry(w,h,d),invisible);mesh.name=name;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();mesh.position.set(p.x,(buildingBaseY??marylandElevation(p.x,p.z))+bottom+h/2,p.z);mesh.rotation.y=p.yaw;mesh.visible=false;group.add(mesh);walls.push(mesh);
  };
  const beam=(f:Finish,p:Placement,a:[number,number,number],b:[number,number,number],width:number,depth=width)=>{
    const av=new Vector3(...a),bv=new Vector3(...b),direction=bv.sub(av),g=new BoxGeometry(width,direction.length(),depth);g.applyQuaternion(new Quaternion().setFromUnitVectors(UP,direction.normalize()));const at=local(p,(a[0]+b[0])/2,(a[2]+b[2])/2);put(f,g,at.x,(a[1]+b[1])/2,at.z,p.yaw);
  };
  const rod=(f:Finish,p:Placement,x:number,y:number,z:number,r:number,h:number,segments=8)=>{
    const at=local(p,x,z);put(f,new CylinderGeometry(r,r,h,segments),at.x,y,at.z,p.yaw);
  };
  const polygon=(b:Building):Point[]=>{
    const footprint=(b as Building&{footprint?:Point[]}).footprint;
    const points=footprint?.length&&footprint.length>=3?footprint.map(p=>[p[0],p[1]] as Point):[[-b.width/2,-b.depth/2],[b.width/2,-b.depth/2],[b.width/2,b.depth/2],[-b.width/2,b.depth/2]].map(([x,z])=>{const at=local(b,x,z);return[at.x,at.z] as Point;});
    if(points.length>3&&Math.hypot(points[0][0]-points.at(-1)![0],points[0][1]-points.at(-1)![1])<.01)points.pop();
    let area=0;for(let i=0;i<points.length;i++){const a=points[i],c=points[(i+1)%points.length];area+=a[0]*c[1]-c[0]*a[1];}if(area>0)points.reverse();return points;
  };
  const edge=(a:Point,b:Point):Placement=>({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(a[1]-b[1],b[0]-a[0])});
  const edgeLength=(a:Point,b:Point)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
  const footprintCollider=(b:Building,points:Point[])=>{
    const shape=new Shape(),c=Math.cos(b.yaw),s=Math.sin(b.yaw);
    points.forEach(([x,z],i)=>{const dx=x-b.x,dz=z-b.z,lx=dx*c-dz*s,lz=dx*s+dz*c;i?shape.lineTo(lx,-lz):shape.moveTo(lx,-lz);});shape.closePath();
    for(const ring of b.holes??[]){const hole=new Path();ring.forEach(([x,z],i)=>{const dx=x-b.x,dz=z-b.z,lx=dx*c-dz*s,lz=dx*s+dz*c;i?hole.lineTo(lx,-lz):hole.moveTo(lx,-lz);});hole.closePath();shape.holes.push(hole);}
    const geometry=new ExtrudeGeometry(shape,{depth:b.height,bevelEnabled:false,steps:1,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,invisible);mesh.name=b.name;mesh.position.set(b.x,buildingBaseY??marylandElevation(b.x,b.z),b.z);mesh.rotation.y=b.yaw;mesh.visible=false;mesh.userData.campusFootprint=points;group.add(mesh);walls.push(mesh);
  };
  const pathSegments=UMD_FULL_PATHS.flatMap(path=>path.slice(1).map((b,i)=>({a:path[i],b})));
  const segmentDistance=(x:number,z:number,a:Point,b:Point)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);};
  const pathDistance=(x:number,z:number)=>Math.min(...pathSegments.map(({a,b})=>segmentDistance(x,z,a,b)));
  const outerCore=(x:number,z:number)=>Math.abs(x)>315||Math.abs(z)>335;
  const inBuilding=(x:number,z:number,margin=0)=>UMD_FULL_BUILDINGS.some(b=>{const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw),s=Math.sin(b.yaw);return Math.abs(dx*c-dz*s)<b.width/2+margin&&Math.abs(dx*s+dz*c)<b.depth/2+margin;});
  const inSportsOrFarm=(x:number,z:number)=>UMD_FULL_SPACES.some(s=>{
    if(!['field','track','baseball','softball','hockey','farm'].includes(s.kind))return false;const dx=x-s.x,dz=z-s.z,c=Math.cos(s.yaw),sn=Math.sin(s.yaw);return Math.abs(dx*c-dz*sn)<s.width/2+3&&Math.abs(dx*sn+dz*c)<s.depth/2+3;
  });
  const tree=(x:number,z:number,radius=4.5)=>{
    if(!outerCore(x,z)||inBuilding(x,z,7)||inSportsOrFarm(x,z)||pathDistance(x,z)<6||trees.some(t=>Math.hypot(t.x-x,t.z-z)<11))return;
    trees.push({x,z,radius});
  };
  const textPlate=(p:Placement,text:string,width:number,y:number,z:number)=>{
    if(typeof document==='undefined')return;const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=160;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#e7dfc9';ctx.fillRect(0,0,1536,160);ctx.fillStyle='#555d52';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='500 62px Georgia, serif';ctx.fillText(text.toUpperCase(),768,82,1460);
    const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;map.anisotropy=2;const mesh=new Mesh(new PlaneGeometry(width,width*160/1536),new MeshStandardMaterial({map,roughness:1}));const at=local(p,0,z);mesh.position.set(at.x,y+(buildingBaseY??marylandElevation(at.x,at.z)),at.z);mesh.rotation.y=p.yaw;mesh.name=`Campus nameplate · ${text}`;group.add(mesh);
  };
  const scoreboard=(p:Placement,width:number,y:number,z:number)=>{
    if(typeof document==='undefined')return;const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=320;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#282e30';ctx.fillRect(0,0,1024,320);ctx.fillStyle='#a94135';ctx.fillRect(0,0,1024,70);ctx.fillStyle='#f3dfbb';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 44px Georgia, serif';ctx.fillText('MARYLAND TERRAPINS',512,38);ctx.font='36px Georgia, serif';ctx.fillText('HOME',190,116);ctx.fillText('GUEST',834,116);ctx.font='78px monospace';ctx.fillText('00',190,200);ctx.fillText('00',834,200);ctx.font='64px monospace';ctx.fillText('00:00',512,194);ctx.font='28px Georgia, serif';ctx.fillText('COLLEGE PARK',512,282);
    const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;const mesh=new Mesh(new PlaneGeometry(width,width*320/1024),new MeshStandardMaterial({map,roughness:.8,emissive:'#695d47',emissiveIntensity:.12}));const at=local(p,0,z);mesh.position.set(at.x,y+(buildingBaseY??marylandElevation(at.x,at.z)),at.z);mesh.rotation.y=p.yaw;mesh.name='Maryland stadium scoreboard';group.add(mesh);
  };
  const roofPlane=(points:Point[],height:number,finish:Finish='roof',holes:Point[][]=[])=>{
    const shape=new Shape();points.forEach((p,i)=>i?shape.lineTo(p[0],-p[1]):shape.moveTo(p[0],-p[1]));shape.closePath();
    for(const ring of holes){const hole=new Path();ring.forEach((p,i)=>i?hole.lineTo(p[0],-p[1]):hole.moveTo(p[0],-p[1]));hole.closePath();shape.holes.push(hole);}
    const geo=new ShapeGeometry(shape);geo.rotateX(-Math.PI/2);put(finish,geo,0,height,0);
  };
  const corniceEdge=(p:Placement,width:number,height:number,modern=false)=>{
    box(modern?'frame':'stone',p,0,height-.35,.03,width,.20,.49);box(modern?'frame':'trim',p,0,height-.08,.12,width+.08,.25,.68);
  };
  const window=(p:Placement,o:Opening,modern:boolean)=>{
    const finish=modern?'glassLight':'glass';plane(finish,p,o.x,o.bottom+o.height/2,-.42,o.width,o.height);
    // The masonry is cut away; pale, thin sills project out while the glazing
    // stays 42cm behind the facade, giving the small windows real parallax.
    box(modern?'frame':'stone',p,o.x,o.bottom-.055,.04,o.width+.19,.11,.54);
    plane('frame',p,o.x,o.bottom+o.height/2,-.35,.055,o.height);
    if(o.height>1.6)plane('frame',p,o.x,o.bottom+o.height*.56,-.345,o.width,.055);
    if(o.door){
      box('frame',p,o.x,o.bottom+o.height+.06,.05,o.width+.25,.12,.38);
      for(const s of [-1,1]){plane('wood',p,o.x+s*o.width*.25,o.bottom+.33,-.31,o.width/2-.06,.62);box('frame',p,o.x+s*.12,o.bottom+1.15,-.28,.035,.32,.07);}
      plane('frame',p,o.x,o.bottom+.65,-.30,o.width,.075);
    }
  };
  const facade=(p:Placement,width:number,height:number,spacing:number,levels:number,finish:Finish,entrance=false)=>{
    const modern=finish==='stone',openingList:Opening[]=[];
    const count=Math.max(0,Math.floor((width-1.6)/spacing));const floorHeight=(height-.7)/levels;
    const windowWidth=Math.min(modern?3.5:2.05,spacing*.48),windowHeight=Math.min(modern?2.65:2.15,floorHeight*.62);
    for(let row=0;row<levels;row++)for(let col=0;col<count;col++){
      const x=(col-(count-1)/2)*spacing;
      if(entrance&&row===0&&Math.abs(x)<3.0)continue;
      openingList.push({x,bottom:.6+row*floorHeight+(floorHeight-windowHeight)*.4,width:windowWidth,height:windowHeight});
    }
    if(entrance&&width>7)openingList.push({x:0,bottom:.08,width:2.7,height:2.65,door:true});
    const shape=new Shape();shape.moveTo(-width/2,.44);shape.lineTo(width/2,.44);shape.lineTo(width/2,height-.18);shape.lineTo(-width/2,height-.18);shape.closePath();
    for(const o of openingList){
      // Entrance holes start below the wall base, so use an inset threshold;
      // the foundation is split at ground level below the opening instead.
      if(o.door)o.bottom=.46;
      const hole=new Path();hole.moveTo(o.x-o.width/2,o.bottom);hole.lineTo(o.x-o.width/2,o.bottom+o.height);hole.lineTo(o.x+o.width/2,o.bottom+o.height);hole.lineTo(o.x+o.width/2,o.bottom);hole.closePath();shape.holes.push(hole);
    }
    const at=local(p,0,-.42);put(finish,new ExtrudeGeometry(shape,{depth:.42,bevelEnabled:false,steps:1,curveSegments:1}),at.x,0,at.z,p.yaw);
    openingList.forEach(o=>window(p,o,modern));
    box('stone',p,0,.22,-.14,width,.44,.62);
    corniceEdge(p,width,height,modern);
    if(!modern&&levels>=3)box('stone',p,0,4.5,.045,width,.10,.52);
    if(entrance&&width>7){
      box('paving',p,0,.075,1.1,5.2,.15,2.4,true);box('paving',p,0,.22,.65,4.3,.14,1.5,true);
      box('trim',p,0,3.8,.84,5.7,.20,2.1);box('roof',p,0,3.96,.84,5.85,.13,2.2);
      for(const x of [-2.45,2.45]){box('stone',p,x,1.92,1.42,.24,3.5,.24);box('trim',p,x,.38,1.42,.36,.22,.36);}
    }
  };
  const curtainFacade=(p:Placement,width:number,height:number,levels:number)=>{
    const floorHeight=height/levels;
    // Continuous glass sits behind floor-edge slabs and structural mullions.
    // Following every surveyed outline edge preserves Iribe's curved corners.
    plane('glassLight',p,0,height/2,-.45,width,height-.35);
    for(let floor=0;floor<=levels;floor++){
      const y=floor*floorHeight;
      box('stone',p,0,y+.12,.10,width,.24,1.15);
      if(floor>0)box('frame',p,0,y-.22,-.10,width,.15,.52);
    }
    const count=Math.max(1,Math.ceil(width/2.8));
    for(let i=0;i<=count;i++)box('frame',p,-width/2+i*width/count,height/2,-.33,.075,height,.22);
    if(width>5)for(let x=-width/2+2;x<width/2;x+=6)box('stone',p,x,2.2,-.2,.27,4.4,.45);
    corniceEdge(p,width,height+.22,true);
  };
  const hipRoof=(p:Placement,width:number,depth:number,height:number,rise:number)=>{
    const ridge=Math.max(0,width/2-Math.min(width/2,depth*.35)),w=width/2,d=depth/2;
    const vertices=[-w,0,-d,-ridge,rise,0,ridge,rise,0,-w,0,-d,ridge,rise,0,w,0,-d,-ridge,rise,0,-w,0,d,w,0,d,-ridge,rise,0,w,0,d,ridge,rise,0,-w,0,-d,-w,0,d,-ridge,rise,0,w,0,-d,ridge,rise,0,w,0,d];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();put('roof',g,p.x,height,p.z,p.yaw);box('roof',p,0,height+rise+.04,0,ridge*2+.2,.11,.22);
  };
  const bench=(p:Placement)=>{
    for(const z of [-.22,.04,.30])box('wood',p,0,.49,z,2.5,.10,.20);box('wood',p,0,.98,-.29,2.5,.38,.11);
    for(const x of [-.93,.93]){box('frame',p,x,.25,.03,.08,.5,.65);box('frame',p,x,.72,-.30,.08,.95,.08);}
    collider('Campus bench',p,2.55,1.2,.8);
  };
  const stadium=(b:Building)=>{
    // The playing surface keeps a recognisable football pitch proportion;
    // the long axis runs across this stadium's broad east–west footprint.
    const p:Placement={...b,yaw:b.yaw+Math.PI/2},w=b.depth,d=b.width,fieldW=w*.42,fieldD=d*.74;
    box('track',p,0,.012,0,w*.68,.024,d*.82,true);
    // Put the turf above its surrounding running apron.
    box('grass',p,0,.043,0,fieldW,.026,fieldD,true);
    for(let line=-5;line<=5;line++)box('white',p,0,.063,line*fieldD/12,fieldW-.8,.012,.13);
    for(const s of [-1,1])box('red',p,0,.06,s*(fieldD/2-fieldD/24),fieldW,.016,fieldD/12);
    for(const side of [-1,1]){
      const stand=shifted(p,side*w*.38,0),standW=w*.20;
      collider(`${b.name} grandstand`,stand,standW,18,d*.85);
      for(let tier=0;tier<13;tier++){
        const x=side*(fieldW/2+5+tier*(standW/13));box(tier%3===0?'trim':'red',p,x,1+tier*.9,0,standW/13+.08,.34,d*.85);
        box('stone',p,x,.5+tier*.45,0,standW/13+.06,1+tier*.9,d*.85);
      }
      box('trim',p,side*w*.49,12.4,0,.45,1.2,d*.86);
      for(const z of [-d*.36,-d*.18,0,d*.18,d*.36])box('trim',p,side*w*.37,6.5,z,standW,1.1,1.5);
    }
    const press=shifted(p,-w*.40,0);box('brick',press,0,17,0,w*.13,6,d*.58);box('glass',press,w*.067,17,0,.12,3.5,d*.53);box('trim',press,0,20.2,0,w*.15,.45,d*.60);
    for(let z=-d*.25;z<=d*.25;z+=d*.10)for(const x of [-w*.045,w*.045])box('frame',press,x,12.2,z,.35,5.4,.35);
    for(const z of [-d*.43,d*.43]){
      for(const x of [-w*.07,w*.07]){rod('frame',p,x,7.5,z,.18,15);collider('Stadium scoreboard support',shifted(p,x,z),.4,15,.4);}
      box('frame',p,0,15.2,z,w*.25,9.3,.7);scoreboard(p,w*.24,15.2,z+.39);const back={...p,yaw:p.yaw+Math.PI};scoreboard(back,w*.24,15.2,-z+.39);
    }
    for(const side of [-1,1]){
      const z=side*(fieldD/2+2);rod('trim',p,0,1.55,z,.13,3.1);beam('trim',p,[0,3.1,z],[0,3.1,z-side*1.5],.18);beam('trim',p,[-4.6,3.1,z-side*1.5],[4.6,3.1,z-side*1.5],.18);
      for(const x of [-4.6,4.6])rod('trim',p,x,5.4,z-side*1.5,.09,4.6);collider('Stadium goalpost',shifted(p,0,z),.28,3.1,.28);
    }
    for(const x of [-w*.46,w*.46])for(const z of [-d*.40,d*.40]){rod('frame',p,x,17,z,.22,34);box('trim',p,x,34,z,8,.9,.8);}
    const sign=shifted(b,0,b.depth/2+3);box('brick',sign,0,4,0,27,2.8,.6);for(const x of [-11.5,11.5]){box('brick',sign,x,2.2,0,1.1,4.4,1.1);box('trim',sign,x,4.5,0,1.3,.22,1.3);collider('SECU entrance gate pier',shifted(sign,x,0),1.1,4.4,1.1);}textPlate(sign,'MARYLAND · SECU STADIUM',26,4,.32);
  };
  const arena=(b:Building)=>{
    const p:Placement=b,w=b.width,d=b.depth,h=b.height;collider(b.name,p,w,h,d);
    box('stone',p,0,.24,0,w+.5,.48,d+.5);box('trim',p,0,h*.89,0,w+1,.55,d+1);
    const arenaWall=(f:Placement,width:number)=>{
      const height=h*.89,shape=new Shape(),openings:Opening[]=[];shape.moveTo(-width/2,.4);shape.lineTo(width/2,.4);shape.lineTo(width/2,height);shape.lineTo(-width/2,height);shape.closePath();
      for(let x=-width/2+4;x<width/2-2;x+=6)openings.push({x,bottom:4.5,width:4.4,height:h*.47});
      for(const x of [-5.2,0,5.2])openings.push({x,bottom:.46,width:2.7,height:2.7,door:true});
      for(const o of openings){const hole=new Path();hole.moveTo(o.x-o.width/2,o.bottom);hole.lineTo(o.x-o.width/2,o.bottom+o.height);hole.lineTo(o.x+o.width/2,o.bottom+o.height);hole.lineTo(o.x+o.width/2,o.bottom);hole.closePath();shape.holes.push(hole);}
      const at=local(f,0,-.6);put('brick',new ExtrudeGeometry(shape,{depth:.6,bevelEnabled:false,steps:1,curveSegments:1}),at.x,0,at.z,f.yaw);openings.forEach(o=>window(f,o,false));
      for(let x=-width/2+1.4;x<width/2-2;x+=6)box('stone',f,x,h*.44,.14,.32,h*.63,.56);
      for(const y of [8.4,12.6])box('frame',f,0,y,-.30,width,.07,.14);
    };
    for(const side of [-1,1]){const front=shifted(p,0,side*d/2);if(side<0)front.yaw+=Math.PI;arenaWall(front,w);const flank=shifted(p,side*w/2,0);flank.yaw+=side*Math.PI/2;arenaWall(flank,d);}
    // A low vaulted roof and repeating structural ribs distinguish the arena
    // from the surrounding academic blocks even from the campus approaches.
    const segments=18,rise=Math.min(13,w*.13);
    for(let i=0;i<segments;i++){
      const x1=-w/2+i*w/segments,x2=-w/2+(i+1)*w/segments,y1=h*.91+Math.sin(i*Math.PI/segments)*rise,y2=h*.91+Math.sin((i+1)*Math.PI/segments)*rise;
      const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([x1,y1,-d/2,x1,y1,d/2,x2,y2,d/2,x1,y1,-d/2,x2,y2,d/2,x2,y2,-d/2],3));g.computeVertexNormals();put('roof',g,p.x,0,p.z,p.yaw);
      beam('frame',p,[x1,y1,-d/2],[x1,y1,d/2],.16);
    }
    for(const side of [-1,1]){
      const f=shifted(p,0,side*(d/2+.05));if(side<0)f.yaw+=Math.PI;
      // Close the barrel-vault ends: from ground level the roof's underside
      // would otherwise disappear and leave structural ribs against the sky.
      const cap=new Shape();cap.moveTo(-w/2,h*.89);cap.lineTo(w/2,h*.89);for(let i=segments;i>=0;i--)cap.lineTo(-w/2+i*w/segments,h*.91+Math.sin(i*Math.PI/segments)*rise);cap.closePath();const capAt=local(f,0,-.12);put('stone',new ExtrudeGeometry(cap,{depth:.24,bevelEnabled:false,steps:1,curveSegments:1}),capAt.x,0,capAt.z,f.yaw);
      box('trim',f,0,4.3,2.3,w*.58,.45,5);for(const x of [-w*.25,0,w*.25])rod('stone',f,x,2.2,4.3,.23,4.4);
      textPlate(f,'XFINITY CENTER',Math.min(30,w*.65),h*.74,.15);
    }
  };
  const garage=(b:Building)=>{
    // These are open parking structures, not academic buildings with dark
    // stripes over their windows. Deck counts and clearances are authored
    // silhouettes informed by Facilities photographs, not surveyed levels.
    const pts=polygon(b),floors=b.sourceBuildingId==='179'?3:b.sourceBuildingId==='404'?6:b.sourceBuildingId==='218'?5:4;
    const floorHeight=3.1,top=(floors-1)*floorHeight+.18;
    const faces=pts.map((a,i)=>({p:edge(a,pts[(i+1)%pts.length]),width:edgeLength(a,pts[(i+1)%pts.length])})).filter(f=>f.width>.2);
    const front=faces.filter(f=>f.width>12).sort((a,c)=>pathDistance(a.p.x,a.p.z)-pathDistance(c.p.x,c.p.z))[0];
    const inside=(x:number,z:number)=>{let hit=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],c=pts[j];if((a[1]>z)!==(c[1]>z)&&x<(c[0]-a[0])*(z-a[1])/(c[1]-a[1])+a[0])hit=!hit;}return hit;};
    const rectangularAreaInside=(p:Placement,w:number,d:number)=>[-1,0,1].every(x=>[-1,0,1].every(z=>{const a=local(p,x*w/2,z*d/2);return inside(a.x,a.z);}));
    let ramp:Placement|undefined;
    // The crescent-shaped Stadium Drive outline needs its ramp fitted inside
    // its actual polygon; a bounding-box rectangle would span the courtyard.
    const rampLength=23,rampWidth=4.4;
    for(const f of [...faces].sort((a,c)=>c.width-a.width)){
      if(f.width<rampLength+4)continue;const candidate=shifted(f.p,0,-5.6);
      if(rectangularAreaInside(candidate,rampLength+2,rampWidth+1)){ramp=candidate;break;}
    }
    if(!ramp){
      const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);
      // A curved footprint can have no individual edge as long as the ramp.
      // Search its interior for a short tangent run without bridging the void.
      search:for(let x=Math.min(...xs)+6;x<Math.max(...xs)-6;x+=6)for(let z=Math.min(...zs)+6;z<Math.max(...zs)-6;z+=6){
        if(!inside(x,z))continue;
        for(let turn=0;turn<12;turn++){
          const candidate={x,z,yaw:turn*Math.PI/12};
          if(rectangularAreaInside(candidate,rampLength+2,rampWidth+1)){ramp=candidate;break search;}
        }
      }
    }
    const deck=(y:number,openRamp:boolean)=>{
      const shape=new Shape();pts.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
      if(ramp&&openRamp){const hole=new Path();[[-rampLength/2,-rampWidth/2],[rampLength/2,-rampWidth/2],[rampLength/2,rampWidth/2],[-rampLength/2,rampWidth/2]].forEach(([x,z],i)=>{const at=local(ramp!,x,z);i?hole.lineTo(at.x,-at.z):hole.moveTo(at.x,-at.z);});hole.closePath();shape.holes.push(hole);}
      const g=new ExtrudeGeometry(shape,{depth:.24,bevelEnabled:false,steps:1,curveSegments:1});g.rotateX(-Math.PI/2);put('concrete',g,0,y-.24,0);
    };
    footprintCollider({...b,height:top+1.2},pts);
    for(let floor=0;floor<floors;floor++){
      const y=floor*floorHeight+.18;deck(y,floor>0);
      for(const f of faces){
        const brick=b.sourceBuildingId==='404'||b.sourceBuildingId==='202',parapet:Finish=brick||b.sourceBuildingId==='179'?'brick':'stone';
        box('trim',f.p,0,y-.16,0,f.width,.23,.66);
        if(f===front&&floor===0){
          const wing=(f.width-9)/2;
          for(const sign of [-1,1])box(parapet,f.p,sign*(4.5+wing/2),y+.43,0,wing,.86,.42);
          box('trim',f.p,0,y+2.55,0,9,.38,.70);
        }else box(parapet,f.p,0,y+.43,0,f.width,.86,.42);
        box('trim',f.p,0,y+.90,.03,f.width,.12,.55);
        if(floor<floors-1){
          const count=Math.max(1,Math.ceil(f.width/6.8));
          for(let i=0;i<=count;i++){
            const x=-f.width/2+i*f.width/count;if(f===front&&Math.abs(x)<4.2)continue;
            box(brick?'brick':'stone',f.p,x,y+floorHeight/2,-.05,brick?.70:.50,floorHeight,.75);
            box('stone',f.p,x,y+floorHeight-.40,-.32,1.1,.30,1.2);
          }
        }
      }
      // Interior columns and cross beams are visible through the empty bays.
      for(let x=-b.width/2+6;x<b.width/2-4;x+=9)for(let z=-b.depth/2+6;z<b.depth/2-4;z+=12){
        const at=shifted(b,x,z);if(!rectangularAreaInside(at,2,2))continue;
        if(ramp&&Math.hypot(at.x-ramp.x,at.z-ramp.z)<rampLength*.58)continue;
        if(floor<floors-1)box('stone',at,0,y+floorHeight/2,0,.52,floorHeight,.52);
      }
      if(ramp&&floor<floors-1){
        beam('concrete',ramp,[-rampLength/2,y-.10,0],[rampLength/2,y+floorHeight-.10,0],.22,rampWidth);
        for(const sign of [-1,1]){
          beam('stone',ramp,[-rampLength/2,y+.24,sign*rampWidth/2],[rampLength/2,y+floorHeight+.24,sign*rampWidth/2],.48,.22);
          beam('trim',ramp,[-rampLength/2,y+.79,sign*rampWidth/2],[rampLength/2,y+floorHeight+.79,sign*rampWidth/2],.07,.07);
        }
      }
    }
    // Roof parking follows the surveyed outline, including the concave
    // Stadium Drive decks. Markings never bridge an absent corner or ramp.
    let stalls=0;
    for(const f of faces){
      if(f.width<9)continue;
      for(let x=-f.width/2+3.1;x<f.width/2-2.6;x+=2.65){
        const at=shifted(f.p,x,-3.4);if(!rectangularAreaInside(at,2.5,4.5))continue;
        if(ramp&&Math.hypot(at.x-ramp.x,at.z-ramp.z)<rampLength*.58)continue;
        box('white',at,-1.25,top+.025,0,.08,.012,4.5);box('white',at,0,top+.025,2.25,2.5,.012,.08);
        box('stone',at,0,top+.11,1.7,1.5,.16,.15);stalls++;
      }
    }
    for(let z=-b.depth/2+11;z<b.depth/2-8;z+=12)for(let x=-b.width/2+6;x<b.width/2-5;x+=2.65){
      const at=shifted(b,x,z);if(!rectangularAreaInside(at,2.6,5))continue;
      if(ramp&&Math.hypot(at.x-ramp.x,at.z-ramp.z)<rampLength*.58)continue;
      box('white',at,-1.25,top+.025,0,.08,.012,4.5);box('white',at,0,top+.025,2.25,2.5,.012,.08);stalls++;
    }
    if(front){
      box('concrete',front.p,0,.025,5.5,10,.05,11,true);
      for(const x of [-4.8,4.8])box('white',front.p,x,.06,5.5,.12,.012,10.5,true);
      const stair=shifted(front.p,-front.width/2+3.0,-2.0);
      if(rectangularAreaInside(stair,4.4,4.0)){
        box('brick',stair,0,(top+2)/2,0,4.4,top+2,4);
        plane('glassLight',stair,0,(top+1.1)/2,2.01,2.6,top+.2);
        for(let floor=0;floor<floors;floor++)box('trim',stair,0,floor*floorHeight+.9,2.06,2.8,.12,.16);
        for(const x of [-1.35,1.35])box('frame',stair,x,(top+1.1)/2,2.06,.09,top+.4,.12);
        box('trim',stair,0,top+2.10,0,4.65,.20,4.25);
      }
      box('red',front.p,0,2.95,.40,Math.min(front.width-2,24),.95,.20);
      textPlate(front.p,b.name,Math.min(front.width-2,23),2.95,.515);
      // A clearance bar, payment kiosk and bollards make the vehicle entry
      // legible from the pedestrian route without adding a drivable interior.
      box('trim',front.p,0,2.48,.8,7.6,.12,.15);
      for(const x of [-3.8,3.8]){box('red',front.p,x,.52,.20,.20,1.04,.20);box('white',front.p,x,.70,.20,.205,.13,.205);}
      box('frame',front.p,3.1,.78,-.9,.55,1.56,.42);box('glassLight',front.p,3.1,1.14,-.67,.38,.33,.03);
    }
    for(const f of faces.filter(f=>f.width>20).slice(0,4)){
      const lamp=shifted(f.p,0,-1.1);rod('frame',lamp,0,top+2.7,0,.065,5.4);box('trim',lamp,0,top+5.4,0,1.5,.12,.50);
    }
    const garageData=group.userData.parkingGarages??=[];
    garageData.push({id:b.id,name:b.name,floors,height:top+1.1,stalls,ramp:Boolean(ramp),openDecks:true,footprint:pts});
  };
  const landscape=()=>{
    for(const space of UMD_FULL_SPACES){
      zone=zoneAt(space.x,space.z);
      if(space.kind==='track'){
        const capsule=(inset:number)=>{
          const radius=space.depth/2-inset,halfStraight=(space.width-space.depth)/2,shape=new Shape();shape.moveTo(-halfStraight,-radius);shape.lineTo(halfStraight,-radius);shape.absarc(halfStraight,0,radius,-Math.PI/2,Math.PI/2,false);shape.lineTo(-halfStraight,radius);shape.absarc(-halfStraight,0,radius,Math.PI/2,Math.PI*1.5,false);shape.closePath();return shape;
        };
        const oval=(inset:number,finish:Finish,height:number,line=false)=>{const shape=capsule(inset);if(line)shape.holes.push(new Path(capsule(inset+.12).getPoints(36)));const g=new ShapeGeometry(shape,36);g.rotateX(-Math.PI/2);put(finish,g,space.x,height,space.z,space.yaw,true);};
        oval(0,'track',.012);for(let lane=1;lane<=6;lane++)oval(lane*1.15-.10,'white',.035,true);oval(8,'grass',.030);
        const fw=space.width-35,fd=space.depth-27;
        for(const side of [-1,1]){box('white',space,side*fw/2,.039,0,.12,.008,fd);box('white',space,0,.039,side*fd/2,fw,.008,.12);}
        box('white',space,0,.039,0,.12,.008,fd);
      }else if(space.kind==='baseball'||space.kind==='softball'){
        const radius=Math.min(space.width,space.depth)*.78,hx=-space.width*.32,hz=space.depth*.32,shape=new Shape();shape.moveTo(hx,-hz);shape.lineTo(hx+radius,-hz);shape.absarc(hx,-hz,radius,0,Math.PI/2,false);shape.closePath();const g=new ShapeGeometry(shape,42);g.rotateX(-Math.PI/2);put('grass',g,space.x,.018,space.z,space.yaw,true);
        const diamond=space.kind==='baseball'?25:19;box('track',space,hx+diamond/2,.022,hz-diamond/2,diamond+5,.04,diamond+5,true);
        for(const side of [0,1]){box('white',space,hx+diamond*side,.047,hz-diamond/2,.10,.012,diamond);box('white',space,hx+diamond/2,.047,hz-diamond*side,diamond,.012,.10);}
        for(const x of [0,diamond])for(const z of [0,-diamond])box('white',space,hx+x,.07,hz+z,.55,.06,.55);
        box('white',space,hx+radius/2,.043,hz,radius,.014,.12);box('white',space,hx,.043,hz-radius/2,.12,.014,radius);
      }else if(space.kind==='farm'){
        for(let x=-space.width*.4;x<space.width*.4;x+=5){
          box('track',space,x,.025,0,2.7,.05,space.depth*.72,true);
          for(let z=-space.depth*.34;z<space.depth*.34;z+=3.5){const at=local(space,x,z);if(inBuilding(at.x,at.z,3)||pathDistance(at.x,at.z)<5)continue;box('grass',space,x,.21,z,1.25,.34,1.5);}
        }
        const p=shifted(space,0,space.depth/2-6);box('wood',p,0,1.2,0,8,.70,.15);for(const s of [-1,1])rod('wood',p,s*3.3,.7,0,.07,1.4);textPlate(p,'CAMPUS FARM',7.6,1.2,.09);
      }else if(space.kind==='golf'){
        // Broad fairways and a few putting greens describe the western campus
        // landscape without pretending to reproduce a surveyed golf course.
        for(let i=0;i<5;i++){
          const x=Math.sin(i*2.1)*space.width*.28,z=(i-2)*space.depth*.17,at=local(space,x,z),green=new CylinderGeometry(19,19,.02,24);green.scale(1.45,1,1);put('grass',green,at.x,.003,at.z,space.yaw,true);
          if(!inBuilding(at.x,at.z,5)&&pathDistance(at.x,at.z)>6){rod('white',ORIGIN,at.x,1.25,at.z,.035,2.5);box('red',ORIGIN,at.x+.32,2.1,at.z,.6,.43,.035);}
          for(const s of [-1,1]){const t=local(space,x+s*45,z+11);tree(t.x,t.z,5.4);}
        }
      }else if(space.kind==='field'||space.kind==='hockey'){
        box('grass',space,0,.003,0,space.width,.036,space.depth,true);
        for(const s of [-1,1]){box('white',space,s*(space.width/2-3),.026,0,.13,.012,space.depth-6);box('white',space,0,.026,s*(space.depth/2-3),space.width-6,.012,.13);}
        box('white',space,0,.026,0,.13,.012,space.depth-6);
      }
      if(space.kind==='quad'||space.kind==='lawn')for(const s of [-1,1])for(const t of [-1,1]){const at=local(space,s*(space.width/2+5),t*(space.depth/2+5));tree(at.x,at.z,4.5);}
    }
  };

  // Spatial ground tiles keep both the collision broad phase and frustum
  // culling local. Their surface sits below the existing six authored sights.
  const bounds=UMD_FULL_BOUNDS;
  for(let x=bounds.minX;x<bounds.maxX;x+=CELL)for(let z=bounds.minZ;z<bounds.maxZ;z+=CELL){
    const w=Math.min(CELL,bounds.maxX-x),d=Math.min(CELL,bounds.maxZ-z);zone=zoneAt(x+w/2,z+d/2);
    const tile=new PlaneGeometry(w,d);tile.rotateX(-Math.PI/2);put('grass',tile,x+w/2,-.015,z+d/2,0,true);
  }
  landscape();
  const renderedSegments=new Set<string>();
  for(const path of UMD_FULL_PATHS)for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],length=edgeLength(a,b);if(length<.1)continue;
    const ka=`${a[0].toFixed(2)},${a[1].toFixed(2)}`,kb=`${b[0].toFixed(2)},${b[1].toFixed(2)}`,key=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;if(renderedSegments.has(key))continue;renderedSegments.add(key);
    const p:Placement={x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(b[0]-a[0],b[1]-a[1])};zone=zoneAt(p.x,p.z);
    if(!inSportsOrFarm(p.x,p.z)){box('paving',p,0,.020,0,6,.04,length+1.5,true);for(const s of [-1,1])box('stone',p,s*3.10,.04,0,.20,.08,length);}
    for(let t=16;t<length-8;t+=38){const at=local(p,0,t-length/2);tree(at.x+Math.cos(p.yaw)*10,at.z-Math.sin(p.yaw)*10,4.3);tree(at.x-Math.cos(p.yaw)*10,at.z+Math.sin(p.yaw)*10,4.7);}
  }
  const estimatedWindows=UMD_FULL_BUILDINGS.reduce((sum,b)=>sum+(b.width+b.depth)*2*Math.max(1,Math.min(5,Math.round(b.height/4.1)))/8,0);
  const spacing=8*Math.max(1,estimatedWindows/6800);
  for(const b of UMD_FULL_BUILDINGS){
    if(DETAILED_BUILDINGS.has(b.sourceBuildingId))continue;
    zone=zoneAt(b.x,b.z);
    buildingBaseY=marylandElevation(b.x,b.z);
    if(b.kind==='stadium'){stadium(b);continue;}if(b.kind==='arena'){arena(b);continue;}
    if(b.kind==='garage'){garage(b);continue;}
    const pts=polygon(b),iribe=/iribe/i.test(b.name),levels=iribe?6:Math.max(1,Math.min(5,Math.round(b.height/4.1))),modern=b.kind==='modern'||b.kind==='greenhouse';
    const finish:Finish=modern?'stone':b.kind==='residence'?'brickLight':'brick';
    const faces=pts.map((a,i)=>({p:edge(a,pts[(i+1)%pts.length]),width:edgeLength(a,pts[(i+1)%pts.length])})).filter(f=>f.width>.15);
    const front=faces.filter(f=>f.width>8).sort((a,c)=>pathDistance(a.p.x,a.p.z)-pathDistance(c.p.x,c.p.z))[0];
    footprintCollider(b,pts);
    for(const f of faces){if(iribe)curtainFacade(f.p,f.width,b.height,levels);else facade(f.p,f.width,b.height,modern?Math.max(6,spacing*.80):spacing,levels,finish,f===front);}
    for(const ring of b.holes??[]){const inner=[...ring];let area=0;for(let i=0;i<inner.length;i++){const a=inner[i],c=inner[(i+1)%inner.length];area+=a[0]*c[1]-c[0]*a[1];}if(area<0)inner.reverse();for(let i=0;i<inner.length;i++){const a=inner[i],c=inner[(i+1)%inner.length];if(edgeLength(a,c)>.15)facade(edge(a,c),edgeLength(a,c),b.height,spacing,levels,finish);}}
    roofPlane(pts,b.height-.16,'roof',b.holes);
    if(iribe){
      const garden=pts.map(([x,z])=>[b.x+(x-b.x)*.76,b.z+(z-b.z)*.76] as Point);roofPlane(garden,b.height+.03,'grass');
      for(let i=0;i<garden.length;i++){const a=garden[i],c=garden[(i+1)%garden.length],p=edge(a,c);box('trim',p,0,b.height+.32,0,edgeLength(a,c),.60,.35);}
      box('stone',b,-b.width*.15,b.height+1.4,-b.depth*.10,b.width*.31,2.8,b.depth*.26);box('roof',b,-b.width*.15,b.height+2.9,-b.depth*.10,b.width*.33,.22,b.depth*.28);
    }
    // Simple historic footprints receive a proper hipped silhouette; complex
    // courtyard outlines retain their real plan instead of a rectangle roof.
    if(pts.length<=6&&!modern&&b.kind!=='athletics'&&Math.min(b.width,b.depth)<45){
      hipRoof(b,b.width+1,b.depth+1,b.height+.06,Math.min(5.8,Math.min(b.width,b.depth)*.20));
      if(b.width>24){box('brick',b,-b.width*.24,b.height+2.4,0,1.0,4.8,1.35);box('trim',b,-b.width*.24,b.height+4.85,0,1.25,.18,1.6);}
    }
    if(modern&&front){
      const cw=Math.min(front.width*.70,26),ch=Math.min(b.height-1.1,16);
      // An entrance curtain wall is a distinct projecting volume with mullions,
      // deep canopy and warm vertical sunshades, not a texture on the masonry.
      box('glassLight',front.p,0,ch/2+.40,1.2,cw,ch,2.4);
      for(let x=-cw/2;x<=cw/2+.01;x+=2.4)box('frame',front.p,x,ch/2+.40,2.43,.09,ch,.15);
      for(let y=4;y<ch;y+=3.9)box('frame',front.p,0,y,2.43,cw,.11,.17);
      box('roof',front.p,0,ch+.55,1.6,cw+1.8,.20,4.4);
      for(const s of [-1,1])for(let i=0;i<4;i++)box('wood',front.p,s*(cw/2+1.0+i*.55),ch/2+.4,1.8,.14,ch,1.3);
      collider(`${b.name} glazed entrance`,shifted(front.p,0,1.2),cw,ch,2.4);
    }
    if(b.kind==='arts'){
      // Clarice's stepped performance volumes and glazed public front retain
      // the GIS courtyard arrangement while making its skyline recognisable.
      box('brick',b,-b.width*.18,b.height+2.3,0,b.width*.32,4.6,b.depth*.52);box('trim',b,-b.width*.18,b.height+4.67,0,b.width*.33,.22,b.depth*.54);
      for(const f of faces)if(f.width>15){for(let x=-f.width/2+1.2;x<f.width/2-.5;x+=8){box('brickLight',f.p,x,b.height/2,.12,.50,b.height-.4,.38);box('stone',f.p,x,b.height-.48,.16,.72,.22,.48);}box('stone',f.p,0,3.9,.11,f.width,.16,.48);}
      if(front){box('glass',front.p,0,3.3,.12,Math.min(front.width-3,24),5.4,.24);for(let x=-10;x<=10;x+=2)box('frame',front.p,x,3.3,.30,.08,5.4,.12);}
    }
    if(front&&(/iribe|clark|clarice|munching|hornbake|eppley|ritchie|denton|dining|varsity|cumberland|ellicott|knight|johnson|yahentamitsi/i.test(b.name)||b.kind==='arts'))textPlate(front.p,b.name,Math.min(front.width-2,18),Math.min(b.height-1.5,5.0),.24);
    // Street trees are tested against every footprint and route before adding.
    for(const s of [-1,1]){const at=local(b,s*(b.width/2+13),b.depth/2+12);tree(at.x,at.z,4.2+(b.width%3)*.18);}
    if(front&&outerCore(front.p.x,front.p.z)){
      const seat=shifted(front.p,Math.min(front.width/2-3,12),6.5);
      if(!inBuilding(seat.x,seat.z,1.5)&&pathDistance(seat.x,seat.z)>4.8)bench(seat);
    }
  }

  const palette:Record<Finish,string>={brick:'#a66b53',brickLight:'#b77e63',stone:'#d0c7ae',concrete:'#969d94',trim:'#e6deca',roof:'#617475',glass:'#54727e',glassLight:'#6c949d',frame:'#758784',shade:'#334b50',wood:'#8d6c4a',paving:'#c5bea9',grass:'#7f985e',track:'#a8705b',red:'#a75046',white:'#e5dfc8'};
  const source:Record<Finish,string>={brick:'brick',brickLight:'brick',stone:'limestone',concrete:'road',trim:'trim',roof:'roof',glass:'glass',glassLight:'glass',frame:'frame',shade:'interiorShade',wood:'benchWood',paving:'pavement',grass:'grass',track:'road',red:'trim',white:'trim'};
  const materials=new Map<Finish,MeshStandardMaterial>();
  for(const [name,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(part=>part.dispose());if(!geometry)throw new Error(`Could not merge UMD district ${name}`);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    let material=materials.get(batch.finish);if(!material){
      material=createCampusSurface(source[batch.finish],{yaw:0}) as MeshStandardMaterial;
      material.name=`UMD districts ${batch.finish}`;material.color=new Color(palette[batch.finish]);material.roughness=batch.finish.startsWith('glass')?.47:1;
      if(batch.finish==='glassLight'){material.emissive.set('#759eaa');material.emissiveIntensity=.24;}
      // This terrain has true vertical layering. The legacy grass depth bias
      // would pull it over streets and pitch markings in distant views.
      if(batch.finish==='grass'||batch.finish==='track'||batch.finish==='concrete')material.polygonOffset=false;
      if(batch.finish==='white'||batch.finish==='red'){material.polygonOffset=true;material.polygonOffsetFactor=-.25;material.polygonOffsetUnits=-1;}
      materials.set(batch.finish,material);
    }
    const mesh=new Mesh(geometry,material);mesh.name=`UMD district ${name}`;mesh.castShadow=!batch.surface&&!batch.finish.startsWith('glass');mesh.receiveShadow=true;group.add(mesh);shadowMeshes.push(mesh);if(batch.surface)ground.push(mesh);
  }
  const districts=[createMarylandBusinessDistrict(_wind),createMarylandEngineeringDistrict(_wind)];
  for(const detail of districts){group.add(detail.group);ground.push(...detail.ground);walls.push(...detail.walls);trees.push(...detail.trees);}
  group.updateMatrixWorld(true);
  // Keep massing, roof and glazing visible across campus; fine mullions,
  // cornices and furniture have no readable contribution several blocks away.
  const fine=shadowMeshes.filter(mesh=>/:(frame|trim|wood|white)$/.test(mesh.name));
  let lowQuality=false;
  return{group,ground,walls,trees,lawns:[] as {mesh:Mesh;footprints:{x:number;z:number;width:number;depth:number;yaw:number}[]}[],
    setQuality:(low:boolean)=>{lowQuality=low;shadowMeshes.forEach(mesh=>{mesh.castShadow=!low&&!ground.includes(mesh)&&!mesh.name.includes('glass');});districts.forEach(d=>d.setQuality(low));},
    update:(camera:Vector3)=>{
      districts.forEach(d=>d.update(camera));
      const reach=lowQuality?260:460;
      for(const mesh of fine){
        const b=mesh.geometry.boundingBox!;
        const dx=Math.max(b.min.x-camera.x,0,camera.x-b.max.x),dz=Math.max(b.min.z-camera.z,0,camera.z-b.max.z);
        mesh.visible=dx*dx+dz*dz<reach*reach;
      }
    },
  };
}
