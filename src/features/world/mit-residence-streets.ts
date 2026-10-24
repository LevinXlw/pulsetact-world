import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial} from 'three';
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {MIT_RESIDENCE_SIDEWALK_WEST,MIT_RESIDENCE_SIDEWALK_EAST,MIT_RESIDENCE_CROSSWALK,MASEEH_COURTYARD_WALK,MIT_MEMORIAL_CARRIAGEWAYS,MIT_MEMORIAL_SURFACE_RAMP,mitMemorialLaneWidth} from './mit-residence-layout';
import type {WorldPoint} from './geo-coordinates';
import {createMITSurfaceProjection} from './mit-surface-projection';
import {createCampusSurface} from './painterly-surfaces';
import {MIT_AMHERST_STREET,MIT_AMHERST_SOUTH_WALK,MIT_BAKER_AMHERST_WALK,MIT_BAKER_ENTRY_WALK} from './mit-residence-layout';

/** Small shared desktop/mobile paving layer. Heights are sampled on the
 * existing terrain before attachment; this never adds a flat ground slab. */
export function createMITResidenceStreets(height:(x:number,z:number)=>number|undefined,terrain?:readonly Mesh[]){
 const group=new Group();group.name='MIT · Memorial Drive dorm sidewalks';const ground:Mesh[]=[];
 const buffers={paving:[] as number[],road:[] as number[],kerb:[] as number[],paint:[] as number[]};
 // Roads follow surveyed terrain, never the top of the new planted islands.
 const project=terrain?createMITSurfaceProjection(terrain.filter(m=>m.userData.bakerNorthCourt!==true)):undefined;
 const surveyed=terrain?.filter(m=>(Array.isArray(m.material)?m.material:[m.material]).some(mat=>/orthophotography/i.test(mat.name)));
 const originalProject=surveyed?.length?createMITSurfaceProjection(surveyed):project;
 function strip(path:WorldPoint[],width:number|((x:number)=>number),key:keyof typeof buffers,offset:number|((x:number)=>number)=0,lift=.025,dash=false,original=false){
  const projection=original?originalProject:project;
  let distance=0;
  const normal=(i:number)=>{const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];
   if(i===0||i===path.length-1){const length=Math.hypot(b[0]-a[0],b[1]-a[1]);return[-(b[1]-a[1])/length,(b[0]-a[0])/length];}
   const p=path[i],al=Math.hypot(p[0]-a[0],p[1]-a[1]),bl=Math.hypot(b[0]-p[0],b[1]-p[1]),ax=-(p[1]-a[1])/al,az=(p[0]-a[0])/al,bx=-(b[1]-p[1])/bl,bz=(b[0]-p[0])/bl,nx=ax+bx,nz=az+bz,denominator=Math.max(.5,nx*ax+nz*az);return[nx/denominator,nz/denominator];
  };
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),na=normal(i-1),nb=normal(i),steps=Math.ceil(length/(project?3:1));
   for(let j=0;j<steps;j++){
    if(dash&&Math.floor((distance+(j+.5)*length/steps)/3)%3!==0)continue;
    // Subdivide across the width too: a 9.5 m chord can cut below surveyed
    // bumps and reveal the old paving through an otherwise valid road strip.
    const columns=project?1:Math.ceil(typeof width==='number'?width:width(a[0]+dx*(j+.5)/steps));
    for(let c=0;c<columns;c++){
      const points=[[c,j],[c+1,j],[c,j+1],[c+1,j+1]].map(([side,t])=>{const f=t/steps,centerX=a[0]+dx*f,w=typeof width==='number'?width:width(centerX),o=typeof offset==='number'?offset:offset(centerX),across=o-w/2+side*w/columns,x=centerX+(na[0]+(nb[0]-na[0])*f)*across,z=a[1]+dz*f+(na[1]+(nb[1]-na[1])*f)*across;const y=height(x,z);return y===undefined?null:[x,y+lift,z];});
      if(points.some(p=>!p))continue;
      if(projection){projection([points[0]!,points[1]!,points[3]!,points[2]!] as [number,number,number][],lift,buffers[key]);continue;}
      // Upward winding in the east/up/south frame.
      for(const k of [0,1,2,1,3,2])buffers[key].push(...points[k]!);
    }
   }distance+=length;
  }
 }
 for(const path of [MIT_RESIDENCE_SIDEWALK_WEST,MIT_RESIDENCE_SIDEWALK_EAST]){strip(path,3.2,'paving');strip(path,.18,'kerb',1.65,.05);}
 strip(MASEEH_COURTYARD_WALK,2.4,'paving');
 strip(MIT_AMHERST_STREET,5.5,'road',0,.025,false,true);
 strip(MIT_AMHERST_SOUTH_WALK,2.8,'paving',0,.04,false,true);
 strip(MIT_BAKER_AMHERST_WALK.slice(0,9),2.5,'paving',0,.04,false,true);
 strip(MIT_BAKER_ENTRY_WALK.slice(0,2),2.5,'paving',0,.04,false,true);
 strip(MIT_RESIDENCE_CROSSWALK,3.2,'road');
 // The stripes span the walkway and repeat along the crossing direction.
 const [crossA,crossB]=MIT_RESIDENCE_CROSSWALK,crossLength=Math.hypot(crossB[0]-crossA[0],crossB[1]-crossA[1]);
 for(let d=.2;d<crossLength;d+=1.25){const p=(t:number):WorldPoint=>[crossA[0]+(crossB[0]-crossA[0])*t/crossLength,crossA[1]+(crossB[1]-crossA[1])*t/crossLength];strip([p(d),p(Math.min(crossLength,d+.55))],2.9,'paint',0,.04);}
 strip(MIT_MEMORIAL_SURFACE_RAMP,4,'road');
 for(const path of MIT_MEMORIAL_CARRIAGEWAYS){strip(path,mitMemorialLaneWidth,'road');strip(path,.1,'paint',0,.038,true);strip(path,.12,'paint',x=>mitMemorialLaneWidth(x)/2-.3,.038);strip(path,.12,'paint',x=>-mitMemorialLaneWidth(x)/2+.3,.038);}
 for(const [key,color] of Object.entries({paving:'#bdb9a8',road:'#626b69',kerb:'#d0cebc',paint:'#e2decb'})){
  const vertices=buffers[key as keyof typeof buffers];if(!vertices.length)continue;
  const raw=new BufferGeometry();raw.setAttribute('position',new Float32BufferAttribute(vertices,3));
  const geometry=mergeVertices(raw,.0001);raw.dispose();geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=(key==='paint'?new MeshStandardMaterial():createCampusSurface(key==='road'?'road':key==='paving'?'pavement':'courtCurb',{pavingStyle:'concrete'})) as MeshStandardMaterial;
  material.name=`MIT Memorial ${key}`;material.color.set(color);material.roughness=.94;material.polygonOffset=true;material.polygonOffsetFactor=key==='paint'?-5:-4;material.polygonOffsetUnits=key==='paint'?-5:-4;
  const mesh=new Mesh(geometry,material);mesh.name=`MIT Memorial ${key}`;mesh.receiveShadow=true;mesh.userData.mitResidenceGround=true;group.add(mesh);if(key==='paving'||key==='road')ground.push(mesh);
 }
 return{group,ground};
}
