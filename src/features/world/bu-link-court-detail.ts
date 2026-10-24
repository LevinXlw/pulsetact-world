import {BoxGeometry,BufferGeometry,DoubleSide,Float32BufferAttribute,Group,Matrix4,Mesh,MeshStandardMaterial,PlaneGeometry,Quaternion,RingGeometry,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {BU_SERT_FRAME,BU_SERT_LINK_ENTRY,buSertPoint} from './bu-sert-layout';
import {buElevation,drapeBUGeometry} from './bu-terrain';
import {createCampusSurface} from './painterly-surfaces';
import {configureBUGroundLayer} from './bu-ground-layers';

/** Positions/sections are photo estimates fitted to the existing courtyard.
 * The BU 2023 exterior image documents low slab benches, shallow planted
 * borders and mature trees, not these exact local coordinates.
 * assets-source/charles-bu/gsu-link-court-20261024.json */
export const BU_LINK_COURT_DETAIL={
  corridor:{x:BU_SERT_LINK_ENTRY.local[0],halfWidth:3.45,north:76.15,south:102},
  planter:{x:-21.25,z:80.8,width:1.8,depth:8.0},
  benches:[
    {x:-19.85,z:78.65,width:.56,depth:2.65},
    {x:-19.85,z:83.0,width:.56,depth:2.65},
    {x:-4.2,z:89.5,width:.56,depth:3.1},
  ],
  treePit:{x:-20.05,z:92.7,radius:1.12,treeRadius:3.25,height:11.2},
} as const;

type Finish='concrete'|'soil'|'iron'|'leaf'|'leafLight';
type CourtTree={x:number;z:number;radius:number;height:number;rootY:number};
const DATUM=5.2,UP=new Vector3(0,1,0);

/** Separate near-ground detail, with identical desktop/phone furniture and
 * tree sites. Mobile reduces only the small shrub leaves. The caller owns
 * vegetation from `trees`; trunk collision must come from that same tree.
 * Seats and soil are ground as well as wall geometry: a low bench cannot
 * let the outside controller's .9 m torso ray leave feet inside its slab. */
export function createBULinkCourtDetail({mobile=false}:{mobile?:boolean}={}){
  const group=new Group();group.name='BU Link · courtyard benches and planted edge';
  const ground:Mesh[]=[],walls:Mesh[]=[],trees:CourtTree[]=[];
  const batches=new Map<Finish,BufferGeometry[]>();
  const own=(finish:Finish,geometry:BufferGeometry)=>{
    const g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();
    if(!g.getAttribute('uv'))g.setAttribute('uv',new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2));
    const parts=batches.get(finish)??[];parts.push(g);batches.set(finish,parts);
  };
  const place=(finish:Finish,g:BufferGeometry,x:number,y:number,z:number,drape=false)=>{
    const at=buSertPoint(x,z);g.rotateY(BU_SERT_FRAME.yaw);g.translate(at[0],y,at[1]);
    if(drape){const adjusted=drapeBUGeometry(g,2);g.dispose();g=adjusted;}
    own(finish,g);
  };
  const grade=(x:number,z:number)=>buElevation(...buSertPoint(x,z))+.155;
  const rectTop=(x:number,z:number,width:number,depth:number)=>Math.max(...[-1,1].flatMap(a=>[-1,1].map(b=>grade(x+a*width/2,z+b*depth/2))));
  const seatRecords:{x:number;z:number;width:number;depth:number;top:number;bottom:number}[]=[];
  for(const bench of BU_LINK_COURT_DETAIL.benches){
    const {x,z,width,depth}=bench,top=rectTop(x,z,width,depth)+.44,thickness=.12;
    // Independent seat slab and two short concrete feet, rather than a solid
    // extruded block. A narrow reveal under each end catches real shadows.
    place('concrete',new BoxGeometry(width,thickness,depth),x,top-thickness/2,z);
    for(const side of [-1,1]){
      const footZ=z+side*(depth/2-.44),bottom=Math.min(...[-1,1].flatMap(a=>[-1,1].map(b=>grade(x+a*.18,footZ+b*.16))))-.025;
      const footTop=top-thickness+.005;
      place('concrete',new BoxGeometry(.36,footTop-bottom,.32),x,(footTop+bottom)/2,footZ);
    }
    seatRecords.push({...bench,top,bottom:top-thickness});
  }
  const bed=BU_LINK_COURT_DETAIL.planter;
  for(const side of [-1,1]){
    place('concrete',new BoxGeometry(.15,.22,bed.depth),bed.x+side*(bed.width/2-.075),DATUM+.155+.095,bed.z,true);
    place('concrete',new BoxGeometry(bed.width-.3,.22,.15),bed.x,DATUM+.155+.095,bed.z+side*(bed.depth/2-.075),true);
  }
  const soil=new PlaneGeometry(bed.width-.3,bed.depth-.3);soil.rotateX(-Math.PI/2);
  place('soil',soil,bed.x,DATUM+.155+.105,bed.z,true);

  // A restrained cast-iron tree grate: the photographed tree has an exposed
  // root opening. Keep this root site well outside the central door corridor.
  const pit=BU_LINK_COURT_DETAIL.treePit;
  const earth=new RingGeometry(0,pit.radius,24,1);earth.rotateX(-Math.PI/2);
  place('soil',earth,pit.x,DATUM+.177,pit.z,true);
  // Radial bars and two thin rings leave actual earth visible between them.
  for(const radius of [.53,1.08]){const ring=new RingGeometry(radius-.024,radius+.024,32,1);ring.rotateX(-Math.PI/2);place('iron',ring,pit.x,DATUM+.199,pit.z,true);}
  for(let i=0;i<24;i++){
    const angle=i*Math.PI/12,middle=.80,g=new BoxGeometry(.027,.022,.55);
    g.rotateY(angle);place('iron',g,pit.x+Math.sin(angle)*middle,DATUM+.191,pit.z+Math.cos(angle)*middle,true);
  }
  const treePoint=buSertPoint(pit.x,pit.z);
  trees.push({x:treePoint[0],z:treePoint[1],radius:pit.treeRadius,height:pit.height,rootY:buElevation(...treePoint)+.177});

  // Small, open leaf clusters follow the shallow planted edge. These are not
  // opaque hedge boxes. All leaf vertices stay inside its soil footprint.
  const leafPositions:{leaf:number[];leafLight:number[]}={leaf:[],leafLight:[]};
  let seed=714023;const random=()=>{seed=Math.imul(seed^seed>>>15,1|seed);seed^=seed+Math.imul(seed^seed>>>7,61|seed);return((seed^seed>>>14)>>>0)/4294967296;};
  const orientation=new Quaternion(),matrix=new Matrix4(),v=new Vector3();
  for(let shrub=0;shrub<9;shrub++){
    const cx=bed.x+(shrub%2?-.25:.25),cz=bed.z-bed.depth/2+.65+shrub*.83;
    const count=mobile?16:42;
    for(let i=0;i<count;i++){
      const angle=random()*Math.PI*2,reach=Math.sqrt(random())*.38,x=cx+Math.cos(angle)*reach,z=cz+Math.sin(angle)*reach;
      const world=buSertPoint(x,z),y=buElevation(...world)+.28+.18+random()*.25;
      orientation.setFromAxisAngle(UP,angle);orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.3+random()*.9));
      matrix.compose(new Vector3(world[0],y,world[1]),orientation,new Vector3(1,1,1));
      const verts=[[0,0,0],[-.09,.11,.012],[0,.23,0],[.09,.11,.012],[0,.12,.035]],positions=leafPositions[(i+shrub)%4===0?'leafLight':'leaf'];
      for(const index of [0,1,4,1,2,4,2,3,4,3,0,4]){v.fromArray(verts[index]).applyMatrix4(matrix);positions.push(v.x,v.y,v.z);}
    }
  }
  for(const finish of ['leaf','leafLight'] as const){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(leafPositions[finish],3));g.computeVertexNormals();own(finish,g);}
  const materials:MeshStandardMaterial[]=[];
  for(const [finish,parts] of batches){
    const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(!geometry)throw new Error(`Link court merge failed: ${finish}`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const color={concrete:'#aaa89c',soil:'#51473a',iron:'#424b45',leaf:'#426247',leafLight:'#668052'}[finish];
    const material=(finish==='concrete'?createCampusSurface('concrete',{profile:'bu',yaw:BU_SERT_FRAME.yaw}):new MeshStandardMaterial({color,roughness:finish==='iron'?.78:1,metalness:finish==='iron'?.35:0,...(finish.startsWith('leaf')?{side:DoubleSide}:{})})) as MeshStandardMaterial;
    material.name=`Link court ${finish}`;material.color.set(color);configureBUGroundLayer(material,'surface');materials.push(material);
    const mesh=new Mesh(geometry,material);mesh.name=`BU Link courtyard · ${finish}`;mesh.castShadow=finish!=='soil';mesh.receiveShadow=true;
    mesh.userData.buLinkCourtDetail=true;
    if(!finish.startsWith('leaf')){mesh.userData.buGround=true;mesh.userData.mobileGround=true;ground.push(mesh);}
    if(finish==='concrete'){mesh.userData.wall=true;walls.push(mesh);}
    group.add(mesh);
  }
  group.userData.seats=seatRecords;group.userData.planter=bed;group.userData.treePit=pit;group.userData.mobile=mobile;
  group.userData.triangles=group.children.reduce((total,mesh)=>total+(mesh as Mesh).geometry.getAttribute('position').count/3,0);
  group.updateMatrixWorld(true);let disposed=false;
  return{group,ground,walls,trees,dispose:()=>{if(disposed)return;disposed=true;group.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});materials.forEach(m=>m.dispose());group.clear();}};
}
