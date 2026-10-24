import {BufferGeometry,Color,CylinderGeometry,DoubleSide,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,PlaneGeometry,Quaternion,SphereGeometry,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Point=readonly [number,number];
type Footprint={footprint:readonly Point[];holes?:readonly (readonly Point[])[]};
type GroundArea={kind:string;points:readonly Point[];holes?:readonly (readonly Point[])[]};
type Bounds={minX:number;maxX:number;minZ:number;maxZ:number};
type PlantKind='palm'|'mesquite'|'palo-verde'|'saguaro'|'agave';
type Plant={x:number;z:number;kind:PlantKind;height:number};
const UP=new Vector3(0,1,0),CELL=240;

export function arizonaInside(point:Point,ring:readonly Point[]){
  let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
export function arizonaSegmentDistance(p:Point,a:Point,b:Point){
  const x=b[0]-a[0],z=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*z)/(x*x+z*z||1)));return Math.hypot(p[0]-a[0]-x*t,p[1]-a[1]-z*t);
}
export function arizonaBoundaryDistance(p:Point,ring:readonly Point[]){return Math.min(...ring.map((a,i)=>arizonaSegmentDistance(p,a,ring[(i+1)%ring.length])));}

/** Original low-cost desert planting. Species and landscape distribution are
 * authored impressions, not a tree inventory. None of these positions claims
 * botanical survey accuracy; all leave the surveyed walking corridors open. */
