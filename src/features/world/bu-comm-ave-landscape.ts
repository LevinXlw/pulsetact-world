import {BoxGeometry,BufferGeometry,CanvasTexture,CylinderGeometry,DataTexture,DoubleSide,Float32BufferAttribute,Group,Mesh,MeshDepthMaterial,MeshStandardMaterial,PlaneGeometry,Quaternion,RGBAFormat,RGBADepthPacking,Shape,ShapeGeometry,SRGBColorSpace,Vector2,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {buElevation,drapeBUGeometry} from './bu-terrain';
import {configureBUGroundLayer} from './bu-ground-layers';
import {BU_CAS_BEDS,BU_CAS_TREE_SITES,buCASFrameAt,buCASPointAt,type BUCASPoint} from './bu-comm-ave-landscape-layout';
export {BU_CAS_LANDSCAPE_BOUNDS,BU_CAS_CLEAR_WALK,buCASLandscapeReplaces} from './bu-comm-ave-landscape-layout';

type Finish='granite'|'soil'|'iron'|'leaf'|'brick';
/** Small original procedural leaf spray. Empty pixels are real cutouts; there
 * is no opaque shrub shell beneath them. The data fallback keeps headless
 * construction/tests equivalent without requiring a browser canvas. */
function shrubLeafTexture(size:number){
  const leaves=Array.from({length:10},(_,i)=>({x:.5+(i%2?1:-1)*(.13+.035*Math.sin(i)),y:.22+Math.floor(i/2)*.13,angle:(i%2?1:-1)*.75,rx:.15,ry:.075}));
  const canvas=typeof document==='undefined'?null:document.createElement('canvas');
  if(canvas){canvas.width=canvas.height=size;const c=canvas.getContext('2d');if(c){
    c.clearRect(0,0,size,size);c.strokeStyle='#635c31';c.lineWidth=size*.014;c.beginPath();c.moveTo(size*.5,size*.96);c.lineTo(size*.5,size*.14);c.stroke();
    leaves.forEach((leaf,i)=>{
      c.save();c.translate(leaf.x*size,leaf.y*size);c.rotate(leaf.angle);
      const gradient=c.createLinearGradient(0,-leaf.ry*size,0,leaf.ry*size);gradient.addColorStop(0,i%3?'#749350':'#819d59');gradient.addColorStop(.48,'#547938');gradient.addColorStop(1,'#315124');
      c.fillStyle=gradient;c.beginPath();c.ellipse(0,0,leaf.rx*size,leaf.ry*size,0,0,Math.PI*2);c.fill();
      c.strokeStyle='#a0ad70';c.lineWidth=Math.max(.6,size*.003);c.beginPath();c.moveTo(-leaf.rx*size*.88,0);c.lineTo(leaf.rx*size*.88,0);c.stroke();c.restore();
    });
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.name='CAS procedural leaf sprays';return texture;
  }}
  const pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=x/size,py=y/size,leaf=leaves.find(l=>{const dx=px-l.x,dy=py-l.y,u=dx*Math.cos(l.angle)+dy*Math.sin(l.angle),v=-dx*Math.sin(l.angle)+dy*Math.cos(l.angle);return (u/l.rx)**2+(v/l.ry)**2<1;});
    if(!leaf)continue;const i=(y*size+x)*4,shade=.87+.13*Math.sin(x*.41+y*.27);pixels[i]=Math.round(95*shade);pixels[i+1]=Math.round(132*shade);pixels[i+2]=Math.round(61*shade);pixels[i+3]=255;
  }
  const texture=new DataTexture(pixels,size,size,RGBAFormat);texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;texture.name='CAS procedural leaf sprays · headless';return texture;
}
/** 2024 BU photograph, not a measured landscape plan. Preserve the existing
 * walking centre at d=2.7; all beds/furniture are outside d=1.85..5.25.
 * Low granite edging is ground, never an invisible blocking wall. */
