import {BoxGeometry,BufferGeometry,CanvasTexture,Color,CylinderGeometry,ExtrudeGeometry,Float32BufferAttribute,Group,LatheGeometry,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Quaternion,Shape,ShapeGeometry,SphereGeometry,SRGBColorSpace,TorusGeometry,Vector2,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {marylandElevation,drapeMarylandGeometry} from './maryland-terrain';

type Finish='brick'|'stone'|'trim'|'roof'|'glass'|'frame'|'shade'|'wood'|'bronze'|'paving'|'lawn'|'terrain'|'leaf'|'flower';
type Placement={x:number;z:number;yaw:number;baseY?:number};
type Footprint={x:number;z:number;width:number;depth:number;yaw:number};
type Opening={x:number;y:number;w:number;h:number;arch?:boolean;door?:boolean};
const UP=new Vector3(0,1,0);
const ORIGIN:Placement={x:0,z:0,yaw:0};
const STAMP:Placement={x:-185,z:-236,yaw:0};
const ARMORY:Placement={x:230,z:-140,yaw:-Math.PI/2};
const CHAPEL:Placement={x:110,z:220,yaw:Math.PI};

/** Original outdoor models informed by official UMD photographs and campus map.
 * The three surrounding neighbourhoods compress walking distances in
 * the site plan; the shared elevation field now restores the campus slopes.
 */
export function createMarylandExpansion(_wind:{value:number}) {
  const group=new Group();group.name='Maryland · Stamp, Armory and Memorial Chapel';
  const ground:Mesh[]=[],walls:Mesh[]=[],shadowMeshes:Mesh[]=[];
  const trees:{x:number;z:number;radius:number}[]=[],footprints:Footprint[]=[];
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>();
  const transform=new Matrix4(),rotation=new Quaternion();
  const invisible=new MeshBasicMaterial();invisible.name='UMD expansion collision';
  const elevation=(p:Placement)=>p.baseY??marylandElevation(p.x,p.z);
  const local=(p:Placement,x:number,z:number)=>({x:p.x+x*Math.cos(p.yaw)+z*Math.sin(p.yaw),z:p.z-x*Math.sin(p.yaw)+z*Math.cos(p.yaw),baseY:elevation(p)});
  const shifted=(p:Placement,x:number,z:number):Placement=>({...local(p,x,z),yaw:p.yaw});
  const put=(finish:Finish,g:BufferGeometry,x:number,y:number,z:number,yaw=0,surface=false,baseY=marylandElevation(x,z))=>{
    rotation.setFromAxisAngle(UP,yaw);transform.compose(new Vector3(x,y+(surface?0:baseY),z),rotation,new Vector3(1,1,1));g.applyMatrix4(transform);
    if(surface){const flat=g;g=drapeMarylandGeometry(flat);flat.dispose();}
    const part=g.index?g.toNonIndexed():g;if(part!==g)g.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${surface?'ground':'detail'}-${finish}`,batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const box=(f:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number,d:number,surface=false)=>{
    const at=local(p,x,z);put(f,new BoxGeometry(w,h,d),at.x,y,at.z,p.yaw,surface,at.baseY);
  };
  const collider=(name:string,p:Placement,x:number,z:number,w:number,h:number,d:number,bottom=0)=>{
    const at=local(p,x,z),mesh=new Mesh(new BoxGeometry(w,h,d),invisible);mesh.name=name;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();mesh.position.set(at.x,at.baseY+bottom+h/2,at.z);mesh.rotation.y=p.yaw;mesh.visible=false;group.add(mesh);walls.push(mesh);
  };
  const rod=(f:Finish,p:Placement,x:number,y:number,z:number,r:number,h:number,segments=12)=>{
    const at=local(p,x,z);put(f,new CylinderGeometry(r,r,h,segments),at.x,y,at.z,p.yaw,false,at.baseY);
  };
  const sphere=(f:Finish,p:Placement,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{
    const g=new SphereGeometry(1,10,7);g.scale(sx,sy,sz);const at=local(p,x,z);put(f,g,at.x,y,at.z,p.yaw,false,at.baseY);
  };
  const beam=(f:Finish,p:Placement,a:[number,number,number],b:[number,number,number],thick:number,depth=thick)=>{
    const av=new Vector3(...a),bv=new Vector3(...b),direction=bv.clone().sub(av),g=new BoxGeometry(thick,direction.length(),depth);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(UP,direction.normalize()));const at=local(p,(a[0]+b[0])/2,(a[2]+b[2])/2);put(f,g,at.x,(a[1]+b[1])/2,at.z,p.yaw,false,at.baseY);
  };
  const archPath=(x:number,bottom:number,w:number,h:number)=>{
    const path=new Path();path.moveTo(x-w/2,bottom);path.lineTo(x-w/2,bottom+h-w/2);path.absarc(x,bottom+h-w/2,w/2,Math.PI,0,true);path.lineTo(x+w/2,bottom);path.closePath();return path;
  };
  const pane=(face:Placement,o:Opening)=>{
    const bottom=o.y-o.h/2;
    if(o.arch){const outline=archPath(o.x,bottom,o.w,o.h),shape=new Shape(outline.getPoints(16));const at=local(face,0,-.54);put('glass',new ShapeGeometry(shape,8),at.x,0,at.z,face.yaw,false,at.baseY);}
    else box('glass',face,o.x,o.y,-.54,o.w,o.h,.07);
    // The exterior wall really stops at the opening: jamb, head and sill have
    // 55cm of depth, with the sash set back behind the brick face.
    for(const side of [-1,1])box('trim',face,o.x+side*(o.w/2+.10),bottom+(o.arch?o.h-o.w/2:o.h)/2,.09,.19,o.arch?o.h-o.w/2:o.h,.30);
    box('stone',face,o.x,bottom-.12,.18,o.w+.62,.24,.55);
    if(o.arch){const at=local(face,o.x,.085);put('trim',new TorusGeometry(o.w/2+.10,.14,6,18,Math.PI),at.x,bottom+o.h-o.w/2,at.z,face.yaw,false,at.baseY);}
    else {box('trim',face,o.x,o.y+o.h/2+.10,.085,o.w+.4,.20,.30);box('brick',face,o.x,o.y+o.h/2+.34,.03,o.w+.65,.28,.25);}
    const rectangularHeight=o.arch?o.h-o.w/2:o.h;
    if(o.door){
      // Oversized historic openings contain ordinary human-scale door leaves;
      // the remaining height is a fixed glazed transom, not a 6m wooden slab.
      const leafHeight=Math.min(2.5,rectangularHeight-.45),doorWidth=Math.min(2.6,o.w-.20),leafWidth=doorWidth/2;
      for(const side of [-1,1]){
        const x=o.x+side*leafWidth/2;
        box('wood',face,x,bottom+leafHeight/2,-.43,leafWidth-.04,leafHeight,.12);
        box('glass',face,x,bottom+.91+(leafHeight-1.06)/2,-.345,leafWidth-.23,leafHeight-1.06,.055);
        box('shade',face,x,bottom+.43,-.35,leafWidth-.25,.58,.05);
        box('wood',face,x,bottom+.43,-.313,leafWidth-.36,.47,.045);
        box('frame',face,x,bottom+1.62,-.30,leafWidth-.23,.055,.07);
        rod('bronze',face,o.x+side*.15,bottom+1.17,-.29,.03,.34,8);
      }
      for(const x of [-doorWidth/2,0,doorWidth/2])box('frame',face,o.x+x,bottom+leafHeight/2,-.29,.09,leafHeight,.12);
      box('frame',face,o.x,bottom+leafHeight+.06,-.29,o.w,.13,.13);
      const upperHeight=rectangularHeight-leafHeight-.1;
      for(const dx of [-o.w/6,o.w/6])box('frame',face,o.x+dx,bottom+leafHeight+.1+upperHeight/2,-.34,.06,upperHeight,.10);
      if(upperHeight>1.1)box('frame',face,o.x,bottom+leafHeight+.1+upperHeight/2,-.33,o.w,.065,.10);
    } else {
      for(const dx of [-o.w/6,o.w/6])box('frame',face,o.x+dx,bottom+rectangularHeight/2,-.34,.055,rectangularHeight,.09);
      const bars=Math.max(2,Math.floor(rectangularHeight/.8));for(let i=1;i<bars;i++)box('frame',face,o.x,bottom+i*rectangularHeight/bars,-.33,o.w,.055,.10);
    }
    if(o.arch)box('frame',face,o.x,bottom+rectangularHeight,-.33,o.w,.07,.1);
  };
  const wall=(face:Placement,w:number,h:number,openings:Opening[],finish:Finish='brick',bottom=0)=>{
    const shape=new Shape();shape.moveTo(-w/2,bottom);shape.lineTo(w/2,bottom);shape.lineTo(w/2,bottom+h);shape.lineTo(-w/2,bottom+h);shape.closePath();
    for(const o of openings){
      if(o.arch)shape.holes.push(archPath(o.x,o.y-o.h/2,o.w,o.h));
      else {const hole=new Path();hole.moveTo(o.x-o.w/2,o.y-o.h/2);hole.lineTo(o.x-o.w/2,o.y+o.h/2);hole.lineTo(o.x+o.w/2,o.y+o.h/2);hole.lineTo(o.x+o.w/2,o.y-o.h/2);hole.closePath();shape.holes.push(hole);}
    }
    const at=local(face,0,-.65);put(finish,new ExtrudeGeometry(shape,{depth:.65,bevelEnabled:false,curveSegments:12}),at.x,0,at.z,face.yaw,false,at.baseY);
    openings.forEach(o=>pane(face,o));
  };
  const facadeOpenings=(width:number,levels:number,step:number,first:number,spacing=5.2,w=1.8,h=2.7):Opening[]=>{
    const count=Math.max(3,Math.floor((width-5)/spacing)),out:Opening[]=[];
    for(let f=0;f<levels;f++)for(let c=0;c<count;c++)out.push({x:(c-(count-1)/2)*spacing,y:first+f*step,w,h});return out;
  };
  const shell=(name:string,p:Placement,w:number,d:number,h:number,front:Opening[],back:Opening[],sides:Opening[],finish:Finish='brick')=>{
    wall(shifted(p,0,d/2),w,h,front,finish);
    const rear=shifted(p,0,-d/2);rear.yaw+=Math.PI;wall(rear,w,h,back,finish);
    for(const side of [-1,1]){const face=shifted(p,side*w/2,0);face.yaw+=side*Math.PI/2;wall(face,d,h,sides,finish);}
    collider(name,p,0,0,w,h,d);
    box('shade',p,0,h/2,0,w-1.4,h-1,d-1.4);
    box('stone',p,0,.38,0,w+.25,.76,d+.25);
  };
  const cornice=(p:Placement,w:number,d:number,y:number,dentils=false)=>{
    box('stone',p,0,y-.70,0,w+.35,.26,d+.35);box('trim',p,0,y-.38,0,w+.75,.38,d+.75);box('shade',p,0,y-.13,0,w+.93,.075,d+.93);box('trim',p,0,y+.04,0,w+1.18,.25,d+1.18);
    if(dentils)for(const side of [-1,1])for(let x=-w/2+.4;x<w/2;x+=.84)box('trim',p,x,y-.84,side*(d/2+.22),.28,.24,.41);
  };
  const roof=(p:Placement,w:number,d:number,y:number,rise:number,hip=3)=>{
    const ridge=Math.max(0,w/2-hip),v=[-w/2,0,-d/2,-ridge,rise,0,ridge,rise,0,-w/2,0,-d/2,ridge,rise,0,w/2,0,-d/2,-ridge,rise,0,-w/2,0,d/2,w/2,0,d/2,-ridge,rise,0,w/2,0,d/2,ridge,rise,0,-w/2,0,-d/2,-w/2,0,d/2,-ridge,rise,0,w/2,0,-d/2,ridge,rise,0,w/2,0,d/2];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(v,3));g.computeVertexNormals();put('roof',g,p.x,y,p.z,p.yaw,false,elevation(p));cornice(p,w,d,y);
    box('roof',p,0,y+rise+.065,0,ridge*2+.2,.13,.30);
    for(const side of [-1,1]){box('roof',p,0,y,side*d/2,w,.13,.16);for(const end of [-1,1])beam('roof',p,[end*w/2,y,side*d/2],[end*ridge,y+rise,0],.12);}
  };
  const porticoRoof=(p:Placement,w:number,d:number,y:number,rise:number)=>{
    // The ridge runs back from the pediment peak, not across the facade.
    const v=[-w/2,0,-d/2,-w/2,0,d/2,0,rise,d/2,-w/2,0,-d/2,0,rise,d/2,0,rise,-d/2,0,rise,-d/2,0,rise,d/2,w/2,0,d/2,0,rise,-d/2,w/2,0,d/2,w/2,0,-d/2];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(v,3));g.computeVertexNormals();put('roof',g,p.x,y,p.z,p.yaw,false,elevation(p));box('roof',p,0,y+rise+.07,0,.22,.14,d+.15);
  };
  const pediment=(p:Placement,w:number,y:number,z:number,rise:number,oculus=true)=>{
    const shape=new Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(0,rise);shape.closePath();
    const cy=rise*.42,r=Math.min(1.0,rise*.20);
    if(oculus){const hole=new Path();hole.absarc(0,cy,r,0,Math.PI*2,true);shape.holes.push(hole);}
    const at=local(p,0,z-.5);put('trim',new ExtrudeGeometry(shape,{depth:.5,bevelEnabled:false,curveSegments:18}),at.x,y,at.z,p.yaw,false,at.baseY);
    for(const side of [-1,1]){beam('stone',p,[side*w/2,y,z],[0,y+rise,z],.25,.35);beam('trim',p,[side*(w/2+.28),y+.21,z+.15],[0,y+rise+.31,z+.15],.30,.60);beam('roof',p,[side*(w/2+.45),y+.45,z-.14],[0,y+rise+.54,z-.14],.14,1.05);}
    box('trim',p,0,y-.22,z-.1,w+.6,.45,.9);
    for(let x=-w/2+.35;x<w/2;x+=.7)box('trim',p,x,y-.57,z+.10,.25,.23,.37);
    if(oculus){const ring=local(p,0,z+.04);put('stone',new TorusGeometry(r+.11,.14,7,24),ring.x,y+cy,ring.z,p.yaw,false,ring.baseY);const circle=new CylinderGeometry(r,r,.06,24);circle.rotateX(Math.PI/2);const center=local(p,0,z-.26);put('glass',circle,center.x,y+cy,center.z,p.yaw,false,center.baseY);box('frame',p,0,y+cy,z-.20,r*1.9,.07,.08);box('frame',p,0,y+cy,z-.20,.07,r*1.9,.08);}
  };
  const column=(p:Placement,x:number,z:number,bottom:number,height:number,r:number)=>{
    const profile=[new Vector2(r*1.3,0),new Vector2(r*1.3,.18),new Vector2(r*1.08,.31),new Vector2(r,.48),new Vector2(r*.80,height-.68),new Vector2(r,height-.51),new Vector2(r*1.23,height-.30),new Vector2(r*1.36,height)];
    const at=local(p,x,z);put('trim',new LatheGeometry(profile,18),at.x,bottom,at.z,p.yaw,false,at.baseY);box('stone',p,x,bottom+.1,z,r*2.8,.2,r*2.8);box('trim',p,x,bottom+height-.04,z,r*2.9,.23,r*2.9);
    for(const side of [-1,1]){sphere('trim',p,x+side*r*.86,bottom+height-.32,z+r*.74,.23,.2,.19);sphere('trim',p,x+side*r*.86,bottom+height-.32,z-r*.74,.23,.2,.19);}
    collider('UMD expansion column',p,x,z,r*2,height,r*2,bottom);
  };
  const stairs=(p:Placement,width:number,front:number,count:number,tread:number,rise:number)=>{
    for(let i=0;i<count;i++){const h=(count-i)*rise,z=front+(i+.5)*tread;box('paving',p,0,h/2,z,width,h,tread+.025,true);box('trim',p,0,h-.03,z+tread/2,width+.12,.06,.1);}
  };
  const textPlate=(p:Placement,text:string,w:number,y:number,z:number,color='#5d6156',fontSize=68)=>{
    if(typeof document==='undefined')return;
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=192;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.clearRect(0,0,2048,192);ctx.fillStyle=color;ctx.font=`500 ${fontSize}px Georgia, serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,1024,99,1980);
    const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;map.anisotropy=4;const mesh=new Mesh(new PlaneGeometry(w,w*192/2048),new MeshStandardMaterial({map,transparent:true,alphaTest:.06,depthWrite:false,roughness:1}));const at=local(p,0,z);mesh.position.set(at.x,at.baseY+y,at.z);mesh.rotation.y=p.yaw;mesh.name=`UMD landmark inscription · ${text}`;group.add(mesh);
  };
  const lawn=(x:number,z:number,w:number,d:number)=>{box('lawn',ORIGIN,x,.007,z,w,.014,d,true);footprints.push({x,z,width:w,depth:d,yaw:0});};
  const path=(a:[number,number],b:[number,number],width=6)=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),p={x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(dx,dz)};
    box('paving',p,0,.021,0,width,.042,length,true);
    for(const side of [-1,1])box('stone',p,side*(width/2+.11),.035,0,.22,.07,length,true);
  };
  const bench=(p:Placement)=>{
    for(const z of [-.27,0,.27])box('wood',p,0,.52,z,2.7,.12,.22);
    for(const y of [.95,1.19])box('wood',p,0,y,-.43,2.7,.17,.11);
    for(const x of [-1.03,1.03]){box('frame',p,x,.29,0,.09,.58,.75);box('frame',p,x,.84,-.4,.09,.94,.10);beam('frame',p,[x,.70,-.42],[x,.70,.35],.07);}
    collider('UMD garden bench',p,0,0,2.8,1.35,1.05);
  };
  const planter=(p:Placement,width=4)=>{
    box('brick',p,0,.36,0,width,.72,2.4);box('stone',p,0,.75,0,width+.2,.14,2.6);box('shade',p,0,.83,0,width-.5,.05,1.9);
    for(let i=0;i<Math.floor(width/.6);i++){const x=-width/2+.55+i*.6;sphere('leaf',p,x,1.09,0,.60,.50,.64);if(i%2===0)for(const dz of [-.37,.34])sphere('flower',p,x,1.42,dz,.11,.08,.11);}
    collider('UMD raised planter',p,0,0,width,1.1,2.5);
  };
  const lamp=(x:number,z:number)=>{
    const p={x,z,yaw:0};rod('frame',p,0,2.5,0,.075,5);box('stone',p,0,.14,0,.42,.28,.42);box('frame',p,0,4.85,0,.47,.12,.47);box('glass',p,0,5.11,0,.34,.44,.34);box('frame',p,0,5.39,0,.54,.12,.54);
    for(const dx of [-.2,.2])for(const dz of [-.2,.2])box('frame',p,dx,5.11,dz,.04,.51,.04);
  };

  // Three strips extend the existing 590×340 base without overlapping its
  // surface. All slabs and paths follow the same sampled elevation field.
  box('terrain',ORIGIN,0,-.09,-250,620,.18,160,true);box('terrain',ORIGIN,0,-.09,250,620,.18,160,true);
  for(const x of [-302.5,302.5])box('terrain',ORIGIN,x,-.09,0,15,.18,340,true);
  for(const x of [-116,116]){path([x,-155],[x,-68],6);path([x,68],[x,145],6);}
  path([-210,-155],[116,-155],7);path([-185,-155],[-185,-194],8);
  path([116,-140],[197,-140],7);path([-116,145],[170,145],7);path([110,145],[110,185],8);
  // Walkable piazzas, with a shallow brick inset that stays clear of blade roots.
  box('paving',ORIGIN,-185,.027,-187,104,.054,22,true);box('paving',ORIGIN,191,.027,-140,20,.054,76,true);box('paving',ORIGIN,110,.026,176,55,.052,20,true);
  for(const x of [-221,-149])box('brick',ORIGIN,x,.056,-187,18,.018,14,true);
  for(const z of [-165,-115])box('brick',ORIGIN,190,.056,z,13,.018,15,true);
  for(const x of [90,130])box('brick',ORIGIN,x,.056,176,9,.018,13,true);
  lawn(-170,-125,77,35);lawn(-32,-130,145,24);lawn(-32,-202,142,70);lawn(50,-258,210,64);
  lawn(169,-202,65,52);lawn(-169,125,76,33);lawn(-30,125,146,29);lawn(-24,205,140,88);lawn(204,226,119,113);
  lawn(-190,222,134,112);lawn(-260,-216,28,118);
  // Small clearings interrupt the large greens with seating and planted borders.
  path([-50,145],[-50,205],4);box('paving',ORIGIN,-50,.020,210,24,.04,16,true);
  path([170,145],[170,270],4);path([170,270],[58,270],4);path([58,270],[58,202],4);
  for(const p of [{x:-58,z:214,yaw:0},{x:-42,z:214,yaw:0},{x:158,z:260,yaw:Math.PI/2},{x:70,z:260,yaw:-Math.PI/2}])bench(p);

  // STAMP: a broad, low union with distinct projecting end pavilions and a
  // stone entrance. Glazing sits inside actual wall apertures on every elevation.
  shell('STAMP main union',STAMP,92,64,15.6,facadeOpenings(92,3,4.7,3.15,5.8,2.35,2.8).filter(o=>Math.abs(o.x)>13),facadeOpenings(92,3,4.7,3.15,5.8,2.35,2.8),facadeOpenings(64,3,4.7,3.15,5.8,2.3,2.8));
  cornice(STAMP,92,64,15.7);box('roof',STAMP,0,15.95,0,92,.18,64);
  for(const x of [-37,37]){
    const wing=shifted(STAMP,x,1);box('brick',wing,0,16.15,0,17,1.5,64);cornice(wing,17,64,17.1);roof(wing,18,65,17.3,3.5);
    for(const dx of [-5.8,0,5.8]){box('stone',wing,dx,9.9,32.3,.48,11.4,.65);box('trim',wing,dx,15.4,32.38,.81,.37,.8);}
  }
  const entry=shifted(STAMP,0,32.75);
  const stampDoors:Opening[]=[];for(const x of [-8,-4,0,4,8])stampDoors.push({x,y:2.25,w:3.15,h:4.25,door:true},{x,y:7.6,w:3.15,h:4.1},{x,y:12.1,w:3.15,h:3.2});
  wall(entry,26,15.1,stampDoors,'stone');box('trim',entry,0,5.05,.07,27,.48,1.2);box('trim',entry,0,14.9,.02,27.5,.4,1.5);
  box('stone',entry,0,5.9,2.9,29,.38,6.6);box('trim',entry,0,6.14,2.9,29.6,.12,6.8);
  for(const x of [-12.9,12.9]){box('stone',entry,x,2.8,5.0,.75,5.6,.75);collider('STAMP entrance pier',entry,x,5.0,.85,5.6,.85);}
  textPlate(entry,'ADELE H. STAMP STUDENT UNION',25,5.93,6.25,'#5d6156',28);
  for(const x of [-23,23]){box('brick',STAMP,x,10.8,32.42,4.2,6.6,.22);textPlate(shifted(STAMP,x,0),'STAMP',3.5,10.9,32.57,'#eadab5');}
  stairs(STAMP,28,38,3,.52,.12);
  // Keep the western planter clear of the new campus-wide approach to STAMP.
  for(const x of [-222,-148])for(const z of [-194,-179])planter({x,z:x===-222&&z===-179?-188:z,yaw:0},7);
  for(const x of [-209,-162])bench({x,z:-178,yaw:Math.PI});
  // Open-ended inverted U bicycle racks, with a generous clear forecourt.
  for(let i=0;i<6;i++){
    const p:Placement={x:-231+i*1.65,z:-173,yaw:Math.PI/2};const g=new TorusGeometry(.42,.055,6,16,Math.PI);const at=local(p,0,0);put('frame',g,at.x,.67,at.z,p.yaw,false,at.baseY);
    for(const x of [-.42,.42])rod('frame',p,x,.335,0,.055,.67,8);collider('STAMP bicycle stand',p,0,0,.95,1.1,.20);
  }

  // Reckord Armory: a long, ten-column classical front, ceremonial stair,
  // massive cornice and lower flanking wings distinguish it from the mall.
  const armoryFront=shifted(ARMORY,0,21.05),openings:Opening[]=[];
  for(const x of [-22.5,-17.5,-12.5,-7.5,-2.5,2.5,7.5,12.5,17.5,22.5]){
    const door=Math.abs(x)<10;openings.push({x,y:door?3.7:4.8,w:2.1,h:door?4.3:4.1,door},{x,y:10.8,w:1.9,h:3.1});
  }
  // The brick backing has the same apertures as the limestone front. Leaving
  // it solid would silently fill the recesses behind the white portico wall.
  shell('Reckord Armory hall',ARMORY,84,42,16.9,[...facadeOpenings(84,2,6.6,4,5.9,2.2,3.4).filter(o=>Math.abs(o.x)>28),...openings],facadeOpenings(84,2,6.6,4,5.9,2.2,3.4),facadeOpenings(42,2,6.6,4,5.6,2.2,3.4));
  roof(ARMORY,85.3,43.3,17.0,7.4,5);
  wall(armoryFront,53,15.9,openings,'trim');box('paving',ARMORY,0,.72,24.4,57,1.44,6.8,true);
  // Shallow pilasters and tiered door lintels break up the white backing wall,
  // as in the official exterior photograph, while the brick wings remain red.
  for(const x of [-26,-20,-10,10,20,26]){
    box('stone',armoryFront,x,8.15,.13,.46,13.1,.32);box('trim',armoryFront,x,14.78,.23,.77,.32,.46);
  }
  for(const x of [-7.5,-2.5,2.5,7.5]){
    box('stone',armoryFront,x,6.01,.17,3.2,.22,.52);box('trim',armoryFront,x,6.24,.27,3.55,.24,.72);box('trim',armoryFront,x,6.43,.35,3.8,.14,.87);
    for(const side of [-1,1])box('trim',armoryFront,x+side*1.30,4.0,.12,.20,4.65,.36);
  }
  box('stone',armoryFront,0,7.08,.12,53,.25,.36);box('trim',armoryFront,0,7.31,.18,53.4,.17,.48);
  for(let i=0;i<10;i++)column(ARMORY,(i-4.5)*5.5,27.0,1.44,13.5,.63);
  box('trim',ARMORY,0,15.50,24.5,58,1.12,7.6);cornice(shifted(ARMORY,0,24.6),58.3,7.9,16.36,true);
  pediment(ARMORY,58.4,16.9,28.65,8.0);textPlate(ARMORY,'R E C K O R D   A R M O R Y',44,15.51,28.36,'#5d6156',40);
  porticoRoof(shifted(ARMORY,0,24.5),59,8.3,17.1,8.0);
  stairs(ARMORY,57,28.8,9,.48,.16);
  for(const side of [-1,1]){
    box('brick',ARMORY,side*31.6,.72,30.9,4.8,1.44,9.0);box('stone',ARMORY,side*31.6,1.50,30.9,5.1,.18,9.3);collider('Armory terrace wall',ARMORY,side*31.6,30.9,5.1,1.65,9.3);
    for(let i=0;i<5;i++)rod('frame',ARMORY,side*27.8,1.0+(4-i)*.16,29.2+i*.8,.038,1.0,6);
    beam('frame',ARMORY,[side*27.8,2.12,29.2],[side*27.8,1.48,32.4],.07);
  }
  for(const z of [-170,-110])bench({x:183,z,yaw:Math.PI/2});
  for(const z of [-175,-105])planter({x:190,z,yaw:Math.PI/2},5);

  // Memorial Chapel: slender arched nave windows, flanking garden chapel,
  // four-column front and a clock/louver/steeple stack visible over the trees.
  const chapelFront:Opening[]=[{x:0,y:3.1,w:4.1,h:5.9,door:true},{x:-9,y:3.0,w:3.2,h:5.6,door:true},{x:9,y:3.0,w:3.2,h:5.6,door:true},{x:-9,y:9.0,w:2.3,h:3.8,arch:true},{x:0,y:9.0,w:2.3,h:3.8,arch:true},{x:9,y:9.0,w:2.3,h:3.8,arch:true}];
  const chapelSides:Opening[]=[];for(const x of [-25,-15,-5,5,15,25])chapelSides.push({x,y:6.1,w:3.1,h:7.5,arch:true});
  shell('Memorial Chapel nave',CHAPEL,30,64,12.3,chapelFront,facadeOpenings(30,1,1,6,6,2.5,6.5),chapelSides);
  // The nave ridge runs along its length, so rotate the roof relative to body.
  roof({...CHAPEL,yaw:CHAPEL.yaw+Math.PI/2},65.2,31.2,12.55,8.6,0);
  const chapelPortico=shifted(CHAPEL,0,34.2);box('paving',chapelPortico,0,.28,0,32,.56,5.8,true);
  for(const x of [-12.5,-4.2,4.2,12.5])column(CHAPEL,x,36,.56,11.15,.60);
  box('trim',CHAPEL,0,12.0,34.2,32.5,.68,6.1);cornice(chapelPortico,32.5,6.2,12.6,true);pediment(CHAPEL,33.0,13.0,37.65,7.2);
  porticoRoof(chapelPortico,33.6,7.0,13.2,7.25);stairs(CHAPEL,31,37.4,4,.47,.14);
  textPlate(CHAPEL,'MEMORIAL CHAPEL',27,12.02,37.36,'#5d6156',35);
  // Brick base to a white stepped tower. Clock faces use solid geometry so
  // they remain legible without a high-resolution external texture.
  const tower=shifted(CHAPEL,0,23.2);box('brick',tower,0,18.1,0,10.9,11.0,10.9);cornice(tower,11.2,11.2,23.6,true);
  box('trim',tower,0,25.8,0,10.2,4.2,10.2);cornice(tower,10.4,10.4,28.0,true);
  for(let face=0;face<4;face++){
    const p={...tower,yaw:tower.yaw+face*Math.PI/2},at=local(p,0,5.19),disk=new CylinderGeometry(1.49,1.49,.07,32);disk.rotateX(Math.PI/2);put('shade',disk,at.x,25.8,at.z,p.yaw,false,at.baseY);
    const rim=local(p,0,5.25);put('trim',new TorusGeometry(1.55,.12,6,32),rim.x,25.8,rim.z,p.yaw,false,rim.baseY);
    for(let i=0;i<12;i++){const a=i*Math.PI/6,x=Math.sin(a)*1.23,y=25.8+Math.cos(a)*1.23;const tick=new BoxGeometry(.075,.24,.07);tick.rotateZ(-a);const atTick=local(p,x,5.27);put('trim',tick,atTick.x,y,atTick.z,p.yaw,false,atTick.baseY);}
    beam('trim',p,[0,25.8,5.30],[.67,26.3,5.30],.09);beam('trim',p,[0,25.8,5.30],[-.45,26.78,5.30],.08);
  }
  box('trim',tower,0,31.3,0,7.7,6.2,7.7);
  for(let face=0;face<4;face++){
    const p={...tower,yaw:tower.yaw+face*Math.PI/2};box('shade',p,0,31.3,3.91,3.3,4.5,.11);
    for(let i=0;i<9;i++)box('trim',p,0,29.3+i*.48,4.02,3.0,.18,.22);
    for(const x of [-2.8,2.8])column(p,x,3.9,28.4,5.8,.30);
    pediment(p,8.8,35.0,4.6,1.8,false);
  }
  cornice(tower,8.4,8.4,34.8,true);
  const upper=new CylinderGeometry(3.0,3.9,4.8,8);put('trim',upper,tower.x,37.5,tower.z,tower.yaw+Math.PI/8,false,elevation(tower));
  for(let face=0;face<8;face++){
    const p={...tower,yaw:tower.yaw+face*Math.PI/4};box('shade',p,0,37.3,3.42,1.15,2.8,.08);for(let i=0;i<5;i++)box('trim',p,0,36.2+i*.48,3.50,1.25,.14,.13);
  }
  put('trim',new CylinderGeometry(3.35,3.45,.45,8),tower.x,40.2,tower.z,tower.yaw+Math.PI/8,false,elevation(tower));
  put('roof',new CylinderGeometry(.10,3.18,7.0,8),tower.x,43.8,tower.z,tower.yaw+Math.PI/8,false,elevation(tower));
  rod('bronze',tower,0,48.0,0,.075,1.4,8);sphere('bronze',tower,0,47.8,0,.23,.23,.23);
  beam('bronze',tower,[-.85,48.3,0],[.85,48.3,0],.09);
  const gardenWing:Placement={x:78,z:234,yaw:Math.PI};
  shell('Memorial Garden Chapel',gardenWing,34,24,7.8,facadeOpenings(34,1,1,3.9,5.2,1.8,4.0).map(o=>({...o,arch:true})),facadeOpenings(34,1,1,3.9,5.2,1.8,4.0),facadeOpenings(24,1,1,3.9,5.2,1.8,4.0));roof(gardenWing,35.2,25.2,7.9,5.1);
  box('brick',gardenWing,8,12.7,-3,1.4,3.4,1.9);box('trim',gardenWing,8,14.44,-3,1.7,.2,2.2);
  for(const x of [90,130])planter({x,z:166,yaw:0},5);
  for(const x of [85,135])bench({x,z:182,yaw:0});

  // A quiet remembrance garden with an open circular walking pattern. The
  // rings are inlaid paving, not curbs, and leave every approach unobstructed.
  const garden:Placement={x:26,z:232,yaw:0};box('paving',garden,0,.025,0,34,.05,34,true);path([26,232],[58,232],4);
  for(const radius of [5,8,11,14]){
    const g=new TorusGeometry(radius,.13,5,64,Math.PI*1.8);g.rotateX(-Math.PI/2);g.rotateY(radius%2?Math.PI:0);put('stone',g,garden.x,.08,garden.z,0,true);
  }
  for(const x of [7,45]){bench({x,z:248,yaw:0});planter({x,z:217,yaw:0},4);}
  // Repeated tree spacing forms recognisable avenues while trunks stay at
  // least 7m from graph routes and never sit in the arrival plazas.
  for(const x of [-128,-104,104,128])for(const z of [-123,119])trees.push({x,z,radius:4.0});
  for(const z of [-168,-142])for(const x of [-208,-155,-74,-28,25,77])trees.push({x,z,radius:4.2});
  for(const z of [132,158])for(const x of [-95,-70,-15,25,65,151])trees.push({x,z,radius:4.0});
  for(const x of [-249,-126])for(const z of [-282,-249,-220,-186])trees.push({x,z,radius:4.2});
  for(const x of [263,178])for(const z of [-204,-83])trees.push({x,z,radius:4.9});
  for(const x of [49,152])for(const z of [196,216,247])trees.push({x,z,radius:4.2});
  for(const x of [-244,-198,-140,-90,-40,20,88,151,213,265])trees.push({x,z:286,radius:4.6});
  // Leave the eastern opening clear for the full-campus engineering walkway.
  for(const x of [-260,-110,-64,-12,43,98,155,213])trees.push({x,z:-295,radius:4.6});
  for(const x of [-124,124])for(const z of [-112,115])lamp(x,z);
  for(const x of [-176,-91,0,90])lamp(x,-161);for(const x of [-94,-30,42,154])lamp(x,151);
  for(const p of [{x:-215,z:-173},{x:-154,z:-173},{x:182,z:-166},{x:182,z:-114},{x:90,z:160},{x:131,z:160},{x:176,z:228}])lamp(p.x,p.z);
  // Freestanding engraved plaques are small enough to fit real visitor scale.
  for(const p of [{x:-199,z:-176,yaw:0,text:'STAMP · CAMPUS LIFE'},{x:181,z:-128,yaw:-Math.PI/2,text:'RECKORD ARMORY'},{x:126,z:162,yaw:Math.PI,text:'MEMORIAL CHAPEL'}]){
    box('brick',p,0,.57,0,4.9,1.14,.65);box('stone',p,0,1.19,0,5.1,.15,.8);textPlate(p,p.text,4.55,.68,.342);collider('UMD landmark plaque',p,0,0,5.1,1.3,.8);
  }

  const palette:Record<Finish,string>={brick:'#a46752',stone:'#c8bca4',trim:'#e6dfca',roof:'#596f73',glass:'#617e88',frame:'#88938c',shade:'#304950',wood:'#846348',bronze:'#646c53',paving:'#c5bca7',lawn:'#859e63',terrain:'#7f985e',leaf:'#607a43',flower:'#d7b46b'};
  const source:Record<Finish,string>={brick:'brick',stone:'limestone',trim:'trim',roof:'roof',glass:'glass',frame:'frame',shade:'interiorShade',wood:'benchWood',bronze:'bronze',paving:'pavement',lawn:'grass',terrain:'grass',leaf:'grass',flower:'trim'};
  const materials=new Map<Finish,MeshStandardMaterial>();let lawnMesh:Mesh|undefined;
  for(const [name,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(p=>p.dispose());if(!geometry)throw new Error(`Cannot merge Maryland expansion ${name}`);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    let material=materials.get(batch.finish);if(!material){material=createCampusSurface(source[batch.finish],{yaw:0}) as MeshStandardMaterial;material.name=`Maryland expansion ${batch.finish}`;material.color=new Color(palette[batch.finish]);material.roughness=batch.finish==='glass'?.44:1;material.metalness=batch.finish==='bronze'?.3:0;materials.set(batch.finish,material);}
    const mesh=new Mesh(geometry,material);mesh.name=`UMD expansion ${name}`;mesh.castShadow=!batch.surface&&batch.finish!=='glass';mesh.receiveShadow=true;group.add(mesh);shadowMeshes.push(mesh);if(batch.surface)ground.push(mesh);if(batch.finish==='lawn')lawnMesh=mesh;
  }
  group.updateMatrixWorld(true);
  return {group,ground,walls,trees,lawns:lawnMesh?[{mesh:lawnMesh,footprints}]:[],setQuality:(low:boolean)=>{shadowMeshes.forEach(mesh=>{mesh.castShadow=!low&&!ground.includes(mesh)&&!mesh.name.includes('glass');});}};
}
