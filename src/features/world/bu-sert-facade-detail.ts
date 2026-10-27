import {BoxGeometry,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,PlaneGeometry} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {BU_SERT_FRAME,BU_SERT_FOUNDATION_ANCHOR,BU_SERT_PARTS,buSertLocal,buSertPoint} from './bu-sert-layout';
import {buElevation} from './bu-terrain';
import {createCampusSurface} from './painterly-surfaces';
import {createBUFrontageGlazing} from './bu-frontage-glazing';

type Finish='aggregate'|'frame'|'glazing'|'spandrel';
type Options={mobile?:boolean};

/** Photo-led lower south window wall, fitted to the retained surveyed facade.
 * The 2021 Commonwealth Avenue photograph and BU's 2023 Link photograph show
 * deep upright sun fins, a continuous intermediate rail, hanging lower blades
 * and slender metal glazing frames. Sections/spacing are photo estimates; the
 * existing foundation, occupied floors, wall collision and upper mass remain.
 * Source/limits: assets-source/charles-bu/sert-facade-detail-20261025.json. */
export function createBUSertFacadeDetail({mobile=false}:Options={}){
  const group=new Group();group.name='BU Mugar · south lower window wall detail';
  const ground:Mesh[]=[],walls:Mesh[]=[];
  const part=BU_SERT_PARTS.find(p=>p.id==='mugar-west')!;
  const local=part.footprint.map(buSertLocal),south=Math.max(...local.map(p=>p[1]));
  const edge=local.filter(p=>Math.abs(p[1]-south)<.04),left=Math.min(...edge.map(p=>p[0])),right=Math.max(...edge.map(p=>p[0]));
  if(!Number.isFinite(left+right)||right-left<5)throw Error('Mugar south facade no longer matches the reviewed footprint');
  const width=right-left,base=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
  // Retain the old curtain-wall primary grid; split each bay into two lights.
  // This makes every old upright coincide with a new upright, rather than
  // leaving an unrelated black grid visible behind the new window screen.
  const primaryBays=Math.ceil(width/4.1),bays=primaryBays*2,spacing=width/bays;
  const batches=new Map<Finish,BufferGeometry[]>();
  const add=(finish:Finish,g:BufferGeometry,x:number,y:number,z:number)=>{
    const point=buSertPoint(x,z);g.rotateY(BU_SERT_FRAME.yaw);g.translate(point[0],base+y,point[1]);
    const geometry=g.index?g.toNonIndexed():g;if(geometry!==g)g.dispose();
    const count=geometry.getAttribute('position').count;
    if(!geometry.getAttribute('uv'))geometry.setAttribute('uv',new Float32BufferAttribute(new Float32Array(count*2),2));
    const parts=batches.get(finish)??[];parts.push(geometry);batches.set(finish,parts);
  };
  const box=(finish:Finish,x:number,y:number,z:number,w:number,h:number,d:number)=>add(finish,new BoxGeometry(w,h,d),x,y,south+z);
  const centre=(left+right)/2;
  // These opaque panes lie in front of the old curtain glass but remain
  // recessed behind its structural frame. They replace the old visual skin,
  // not the physical opening: no new wall or collision slab is introduced.
  for(const [bottom,top] of [[.20,3.48],[3.88,7.00]]){
    add('glazing',new PlaneGeometry(width-.20,top-bottom),centre,(bottom+top)/2,south-.265);
  }
  box('spandrel',centre,.34,-.20,width-.18,.35,.07);
  box('aggregate',centre,3.68,.29,width,.27,1.18);
  box('aggregate',centre,7.12,.30,width,.16,1.20);
  for(let i=0;i<=bays;i++){
    const x=left+i*spacing;
    // Deep, thin concrete vanes are actual closed solids with visible return
    // faces. The lower tails stop above head height over the existing court.
    if(i>0&&i<bays){
      box('aggregate',x,5.465,.27,.145,3.17,1.18);
      box('aggregate',x,3.145,.085,.145,.79,.81);
    }
    box('frame',x,1.84,-.105,.065,3.28,.26);
    box('frame',x,5.44,-.105,.065,3.12,.26);
  }
  for(const [height,thickness] of [[.18,.085],[2.70,.065],[3.49,.085],[3.89,.085],[6.98,.085]])box('frame',centre,height,-.105,width-.12,thickness,.26);
  // Deep outer jambs close the curtain edge at the established facade line.
  for(const x of [left+.09,right-.09])box('aggregate',x,3.58,-.005,.18,7.16,.50);
  const materials:MeshStandardMaterial[]=[];
  for(const [finish,parts] of batches){
    const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(!geometry)throw Error(`Mugar detail merge failed: ${finish}`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const material=finish==='glazing'?createBUFrontageGlazing({variant:'clear',mobile}):finish==='aggregate'?
      createCampusSurface('concrete',{profile:'bu',yaw:BU_SERT_FRAME.yaw,groundHeight:base}) as MeshStandardMaterial:
      new MeshStandardMaterial({color:finish==='frame'?'#b8b7ad':'#92958e',roughness:finish==='frame'?.52:.86,metalness:finish==='frame'?.36:.08});
    if(finish==='aggregate')material.color.set('#aba69b');
    if(finish!=='glazing')material.name=`Mugar south ${finish}`;materials.push(material);
    const mesh=new Mesh(geometry,material);mesh.name=`BU Mugar lower facade · ${finish}`;
    mesh.castShadow=finish!=='glazing';mesh.receiveShadow=true;mesh.userData.buSertFacadeDetail=true;group.add(mesh);
  }
  group.userData={...group.userData,buSertFacadeDetail:true,facade:{left,right,south,base,bays,spacing,glassRecess:.265,finProjection:.86,finBottom:2.75},triangles:[...group.children].reduce((sum,m)=>sum+(m as Mesh).geometry.getAttribute('position').count/3,0)};
  let disposed=false;
  return{group,ground,walls,dispose:()=>{if(disposed)return;disposed=true;group.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});materials.forEach(m=>m.dispose());group.clear();}};
}
