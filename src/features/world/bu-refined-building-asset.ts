import {CubeCamera,Group,HalfFloatType,Matrix4,Mesh,MeshStandardMaterial,PMREMGenerator,Texture,Vector3,Vector4,WebGLCubeRenderTarget,type Material,type WebGLRenderTarget} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {configureBUGroundLayer} from './bu-ground-layers';

type RefinedBuildingOptions={id:'cds'|'questrom'|'stata'|'baker'|'maseeh';label:string;url:string;toWorld:Matrix4;probeLocal:readonly [number,number,number];environment?:{size:64|128;keepOnLow?:boolean}};
// Nearby buildings may share a reflection view; never begin a nested probe.
let capturingNeighborhood=false;

function releaseModel(group:Group){
 const geometry=new Set<Mesh['geometry']>(),materials=new Set<Material>(),textures=new Set<Texture>();
 group.traverse(object=>{if(!(object instanceof Mesh))return;geometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);});
 for(const material of materials){for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);material.dispose();}
 geometry.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());group.clear();
}

/** One bounded neighborhood capture at street scale, shared by the exterior.
 * Desktop defaults to 128px; the Stata phone asset uses a 64px capture.
 */
function attachEnvironment(group:Group,meshes:Mesh[],options:RefinedBuildingOptions){
 let enabled=true,disposed=false,capturing=false,failed=false,environment:WebGLRenderTarget|undefined;
 const materials=new Set<MeshStandardMaterial>();
 meshes.forEach(mesh=>{for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(m instanceof MeshStandardMaterial)materials.add(m);});
 const probePosition=new Vector3(...options.probeLocal).applyMatrix4(group.matrix),eye=new Vector3();
 const previous=new Map(meshes.map(mesh=>[mesh,mesh.onBeforeRender]));
 const release=()=>{for(const material of materials){material.envMap=null;material.needsUpdate=true;}environment?.dispose();environment=undefined;group.userData[`${options.id}EnvironmentReady`]=false;};
 for(const mesh of meshes)mesh.onBeforeRender=function(renderer,scene,camera,...rest){
  previous.get(this)?.call(this,renderer,scene,camera,...rest);
  if(!enabled||disposed||capturing||capturingNeighborhood||failed||environment)return;
  camera.getWorldPosition(eye);if(eye.distanceTo(probePosition)>260)return;
  capturing=true;capturingNeighborhood=true;
  // The sky writes at the far plane; nearby blocks are enough to reflect the
  // street. A campus-wide probe uploads otherwise unseen distant buildings.
  const target=new WebGLCubeRenderTarget(options.environment?.size??128,{type:HalfFloatType}),probe=new CubeCamera(.3,260,target),pmrem=new PMREMGenerator(renderer);
  probe.position.copy(probePosition);
  const hidden:Mesh[]=[];
  const visible=group.visible,xr=renderer.xr.enabled,shadow=renderer.shadowMap.enabled;
  const renderTarget=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  const viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest();
  scene.traverse(object=>{if(object instanceof Mesh&&object.visible&&((object as Mesh&{isSkinnedMesh?:boolean}).isSkinnedMesh||(Array.isArray(object.material)?object.material:[object.material]).some(m=>m.userData.campusWater))){hidden.push(object);object.visible=false;}});
  try{
   group.visible=false;renderer.xr.enabled=false;renderer.shadowMap.enabled=false;renderer.setScissorTest(false);
   probe.update(renderer,scene);environment=pmrem.fromCubemap(target.texture);environment.texture.name=`${options.label} static neighborhood reflection`;
   for(const material of materials){material.envMap=environment.texture;material.needsUpdate=true;}
   group.userData[`${options.id}EnvironmentReady`]=true;
  }catch(error){
   failed=true;release();
   console.warn(`${options.label} neighborhood reflection unavailable; retaining direct lighting.`,error);
  }finally{
   group.visible=visible;hidden.forEach(object=>{object.visible=true;});
   renderer.xr.enabled=xr;renderer.shadowMap.enabled=shadow;
   renderer.setRenderTarget(renderTarget,face,mip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
   pmrem.dispose();target.dispose();capturing=false;capturingNeighborhood=false;
  }
 };
 return {setQuality:(low:boolean)=>{enabled=!low||options.environment?.keepOnLow===true;if(!enabled&&environment)release();},dispose:()=>{if(disposed)return;disposed=true;for(const [mesh,before] of previous)mesh.onBeforeRender=before;release();}};
}

export async function loadRefinedBUBuilding(signal:AbortSignal,options:RefinedBuildingOptions){
 const response=await fetch(options.url,{signal,cache:'no-cache'});
 if(!response.ok)throw new Error(`${options.label} 模型读取失败 (${response.status})`);
 const bytes=await response.arrayBuffer();signal.throwIfAborted();
 const gltf=await new GLTFLoader().parseAsync(bytes,'');
 const group=new Group();group.name=`${options.label} · Blender refined complete exterior`;group.matrixAutoUpdate=false;group.matrix.copy(options.toWorld);group.add(gltf.scene);
 if(signal.aborted){releaseModel(group);signal.throwIfAborted();}
 const meshes:Mesh[]=[];
 group.traverse(object=>{
  if(!(object instanceof Mesh))return;
  meshes.push(object);object.geometry.computeBoundingBox();object.geometry.computeBoundingSphere();
  const materials=Array.isArray(object.material)?object.material:[object.material];
  for(const material of materials){
   if(!(material instanceof MeshStandardMaterial))continue;
   const ground=object.userData.ground===true||object.userData.buGround===true||object.userData.stataGround===true||object.name.startsWith('BU ground');
   material.envMapIntensity=/glass/i.test(material.name)?1.1:.45;
   if(ground)configureBUGroundLayer(material,'surface');
   for(const texture of [material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap])if(texture)texture.anisotropy=4;
  }
  object.receiveShadow=true;
 });
 group.updateMatrixWorld(true);group.userData[`${options.id}Refined`]=true;
 const environment=attachEnvironment(group,meshes,options);
 const setQuality=(low:boolean)=>{for(const object of meshes){const material=Array.isArray(object.material)?object.material[0]:object.material;object.castShadow=!low&&!object.userData.ground&&!object.userData.buGround&&!object.userData.stataGround&&!object.userData.stataCollisionOnly&&!object.name.startsWith('BU ground')&&!/glass/i.test(material.name);}environment.setQuality(low);};
 setQuality(false);
 // The containing WorldAssets owns model geometry/material disposal.
 let disposed=false;
 return {group,setQuality,disposeEnvironment:environment.dispose,bytes:bytes.byteLength,
  dispose:()=>{if(disposed)return;disposed=true;environment.dispose();releaseModel(group);}};
}
