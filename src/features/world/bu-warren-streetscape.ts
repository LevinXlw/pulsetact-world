import {BoxGeometry,BufferGeometry,Group,Mesh,MeshStandardMaterial,Shape,ShapeGeometry,Vector2} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {configureBUGroundLayer} from './bu-ground-layers';
import {buElevation,drapeBUGeometry} from './bu-terrain';
import {BU_WARREN_ENTRY,BU_WARREN_FRONT,BU_WARREN_PAVING,BU_WARREN_RETAINED_TREE_PITS,buWarrenCoordinates} from './bu-warren-streetscape-layout';

export const BU_WARREN_WALK_OFFSET=.118;
const thresholdY=()=>buElevation(...BU_WARREN_FRONT.buildingAnchor)+.20;
/** Only the last 2.4 m at the actual central entrance blends to the existing
 * rigid threshold. The road/campus DEM remains untouched. */
export function buWarrenWalkHeight(x:number,z:number){
  const p=buWarrenCoordinates(x,z),entry=BU_WARREN_ENTRY;
  const across=Math.max(0,Math.min(1,entry.width/2+1-Math.abs(p.along-entry.along)));
  const toward=Math.max(0,Math.min(1,(entry.rampDepth-p.depth)/(entry.rampDepth-entry.thresholdDepth)));
  const ground=buElevation(x,z)+BU_WARREN_WALK_OFFSET;
  return ground+Math.max(0,thresholdY()-ground)*across*toward;
}

/** Photo/reference-led Warren frontage infill. Both quality levels share the
 * same walkable surface and retain all existing tree, road and wall objects.
 * See assets-source/charles-bu/warren-streetscape-20261024.json. */
export function createBUWarrenStreetscape({mobile=false}:{mobile?:boolean}={}){
  const group=new Group();group.name='BU Warren · continuous Commonwealth forecourt';
  const yaw=Math.atan2(-BU_WARREN_FRONT.dz,BU_WARREN_FRONT.dx);
  const make=(name:string,color:string,brick=false)=>{
    const m=createCampusSurface(brick||name==='concrete'?'pavement':name,{profile:'bu',yaw,...(brick?{pavingStyle:'brick' as const}:name==='concrete'?{pavingStyle:'concrete' as const}:{})}) as MeshStandardMaterial;
    m.name=name;m.color.set(color);configureBUGroundLayer(m,'surface');return m;
  };
  const materials={concrete:make('concrete','#b7b4a9'),pavers:make('pavingBrick','#82756b',true)};
  const ownedMaterials=Object.values(materials);
  const parts:{concrete:BufferGeometry[];pavers:BufferGeometry[]}={concrete:[],pavers:[]};
  for(const patch of BU_WARREN_PAVING){
    const geometry=new ShapeGeometry(new Shape(patch.points.map(([x,z])=>new Vector2(x,-z))));
    geometry.rotateX(-Math.PI/2);geometry.translate(0,5.2,0);
    const draped=drapeBUGeometry(geometry,1.2,buWarrenWalkHeight);geometry.dispose();
    const part=draped.index?draped.toNonIndexed():draped;if(part!==draped)draped.dispose();parts[patch.finish].push(part);
  }
  const ground:Mesh[]=[];
  for(const finish of ['concrete','pavers'] as const){
    const geometry=mergeGeometries(parts[finish]);parts[finish].forEach(p=>p.dispose());
    if(!geometry)throw new Error(`Warren paving merge failed: ${finish}`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,materials[finish]);mesh.name=`BU Warren frontage · ${finish==='pavers'?'pavingBrick':'pavingConcrete'}`;
    mesh.userData.buGround=true;mesh.userData.mobileGround=true;mesh.userData.warrenStreetscape=true;
    mesh.receiveShadow=true;group.add(mesh);ground.push(mesh);
  }
  if(mobile){
    // The phone bake keeps selected street trees but deliberately discards the
    // large original streets group. Restore only these four existing pit sites
    // inside the new paving's holes; desktop already owns their original rims.
    const soil=new MeshStandardMaterial({name:'Warren tree pit soil',color:'#695d49',roughness:1});
    configureBUGroundLayer(soil,'surface');
    const rim=make('curb','#96958c');ownedMaterials.push(soil,rim);
    const soilParts:BufferGeometry[]=[],rimParts:BufferGeometry[]=[];
    const append=(list:BufferGeometry[],source:BufferGeometry)=>{
      const g=drapeBUGeometry(source,2);source.dispose();const part=g.index?g.toNonIndexed():g;
      if(part!==g)g.dispose();list.push(part);
    };
    for(const [x,z] of BU_WARREN_RETAINED_TREE_PITS){
      const earth=new ShapeGeometry(new Shape([[-.85,-.85],[.85,-.85],[.85,.85],[-.85,.85]].map(([dx,dz])=>new Vector2(x+dx,-z-dz))));
      earth.rotateX(-Math.PI/2);
      // 7 mm above the retained old +.105 m mobile sidewalk, below the new
      // +.118 m apron. This avoids a coplanar tie without making a raised bed.
      earth.translate(0,5.2+.112,0);append(soilParts,earth);
      for(const side of [-1,1]){
        const across=new BoxGeometry(.13,.04,1.9);across.translate(x+side*.9,5.2+.13,z);append(rimParts,across);
        const along=new BoxGeometry(1.9,.04,.13);along.translate(x,5.2+.13,z+side*.9);append(rimParts,along);
      }
    }
    for(const [finish,parts,material] of [['soil',soilParts,soil],['granite',rimParts,rim]] as const){
      const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(!geometry)throw new Error(`Warren tree pit merge failed: ${finish}`);
      geometry.computeBoundingBox();geometry.computeBoundingSphere();const mesh=new Mesh(geometry,material);
      mesh.name=`BU Warren tree pits · ${finish}`;mesh.userData.buGround=true;mesh.userData.mobileGround=true;mesh.userData.warrenTreePitCount=4;
      mesh.receiveShadow=true;group.add(mesh);ground.push(mesh);
    }
  }
  group.userData.mobile=mobile;
  group.userData.warrenTreePits={count:mobile?4:0,sites:mobile?BU_WARREN_RETAINED_TREE_PITS:[],soilOffset:.112,rimBottom:.11,rimTop:.15};
  group.updateMatrixWorld(true);let disposed=false;
  return {group,ground,walls:[] as Mesh[],trees:[] as {x:number;z:number;radius:number;rootY:number}[],dispose:()=>{
    if(disposed)return;disposed=true;ground.forEach(m=>m.geometry.dispose());ownedMaterials.forEach(m=>m.dispose());group.clear();
  }};
}
