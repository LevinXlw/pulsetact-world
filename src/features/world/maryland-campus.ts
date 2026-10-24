import {BoxGeometry,BufferGeometry,CanvasTexture,Color,CylinderGeometry,ExtrudeGeometry,Float32BufferAttribute,Group,LatheGeometry,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Quaternion,Shape,ShapeGeometry,SphereGeometry,SRGBColorSpace,TorusGeometry,Vector2,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {createCampusWaterMaterial,CampusWaterMaterial} from './campus-water';
import {marylandElevation,drapeMarylandGeometry} from './maryland-terrain';

/** Authored outdoor approximation of the McKeldin Mall campus plan, in metres.
 * Official photographs/plan references are recorded in assets-source/maryland.
 * East is +x, south is +z. Terrain follows the shared Maryland elevation field.
 */
type Finish='brick'|'stone'|'trim'|'roof'|'glass'|'frame'|'shade'|'wood'|'bronze'|'patina'|'paving'|'lawn'|'terrain'|'water';
type Placement={x:number;z:number;yaw:number;baseY?:number};
type Footprint={x:number;z:number;width:number;depth:number;yaw:number};
type Opening={x:number;y:number;width:number;height:number;kind?:'window'|'door'|'archedDoor';stone?:boolean;simple?:boolean};
const UP=new Vector3(0,1,0);
const LIBRARY:Placement={x:-160,z:0,yaw:Math.PI/2};
const ADMIN:Placement={x:160,z:0,yaw:-Math.PI/2};

export function createMarylandCampus(wind:{value:number}) {
  const group=new Group();group.name='University of Maryland · McKeldin Mall';
  const ground:Mesh[]=[],walls:Mesh[]=[],shadowMeshes:Mesh[]=[];
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>();
  const transform=new Matrix4(),rotation=new Quaternion();
  const invisible=new MeshBasicMaterial();invisible.name='UMD collision';
  const elevation=(p:Placement)=>p.baseY??marylandElevation(p.x,p.z);
  const local=(p:Placement,x:number,z:number)=>({x:p.x+x*Math.cos(p.yaw)+z*Math.sin(p.yaw),z:p.z-x*Math.sin(p.yaw)+z*Math.cos(p.yaw),baseY:elevation(p)});
  const put=(finish:Finish,g:BufferGeometry,x:number,y:number,z:number,yaw=0,surface=false,baseY=marylandElevation(x,z))=>{
    rotation.setFromAxisAngle(UP,yaw);transform.compose(new Vector3(x,y+(surface?0:baseY),z),rotation,new Vector3(1,1,1));g.applyMatrix4(transform);
    if(surface){const flat=g;g=drapeMarylandGeometry(flat);flat.dispose();}
    const part=g.index?g.toNonIndexed():g;if(part!==g)g.dispose();
    // Consistent attributes allow box, lathe, shaped and manually-authored roofs
    // to share one draw per finish without exploding facade draw calls.
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${surface?'ground':'detail'}-${finish}`;
    const batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const box=(finish:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number,d:number,surface=false)=>{
    const at=local(p,x,z);put(finish,new BoxGeometry(w,h,d),at.x,y,at.z,p.yaw,surface,at.baseY);
  };
  const collider=(name:string,p:Placement,x:number,z:number,w:number,h:number,d:number,bottom=0)=>{
    const at=local(p,x,z),mesh=new Mesh(new BoxGeometry(w,h,d),invisible);mesh.name=name;
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    mesh.position.set(at.x,at.baseY+bottom+h/2,at.z);mesh.rotation.y=p.yaw;mesh.visible=false;group.add(mesh);walls.push(mesh);
  };
  const sphere=(finish:Finish,p:Placement,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{
    const g=new SphereGeometry(1,12,8);g.scale(sx,sy,sz);const at=local(p,x,z);put(finish,g,at.x,y,at.z,p.yaw,false,at.baseY);
  };
  const rod=(finish:Finish,p:Placement,x:number,y:number,z:number,r:number,h:number)=>{
    const at=local(p,x,z);put(finish,new CylinderGeometry(r,r,h,12),at.x,y,at.z,p.yaw,false,at.baseY);
  };
  const beam=(finish:Finish,p:Placement,a:[number,number,number],b:[number,number,number],thick:number,depth=thick)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),g=new BoxGeometry(length,thick,depth);
    g.rotateZ(Math.atan2(dy,dx));const at=local(p,(a[0]+b[0])/2,(a[2]+b[2])/2);
    put(finish,g,at.x,(a[1]+b[1])/2,at.z,p.yaw,false,at.baseY);
  };
  const arch=(finish:Finish,p:Placement,x:number,bottom:number,z:number,w:number,h:number)=>{
    const s=new Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h-w/2);
    s.absarc(0,h-w/2,w/2,0,Math.PI,false);s.lineTo(-w/2,0);s.closePath();
    const at=local(p,x,z);put(finish,new ShapeGeometry(s,8),at.x,bottom,at.z,p.yaw,false,at.baseY);
  };
  const pediment=(p:Placement,w:number,y:number,z:number,rise:number,oculus=true)=>{
    const shape=new Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(0,rise);shape.closePath();
    // The tympanum is a solid stone panel with a true circular aperture. The
    // old single triangle put the round window over solid, unbroken plaster.
    const cy=rise*.44,radius=Math.min(.94,rise*.19);
    if(oculus){const hole=new Path();hole.absarc(0,cy,radius,0,Math.PI*2,true);shape.holes.push(hole);}
    const at=local(p,0,z-.62);put('trim',new ExtrudeGeometry(shape,{depth:.62,bevelEnabled:false,curveSegments:16}),at.x,y,at.z,p.yaw,false,at.baseY);
    box('trim',p,0,y-.25,z-.31,w+.7,.5,1.2);
    box('shade',p,0,y-.54,z-.1,w+.4,.07,.78);
    for(const side of [-1,1]){
      beam('stone',p,[side*(w/2+.12),y+.02,z+.1],[0,y+rise+.12,z+.1],.30,.30);
      beam('trim',p,[side*(w/2+.39),y+.24,z+.24],[0,y+rise+.4,z+.24],.24,.58);
      beam('roof',p,[side*(w/2+.57),y+.43,z-.16],[0,y+rise+.6,z-.16],.15,1.3);
    }
    if(oculus){
      const ringAt=local(p,0,z+.045);put('stone',new TorusGeometry(radius+.13,.15,8,32),ringAt.x,y+cy,ringAt.z,p.yaw,false,ringAt.baseY);
      const round=new CylinderGeometry(radius-.035,radius-.035,.055,32);round.rotateX(Math.PI/2);
      const glassAt=local(p,0,z-.34);put('glass',round,glassAt.x,y+cy,glassAt.z,p.yaw,false,glassAt.baseY);
      for(const k of [-.5,0,.5]){
        const segment=2*Math.sqrt(Math.max(0,radius*radius-k*k));
        box('frame',p,k,y+cy,z-.27,.055,segment,.075);box('frame',p,0,y+cy+k,z-.27,segment,.055,.075);
      }
    }
    const count=Math.floor(w/.8);
    for(let i=0;i<count;i++)box('trim',p,(i-(count-1)/2)*.8,y-.66,z+.18,.28,.26,.40);
  };
  const pitchedRoof=(p:Placement,w:number,d:number,eave:number,rise:number,hip=2.6)=>{
    const ridge=Math.max(0,w/2-hip);
    const vertices=[
      -w/2,0,-d/2, -ridge,rise,0, ridge,rise,0, -w/2,0,-d/2, ridge,rise,0, w/2,0,-d/2,
      -ridge,rise,0, -w/2,0,d/2, w/2,0,d/2, -ridge,rise,0, w/2,0,d/2, ridge,rise,0,
      -w/2,0,-d/2, -w/2,0,d/2, -ridge,rise,0, w/2,0,-d/2,ridge,rise,0,w/2,0,d/2,
      -w/2,0,-d/2,w/2,0,-d/2,w/2,0,d/2,-w/2,0,-d/2,w/2,0,d/2,-w/2,0,d/2,
    ];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();put('roof',g,p.x,eave,p.z,p.yaw,false,elevation(p));
    box('trim',p,0,eave-.14,0,w+.5,.28,d+.5);
    box('trim',p,0,eave-.43,0,w+.16,.3,d+.16);
    box('shade',p,0,eave-.61,0,w-.22,.055,d-.22);
    box('stone',p,0,eave-.77,0,w-.3,.25,d-.3);
    box('roof',p,0,eave+rise+.07,0,ridge*2+.16,.16,.34);
    // Standing folded hip caps and gutters carry a readable edge thickness.
    for(const side of [-1,1]){
      box('roof',p,0,eave+.015,side*(d/2+.12),w+.28,.13,.15);
      for(const end of [-1,1]){
        const a=new Vector3(end*w/2,eave,side*d/2),b=new Vector3(end*ridge,eave+rise,0),g=new CylinderGeometry(.065,.065,a.distanceTo(b),6);
        g.applyQuaternion(new Quaternion().setFromUnitVectors(UP,b.clone().sub(a).normalize()));
        const at=local(p,(a.x+b.x)/2,(a.z+b.z)/2);put('roof',g,at.x,(a.y+b.y)/2,at.z,p.yaw,false,at.baseY);
      }
    }
  };
  const porticoRoof=(p:Placement,w:number,front:number,back:number,eave:number,rise:number)=>{
    const vertices=[
      -w/2,0,back, -w/2,0,front, 0,rise,front, -w/2,0,back,0,rise,front,0,rise,back,
      0,rise,back,0,rise,front,w/2,0,front,0,rise,back,w/2,0,front,w/2,0,back,
      -w/2,0,back,w/2,0,back,w/2,0,front,-w/2,0,back,w/2,0,front,-w/2,0,front,
    ];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();put('roof',g,p.x,eave,p.z,p.yaw,false,elevation(p));
  };
  const window=(p:Placement,o:Opening,z:number)=>{
    const {x,y,width:w,height:h}=o,glassZ=z-.44,sashZ=z-.35;
    // Every pane sits inside a cut opening. The 44 cm reveal produces actual
    // parallax and a cast lintel shadow as the player walks alongside a wall.
    box('shade',p,x,y,z-.55,w,h,.08);box('glass',p,x,y,glassZ,w-.10,h-.10,.045);
    if(o.simple){
      for(const side of [-1,1])box('trim',p,x+side*(w/2+.04),y,z-.15,.12,h+.20,.40);
      box('stone',p,x,y+h/2+.09,z-.12,w+.28,.16,.40);
      box('trim',p,x,y-h/2-.10,z+.03,w+.36,.20,.50);
      box('frame',p,x,y,sashZ,.052,h-.10,.08);
      for(const dy of [-h/6,h/6])box('frame',p,x,y+dy,sashZ,w-.10,.055,.08);
      return;
    }
    for(const side of [-1,1]){
      box('stone',p,x+side*(w/2+.035),y,z-.19,.075,h+.08,.46);
      box('trim',p,x+side*(w/2+.10),y,z+.035,.14,h+.28,.15);
      box('frame',p,x+side*(w/2-.07),y,sashZ,.10,h-.08,.11);
      box('frame',p,x,y+side*(h/2-.07),sashZ,w-.08,.10,.11);
    }
    box('stone',p,x,y+h/2+.13,z-.055,w+.42,.24,.37);
    box('trim',p,x,y-h/2-.12,z+.08,w+.52,.22,.65);
    box('shade',p,x,y-h/2-.255,z+.025,w+.35,.04,.43);
    for(const dx of [-w/6,w/6])box('frame',p,x+dx,y,sashZ,.043,h-.1,.08);
    for(const dy of [-h/4,0,h/4])box('frame',p,x,y+dy,sashZ,w-.1,.052,.085);
    if(!o.stone){
      // An upright header course and a single pale keystone stay understated.
      box('brick',p,x,y+h/2+.35,z+.025,w+.44,.20,.14);
      box('stone',p,x,y+h/2+.31,z+.07,.23,.31,.18);
    }
  };
  const door=(p:Placement,o:Opening,z:number)=>{
    const {x,width:w,height:h}=o,bottom=o.y-h/2,arched=o.kind==='archedDoor';
    const spring=arched?h-w/2:h,leafTop=Math.min(spring-.13,2.7),doorZ=z-.38;
    // Closed, human-scale paired leaves have lower panels, glazed uppers and
    // visible hardware; the rest of a large entrance is fixed fanlight glass.
    if(arched){arch('shade',p,x,bottom,z-.57,w,h);arch('glass',p,x,bottom+.07,z-.48,w-.12,h-.14);}
    else{box('shade',p,x,o.y,z-.58,w,h,.08);box('glass',p,x,o.y,z-.48,w-.12,h-.12,.055);}
    const leafWidth=Math.min(2.4,w-.22),leafBottom=bottom+.08,leafHeight=leafTop-.08;
    for(const side of [-1,1]){
      const dx=x+side*leafWidth/4;
      box('wood',p,dx,leafBottom+leafHeight/2,doorZ,leafWidth/2-.035,leafHeight,.12);
      box('glass',p,dx,leafBottom+leafHeight*.67,doorZ+.071,leafWidth/2-.25,leafHeight*.48,.028);
      box('shade',p,dx,leafBottom+leafHeight*.20,doorZ+.068,leafWidth/2-.25,leafHeight*.24,.025);
      box('wood',p,dx,leafBottom+leafHeight*.20,doorZ+.087,leafWidth/2-.34,leafHeight*.18,.026);
      box('bronze',p,x+side*.11,leafBottom+1.26,doorZ+.16,.045,.34,.07);
      box('bronze',p,dx,leafBottom+.13,doorZ+.075,leafWidth/2-.18,.13,.03);
      box('frame',p,x+side*(w/2-.05),bottom+spring/2,z-.27,.11,spring,.21);
      box('stone',p,x+side*(w/2+.09),bottom+spring/2,z-.16,.20,spring,.64);
    }
    box('frame',p,x,bottom+leafTop,z-.28,w,.12,.21);
    box('stone',p,x,bottom-.05,z+.04,w+.46,.13,.85);
    if(arched){
      const cx=local(p,x,z-.02),ring=new TorusGeometry(w/2+.10,.15,6,20,Math.PI);
      put('stone',ring,cx.x,bottom+spring,cx.z,p.yaw,false,cx.baseY);
      for(const angle of [Math.PI/4,Math.PI/2,Math.PI*3/4]){
        beam('frame',p,[x,bottom+spring,z-.29],[x+Math.cos(angle)*(w/2-.06),bottom+spring+Math.sin(angle)*(w/2-.06),z-.29],.045,.07);
      }
      box('stone',p,x,bottom+h+.07,z+.055,.26,.32,.41);
    }else{
      box('stone',p,x,bottom+h+.14,z-.04,w+.55,.27,.57);
      for(const dx of [-w/4,0,w/4])box('frame',p,x+dx,bottom+(leafTop+h)/2,z-.32,.055,h-leafTop,.10);
    }
  };
  const facadeOpenings=(w:number,columns:number,levels:number[],skipCenter=0,windowWidth=1.72,windowHeight=2.75)=>{
    const openings:Opening[]=[];
    for(const y of levels)for(let c=0;c<columns;c++){
      const x=(c-(columns-1)/2)*(w-7)/(columns-1);
      if(Math.abs(x)<skipCenter)continue;
      openings.push({x,y,width:windowWidth,height:windowHeight});
    }
    return openings;
  };
  const wall=(p:Placement,w:number,h:number,z:number,openings:Opening[],finish:Finish='brick',thickness=.75)=>{
    const shape=new Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,h);shape.lineTo(-w/2,h);shape.closePath();
    for(const o of openings){
      const left=o.x-o.width/2,right=o.x+o.width/2,bottom=o.y-o.height/2,top=o.y+o.height/2,hole=new Path();
      hole.moveTo(left,bottom);hole.lineTo(left,o.kind==='archedDoor'?top-o.width/2:top);
      if(o.kind==='archedDoor')hole.absarc(o.x,top-o.width/2,o.width/2,Math.PI,0,true);
      else hole.lineTo(right,top);
      hole.lineTo(right,bottom);hole.closePath();shape.holes.push(hole);
    }
    const at=local(p,0,z-thickness),g=new ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:10});
    put(finish,g,at.x,0,at.z,p.yaw,false,at.baseY);
    for(const o of openings){if(o.kind)door(p,o,z);else window(p,o,z);}
  };
  const shell=(name:string,p:Placement,w:number,d:number,h:number,front:Opening[],back:Opening[],sides:Opening[],finish:Finish='brick')=>{
    wall(p,w,h,d/2,front,finish);
    wall({...p,yaw:p.yaw+Math.PI},w,h,d/2,back,finish);
    for(const side of [-1,1]){
      const face={...local(p,side*w/2,0),yaw:p.yaw+side*Math.PI/2};
      wall(face,d,h,0,sides,finish);
    }
    // Collision stays a simple conservative envelope: buildings remain outdoor
    // landmarks and no new doorway leads through a wall into an empty interior.
    collider(name,p,0,0,w,h,d);
  };
  const column=(p:Placement,x:number,z:number,bottom:number,height:number,r=.67)=>{
    const profile=[new Vector2(r*1.31,0),new Vector2(r*1.31,.16),new Vector2(r*1.15,.23),new Vector2(r*1.23,.32),new Vector2(r*1.16,.43),new Vector2(r,.58),new Vector2(r*.98,height*.35),new Vector2(r*.87,height-1.05),new Vector2(r*.96,height-.96),new Vector2(r*.96,height-.82),new Vector2(r*1.21,height-.48),new Vector2(r*1.29,height-.23),new Vector2(r*1.38,height-.14)];
    const at=local(p,x,z),shaft=new LatheGeometry(profile,48),positions=shaft.getAttribute('position');
    for(let i=0;i<positions.count;i++){
      const y=positions.getY(i);if(y<.58||y>height-1.05)continue;
      const a=Math.atan2(positions.getX(i),positions.getZ(i)),groove=1-.020*(.5+.5*Math.cos(a*24));
      positions.setX(i,positions.getX(i)*groove);positions.setZ(i,positions.getZ(i)*groove);
    }
    shaft.computeVertexNormals();put('trim',shaft,at.x,bottom,at.z,p.yaw,false,at.baseY);
    box('stone',p,x,bottom+.10,z,r*2.85,.20,r*2.85);
    box('trim',p,x,bottom+height-.04,z,r*2.9,.21,r*2.9);
    // Two overlapping tiers of simple acanthus leaves model the silhouette of
    // the Corinthian capitals without expensive repeated ornamental spheres.
    for(let tier=0;tier<2;tier++)for(let i=0;i<8;i++){
      const angle=i*Math.PI/4+tier*Math.PI/8,leaf=new BufferGeometry(),rr=r*(.96+tier*.12),base=height-.92+tier*.28;
      leaf.setAttribute('position',new Float32BufferAttribute([-.15,0,rr, .15,0,rr, 0,.47,rr+.24, -.15,0,rr, 0,.47,rr+.24, -.19,.30,rr+.18, .15,0,rr, .19,.30,rr+.18, 0,.47,rr+.24],3));
      leaf.computeVertexNormals();leaf.rotateY(angle);put('trim',leaf,at.x,bottom+base,at.z,p.yaw,false,at.baseY);
    }
    collider('UMD portico column',p,x,z,r*2,height,r*2,bottom);
  };
  const steps=(p:Placement,width:number,front:number,count:number,tread:number,rise:number)=>{
    // Topmost step touches the portico. Lower steps extend towards the mall.
    for(let i=0;i<count;i++){
      const h=(count-i)*rise,z=front+(i+.5)*tread;
      box('paving',p,0,h/2,z,width,h,tread+.025,true);
      box('trim',p,0,h-.035,z+tread/2-.015,width+.15,.07,.09);
    }
  };
  const inscription=(p:Placement,text:string,w:number,y:number,z:number)=>{
    if(typeof document==='undefined')return;
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=160;const ctx=canvas.getContext('2d');if(!ctx)return;
    // The official fronts use small incised letters within the frieze, not a
    // full-height sign. Keep cap height well inside the 0.85–1.1m stone band.
    ctx.clearRect(0,0,2048,160);ctx.fillStyle='#64645a';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 44px Georgia, serif';ctx.fillText(text,1024,83,1980);
    const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;map.anisotropy=4;
    const mesh=new Mesh(new PlaneGeometry(w,w*160/2048),new MeshStandardMaterial({map,transparent:true,alphaTest:.08,depthWrite:false,roughness:1}));
    const at=local(p,0,z);mesh.position.set(at.x,at.baseY+y,at.z);mesh.rotation.y=p.yaw;mesh.name=`UMD inscription · ${text}`;group.add(mesh);
  };

  const center:Placement={x:0,z:0,yaw:0};
  // The draped base closes the playable boundary. Only actual grass footprints
  // are returned for blade scattering, so paving stays blade-free.
  box('terrain',center,0,-.09,0,590,.18,340,true);
  for(const z of [-14,14])box('paving',center,0,.018,z,246,.036,7,true);
  box('paving',center,0,.022,0,258,.044,12,true);
  for(const z of [-65,65])box('paving',center,0,.018,z,274,.036,5,true);
  for(const x of [-116,-40,40,116])box('paving',center,x,.019,0,5,.038,135,true);
  for(const x of [-116,116])box('paving',center,x,.023,0,25,.046,122,true);
  const footprints:Footprint[]=[];
  for(const z of [-40.5,40.5])for(const x of [-78,0,78]){
    const patch={x,z,width:70,depth:43,yaw:0};footprints.push(patch);box('lawn',center,x,.008,z,70,.016,43,true);
  }
  // These long narrow turf strips sit beside the central fountain promenade,
  // close to the main walking camera. The six broad lawns alone leave this
  // foreground as a perfectly flat base plane. Raised cross-paths are retained
  // and excluded from blade roots by the shared actual-ground-height mask.
  for(const z of [-8.25,8.25]){
    const patch={x:0,z,width:230,depth:3.5,yaw:0};footprints.push(patch);box('lawn',center,0,.008,z,230,.016,3.5,true);
  }

  // ODK's 16 by 250 ft water body is a distinctive real element of the mall.
  // Five shallow level basins retain the rhythm while keeping the entire walk
  // at one datum. A conservative collision proxy prevents walking on water.
  const fountain:Placement={x:5,z:0,yaw:0};
  box('stone',fountain,0,.19,0,78,.38,7.1);
  for(const z of [-3.18,3.18]){box('trim',fountain,0,.42,z,78,.19,.48);box('stone',fountain,0,.24,z,78,.30,.58);}
  for(const x of [-38.8,38.8])box('trim',fountain,x,.42,0,.42,.19,6.8);
  for(let i=0;i<5;i++){
    const x=(i-2)*15.24;box('water',fountain,x,.387,0,14.8,.025,4.8768);
    box('trim',fountain,x+7.54,.45,0,.32,.14,5.9);
    // A thin pale horizontal lip gives the tier a calm cascade highlight.
    box('water',fountain,x+7.64,.39,0,.09,.18,4.78);
  }
  collider('ODK fountain basin',fountain,0,0,78,.8,7.1);

  // McKeldin's east front: a three-storey Georgian brick facade with a six
  // column Corinthian portico over an arched stone basement. The taller rear
  // library block is expressed behind it rather than changing the iconic face.
  const libraryMain={...LIBRARY,...local(LIBRARY,0,4)},libraryLevels=[5.3,10.65,17.55];
  const libraryFront=facadeOpenings(105,23,libraryLevels,19);
  for(const x of [-11.2,-5.6,0,5.6,11.2])for(const y of [6.7,12.1]){
    if(x===0&&y===6.7)continue;libraryFront.push({x,y,width:2.15,height:3.45});
  }
  libraryFront.push({x:0,y:6.45,width:3.5,height:4.9,kind:'door'});
  shell('McKeldin east facade',libraryMain,105,34,20.4,libraryFront,
    facadeOpenings(105,23,libraryLevels).map(o=>({...o,simple:true})),facadeOpenings(34,6,libraryLevels).map(o=>({...o,simple:true})));
  const stacks={...LIBRARY,...local(LIBRARY,0,-23)},stackLevels=[4.1,9.2,14.3,19.4,24.5];
  shell('McKeldin rear stacks',stacks,98,28,29.7,facadeOpenings(98,17,[24.5]).map(o=>({...o,simple:true})),
    facadeOpenings(98,17,stackLevels).map(o=>({...o,simple:true})),facadeOpenings(28,5,stackLevels).map(o=>({...o,simple:true})));
  for(const y of [.65,3.6])box('stone',LIBRARY,0,y,4,105.8,y===.65?1.3:.38,34.7);
  box('stone',LIBRARY,0,14.38,4,105.8,.25,34.8);box('trim',LIBRARY,0,14.76,4,106,.51,35);
  box('trim',LIBRARY,0,15.15,4,106.5,.20,35.4);box('shade',LIBRARY,0,15.30,21.04,105,.075,.12);
  for(const side of [-1,1])for(let i=0;i<104;i++)box('trim',libraryMain,(i-51.5),15.39,side*17.3,.27,.20,.33);
  pitchedRoof(libraryMain,106.8,35.6,20.4,3.1,3.8);
  box('trim',LIBRARY,0,29.45,-23,99,.7,29);box('roof',LIBRARY,0,29.92,-23,98.2,.28,28.2);
  for(const x of [-44,-22,22,44]){
    box('brick',LIBRARY,x,23.65,4,1.45,2.4,2.2);box('stone',LIBRARY,x,24.83,4,1.72,.24,2.47);
    box('shade',LIBRARY,x,24.98,4,1.02,.08,1.56);box('trim',LIBRARY,x,24.58,4,1.59,.12,2.34);
  }
  // The basement itself is also pierced. An arched pane is no longer pasted
  // on a stone box; the three closed doors are recessed behind the arch rings.
  wall(LIBRARY,36,3.9,28.6,[-9,0,9].map(x=>({x,y:2.175,width:2.1,height:3.15,kind:'archedDoor',stone:true})), 'stone',.88);
  box('stone',LIBRARY,0,1.95,23.0,36,3.9,3.8);
  for(const side of [-1,1])box('stone',LIBRARY,side*17.6,1.95,26.5,.8,3.9,4.2);
  box('trim',LIBRARY,0,3.88,24.8,36.4,.20,8.0);
  collider('McKeldin raised portico basement',LIBRARY,0,24.8,36,3.9,7.6);
  for(const x of [-16,-11,-4,4,11,16])column(LIBRARY,x,26.2,3.9,12.7,.73);
  box('trim',LIBRARY,0,16.98,24.8,37,1.1,8.1);box('stone',LIBRARY,0,17.65,24.8,37.5,.23,8.6);
  // Coffers make the portico ceiling a volume visible when looking upward.
  for(const x of [-13.5,-7.5,0,7.5,13.5])box('stone',LIBRARY,x,16.405,24.5,4.7,.055,3.7);
  for(const z of [22.0,24.5,27])box('trim',LIBRARY,0,16.36,z,36.1,.15,.18);
  pediment(LIBRARY,37.1,18.05,29.18,7.1);inscription(LIBRARY,'M C K E L D I N   L I B R A R Y',33,16.98,28.89);
  porticoRoof(LIBRARY,37.8,29.08,20.5,18.32,7.1);
  // Accessible lower forecourt at 0.6m; the column plinth remains decorative.
  steps(LIBRARY,43,29,5,.62,.12);
  box('paving',LIBRARY,0,.30,28.79,43,.60,.44,true);
  for(const x of [-25,25]){box('brick',LIBRARY,x,.65,30.8,6,1.3,10);box('trim',LIBRARY,x,1.35,30.8,6.4,.18,10.4);collider('McKeldin terrace sidewall',LIBRARY,x,30.8,6,1.5,10);}
  // An original Testudo study: chamfered stone, bronze rim, seven raised scute
  // plates and a recognisable neck/beak replace the former intersecting blobs.
  box('stone',LIBRARY,0,.14,34.6,2.85,.28,2.55);
  const plinthShape=new Shape(),pw=2.56,pd=2.26,chamfer=.16;
  plinthShape.moveTo(-pw/2+chamfer,-pd/2);plinthShape.lineTo(pw/2-chamfer,-pd/2);plinthShape.lineTo(pw/2,-pd/2+chamfer);
  plinthShape.lineTo(pw/2,pd/2-chamfer);plinthShape.lineTo(pw/2-chamfer,pd/2);plinthShape.lineTo(-pw/2+chamfer,pd/2);
  plinthShape.lineTo(-pw/2,pd/2-chamfer);plinthShape.lineTo(-pw/2,-pd/2+chamfer);plinthShape.closePath();
  const plinth=new ExtrudeGeometry(plinthShape,{depth:.80,bevelEnabled:true,bevelSize:.035,bevelThickness:.04,bevelSegments:1});plinth.rotateX(-Math.PI/2);
  const plinthAt=local(LIBRARY,0,34.6);put('stone',plinth,plinthAt.x,.29,plinthAt.z,LIBRARY.yaw,false,plinthAt.baseY);
  box('trim',LIBRARY,0,1.15,34.6,2.76,.18,2.46);box('bronze',LIBRARY,0,.78,35.755,.76,.31,.035);
  box('stone',LIBRARY,0,.78,35.779,.64,.022,.018);
  sphere('bronze',LIBRARY,0,1.46,34.6,.94,.20,1.08);
  const shellShape=new SphereGeometry(1,28,12,0,Math.PI*2,0,Math.PI/2);shellShape.scale(.94,.56,1.07);
  const shellAt=local(LIBRARY,0,34.6);put('bronze',shellShape,shellAt.x,1.46,shellAt.z,LIBRARY.yaw,false,shellAt.baseY);
  const shellRim=new TorusGeometry(1,.035,6,36);shellRim.rotateX(-Math.PI/2);shellRim.scale(.95,1,1.08);put('patina',shellRim,shellAt.x,1.47,shellAt.z,LIBRARY.yaw,false,shellAt.baseY);
  const plate=(points:[number,number][])=>{
    const area=points.reduce((sum,p,i)=>sum+p[0]*points[(i+1)%points.length][1]-points[(i+1)%points.length][0]*p[1],0);
    if(area>0)points=[...points].reverse();
    const cx=points.reduce((s,p)=>s+p[0],0)/points.length,cz=points.reduce((s,p)=>s+p[1],0)/points.length;
    const project=([x,z]:[number,number])=>[x*.94,Math.sqrt(Math.max(0,1-x*x-z*z))*.56+.015,z*1.07];
    const vertices:number[]=[];
    for(let i=0;i<points.length;i++)vertices.push(...project([cx,cz]),...project(points[i]),...project(points[(i+1)%points.length]));
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();
    put('patina',g,shellAt.x,1.46,shellAt.z,LIBRARY.yaw,false,shellAt.baseY);
  };
  plate([[-.25,.24],[.25,.24],[.33,.46],[.20,.74],[-.20,.74],[-.33,.46]]);
  plate([[-.27,-.27],[.27,-.27],[.35,-.01],[.25,.20],[-.25,.20],[-.35,-.01]]);
  plate([[-.21,-.73],[.21,-.73],[.32,-.49],[.27,-.31],[-.27,-.31],[-.32,-.49]]);
  for(const side of [-1,1]){
    plate([[side*.38,.04],[side*.80,.10],[side*.73,.48],[side*.36,.71],[side*.37,.45]]);
    plate([[side*.37,-.05],[side*.37,-.45],[side*.34,-.70],[side*.74,-.47],[side*.82,-.10]]);
    for(const z of [-.61,.57]){
      sphere('bronze',LIBRARY,side*.83,1.36,34.6+z,.29,.14,.32);
      for(const toe of [-.11,0,.11])sphere('patina',LIBRARY,side*(1.00+toe*.4),1.29,34.6+z+toe,.11,.047,.062);
    }
  }
  sphere('bronze',LIBRARY,0,1.49,35.64,.23,.20,.42);sphere('patina',LIBRARY,0,1.61,35.95,.29,.20,.30);
  sphere('bronze',LIBRARY,0,1.53,36.16,.22,.095,.15);
  for(const side of [-1,1]){sphere('bronze',LIBRARY,side*.236,1.68,36.01,.067,.065,.085);sphere('shade',LIBRARY,side*.278,1.685,36.025,.020,.036,.041);}
  sphere('bronze',LIBRARY,0,1.40,33.53,.10,.08,.25);
  collider('Testudo sculpture plinth',LIBRARY,0,34.6,2.8,1.6,2.5);

  // Thomas V. Miller Jr. Administration: four-column west-facing portico,
  // projecting end pavilions, broad stairs and a shallow classical pediment.
  const adminLevels=[3.7,8.3,12.9],adminFront=facadeOpenings(62,13,adminLevels,17.5);
  for(const x of [-8,0,8]){
    adminFront.push({x,y:5.25,width:3.45,height:5.0,kind:'door'});
    adminFront.push({x,y:11.3,width:2.9,height:2.7,stone:true});
  }
  shell('Miller Administration main',ADMIN,94,38,16.5,adminFront,
    facadeOpenings(94,21,adminLevels).map(o=>({...o,simple:true})),[]);
  box('stone',ADMIN,0,.75,0,94.6,1.5,38.6);box('trim',ADMIN,0,15.95,0,95.2,.9,39.2);
  for(const side of [-1,1])box('trim',ADMIN,side*32.3,6.67,19.08,29.4,.19,.34);
  box('trim',ADMIN,0,6.67,-19.08,94.4,.19,.34);
  pitchedRoof(ADMIN,96,40,16.7,4.4);
  for(const x of [-39,39]){
    const p={...ADMIN,...local(ADMIN,x,3)},front=facadeOpenings(16,3,[3.8,8.3,12.8],0,1.75,2.6);
    shell('Miller Administration end pavilion',p,16,44,17.5,front,
      front.map(o=>({...o,simple:true})),facadeOpenings(44,7,[3.8,8.3,12.8]).map(o=>({...o,simple:true})));
    pitchedRoof(p,17.4,45.4,17.55,3.5,3.5);pediment(p,17.1,17.6,22.8,4.3,false);
    for(const side of [-1,1]){
      // Corner pilasters turn onto each wing instead of ending as a flat strip.
      box('stone',p,side*7.78,8.1,22.04,.38,15.5,.34);
      for(const y of [1.25,5.75,10.4,15.9])box('trim',p,side*7.78,y,22.12,.63,.28,.49);
    }
  }
  box('stone',ADMIN,0,1.25,22.4,34,2.5,7.2,true);
  for(const x of [-12,-4,4,12])column(ADMIN,x,24.9,2.5,11.6,.74);
  box('trim',ADMIN,0,14.5,22.7,35.8,.85,8.2);box('trim',ADMIN,0,15.11,22.7,36.4,.29,8.6);
  pediment(ADMIN,36.1,15.45,27.08,7.4);
  porticoRoof(ADMIN,36.8,26.98,18.5,15.72,7.4);
  inscription(ADMIN,'THOMAS V. MILLER, JR. ADMINISTRATION BUILDING',34,14.5,26.86);
  for(const x of [-8,0,8]){
    for(const side of [-1,1])box('trim',ADMIN,x+side*2.22,8.15,19.17,.44,11.1,.53);
    box('trim',ADMIN,x,8.35,19.18,5.25,.34,.4);
    // Recessed rectangular spandrel panels break up the stone between levels.
    box('stone',ADMIN,x,9.00,19.02,4.0,.78,.15);
    box('trim',ADMIN,x,9.0,19.14,3.56,.53,.12);
  }
  for(const x of [-12,-4,4,12])box('stone',ADMIN,x,14.03,22.7,4.8,.08,4.5);
  steps(ADMIN,37,26.5,15,.5,.16);
  // Close the former half-metre gap between the last stair and the landing.
  box('paving',ADMIN,0,1.25,26.24,34,2.5,.54,true);
  for(const x of [-22,22]){box('brick',ADMIN,x,1.22,30.3,4,2.44,10.3);box('trim',ADMIN,x,2.48,30.3,4.4,.18,10.7);collider('Miller forecourt sidewall',ADMIN,x,30.3,4,2.6,10.3);}

  // Side halls retain the authored plan, but each is a built envelope with
  // walk-close window depth, a distinct entrance and a finished roof silhouette.
  const contexts=[{x:-66,z:-88,w:92,d:30,name:'Jiménez Hall'},{x:55,z:-88,w:80,d:30,name:'Symons Hall'},{x:-61,z:88,w:96,d:30,name:'Taliaferro Hall'},{x:64,z:88,w:84,d:30,name:'Francis Scott Key Hall'}];
  for(const [index,c] of contexts.entries()){
    const p:Placement={x:c.x,z:c.z,yaw:c.z<0?0:Math.PI},h=13.2+(index%2)*1.4;
    const columns=Math.floor(c.w/5.5)|1,levels=[2.65,6.75,10.85],front=facadeOpenings(c.w,columns,levels,4.5);
    front.push({x:0,y:10.85,width:2.3,height:2.6,stone:true});
    shell(c.name,p,c.w,c.d,h,front,facadeOpenings(c.w,columns,levels).map(o=>({...o,simple:true})),facadeOpenings(c.d,5,levels).map(o=>({...o,simple:true})));
    box('stone',p,0,.50,0,c.w+.6,1.0,c.d+.6);
    for(const y of [4.38,8.40]){
      for(const side of [-1,1])box('trim',p,side*(c.w/4+2.2),y,c.d/2+.06,c.w/2-4.4,.14,.19);
      box('trim',p,0,y,-c.d/2-.06,c.w+.25,.14,.19);
    }
    pitchedRoof(p,c.w+1.2,c.d+1.2,h,3.7,index===2?5.7:3.0);
    const portalFront=c.d/2+1.16,portalHeight=index===1?6.45:6.15;
    wall(p,8,portalHeight,portalFront,[{x:0,y:2.62,width:index===3?3.5:3.15,height:4.94,kind:index%2===0?'archedDoor':'door',stone:true}],index===1?'brick':'stone');
    for(const side of [-1,1]){
      box('stone',p,side*3.76,portalHeight/2,c.d/2+.50,.48,portalHeight,1.22);
      box('trim',p,side*3.68,portalHeight/2,portalFront+.09,.25,portalHeight,.22);
    }
    box('stone',p,0,portalHeight+.11,c.d/2+.54,8.55,.24,1.70);
    box('trim',p,0,portalHeight+.33,c.d/2+.52,8.84,.20,1.88);
    collider(`${c.name} entrance surround`,p,0,c.d/2+.55,8,portalHeight,1.1);
    if(index===0||index===2)pediment(p,8.7,portalHeight+.57,portalFront+.24,index===0?1.8:1.45,false);
    else{
      box('stone',p,0,portalHeight+.77,portalFront-.06,5.4,.62,.34);
      for(const x of [-3.25,3.25])box('trim',p,x,portalHeight+.84,portalFront-.08,.60,.75,.63);
    }
    for(const x of [-c.w*.3,c.w*.3]){
      box('brick',p,x,h+3.25,-2,1.45,2.7,2.1);box('stone',p,x,h+4.57,-2,1.80,.20,2.44);
      box('shade',p,x,h+4.71,-2,1.25,.09,1.82);box('trim',p,x,h+4.35,-2,1.62,.12,2.24);
    }
    // Wall pilasters and a few downpipes add human-scale edges without
    // generating thousands of individual bricks or additional draw calls.
    for(const side of [-1,1]){
      box('stone',p,side*(c.w/2-.24),h/2,c.d/2+.045,.38,h-.3,.22);
      rod('roof',p,side*(c.w/2-.87),h/2,c.d/2+.22,.065,h-.35);
    }
  }

  // Furnishing stays outside the main 7m pedestrian lane, including the route
  // used by destination guidance. Trunks are returned for the common foliage.
  for(const x of [-91,-61,-17,28,62,94])for(const side of [-1,1]){
    const bench:Placement={x,z:side*23,yaw:side===1?0:Math.PI};
    for(const z of [-.27,0,.27])box('wood',bench,0,.52,z,2.65,.12,.22);
    for(const y of [.94,1.2])box('wood',bench,0,y,-.42,2.65,.16,.10);
    for(const dx of [-1,1]){box('frame',bench,dx,.28,0,.1,.56,.72);box('frame',bench,dx,.84,-.40,.1,.94,.1);}
    collider('UMD mall bench',bench,0,-.03,2.8,1.3,1.0);
  }
  for(const x of [-106,-54,54,106])for(const z of [-59,59]){
    const p:Placement={x,z,yaw:0};rod('frame',p,0,2.5,0,.095,5);box('stone',p,0,.15,0,.5,.3,.5);
    box('frame',p,0,4.83,0,.48,.12,.48);box('glass',p,0,5.14,0,.36,.54,.36);box('frame',p,0,5.47,0,.56,.14,.56);
    for(const dx of [-.21,.21])for(const dz of [-.21,.21])box('frame',p,dx,5.16,dz,.045,.61,.045);
  }
  const trees:{x:number;z:number;radius:number}[]=[];
  for(const z of [-67,67])for(const x of [-111,-87,-63,-15,15,63,87,111])trees.push({x,z,radius:4.1+(Math.abs(x)%3)*.25});
  for(const x of [-211,210])for(const z of [-91,-51,51,91])trees.push({x,z,radius:4.6});
  for(const x of [-106,106])for(const z of [-46,46])trees.push({x,z,radius:3.8});

  const palette:Record<Finish,string>={brick:'#a86c55',stone:'#c9c1ad',trim:'#e7e2d4',roof:'#657475',glass:'#718d91',frame:'#d4dace',shade:'#35494b',wood:'#806049',bronze:'#667457',patina:'#89906b',paving:'#c6bba5',lawn:'#859e63',terrain:'#7f985e',water:'#72aaa9'};
  const source:Record<Finish,string>={brick:'brick',stone:'limestone',trim:'trim',roof:'roofMetal',glass:'glass',frame:'frame',shade:'interiorShade',wood:'benchWood',bronze:'bronze',patina:'bronze',paving:'pavement',lawn:'grass',terrain:'grass',water:'water'};
  const materials=new Map<Finish,MeshStandardMaterial>();
  let lawnMesh:Mesh|undefined;
  for(const [name,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(part=>part.dispose());if(!geometry)throw new Error(`Cannot merge UMD ${name}`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    let material=materials.get(batch.finish);if(!material){
      material=batch.finish==='water'?createCampusWaterMaterial({time:wind,name:'Maryland water',deepColor:'#4d807d'}):createCampusSurface(source[batch.finish],{yaw:0}) as MeshStandardMaterial;
      material.name=`Maryland ${batch.finish}`;
      if(batch.finish!=='water'){material.color=new Color(palette[batch.finish]);material.roughness=batch.finish==='glass'?.48:batch.finish==='roof'?.88:1;material.metalness=batch.finish==='bronze'||batch.finish==='patina'?.35:0;}
      if(batch.finish==='brick'||batch.finish==='roof'){
        const baseCompile=material.onBeforeCompile,baseKey=material.customProgramCacheKey(),finish=batch.finish;
        material.onBeforeCompile=(shader,renderer)=>{
          baseCompile(shader,renderer);
          if(finish==='brick')shader.fragmentShader=shader.fragmentShader.replace('brickTone*.10*close+wash*.07','brickTone*.16*close+wash*.09');
          else shader.fragmentShader=shader.fragmentShader.replace('vec3 campusN = campusAxes(normalize(vCampusNormal));',/* glsl */ `
            vec3 campusN = campusAxes(normalize(vCampusNormal));
            // UMD-only slate courses, filtered at distance; no repeated bricks
            // in geometry and no changes to the finishes of other campuses.
            float slateAxis=abs(campusN.x)>abs(campusN.z)?campusP.z:campusP.x;
            vec2 slateFace=vec2(slateAxis+mod(floor(campusP.y/.28),2.)*.25,campusP.y);
            float slateClose=1.-smoothstep(.025,.12,max(fwidth(slateFace.x),fwidth(slateFace.y)));
            float slateJoint=campusJoint(slateFace,vec2(.50,.28),.006);
            float slateTone=campusHash(floor(slateFace/vec2(.50,.28)))-.5;
            diffuseColor.rgb*=1.+slateTone*.075*slateClose-slateJoint*.16*slateClose;
          `);
        };
        material.customProgramCacheKey=()=>`${baseKey}-maryland-${finish}-v2`;
      }
      materials.set(batch.finish,material);
    }
    const mesh=new Mesh(geometry,material);mesh.name=`UMD ${name}`;mesh.castShadow=!batch.surface&&batch.finish!=='glass'&&batch.finish!=='water';mesh.receiveShadow=true;
    group.add(mesh);shadowMeshes.push(mesh);if(batch.surface)ground.push(mesh);if(batch.finish==='lawn')lawnMesh=mesh;
  }
  group.updateMatrixWorld(true);
  return {group,ground,walls,trees,lawns:lawnMesh?[{mesh:lawnMesh,footprints}]:[],setQuality:(low:boolean)=>{
    const water=materials.get('water');if(water instanceof CampusWaterMaterial)water.setQuality(low?'mobile-hd':'desktop');
    shadowMeshes.forEach(mesh=>{mesh.castShadow=!low&&!ground.includes(mesh)&&!mesh.name.includes('glass')&&!mesh.name.includes('water');});
  }};
}