export function createArizonaEnvironment(options:{bounds:Bounds;buildings:readonly Footprint[];surfaces:readonly GroundArea[];paths:readonly (readonly Point[])[];elevation:(x:number,z:number)=>number;wind:{value:number}}){
  const {bounds,buildings,surfaces,paths,elevation}=options,group=new Group();group.name='Arizona · Sonoran campus planting';
  const batches=new Map<string,{color:string;parts:BufferGeometry[];leaves:boolean}>(),plants:Plant[]=[],walls:Mesh[]=[],visible:Mesh[]=[];
  const invisible=new MeshBasicMaterial({side:DoubleSide}),shaft=new Vector3(),mid=new Vector3(),rotation=new Quaternion();
  const segments=paths.flatMap(path=>path.slice(1).map((b,i)=>({a:path[i],b})));
  const boxes=buildings.map(b=>({b,minX:Math.min(...b.footprint.map(p=>p[0]))-7,maxX:Math.max(...b.footprint.map(p=>p[0]))+7,minZ:Math.min(...b.footprint.map(p=>p[1]))-7,maxZ:Math.max(...b.footprint.map(p=>p[1]))+7}));
  const areas=surfaces.map(s=>({s,minX:Math.min(...s.points.map(p=>p[0])),maxX:Math.max(...s.points.map(p=>p[0])),minZ:Math.min(...s.points.map(p=>p[1])),maxZ:Math.max(...s.points.map(p=>p[1]))}));
  const inArea=(p:Point,a:(typeof areas)[number])=>p[0]>=a.minX&&p[0]<=a.maxX&&p[1]>=a.minZ&&p[1]<=a.maxZ&&arizonaInside(p,a.s.points)&&!(a.s.holes??[]).some(h=>arizonaInside(p,h));
  const paved=areas.filter(a=>!['grass','lawn','garden','sand','desert'].includes(a.s.kind)),grassy=areas.filter(a=>['grass','lawn'].includes(a.s.kind));
  const isPaved=(p:Point)=>paved.some(a=>inArea(p,a));
  const isOccupied=(p:Point,margin=5)=>boxes.some(({b,minX,maxX,minZ,maxZ})=>p[0]>=minX&&p[0]<=maxX&&p[1]>=minZ&&p[1]<=maxZ&&(arizonaInside(p,b.footprint)||arizonaBoundaryDistance(p,b.footprint)<margin));
  const onLawn=(p:Point)=>grassy.some(a=>inArea(p,a));
  const clear=(p:Point,margin=5)=>!isOccupied(p,margin)&&!isPaved(p)&&segments.every(({a,b})=>arizonaSegmentDistance(p,a,b)>margin)&&plants.every(t=>Math.hypot(t.x-p[0],t.z-p[1])>7.5);
  const add=(geometry:BufferGeometry,color:string,x:number,z:number,leaves=false)=>{
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${Math.floor(x/CELL)}:${Math.floor(z/CELL)}:${color}:${leaves}`,batch=batches.get(key)??{color,parts:[],leaves};batch.parts.push(part);batches.set(key,batch);
  };
  const branch=(a:Vector3,b:Vector3,r0:number,r1:number,color:string,x:number,z:number)=>{
    shaft.subVectors(b,a);const g=new CylinderGeometry(r1,r0,shaft.length(),7);rotation.setFromUnitVectors(UP,shaft.normalize());g.applyQuaternion(rotation);mid.addVectors(a,b).multiplyScalar(.5);g.translate(mid.x,mid.y,mid.z);add(g,color,x,z);
  };
  const crown=(x:number,y:number,z:number,width:number,height:number,depth:number,color:string)=>{
    const g=new SphereGeometry(1,10,7),positions=g.getAttribute('position');
    for(let i=0;i<positions.count;i++){const xx=positions.getX(i),yy=positions.getY(i),zz=positions.getZ(i),angle=Math.atan2(zz,xx),r=1+.12*Math.sin(angle*5+yy*2)+.065*Math.cos(angle*9-yy*4);positions.setXYZ(i,xx*width*r,yy*height,zz*depth*r);}
    g.computeVertexNormals();g.translate(x,y,z);add(g,color,x,z,true);
  };
  const trunkCollision=(x:number,z:number,radius:number,height:number)=>{
    const mesh=new Mesh(new CylinderGeometry(radius,radius,height,8),invisible);mesh.position.set(x,elevation(x,z)+height/2,z);mesh.name='Arizona tree trunk';mesh.visible=false;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();group.add(mesh);walls.push(mesh);
  };
  const random=(x:number,z:number,offset=0)=>{const n=Math.sin(x*12.9898+z*78.233+offset*39.22)*43758.5453;return n-Math.floor(n);};
  const leaf=(a:Vector3,b:Vector3,width:number,color:string,x:number,z:number,bend=.3)=>{
    const d=new Vector3().subVectors(b,a),side=new Vector3(-d.z,0,d.x).normalize().multiplyScalar(width),m=new Vector3().lerpVectors(a,b,.48);m.y+=bend;
    const v=[a.x,a.y,a.z,m.x+side.x,m.y,m.z+side.z,b.x,b.y,b.z,a.x,a.y,a.z,b.x,b.y,b.z,m.x-side.x,m.y,m.z-side.z];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(v,3));g.computeVertexNormals();add(g,color,x,z,true);
  };
  const plant=(x:number,z:number,kind:PlantKind,height:number,force=false)=>{
    if(!force&&!clear([x,z],kind==='agave'?3.5:5))return;
    const y=elevation(x,z),seed=random(x,z),phase=seed*Math.PI*2;plants.push({x,z,kind,height});
    if(kind==='palm'){
      const lean=.7*Math.sin(phase),top=new Vector3(x+lean,y+height,z+.4*Math.cos(phase));
      branch(new Vector3(x,y-.1,z),top,.40,.24,'#8d7356',x,z);
      for(let h=.8;h<height-.8;h+=.65){const g=new CylinderGeometry(.37-.11*h/height,.40-.11*h/height,.12,8);g.translate(x+lean*h/height,y+h,z+.4*Math.cos(phase)*h/height);add(g,'#a38b67',x,z);}
      crown(top.x,top.y-.22,top.z,.62,.80,.62,'#6b7950');
      for(let i=0;i<13;i++){
        const angle=phase+i*Math.PI*2/13,len=4.1+(i%3)*.35,tip=new Vector3(top.x+Math.cos(angle)*len,top.y-.65-(i%3)*.40,top.z+Math.sin(angle)*len),midpoint=new Vector3().lerpVectors(top,tip,.53);midpoint.y+=1.4;
        branch(top,midpoint,.055,.025,'#82975c',x,z);branch(midpoint,tip,.03,.01,'#82975c',x,z);
        const tangent=new Vector3(-Math.sin(angle),0,Math.cos(angle));
        for(let j=1;j<8;j++){
          const t=j/8,at=new Vector3().lerpVectors(top,tip,t);at.y+=Math.sin(t*Math.PI)*1.2;const length=Math.sin(t*Math.PI)*.9;
          for(const s of [-1,1]){const end=at.clone().addScaledVector(tangent,s*length).add(new Vector3(Math.cos(angle)*.5,-.28,Math.sin(angle)*.5));leaf(at,end,.13,i%2?'#7d9059':'#91a56a',x,z,.07);}
        }
      }
      trunkCollision(x,z,.44,2.1);
    }else if(kind==='mesquite'||kind==='palo-verde'){
      const green=kind==='palo-verde',trunk=green?'#85915c':'#857861',base=new Vector3(x,y,z),fork=new Vector3(x+.2,y+height*.33,z-.12);
      branch(base,fork,.24,.16,trunk,x,z);
      for(let i=0;i<5;i++){
        const angle=phase+i*2.39996,reach=height*(.22+(i%2)*.10),top=new Vector3(x+Math.cos(angle)*reach,y+height*(.65+(i%3)*.11),z+Math.sin(angle)*reach);
        branch(fork,top,.13,.04,trunk,x,z);
        for(let j=0;j<2;j++){const xx=top.x+Math.cos(angle+j*2)*1.1,zz=top.z+Math.sin(angle+j*2)*1.1;crown(xx,top.y+.12,zz,height*.29,height*.12,height*.23,green?(j?'#9da56c':'#a9ad71'):(j?'#849761':'#91a16d'));}
      }
      trunkCollision(x,z,.30,1.8);
    }else if(kind==='saguaro'){
      const radius=.35+height*.018,color='#82956c';branch(new Vector3(x,y,z),new Vector3(x,y+height,z),radius,radius*.88,color,x,z);crown(x,y+height,z,radius,radius,radius,color);
      for(let side=-1;side<=1;side+=2){const angle=phase+side*1.6,armHeight=height*(.43+side*.055),reach=.9+height*.07,ax=x+Math.cos(angle)*reach,az=z+Math.sin(angle)*reach;branch(new Vector3(x,y+armHeight,z),new Vector3(ax,y+armHeight+.27,az),radius*.70,radius*.69,color,x,z);branch(new Vector3(ax,y+armHeight+.27,az),new Vector3(ax,y+height*(.77+side*.06),az),radius*.69,radius*.58,color,x,z);crown(ax,y+height*(.77+side*.06),az,radius*.58,radius*.58,radius*.58,color);}
      // Fine sculpted ribs catch light; no flat cactus cutouts.
      for(let i=0;i<9;i++){const theta=i*Math.PI*2/9;branch(new Vector3(x+Math.cos(theta)*radius*.98,y+.12,z+Math.sin(theta)*radius*.98),new Vector3(x+Math.cos(theta)*radius*.88,y+height-.12,z+Math.sin(theta)*radius*.88),.022,.018,'#9da87c',x,z);}
      trunkCollision(x,z,radius+.06,2);
    }else{
      for(let i=0;i<15;i++){const angle=phase+i*2.39996,r=.65+(i%4)*.19;leaf(new Vector3(x,y+.12,z),new Vector3(x+Math.cos(angle)*r,y+.2+height*(.3+(i%4)*.19),z+Math.sin(angle)*r),.15,i%2?'#7e9b8b':'#98ac94',x,z,.16);}
    }
  };

  // Palm-lined greens provide a recognisable campus oasis. Dry planting is
  // kept on open mineral ground, with lower shrubs away from through paths.
  for(const area of surfaces.filter(s=>['grass','lawn'].includes(s.kind))){
    const xs=area.points.map(p=>p[0]),zs=area.points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    if(maxX-minX>75&&maxZ-minZ>15){for(let x=minX+12;x<maxX-8;x+=27)for(const z of [minZ+4,maxZ-4])if(arizonaInside([x,z],area.points))plant(x,z,'palm',10+random(x,z)*3);}
  }
  for(let x=bounds.minX+20;x<bounds.maxX-20;x+=27)for(let z=bounds.minZ+20;z<bounds.maxZ-20;z+=27){
    const xx=x+(random(x,z,1)-.5)*17,zz=z+(random(x,z,2)-.5)*17,p:[number,number]=[xx,zz],roll=random(x,z,3);
    if(roll>.22||onLawn(p))continue;
    // Cacti are small garden accents rather than a desert wilderness laid
    // over the campus. The dominant shade trees are mesquite / palo verde.
    const kind:PlantKind=roll<.035?'saguaro':roll<.075?'agave':roll<.14?'palo-verde':'mesquite';
    plant(xx,zz,kind,kind==='agave'?1.1:kind==='saguaro'?3.5+roll*22:5+roll*13);
  }
  const materials=new Map<string,MeshStandardMaterial>();
  for(const [key,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(p=>p.dispose());if(!geometry)throw new Error('Arizona plant batching failed');geometry.computeBoundingBox();geometry.computeBoundingSphere();
    let material=materials.get(batch.color);if(!material){
      material=new MeshStandardMaterial({color:new Color(batch.color),roughness:1,side:DoubleSide});material.name='Arizona desert planting';
      if(batch.leaves){
        material.onBeforeCompile=shader=>{shader.uniforms.uArizonaWind=options.wind;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uArizonaWind;').replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x += sin(uArizonaWind * 1.3 + position.z * .19 + position.x * .11) * .045; transformed.z += cos(uArizonaWind + position.x * .17) * .025;');};
        material.customProgramCacheKey=()=> 'arizona-desert-foliage-v1';
      }
      materials.set(batch.color,material);
    }
    const mesh=new Mesh(geometry,material);mesh.name=`Arizona planting ${key}`;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);visible.push(mesh);
  }
  // Low-detail surroundings make the finite gameplay bounds sit in Tucson's
  // ground plane instead of appearing as a floating rectangle in an overview.
  // This is scenic context only; it adds no walkable area or mapped buildings.
  const surroundMaterial=new MeshStandardMaterial({color:'#bdab81',roughness:1}),margin=2600;
  const rectangles=[
    [bounds.minX-margin,bounds.maxX+margin,bounds.minZ-margin,bounds.minZ],
    [bounds.minX-margin,bounds.maxX+margin,bounds.maxZ,bounds.maxZ+margin],
    [bounds.minX-margin,bounds.minX,bounds.minZ,bounds.maxZ],
    [bounds.maxX,bounds.maxX+margin,bounds.minZ,bounds.maxZ],
  ];
  for(const [minX,maxX,minZ,maxZ] of rectangles){
    const width=maxX-minX,depth=maxZ-minZ,geometry=new PlaneGeometry(width,depth,Math.ceil(width/64),Math.ceil(depth/64));geometry.rotateX(-Math.PI/2);geometry.translate((minX+maxX)/2,-.055,(minZ+maxZ)/2);
    const positions=geometry.getAttribute('position');for(let i=0;i<positions.count;i++)positions.setY(i,elevation(positions.getX(i),positions.getZ(i))-.055);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,surroundMaterial);mesh.name='Arizona · surrounding desert context';mesh.receiveShadow=true;group.add(mesh);
  }
  // A distant, nonwalkable atmospheric silhouette suggests the Santa Catalina
  // range north of Tucson. It is explicitly scenic art, not a sampled DEM.
  for(let layer=0;layer<2;layer++){
    const points:number[]=[],colors:number[]=[],count=36,center=(bounds.minX+bounds.maxX)/2,z=bounds.minZ-1000-layer*480;
    const ridge=(i:number)=>{const x=center-2100+i*4200/count,h=110+Math.sin(i*.53+layer*.7)*43+Math.sin(i*1.31)*28+Math.exp(-(((i-count*.58)/8)**2))*170;return new Vector3(x,h+layer*65,z-Math.sin(i*.41)*85);};
    const color=new Color(layer?'#a5aaa1':'#929c8d');
    for(let i=0;i<count;i++){
      const a=ridge(i),b=ridge(i+1),frontA=new Vector3(a.x,-45,a.z+260),frontB=new Vector3(b.x,-45,b.z+260),backA=new Vector3(a.x,-45,a.z-180),backB=new Vector3(b.x,-45,b.z-180);
      for(const [index,p] of [frontA,a,b,frontA,b,frontB,a,backA,backB,a,backB,b].entries()){points.push(p.x,p.y,p.z);const shade=index%3===1?1.04:.96;colors.push(color.r*shade,color.g*shade,color.b*shade);}
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,new MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:1,side:DoubleSide}));mesh.name='Arizona · distant Catalina impression';mesh.receiveShadow=false;group.add(mesh);
  }
  group.userData.plants=plants;group.updateMatrixWorld(true);
  let lowQuality=false;
  return {group,walls,plants,setQuality:(low:boolean)=>{lowQuality=low;visible.forEach(m=>{m.castShadow=!low;});},update:(camera:Vector3)=>{
    const altitude=Math.max(0,camera.y-elevation(camera.x,camera.z));
    const reach=Math.max(lowQuality?270:530,Math.min(2200,altitude*4));
    for(const mesh of visible){const box=mesh.geometry.boundingBox!,dx=Math.max(box.min.x-camera.x,0,camera.x-box.max.x),dz=Math.max(box.min.z-camera.z,0,camera.z-box.max.z);mesh.visible=dx*dx+dz*dz<reach*reach;}
  }};
}
