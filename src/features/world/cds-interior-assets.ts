import {DoubleSide,Group,Mesh,MeshStandardMaterial,Texture,Vector3,type Material} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {CampusCollision} from '../real-campus/campus-collision';
import type {WorldAssets} from './scene-assets';

const ASSET_ROOT='/assets/bu-cds-interior/';
export type CDSInteriorPhysicsManifest={physics:{ground:readonly string[];walls:readonly string[];ceilings:readonly string[]}};
type GroundTriangle={ax:number;az:number;ay:number;bx:number;bz:number;by:number;cx:number;cz:number;cy:number;inverse:number};
export const CDS_INTERIOR_MAX_STEP=.34;

/** A vertical support query for overlapping indoor floors. The exterior's
 * highest-from-the-sky sampler intentionally remains unchanged. Only exported
 * walk surfaces participate; seats, tables and ceiling undersides never do.
 */
export function createCDSInteriorGroundSampler(meshes:readonly Mesh[]){
  const cells=new Map<string,GroundTriangle[]>(),cellSize=4;
  const a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);
    const positions=mesh.geometry.getAttribute('position'),indices=mesh.geometry.index;
    const count=indices?.count??positions.count;
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(positions,indices?indices.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,indices?indices.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,indices?indices.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      const normalY=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);
      if(normalY<1e-10)continue;
      const inverse=1/((b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z));
      const triangle={ax:a.x,az:a.z,ay:a.y,bx:b.x,bz:b.z,by:b.y,cx:c.x,cz:c.z,cy:c.y,inverse};
      const minX=Math.floor(Math.min(a.x,b.x,c.x)/cellSize),maxX=Math.floor(Math.max(a.x,b.x,c.x)/cellSize);
      const minZ=Math.floor(Math.min(a.z,b.z,c.z)/cellSize),maxZ=Math.floor(Math.max(a.z,b.z,c.z)/cellSize);
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
        const key=`${x}:${z}`,cell=cells.get(key);if(cell)cell.push(triangle);else cells.set(key,[triangle]);
      }
    }
  }
  return (x:number,z:number,feetY=0):number|undefined=>{
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(feetY))return undefined;
    const cell=cells.get(`${Math.floor(x/cellSize)}:${Math.floor(z/cellSize)}`);if(!cell)return undefined;
    let highest=-Infinity;
    for(const t of cell){
      const wa=((t.bz-t.cz)*(x-t.cx)+(t.cx-t.bx)*(z-t.cz))*t.inverse;
      const wb=((t.cz-t.az)*(x-t.cx)+(t.ax-t.cx)*(z-t.cz))*t.inverse,wc=1-wa-wb;
      if(wa<-1e-8||wb<-1e-8||wc<-1e-8)continue;
      const height=t.ay*wa+t.by*wb+t.cy*wc;
      if(height<=feetY+CDS_INTERIOR_MAX_STEP+1e-6)highest=Math.max(highest,height);
    }
    return highest===-Infinity?undefined:highest;
  };
}

export class CDSInteriorCollision extends CampusCollision{
  private support:(x:number,z:number,feetY?:number)=>number|undefined;
  private cameraCollision=new CampusCollision();
  constructor(ground:Mesh[],walls:Mesh[],ceilings:Mesh[]=[]){
    super();
    for(const mesh of [...ground,...walls,...ceilings]){mesh.updateWorldMatrix(true,false);mesh.geometry.computeBoundingBox();}
    this.rebuild(ground,walls);this.support=createCDSInteriorGroundSampler(ground);
    this.cameraCollision.rebuild(ground,[...walls,...ceilings]);
  }
  override groundHeight(x:number,z:number,feetY=0){return this.support(x,z,feetY);}
  override distance(origin:Vector3,direction:Vector3,reach:number,includeGround=false){
    return includeGround?this.cameraCollision.distance(origin,direction,reach,true):super.distance(origin,direction,reach,false);
  }
  override clear(){super.clear();this.cameraCollision.clear();this.support=()=>undefined;}
}

/** Never infer colliders from a decorative batch's name, finish or top faces.
 * The export manifest explicitly lists the dedicated physical proxy groups.
 */