export function createBUCommAveLandscape({mobile=false}:{mobile?:boolean}={}){
  const group=new Group();group.name='BU CAS · granite planters and recessed benches';
  const leafMap=shrubLeafTexture(mobile?128:256);
  const leafDepth=new MeshDepthMaterial({depthPacking:RGBADepthPacking,map:leafMap,alphaTest:.42,side:DoubleSide});
  const parts:Record<Finish,BufferGeometry[]>={granite:[],soil:[],iron:[],leaf:[],brick:[]};
  const material=(name:string,color:string)=>{const m=createCampusSurface(name,{profile:'bu'}) as MeshStandardMaterial;m.color.set(color);configureBUGroundLayer(m,'surface');return m;};
  const materials:Record<Finish,MeshStandardMaterial>={
    granite:material('curb','#92938d'),soil:material('grass','#5a6040'),
    iron:new MeshStandardMaterial({name:'CAS black cast-iron benches',color:'#252c29',roughness:.60,metalness:.44}),
    leaf:new MeshStandardMaterial({name:'CAS perforated evergreen leaf sprays',map:leafMap,bumpMap:leafMap,bumpScale:.018,alphaTest:.42,side:DoubleSide,vertexColors:true,roughness:.83}),
    brick:material('brick','#8a6253'),
  };
  const append=(finish:Finish,g:BufferGeometry)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();parts[finish].push(n);};
  const base=(p:BUCASPoint)=>buElevation(p[0],p[1]);
  const box=(finish:Finish,p:BUCASPoint,w:number,h:number,depth:number,y:number,yaw:number)=>{
    const g=new BoxGeometry(w,h,depth),centreHeight=base(p);g.rotateY(yaw);g.translate(p[0],centreHeight+y,p[1]);
    // The broad low coping must touch the sloping sidewalk at both ends.
    // Furniture stays rigid; the short granite blocks follow the shared DEM.
    if(finish==='granite'){const a=g.getAttribute('position');for(let i=0;i<a.count;i++)a.setY(i,a.getY(i)+buElevation(a.getX(i),a.getZ(i))-centreHeight);g.computeVertexNormals();}
    append(finish,g);
  };
  const bar=(a:Vector3,b:Vector3,r:number)=>{const delta=b.clone().sub(a),g=new CylinderGeometry(r,r,delta.length(),mobile?5:8);g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);append('iron',g);};
  const patch=(finish:Finish,points:BUCASPoint[],height:number)=>{
    const g=new ShapeGeometry(new Shape(points.map(([x,z])=>new Vector2(x,-z))));g.rotateX(-Math.PI/2);g.translate(0,5.2+height,0);const draped=drapeBUGeometry(g,3);g.dispose();append(finish,draped);
  };
  const edge=(a:BUCASPoint,b:BUCASPoint,width=.34)=>{
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.ceil(len/1.05),yaw=Math.atan2(-(b[1]-a[1]),b[0]-a[0]);
    // Individual granite coping blocks follow the terrain; small true joints
    // replace an unbroken, uniformly stretched concrete strip.
    for(let i=0;i<count;i++){const t=(i+.5)/count,p:BUCASPoint=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];box('granite',p,len/count-.012,.175,width,.1925,yaw);}
  };
  const shrubs=(from:number,to:number,near:number,far:number,seed:number)=>{
    for(let x=from+.7;x<to-.4;x+=mobile?2.25:1.5){
      const d=(near+far)/2,p=buCASPointAt(x,d),f=buCASFrameAt(x)!,h=.72+.22*(.5+.5*Math.sin(x*3+seed));
      const sprays=mobile?38:100,halfDepth=Math.max(.10,(far-near)*.46);
      for(let k=0;k<sprays;k++){
        // Deterministic, differently oriented sprays fill a bush volume. Small
        // leaves and holes break its contour instead of shading a green rock.
        const angle=k*2.399+seed,level=(k+.5)/sprays,r=Math.sqrt((Math.sin(k*12.98+seed)*43758.54)%1+1)%1;
        const along=Math.cos(angle)*(.22+.49*r)*Math.sin(Math.PI*(.12+.78*level));
        const across=Math.sin(angle)*halfDepth*.63;
        const width=mobile?.37:.30,g=new PlaneGeometry(width,.27,1,2);
        const pos=g.getAttribute('position');for(let j=0;j<pos.count;j++)pos.setZ(j,.035*Math.sin((pos.getX(j)/width+.5)*Math.PI));g.computeVertexNormals();
        g.rotateX(-.6+.95*Math.sin(k*1.71));g.rotateY(angle);g.rotateZ(.45*Math.cos(k*3.1));
        // Clamp every vertex to its original bed depth, leaving the tested
        // walking band and entry openings completely unchanged.
        const v=g.getAttribute('position');for(let j=0;j<v.count;j++){
          const lx=v.getX(j)+f.dx*along+f.nx*across,lz=v.getZ(j)+f.dz*along+f.nz*across;
          const forward=lx*f.dx+lz*f.dz,depth=Math.max(-halfDepth,Math.min(halfDepth,lx*f.nx+lz*f.nz));
          v.setXYZ(j,p[0]+f.dx*forward+f.nx*depth,base(p)+.16+h*(.16+.75*level)+v.getY(j),p[1]+f.dz*forward+f.nz*depth);
        }g.computeVertexNormals();
        const positions=g.getAttribute('position'),colors:number[]=[],shade=.72+.28*(.5+.5*Math.sin(k*5.2+seed));
        for(let j=0;j<positions.count;j++)colors.push(shade,shade,shade*.94);
        g.setAttribute('color',new Float32BufferAttribute(colors,3));append('leaf',g);
      }
    }
  };
  function bench(x:number){
    const f=buCASFrameAt(x)!,p=buCASPointAt(x,.97),yaw=Math.atan2(-f.dz,f.dx);
    const point=(along:number,d:number,y:number)=>new Vector3(p[0]+f.dx*along+f.nx*d,base(p)+y,p[1]+f.dz*along+f.nz*d);
    // Slatted cast iron seat, inclined back, paired arm loops and curved legs.
    for(let i=0;i<5;i++){
      const offset=-.19+i*.095,q:BUCASPoint=[p[0]+f.nx*offset,p[1]+f.nz*offset];box('iron',q,1.75,.035,.065,.57,yaw);
    }
    for(let i=0;i<4;i++){
      const q:BUCASPoint=[p[0]-f.nx*(.24+i*.022),p[1]-f.nz*(.24+i*.022)];box('iron',q,1.75,.048,.045,.72+i*.075,yaw);
    }
    for(const side of [-.70,.70]){
      for(const d of [-.17,.18]){bar(point(side,d,.12),point(side,d*.65,.54),.035);}
      bar(point(side,-.22,.53),point(side,-.32,1.0),.027);
      const arm=[[-.29,.76],[-.24,.84],[-.08,.87],[.13,.85],[.22,.76],[.18,.60]];
      for(let i=1;i<arm.length;i++)bar(point(side,arm[i-1][0],arm[i-1][1]),point(side,arm[i][0],arm[i][1]),.026);
    }
  }
  for(const bed of BU_CAS_BEDS){
    const {from,to,near,far}=bed;
    const p=(x:number,d:number)=>buCASPointAt(x,d);
    // Recess the street-side bench into the planter border. It faces the walk
    // without moving its seat or armrests into the existing navigation line.
    const points=bed.benchX===null?[p(from,near),p(to,near),p(to,far),p(from,far)]:[
      p(from,near),p(to,near),p(to,far),p(bed.benchX+1.1,far),p(bed.benchX+1.1,.62),p(bed.benchX-1.1,.62),p(bed.benchX-1.1,far),p(from,far),
    ];
    patch('soil',points,.135);
    for(let i=0;i<points.length;i++)edge(points[i],points[(i+1)%points.length],bed.row==='street'?.30:.34);
    if(bed.benchX!==null){
      bench(bed.benchX);
      shrubs(from,bed.benchX-1.35,near+.25,far-.25,from);
      shrubs(bed.benchX+1.35,to,near+.25,far-.25,to);
      // A narrow warm brick feature strip, never a replacement paving blanket.
      patch('brick',[p(from,far+.19),p(to,far+.19),p(to,far+.27),p(from,far+.27)],.112);
    }else{
      shrubs(from,to,far-1.25,far-.45,to);
    }
  }
  const ground:Mesh[]=[],walls:Mesh[]=[];
  for(const finish of Object.keys(parts) as Finish[]){
    if(!parts[finish].length){materials[finish].dispose();continue;}
    const geometry=mergeGeometries(parts[finish]);parts[finish].forEach(g=>g.dispose());if(!geometry)throw new Error(`CAS merge failed: ${finish}`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();const mesh=new Mesh(geometry,materials[finish]);mesh.name=`BU CAS streetscape · ${finish}`;mesh.receiveShadow=true;mesh.castShadow=!mobile&&finish!=='soil'&&finish!=='brick';group.add(mesh);
    if(finish==='leaf')mesh.customDepthMaterial=leafDepth;
    if(finish==='granite'||finish==='soil'||finish==='brick'){ground.push(mesh);mesh.userData.buGround=true;mesh.userData.mobileGround=true;}
  }
  const trees=BU_CAS_TREE_SITES.map(t=>({...t,rootY:buElevation(t.x,t.z)+.14}));
  group.updateMatrixWorld(true);let disposed=false;
  return {group,ground,walls,trees,dispose:()=>{if(disposed)return;disposed=true;group.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});Object.values(materials).forEach(m=>m.dispose());leafDepth.dispose();leafMap.dispose();group.clear();}};
}
