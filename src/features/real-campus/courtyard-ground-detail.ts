import {BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Quaternion,Vector3} from 'three';
import {courtyardTurfPalette} from './portico-finish';

// The existing lawn patches, in the Building 10 courtyard's local metre frame.
// This layer grows from their triangles; it never substitutes a flat ground plane.
const lawns=[[-46,46,7,92],[-46,-2,95,128],[2,46,95,128],[-46,-2,131,152],[2,46,131,152]];
const origin=[12.904326,-34.578878],uAxis=[.9080005,-.4189689],sAxis=[.4189689,.9080005];
function rng(seed:number){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function lawnEdgeDistance(x:number,z:number){
 const dx=x-origin[0],dz=z-origin[1],u=dx*uAxis[0]+dz*uAxis[1],s=dx*sAxis[0]+dz*sAxis[1];
 for(const [u0,u1,s0,s1] of lawns)if(u>u0&&u<u1&&s>s0&&s<s1)return Math.min(u-u0,u1-u,s-s0,s1-s);
 return -1;
}

/** Terrain positions are sampled barycentrically, so no raycast or height query
 * is needed at runtime. Only the narrow lawn margin gets additional geometry. */
export function courtyardGrassRoots(source:Group){
 const random=rng(41827),roots:Vector3[]=[],a=new Vector3(),b=new Vector3(),c=new Vector3();
 source.updateMatrixWorld(true);
 source.traverse(object=>{
  if(!(object instanceof Mesh)||Array.isArray(object.material)||object.material.name!=='grass')return;
  const positions=object.geometry.getAttribute('position'),index=object.geometry.index,count=index?.count??positions.count;
  for(let i=0;i<count;i+=3){
   a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(object.matrixWorld);
   b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(object.matrixWorld);
   c.fromBufferAttribute(positions,index?index.getX(i+2):i+2).applyMatrix4(object.matrixWorld);
   const area=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))*.5;
   const samples=Math.floor(area*110+random());
   for(let j=0;j<samples;j++){
    const t=Math.sqrt(random()),v=random(),wa=1-t,wb=t*(1-v),wc=t*v;
    const x=a.x*wa+b.x*wb+c.x*wc,z=a.z*wa+b.z*wb+c.z*wc,edge=lawnEdgeDistance(x,z);
    // Leave a few centimetres for a clean mown edge, then a soft irregular fringe.
    if(edge<.045||edge>.12+random()*.18||roots.length>=28000)continue;
    roots.push(new Vector3(x,a.y*wa+b.y*wb+c.y*wc-.005,z));
   }
  }
 });
 return roots;
}

function bladeGeometry(){
 const positions:number[]=[],colors:number[]=[],random=rng(727);
 for(let i=0;i<3;i++){
  const angle=i*Math.PI*.61,dx=Math.cos(angle),dz=Math.sin(angle),h=.028+random()*.025,w=.003+random()*.003;
  const x=(random()-.5)*.055,z=(random()-.5)*.055,bend=.012+random()*.015;
  const points=[[x-dx*w,0,z-dz*w],[x+dx*w,0,z+dz*w],[x+dx*w*.45-dz*bend*.4,h*.6,z+dz*w*.45+dx*bend*.4],[x-dx*w*.45-dz*bend*.4,h*.6,z-dz*w*.45+dx*bend*.4],[x-dz*bend,h,z+dx*bend]];
  for(const index of [0,1,2,0,2,3,3,2,4]){positions.push(...points[index]);const tone=index<2?.55:index===4?1.08:.9;colors.push(tone,tone,tone);}
 }
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)).setAttribute('color',new Float32BufferAttribute(colors,3));
 geometry.computeVertexNormals();return geometry;
}

export function createCourtyardGroundDetail(source:Group,lowQuality=false){
 const group=new Group();group.name='Courtyard short grass';
 const roots=courtyardGrassRoots(source),geometry=bladeGeometry();
 const material=new MeshStandardMaterial({name:'shortMownGrass',side:DoubleSide,roughness:1,vertexColors:true});
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vec3 rootWorld=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
   float nearGrass=1.0-smoothstep(18.0,38.0,length(rootWorld-cameraPosition));
   transformed.y*=nearGrass;
  `);
  // Small blades use an upward-biased normal to approximate a dense turf layer;
  // otherwise back-facing slivers become dark spikes against the lawn.
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   normal=normalize(normal*.12+normalize(mat3(viewMatrix)*vec3(0.0,1.0,0.0)));
  `);
 };
 material.customProgramCacheKey=()=> 'courtyard-mown-fringe-v1';
 const mesh=new InstancedMesh(geometry,material,roots.length),random=rng(924),matrix=new Matrix4(),rotation=new Quaternion(),scale=new Vector3(),color=new Color(),up=new Vector3(0,1,0);
 // Shuffle the roots so the low-quality prefix retains the complete boundary.
 for(let i=roots.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[roots[i],roots[j]]=[roots[j],roots[i]];}
 roots.forEach((root,index)=>{
  rotation.setFromAxisAngle(up,random()*Math.PI*2);scale.setScalar(.7+random()*.6);matrix.compose(root,rotation,scale);mesh.setMatrixAt(index,matrix);
  const tone=random(),lo=courtyardTurfPalette.low,hi=courtyardTurfPalette.high;
  color.setRGB(lo[0]+(hi[0]-lo[0])*tone,lo[1]+(hi[1]-lo[1])*tone,lo[2]+(hi[2]-lo[2])*tone);mesh.setColorAt(index,color);
 });
 mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
 mesh.castShadow=false;mesh.receiveShadow=true;mesh.userData.collision='none';mesh.userData.excludeFromAO=true;
 mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);
 group.userData.stats={tufts:roots.length,triangles:roots.length*9,drawCalls:1};
 group.userData.setQuality=(quality:string)=>{mesh.count=quality==='low'?Math.floor(roots.length*.3):roots.length;};
 group.userData.setQuality(lowQuality?'low':'standard');return group;
}