export function createCDSInteriorCollision(physics:Group,manifest:CDSInteriorPhysicsManifest){
  const names=manifest.physics;
  if(!names||!Array.isArray(names.ground)||!names.ground.length||!Array.isArray(names.walls)||!names.walls.length||!Array.isArray(names.ceilings))
    throw new Error('CDS 室内碰撞清单缺失');
  const meshes=new Map<string,Mesh>();
  physics.updateMatrixWorld(true);
  physics.traverse(object=>{if(object instanceof Mesh){if(meshes.has(object.name))throw new Error(`CDS 碰撞组重复: ${object.name}`);meshes.set(object.name,object);}});
  const select=(list:readonly string[])=>list.map(name=>{
    const mesh=meshes.get(name);if(!mesh)throw new Error(`CDS 碰撞组缺失: ${name}`);
    const position=mesh.geometry.getAttribute('position');
    for(let i=0;i<position.count;i++)if(!Number.isFinite(position.getX(i)+position.getY(i)+position.getZ(i)))throw new Error(`CDS 碰撞坐标无效: ${name}`);
    // Dedicated proxy surfaces must also stop a camera approaching their back.
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.side=DoubleSide;
    return mesh;
  });
  return new CDSInteriorCollision(select(names.ground),select(names.walls),select(names.ceilings));
}

function disposeGroups(groups:readonly Group[]){
  const geometries=new Set<Mesh['geometry']>(),materials=new Set<Material>(),textures=new Set<Texture>(),bitmaps=new Set<ImageBitmap>();
  for(const group of groups)group.traverse(object=>{
    if(!(object instanceof Mesh))return;
    geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
  });
  for(const material of materials){for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);material.dispose();}
  geometries.forEach(geometry=>geometry.dispose());textures.forEach(texture=>{
    const images=Array.isArray(texture.source.data)?texture.source.data:[texture.source.data];
    for(const image of images)if(typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap)bitmaps.add(image);
    texture.dispose();
  });
  // GLTFLoader-created bitmap pixels are owned by this one visit. Multiple
  // maps can share an image; release that CPU allocation once, after GPU maps.
  bitmaps.forEach(bitmap=>bitmap.close());groups.forEach(group=>group.clear());
}

function assertTextureFree(bytes:ArrayBuffer){
  const view=new DataView(bytes);
  if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(16,true)!==0x4e4f534a)throw new Error('CDS 室内 GLB 格式无效');
  const size=view.getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,size)));
  if(json.images?.length||json.textures?.length||json.samplers?.length)throw new Error('CDS 手机或物理模型不应加载贴图');
}

async function fetchBytes(url:string,signal:AbortSignal){
  const response=await fetch(url,{signal,cache:'no-cache'});
  if(!response.ok)throw new Error(`CDS 室内模型读取失败 (${response.status})`);
  const bytes=await response.arrayBuffer();signal.throwIfAborted();return bytes;
}

/** Loaded only after the visitor chooses to enter. One room, no campus build,
 * cubemap, environment render target, or mobile desktop-texture fallback.
 */
export async function loadCDSInteriorAssets(signal:AbortSignal,mobile=false):Promise<WorldAssets>{
  signal.throwIfAborted();
  const model=new Group();model.name='CDS public interior';
  let physics:Group|undefined,collision:CDSInteriorCollision|undefined;
  try{
    const [response,visualBytes,physicsBytes]=await Promise.all([
      fetch(`${ASSET_ROOT}manifest.json`,{signal,cache:'no-cache'}),
      fetchBytes(`${ASSET_ROOT}interior-${mobile?'mobile':'desktop'}.glb`,signal),
      fetchBytes(`${ASSET_ROOT}physics.glb`,signal),
    ]);
    if(!response.ok)throw new Error(`CDS 室内清单读取失败 (${response.status})`);
    const manifest=await response.json() as CDSInteriorPhysicsManifest;signal.throwIfAborted();
    assertTextureFree(physicsBytes);if(mobile)assertTextureFree(visualBytes);
    const loader=new GLTFLoader();
    const visual=await loader.parseAsync(visualBytes,'');model.add(visual.scene);signal.throwIfAborted();
    physics=(await loader.parseAsync(physicsBytes,'')).scene;signal.throwIfAborted();
    collision=createCDSInteriorCollision(physics,manifest);
    const meshes:Mesh[]=[];
    model.traverse(object=>{
      if(!(object instanceof Mesh))return;meshes.push(object);
      object.geometry.computeBoundingBox();object.geometry.computeBoundingSphere();object.receiveShadow=true;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(material instanceof MeshStandardMaterial){material.envMapIntensity=.35;for(const texture of [material.map,material.normalMap,material.roughnessMap,material.metalnessMap])if(texture)texture.anisotropy=2;}
      }
    });
    model.updateMatrixWorld(true);model.userData.cdsInterior=true;model.userData.mobile=mobile;
    const setQuality=(low:boolean)=>{
      for(const mesh of meshes){const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];mesh.castShadow=!mobile&&!low&&!materials.some(material=>material.transparent);}
    };
    setQuality(mobile);let disposed=false;
    return {model,collision,wind:{value:0},setQuality,update:()=>{},dispose:()=>{
      if(disposed)return;disposed=true;collision!.clear();disposeGroups([model,physics!]);meshes.length=0;
    }};
  }catch(error){collision?.clear();disposeGroups(physics?[model,physics]:[model]);throw error;}
}
