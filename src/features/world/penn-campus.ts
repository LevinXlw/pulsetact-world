import {BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Path, Quaternion, Shape, TorusGeometry, Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {PENN_LAYOUT} from './penn-layout';

type Finish='greenstone'|'sandstone'|'trim'|'brick'|'brickDark'|'slate'|'copper'|'glass'|'inset'|'frame'|'wood'|'paving'|'brickWalk'|'grass'|'bronze';
type Placement={x:number;z:number;yaw?:number};
type LawnFootprint={x:number;z:number;width:number;depth:number;yaw:number};
const UP=new Vector3(0,1,0);

/** A walkable, hand-modelled College Green vignette. See assets-source/penn.
 * Landmarks retain their real cardinal relationship and architectural language;
 * footprints and ornament are deliberately simplified, not a measured survey. */
export function createPennCampus(_wind:{value:number}) {
  const group=new Group();group.name='University of Pennsylvania · College Green';
  const ground:Mesh[]=[],walls:Mesh[]=[],shadowMeshes:Mesh[]=[];
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>();
  const transform=new Matrix4(),rotation=new Quaternion();
  const collisionMaterial=new MeshBasicMaterial();collisionMaterial.name='Penn invisible collision';
  const origin:Placement={x:0,z:0,yaw:0};
  const world=(p:Placement,x:number,z:number)=>{
    const c=Math.cos(p.yaw??0),s=Math.sin(p.yaw??0);return {x:p.x+x*c+z*s,z:p.z-x*s+z*c};
  };
  const put=(finish:Finish,g:BufferGeometry,p:Placement,x:number,y:number,z:number,surface=false)=>{
    const at=world(p,x,z);rotation.setFromAxisAngle(UP,p.yaw??0);
    transform.compose(new Vector3(at.x,y,at.z),rotation,new Vector3(1,1,1));g.applyMatrix4(transform);
    const geometry=g.index?g.toNonIndexed():g;if(geometry!==g)g.dispose();
    // Every primitive contributes matching position / normal / uv attributes.
    const key=`${surface?'ground':'building'}:${finish}`;
    const batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(geometry);batches.set(key,batch);
  };
  const box=(finish:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number,d:number,surface=false)=>put(finish,new BoxGeometry(w,h,d),p,x,y,z,surface);
  const cylinder=(finish:Finish,p:Placement,x:number,y:number,z:number,r:number,h:number,segments=16)=>put(finish,new CylinderGeometry(r,r,h,segments),p,x,y,z);
  const collider=(name:string,p:Placement,x:number,z:number,w:number,h:number,d:number)=>{
    const at=world(p,x,z),g=new BoxGeometry(w,h,d);g.computeBoundingBox();g.computeBoundingSphere();
    const mesh=new Mesh(g,collisionMaterial);mesh.position.set(at.x,h/2,at.z);mesh.rotation.y=p.yaw??0;
    mesh.name=name;mesh.visible=false;group.add(mesh);walls.push(mesh);
  };
  const block=(finish:Finish,p:Placement,x:number,z:number,w:number,h:number,d:number,name:string)=>{
    box(finish,p,x,h/2,z,w,h,d);collider(name,p,x,z,w,h,d);
  };
  const extrude=(shape:Shape,depth:number)=>new ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:8,steps:1});
  const archOutline=(w:number,h:number,pointed:boolean,offset=0)=>{
    const p=new Path();const r=w/2;
    p.moveTo(-r,offset);p.lineTo(r,offset);
    if(pointed){p.lineTo(r,offset+h*.59);p.quadraticCurveTo(r*.81,offset+h*.84,0,offset+h);p.quadraticCurveTo(-r*.81,offset+h*.84,-r,offset+h*.59);}
    else {p.lineTo(r,offset+h-r);p.absarc(0,offset+h-r,r,0,Math.PI,false);}
    p.closePath();return p;
  };
  const archShape=(w:number,h:number,pointed:boolean)=>{
    const shape=new Shape();shape.curves=archOutline(w,h,pointed).curves;return shape;
  };
  const arch=(p:Placement,x:number,bottom:number,z:number,w:number,h:number,pointed=true,trim:Finish='sandstone',pane:Finish='glass',border=.24)=>{
    const dark=extrude(archShape(w+.18,h+.09,pointed),.07);put('inset',dark,p,x,bottom,z);
    const glass=extrude(archShape(w,h,pointed),.055);put(pane,glass,p,x,bottom+.045,z+.09);
    const frame=archShape(w+border*2,h+border*1.18,pointed);
    frame.holes.push(archOutline(w,h,pointed,.06));
    put(trim,extrude(frame,.30),p,x,bottom-.04,z+.12);
    box(trim,p,x,bottom-.09,z+.30,w+border*2+.22,.19,.56);
    if(pane==='glass'){
      box('frame',p,x,bottom+h*.42,z+.19,.095,h*.80,.10);
      box('frame',p,x,bottom+h*.37,z+.19,w,.085,.10);
      if(w>2.7)for(const side of [-1,1])box('frame',p,x+side*w*.26,bottom+h*.33,z+.19,.065,h*.62,.10);
    }
  };
  const doubleDoor=(p:Placement,x:number,bottom:number,z:number,w:number,h:number,pointed:boolean)=>{
    // A monumental portal frames doors of human scale. The upper arch and
    // fixed sidelights are opaque painted glazing, not an accessible interior.
    put('glass',extrude(archShape(w-.28,h-.16,pointed),.035),p,x,bottom+.06,z+.175);
    const doorWidth=Math.min(2.90,w*.60),doorHeight=3.32,half=doorWidth/2;
    box('inset',p,x,bottom+doorHeight/2+.05,z+.23,doorWidth+.20,doorHeight+.10,.07);
    for(const side of [-1,1]){
      const leafX=x+side*(half/2+.018),leafWidth=half-.055;
      box('wood',p,leafX,bottom+doorHeight/2+.05,z+.275,leafWidth,doorHeight,.10);
      // Raised outer stiles, a lower timber panel and upper inset glazing.
      for(const edge of [-1,1])box('wood',p,leafX+edge*(leafWidth/2-.085),bottom+doorHeight/2+.05,z+.345,.12,doorHeight,.075);
      for(const y of [.17,1.43,3.27])box('wood',p,leafX,bottom+y,z+.345,leafWidth,.13,.075);
      box('inset',p,leafX,bottom+.80,z+.337,leafWidth-.34,.94,.026);
      box('wood',p,leafX,bottom+.80,z+.360,leafWidth-.46,.82,.045);
      box('glass',p,leafX,bottom+2.31,z+.337,leafWidth-.34,1.50,.028);
      box('wood',p,leafX,bottom+2.31,z+.365,.065,1.49,.055);
      box('wood',p,leafX,bottom+2.31,z+.365,leafWidth-.34,.065,.055);
      box('bronze',p,x+side*.22,bottom+1.68,z+.382,.105,.61,.055);
      box('bronze',p,x+side*.22,bottom+1.68,z+.46,.065,.42,.12);
      box('bronze',p,leafX,bottom+.18,z+.386,leafWidth-.16,.17,.025);
    }
    // Recessed central seam and deep fixed jambs separate the two leaves.
    box('inset',p,x,bottom+doorHeight/2+.05,z+.34,.046,doorHeight,.035);
    for(const side of [-1,1])box('wood',p,x+side*(half+.15),bottom+1.84,z+.30,.21,3.65,.24);
    box('wood',p,x,bottom+3.66,z+.30,w-.30,.20,.25);
    box('wood',p,x,bottom+.10,z+.30,w-.30,.12,.23);
    const fanBottom=3.80,fanTop=h-.28;
    box('wood',p,x,bottom+(fanBottom+fanTop)/2,z+.27,.11,fanTop-fanBottom,.14);
    for(const side of [-1,1]){
      const top=pointed?h*.76:h*.85;
      box('wood',p,x+side*w*.24,bottom+(fanBottom+top)/2,z+.27,.085,top-fanBottom,.14);
    }
  };
  const rectWindow=(p:Placement,x:number,y:number,z:number,w:number,h:number,trim:Finish='trim')=>{
    box('inset',p,x,y,z,w+.32,h+.30,.09);box('glass',p,x,y,z+.065,w,h,.06);
    for(const side of [-1,1])box(trim,p,x+side*(w/2+.11),y,z+.16,.19,h+.38,.31);
    box(trim,p,x,y+h/2+.13,z+.16,w+.44,.20,.32);box(trim,p,x,y-h/2-.13,z+.23,w+.58,.24,.49);
    box('frame',p,x,y,z+.13,.075,h,.10);box('frame',p,x,y,z+.13,w,.075,.10);
  };
  const cornice=(p:Placement,w:number,d:number,y:number,finish:Finish='sandstone')=>{
    box(finish,p,0,y,0,w+.22,.23,d+.22);
    box(finish,p,0,y+.22,0,w+.62,.20,d+.62);
    box(finish,p,0,y+.42,0,w+1.0,.21,d+1.0);
  };
  const gable=(p:Placement,x:number,z:number,w:number,d:number,eave:number,rise:number,wall:Finish='greenstone',roof:Finish='slate')=>{
    const triangle=new Shape();triangle.moveTo(-w/2,0);triangle.lineTo(w/2,0);triangle.lineTo(0,rise);triangle.closePath();
    const body=extrude(triangle,d);body.translate(0,0,-d/2);put(wall,body,p,x,eave,z);
    const angle=Math.atan2(rise,w/2),length=Math.hypot(w/2,rise)+.74;
    for(const side of [-1,1]){
      const plane=new BoxGeometry(length,.21,d+.70);plane.rotateZ(-side*angle);
      put(roof,plane,p,x+side*w/4,eave+rise/2+.15,z);
    }
    box(roof,p,x,eave+rise+.22,z,.34,.28,d+.90);
    for(const end of [-1,1])for(const side of [-1,1]){
      const edge=new BoxGeometry(length,.24,.30);edge.rotateZ(-side*angle);
      put('sandstone',edge,p,x+side*w/4,eave+rise/2+.20,z+end*(d/2+.40));
    }
  };
  const stairs=(p:Placement,x:number,z:number,w:number,count:number,step=.17,tread=.44)=>{
    // Every riser shares the inner landing edge; each next tread is shorter
    // toward the front. This avoids gaps or falling off the last upper tread.
    const inside=z-count*tread;
    for(let i=0;i<count;i++){
      const depth=(count-i)*tread;
      box('paving',p,x,step*(i+1)/2,inside+depth/2,w,step*(i+1),depth,true);
    }
  };
  const strip=(path:readonly (readonly number[])[],width:number,finish:Finish,y=.028)=>{
    for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      const p={x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(dx,dz)};
      box(finish,p,0,y-.018,0,width,.036,length+width*.15,true);
    }
  };

  // A level, continuous outdoor floor. Turf patches are disjoint from the
  // authored paths, so close grass never emerges through the brick paving.
  box('paving',origin,-6.5,-.045,7,303,.09,250,true);
  const lawnPatches:LawnFootprint[]=[
    {x:-77,z:-31.5,width:78,depth:47,yaw:0},
    {x:22,z:-31.5,width:68,depth:47,yaw:0},
    {x:-77,z:12,width:78,depth:23,yaw:0},
    {x:13,z:13,width:52,depth:18,yaw:0},
    {x:-129,z:53,width:25,depth:92,yaw:0},
    {x:126,z:78,width:20,depth:76,yaw:0},
  ];
  for(const lawn of lawnPatches)box('grass',origin,lawn.x,.013,lawn.z,lawn.width,.026,lawn.depth,true);
  strip([[-153,-12],[-121,-12],[-118,-3],[-23,-3],[52,-3],[61,11]],8,'brickWalk',.043);
  strip([[-23,-64],[-23,44]],9,'brickWalk',.044);
  strip([[-121,29],[58,29],[61,11],[62,-57]],8,'brickWalk',.045);
  strip([[-121,-62],[66,-62]],7,'paving',.046);
  strip([[-121,-62],[-121,100]],7,'brickWalk',.045);
  strip([[62,-62],[62,67],[62,100],[-121,100]],7,'brickWalk',.045);
  // Light granite strips at the path edge and cross joints catch evening sun.
  for(const x of [-28.0,-18.0])box('trim',origin,x,.052,-10,.23,.075,105);
  for(let z=-61;z<43;z+=7.4)box('trim',origin,-23,.063,z,9,.03,.10);
  for(let x=-117;x<60;x+=11)box('trim',origin,x,.064,29,.11,.03,8.0);

  // College Hall faces north over College Green. Its nineteenth-century tall
  // towers were removed in 1914 and 1929; this is the present gabled silhouette.
  const college={x:-23,z:65,yaw:0};
  block('greenstone',college,0,0,112,18.8,34,'College Hall main body');
  box('sandstone',college,0,.56,0,112.65,1.12,34.65);
  for(const y of [5.55,11.60,18.15])box('sandstone',college,0,y,0,112.45,.28,34.45);
  cornice(college,112,34,18.78);
  gable({x:college.x,z:college.z,yaw:Math.PI/2},0,0,34.4,112.4,19.20,9.4);
  // Projecting ends and central bay break the long plane into deep masses.
  for(const x of [-46.5,46.5]){
    block('greenstone',college,x,-2,17,21.4,39.0,`College Hall ${x<0?'west':'east'} bay`);
    const bay={x:college.x+x,z:college.z-2,yaw:0};cornice(bay,17,39,21.3);
    gable(bay,0,0,18,39.7,21.8,7.3);
  }
  block('greenstone',college,0,-3.5,18.0,23.8,41,'College Hall central bay');
  const central={x:college.x,z:college.z-3.5,yaw:0};cornice(central,18,41,23.7);gable(central,0,0,18.8,41.7,24.2,8.4);
  const north={x:college.x,z:48,yaw:Math.PI},south={x:college.x,z:82,yaw:0};
  for(const face of [north,south])for(const x of [-35,-28,-21,-14,14,21,28,35]){
    arch(face,x,1.25,.03,2.45,4.10,true);
    arch(face,x,6.65,.03,2.45,4.25,true);
    arch(face,x,12.55,.03,2.45,4.35,true);
  }
  // Alternating masonry voussoirs add real relief around the broad gables.
  for(const bx of [-46.5,46.5])for(const end of [-1,1]){
    const face={x:college.x+bx,z:college.z-2+end*19.52,yaw:end<0?Math.PI:0};
    for(const x of [-4.7,0,4.7])for(const bottom of [1.25,7.1,13.0])arch(face,x,bottom,.03,2.4,4.2,true);
    arch(face,0,22.0,.04,3.0,4.4,true);
    for(const side of [-1,1])box('sandstone',face,side*7.8,11.0,.21,.48,21.8,.46);
  }
  const entrance={x:college.x,z:41,yaw:Math.PI};
  arch(entrance,0,.58,.03,5.2,7.5,true,'sandstone','wood',.48);
  doubleDoor(entrance,0,.58,.03,5.2,7.5,true);
  for(const dx of [-1,1]){
    cylinder('sandstone',entrance,dx*3.25,3.55,.36,.30,6.0,12);
    box('sandstone',entrance,dx*3.25,.65,.36,.86,.42,.84);
    box('sandstone',entrance,dx*3.25,6.6,.36,.84,.4,.84);
  }
  for(const bottom of [9.5,16.0])for(const x of [-4.5,0,4.5])arch(entrance,x,bottom,.03,2.55,4.8,true);
  const rose=new TorusGeometry(1.25,.16,8,24);put('sandstone',rose,entrance,0,28.0,.18);
  put('glass',new CylinderGeometry(1.08,1.08,.07,24).rotateX(Math.PI/2),entrance,0,28.0,.12);
  for(const angle of [0,Math.PI/3,-Math.PI/3]){
    const spoke=new BoxGeometry(.09,2.05,.09);spoke.rotateZ(angle);put('frame',spoke,entrance,0,28.0,.25);
  }
  // College entrance has shallow climbable steps; arrive at the foot of them.
  stairs(entrance,0,2.5,9,4,.16,.50);
  box('paving',entrance,0,.32,.25,9,.64,.5,true);
  for(const x of [-33,-22,22,33]){
    const dormer={x:college.x+x,z:college.z-12.5,yaw:Math.PI};
    box('greenstone',dormer,0,24.3,0,3.8,4.6,4.8);gable(dormer,0,0,4.6,5.1,26.5,2.5);
    arch(dormer,0,23.1,2.51,1.8,3.0,true);
  }
  for(const x of [-55,55])for(const z of [-15,15]){
    box('sandstone',college,x,10.0,z,.72,20,.72);
    box('sandstone',college,x,20.15,z,1.0,.38,1.0);
  }

  // Fisher's west entrance faces the Green. The rounded stair tower, tall
  // reading hall, layered roof and lower south wing form separate volumes.
  const fisher={x:95,z:11,yaw:0};
  block('brick',fisher,0,0,38,23.7,56,'Fisher Fine Arts reading hall');
  block('brickDark',fisher,2,34,34,14.2,19,'Fisher Fine Arts south wing');
  box('sandstone',fisher,0,2.2,0,38.5,4.4,56.5);
  box('sandstone',fisher,2,1.7,34,34.5,3.4,19.5);
  for(const y of [4.55,12.10,20.75])box('sandstone',fisher,0,y,0,38.5,.28,56.5);
  cornice(fisher,38,56,23.6,'brickDark');
  gable(fisher,0,0,39,57,24.15,12.4,'brick','slate');
  // Long copper roof lantern with louvres is a defining Furness silhouette.
  box('copper',fisher,0,36.65,0,5.1,2.0,33);
  gable(fisher,0,0,6.1,34,37.65,1.8,'copper','copper');
  for(const x of [-1,1])for(let z=-15;z<=15;z+=1.0)box('inset',fisher,x*2.57,36.65,z,.075,1.2,.16);
  gable({x:97,z:45,yaw:Math.PI/2},0,0,20.0,35,14.5,6.1,'brickDark','slate');
  const west={x:75.97,z:11,yaw:-Math.PI/2};
  for(const x of [-20,-10,0,10,20]){
    arch(west,x,5.5,.03,5.4,10.2,false,'sandstone','glass',.42);
    for(const side of [-1,1])cylinder('sandstone',west,x+side*3.18,8.4,.42,.25,6.3,12);
    box('sandstone',west,x,17.0,.13,6.8,.35,.46);
    arch(west,x,18.0,.03,3.1,4.0,false,'brickDark','glass',.27);
  }
  for(let x=-25;x<=25;x+=5)box('brickDark',west,x,12.5,.17,.65,24.8,.64);
  const east={x:114.03,z:11,yaw:Math.PI/2};
  for(let x=-23;x<=23;x+=5.75)for(const bottom of [5.6,13.0])arch(east,x,bottom,.03,2.6,5.6,false,'sandstone','glass',.25);
  // Entrance loggia projects west; nested segmental arches and short columns
  // have thickness rather than relying on dark rectangles painted on the wall.
  const porch={x:71.9,z:11,yaw:-Math.PI/2};
  box('brickDark',porch,0,6.6,0,13.2,9.8,4.8);
  collider('Fisher entrance pavilion',porch,0,0,13.2,11.5,4.8);
  arch(porch,0,1.4,2.44,6.6,7.4,false,'sandstone','wood',.75);
  doubleDoor(porch,0,1.4,2.44,6.6,7.4,false);
  for(const side of [-1,1]){
    cylinder('sandstone',porch,side*4.4,4.4,3.0,.60,5.5,16);
    box('sandstone',porch,side*4.4,1.62,3.0,1.48,.40,1.48);
    box('sandstone',porch,side*4.4,7.25,3.0,1.52,.40,1.52);
    box('brickDark',porch,side*6.0,6.4,1.9,1.12,12.8,1.8);
  }
  box('sandstone',porch,0,10.75,1.6,13.7,.45,5.5);
  box('brick',porch,0,11.5,1.6,13.5,1.0,5.1);
  box('sandstone',porch,0,12.05,1.6,14.0,.24,5.65);
  stairs(porch,0,6.2,13.5,8,.17,.45);
  box('paving',porch,0,.68,2.52,13.5,1.36,.18,true);
  // Thick semicircular stone wedges articulate the entry arch's masonry bond.
  for(let i=0;i<13;i++){
    const a=i*Math.PI/13+.016,b=(i+1)*Math.PI/13-.016,shape=new Shape();
    shape.moveTo(Math.cos(a)*4.22,Math.sin(a)*4.22);
    shape.absarc(0,0,4.22,a,b,false);shape.lineTo(Math.cos(b)*3.66,Math.sin(b)*3.66);
    shape.absarc(0,0,3.66,b,a,true);shape.closePath();
    put(i%3===0?'brickDark':'sandstone',extrude(shape,.26),porch,0,5.5,2.92);
  }
  // Round stair turret, situated at the north-west corner of the library.
  const tower={x:77.5,z:-19.5,yaw:0};
  cylinder('sandstone',tower,0,2.2,0,7.55,4.4,24);
  cylinder('brick',tower,0,15.3,0,7.30,26.2,24);
  cylinder('sandstone',tower,0,8.1,0,7.53,.45,24);
  cylinder('sandstone',tower,0,18.1,0,7.57,.45,24);
  cylinder('brickDark',tower,0,27.85,0,7.68,.90,24);
  cylinder('sandstone',tower,0,28.45,0,7.87,.32,24);
  cylinder('slate',tower,0,28.65,0,7.28,.20,24);
  collider('Fisher stair turret',tower,0,0,14.6,29,14.6);
  for(let i=0;i<12;i++){
    const angle=i*Math.PI/6,at={x:tower.x+Math.sin(angle)*7.32,z:tower.z+Math.cos(angle)*7.32,yaw:angle};
    if(i%2===0){arch(at,0,9.5,.03,2.0,6.4,false,'sandstone','glass',.28);arch(at,0,20.0,.03,1.55,4.7,false,'brickDark','glass',.26);}
    box('brickDark',at,0,29.50,0,1.85,2.0,.95);
    box('sandstone',at,0,30.50,.02,2.10,.22,1.12);
    box('sandstone',at,0,26.8,.48,.42,.35,1.75);
  }
  // North reading-room gable, visible from the east-west lawn path.
  const fisherNorth={x:95,z:-17.04,yaw:Math.PI};
  arch(fisherNorth,0,7.0,.03,10.2,13.4,false,'sandstone','glass',.5);
  arch(fisherNorth,0,25.7,.03,3.0,5.2,false,'sandstone','glass',.30);
  for(const x of [-15.9,15.9])box('sandstone',fisherNorth,x,14.2,.28,.83,28.4,.83);

  // The northern edge is anchored by the modern Van Pelt Library. Restrained
  // infill geometry makes the historic landmarks read as part of a real campus.
  const vanPelt={x:-28,z:-87,yaw:0};
  block('brickDark',vanPelt,0,0,122,21.0,36,'Van Pelt Library');
  box('trim',vanPelt,0,1.0,0,122.5,2.0,36.5);
  cornice(vanPelt,122,36,20.95,'trim');box('slate',vanPelt,0,21.65,0,122,.45,36);
  const libraryFace={x:-28,z:-68.95,yaw:0};
  for(let x=-56;x<=56;x+=7){
    box('sandstone',libraryFace,x,10.6,.25,.72,20.8,.72);
    for(const y of [5.3,10.5,15.7])rectWindow(libraryFace,x+2.9,y,.04,3.3,3.2,'sandstone');
  }
  const meyerson={x:101,z:-65,yaw:0};
  block('sandstone',meyerson,0,0,56,16.5,39,'Meyerson Hall');
  box('slate',meyerson,0,17.0,0,57,.6,40);
  for(const side of [-1,1])for(let x=-23;x<=23;x+=5.75)for(const y of [4.0,9.0,14.0])rectWindow({x:101,z:-65+side*19.52,yaw:side<0?Math.PI:0},x,y,.03,3.65,2.7,'trim');
  const cohen={x:-23,z:116,yaw:0};
  block('greenstone',cohen,0,0,69,17.0,26,'Cohen Hall');
  cornice(cohen,69,26,16.9);gable({x:-23,z:116,yaw:Math.PI/2},0,0,27,69,17.4,7.2);
  for(let x=-28;x<=28;x+=7)for(const y of [2.1,8.4])arch({x:-23,z:102.95,yaw:Math.PI},x,y,.03,2.7,4.6,true);

  // Human-scale details: slatted benches, stone planters and lanterns. Keep
  // all objects away from route centre lines, including destination arrivals.
  const bench=(x:number,z:number,yaw=0)=>{
    const p={x,z,yaw};
    for(let i=0;i<5;i++)box('wood',p,0,.55,-.38+i*.18,2.4,.10,.13);
    for(let i=0;i<3;i++)box('wood',p,0,.90+i*.18,-.43,2.4,.13,.09);
    for(const dx of [-.85,.85]){
      box('bronze',p,dx,.31,0,.12,.6,.75);box('bronze',p,dx,.82,-.43,.10,1.0,.12);
      box('bronze',p,dx,.85,0,.10,.10,.73);
    }
    collider('College Green bench',p,0,0,2.5,1.4,1.0);
  };
  for(const [x,z,yaw] of [[-106,24,0],[-85,24,0],[-46,24,0],[3,24,0],[30,24,0],[-107,-57,Math.PI],[-68,-57,Math.PI],[-6,-57,Math.PI],[43,-57,Math.PI],[57,46,Math.PI/2]])bench(x,z,yaw);
  const lamp=(x:number,z:number)=>{
    const p={x,z,yaw:0};cylinder('bronze',p,0,.15,0,.24,.30,8);cylinder('bronze',p,0,2.15,0,.075,4.2,8);
    cylinder('bronze',p,0,4.18,0,.31,.13,8);box('glass',p,0,4.5,0,.42,.58,.42);
    for(const sx of [-1,1])for(const sz of [-1,1])box('bronze',p,sx*.23,4.5,sz*.23,.045,.64,.045);
    const cap=new CylinderGeometry(.12,.39,.27,4);cap.rotateY(Math.PI/4);put('bronze',cap,p,0,4.93,0);
    collider('College Green lantern',p,0,0,.40,4.9,.40);
  };
  for(const [x,z] of [[-30,-55],[-30,18],[-115,24],[48,24],[-115,-53],[55,-53],[57,59],[-115,74]])lamp(x,z);
  for(const x of [-35,-11]){
    box('sandstone',origin,x,.45,35,2.5,.9,2.5);box('sandstone',origin,x,.96,35,2.8,.18,2.8);
    box('grass',origin,x,1.08,35,2.32,.15,2.32);collider('College Hall planted urn',origin,x,35,2.8,1.2,2.8);
  }

  const trees=[[-105,-36],[-87,-17],[-58,-39],[-42,-18],[0,-40],[27,-38],[42,-18],[-101,8],[-59,9],[12,9],[-132,20],[-132,52],[-133,86],[128,59],[127,91],[-141,-84],[-115,114],[60,113]]
    .map(([x,z],i)=>({x,z,radius:3.7+(i%4)*.42}));
  const finishes=new Map<Finish,MeshStandardMaterial>();
  const colors:Record<Finish,string>={greenstone:'#7f9484',sandstone:'#b18c70',trim:'#d1c3a6',brick:'#a3533c',brickDark:'#884a3c',slate:'#58666a',copper:'#688c83',glass:'#496a6a',inset:'#243937',frame:'#a59072',wood:'#70553d',paving:'#c2b99f',brickWalk:'#ac735b',grass:'#7e9862',bronze:'#485a50'};
  const sources:Record<Finish,string>={greenstone:'limestone',sandstone:'limestone',trim:'trim',brick:'brick',brickDark:'brick',slate:'roof',copper:'metal',glass:'glass',inset:'interiorShade',frame:'frame',wood:'benchWood',paving:'pavement',brickWalk:'brick',grass:'grass',bronze:'bronze'};
  const material=(finish:Finish)=>{
    if(finishes.has(finish))return finishes.get(finish)!;
    const m=createCampusSurface(sources[finish],{yaw:0}) as MeshStandardMaterial;
    m.name=`Penn ${finish}`;m.color=new Color(colors[finish]);
    if(finish==='glass'){m.roughness=.55;m.metalness=.12;}
    finishes.set(finish,m);return m;
  };
  const lawns:{mesh:Mesh;footprints:LawnFootprint[]}[]=[];
  for(const [key,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(g=>g.dispose());
    if(!geometry)throw new Error(`Cannot merge Penn ${key}`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,material(batch.finish));mesh.name=`Penn ${key}`;
    mesh.castShadow=!batch.surface&&batch.finish!=='glass';mesh.receiveShadow=true;
    group.add(mesh);shadowMeshes.push(mesh);
    if(batch.surface)ground.push(mesh);
    if(batch.surface&&batch.finish==='grass')lawns.push({mesh,footprints:lawnPatches});
  }
  group.updateMatrixWorld(true);
  group.userData.campusBounds=PENN_LAYOUT.bounds;
  return {group,ground,walls,trees,lawns,setQuality:(low:boolean)=>{
    shadowMeshes.forEach(mesh=>{mesh.castShadow=!low&&!ground.includes(mesh)&&!mesh.name.endsWith(':glass');});
  }};
}
