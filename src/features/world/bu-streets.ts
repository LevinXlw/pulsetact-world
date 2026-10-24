import {BoxGeometry,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {BU_STREET_ROUTE,type WorldPoint} from './charles-geography';

/** Simplified Commonwealth Avenue streetscape. Sidewalks stay level with BU;
 * the median rails are scenery, without a transit or traffic simulation. */
export function createBUStreets(){
  const group=new Group();group.name='Commonwealth Avenue campus walk';
  const ground:Mesh[]=[],batches=new Map<string,BufferGeometry[]>();
  const materials:Record<string,MeshStandardMaterial>={
    paving:createCampusSurface('pavement') as MeshStandardMaterial,
    road:createCampusSurface('road') as MeshStandardMaterial,
    trim:createCampusSurface('trim') as MeshStandardMaterial,
    rail:new MeshStandardMaterial({color:'#66746d',roughness:.64,metalness:.3}),
    gravel:new MeshStandardMaterial({color:'#7d8978',roughness:1}),
    marking:new MeshStandardMaterial({color:'#dfd6b6',roughness:1}),
  };
  const put=(kind:string,g:BufferGeometry)=>{const list=batches.get(kind)??[];list.push(g);batches.set(kind,list);};
  const box=(kind:string,x:number,y:number,z:number,w:number,h:number,d:number,yaw=0)=>{
    const g=new BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,y,z);put(kind,g);
  };
  const strip=(kind:string,points:WorldPoint[],width:number,y:number)=>{
    const positions:number[]=[],uv:number[]=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=(b[1]-a[1])/length,nz=-(b[0]-a[0])/length;
      for(const [end,side] of [[0,-1],[1,-1],[0,1],[0,1],[1,-1],[1,1]]){
        const p=end?b:a,x=p[0]+nx*side*width/2,z=p[1]+nz*side*width/2;
        positions.push(x,y,z);uv.push(x/4,z/4);
      }
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.computeVertexNormals();put(kind,g);
  };
  // Extend the street beyond both landmarks so it reads as part of the city.
  const walk:WorldPoint[]=[[-1300,985],...BU_STREET_ROUTE.slice(1),[-555,1109]];
  strip('paving',BU_STREET_ROUTE,7,5.251);
  strip('paving',walk,8.5,5.237);
  const road=walk.map(([x,z])=>[x,z+20] as WorldPoint);
  strip('road',road,24,5.218);strip('gravel',road,6.8,5.235);
  const southWalk=walk.map(([x,z])=>[x,z+36] as WorldPoint);strip('paving',southWalk,7,5.238);
  for(const offset of [-3.5,3.5])strip('trim',road.map(([x,z])=>[x,z+offset]),.23,5.28);
  for(const offset of [-2.1,-.66,.66,2.1])strip('rail',road.map(([x,z])=>[x,z+offset]),.065,5.29);
  for(let i=1;i<road.length;i++){
    const a=road[i-1],b=road[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),yaw=-Math.atan2(dz,dx);
    for(let d=3;d<length;d+=18){
      const x=a[0]+dx*d/length,z=a[1]+dz*d/length;
      for(const side of [-1,1])box('marking',x,5.233,z+side*8.1,3.8,.016,.12,yaw);
    }
  }
  // Flush crossing markings at the plaza and the business-school entrance.
  for(const [x,z] of [[-1175,1000],[-632,1098]]){
    for(let offset=10;offset<32;offset+=2.6)box('marking',x,5.245,z+offset,4,.015,.78,-.145);
  }
  const meshes:Mesh[]=[];
  for(const [kind,parts] of batches){
    const normalized=parts.map(g=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();return n;});
    const g=mergeGeometries(normalized);normalized.forEach(part=>part.dispose());if(!g)throw new Error(`Unable to merge BU street ${kind}`);
    g.computeBoundingBox();g.computeBoundingSphere();const mesh=new Mesh(g,materials[kind]);
    mesh.name=`BU street ${kind}`;mesh.receiveShadow=true;group.add(mesh);meshes.push(mesh);
    if(kind==='paving'||kind==='road')ground.push(mesh);
  }
  group.updateMatrixWorld(true);
  return {group,ground,setQuality:(low:boolean)=>meshes.forEach(mesh=>{mesh.receiveShadow=!low;})};
}
