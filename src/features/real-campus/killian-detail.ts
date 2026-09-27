import {localBinary} from './local-assets';
import {createCourtyardVegetation} from './courtyard-vegetation';
import {finishPaving,finishLimestone,finishAsphalt} from './surface-finish';
import {finishCourtyardGrass,finishPorticoGlass,finishPorticoStone} from './portico-finish';
import {TextureLoader,RepeatWrapping,SRGBColorSpace,Mesh,MeshStandardMaterial,Vector2,Group,Texture,BufferGeometry,Material} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
export async function loadKillianDetail(signal:AbortSignal,options:{quality?:'standard'|'low'}={}){
 const manifestResponse=await fetch('/data/killian/detail-manifest.json',{signal});if(!manifestResponse.ok)throw new Error('样板配置加载失败');
 const manifest=await manifestResponse.json();
 const environmentResponse=await fetch('/data/killian/environment.json',{signal});if(!environmentResponse.ok)throw new Error('环境配置加载失败');
 const environment=await environmentResponse.json();
 const core=await localBinary('/data/killian/detail.glb',manifest.delivery?'/data/killian/detail.glb.gz':undefined,signal);
 const result=await new GLTFLoader().parseAsync(core,'');
 const textureLoader=new TextureLoader(),loaded:Texture[]=[],waterTime={value:0};
 try{
  const pending=['leafy_grass','concrete_wall_001','concrete_pavement'].flatMap(name=>['color','normal','roughness'].map(async kind=>{const t=await textureLoader.loadAsync(`/data/killian/${name}-${kind}.jpg`);loaded.push(t);t.wrapS=t.wrapT=RepeatWrapping;t.anisotropy=8;if(kind==='color')t.colorSpace=SRGBColorSpace;return t;}));
  const results=await Promise.allSettled(pending);
  if(results.some(r=>r.status==='rejected')||signal.aborted)throw new Error('样板材质加载中断');
  const textures=results.map(r=>(r as PromiseFulfilledResult<Texture>).value),materials=[textures.slice(0,3),textures.slice(3,6),textures.slice(6,9)];
  result.scene.traverse(o=>{if(!(o instanceof Mesh))return;const m=o.material as MeshStandardMaterial;
   const textures=m.name==='grass'?materials[0]:['pavement','steps','stepNosing','porticoFloor','road','bridgeDeck','bridgeWalk','courtCurb'].includes(m.name)?materials[2]:['stone','trim','porticoWall','porticoStone','porticoTrim','columnTrim','courtyardWall','courtyardTrim','courtyardPlinth'].includes(m.name)?materials[1]:null;
   if(textures){[m.map,m.normalMap,m.roughnessMap]=textures;m.normalScale=new Vector2(.35,.35);if(m.name==='grass')m.color.set('#7c9667');if(m.name==='pavement')m.color.set('white');}
   // The concrete scan has a darker albedo than the pale limestone reference.
   // Calibrate the product of map and linear color rather than adding emissive light.
   if(['stone','trim','porticoWall'].includes(m.name))m.color.setRGB(1.8,1.78,1.65);
   if(['stone','trim','porticoWall'].includes(m.name)){m.normalScale.set(.16,.16);m.roughness=.9;}
   if(m.name==='stone'){finishLimestone(m);m.normalScale.set(.045,.045);}
   if(['pavement','bridgeWalk'].includes(m.name))finishPaving(m);
   if(m.name==='columnStone'){m.roughnessMap=materials[1][2];m.roughness=.9;}
   if(m.name==='entranceDoor'){m.roughness=.38;m.metalness=.1;}
   if(m.name==='entranceFrame'){m.roughness=.5;m.metalness=.35;}
   if(['porticoWall','porticoStone','porticoTrim','columnStone','columnTrim','porticoFloor','steps','stepNosing'].includes(m.name)){
    finishPorticoStone(m,['porticoWall','porticoStone'].includes(m.name)?'wall':['columnStone','columnTrim'].includes(m.name)?'column':['porticoFloor','steps','stepNosing'].includes(m.name)?'floor':'trim');
    m.normalScale.set(.025,.025);m.roughness=.83;
   }
   if(['porticoGlass','doorGlass'].includes(m.name)){finishPorticoGlass(m);m.color.set('#8d9b9f');}
   if(['courtyardWall','courtyardTrim','courtyardPlinth','courtCurb'].includes(m.name)){
    finishPorticoStone(m,m.name==='courtyardWall'?'wall':m.name==='courtCurb'?'floor':'trim');
    m.normalScale.set(.025,.025);m.roughness=.88;
   }
   if(m.name==='courtyardGlass'){finishPorticoGlass(m);m.color.set('#8b9997');m.opacity=.72;m.metalness=.13;m.roughness=.19;}
   if(m.name==='courtyardFrame'){m.color.set('#777d71');m.metalness=.22;m.roughness=.58;}
   if(m.name==='courtyardInterior'){m.color.set('#222b29');m.roughness=1;}
   if(m.name==='grass')finishCourtyardGrass(m);
   if(m.name==='windowFrame'){m.color.set('#8b907f');m.metalness=.25;m.roughness=.55;}
   if(m.name==='windowInterior'){m.color.set('#273035');m.roughness=1;}
   if(m.name==='entranceDoor'||m.name==='entrancePanel'){m.color.set('#614935');m.roughness=.57;}
   if(m.name==='entranceFrame'){m.color.set('#796044');m.roughness=.46;}
   if(m.name==='doorHardware'){m.color.set('#a99667');m.metalness=.7;m.roughness=.32;}
   if(m.name==='lettering'){m.color.set('#57584e');m.roughness=.96;}
   if(['steps','porticoFloor'].includes(m.name))m.color.set('white');
   if(m.name==='bridgeDeck'){m.map=null;m.normalMap=null;m.roughnessMap=null;m.color.set('#596166');m.roughness=.95;}
   if(m.name==='water'){
    m.onBeforeCompile=shader=>{
     shader.uniforms.waterTime=waterTime;
     shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWaterPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvWaterPosition=(modelMatrix*vec4(position,1.0)).xyz;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWaterPosition; uniform float waterTime;').replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      vec2 slope=vec2(.035*cos(vWaterPosition.x*.7+waterTime*.6),.025*sin(vWaterPosition.z*.83-waterTime*.4));
      normal=normalize(mat3(viewMatrix)*vec3(-slope.x,1.0,-slope.y));`);
    };m.customProgramCacheKey=()=> 'campus-water-ripples-v1';
   }
   if(m.name==='pavingJoint'){o.userData.collision='none';m.roughness=1;}
   if(['arterial','bridgeDeck'].includes(m.name)){m.normalMap=null;m.roughnessMap=null;m.roughness=.97;finishAsphalt(m);}
   if(m.name==='arterial'){m.polygonOffset=true;m.polygonOffsetFactor=-4;m.polygonOffsetUnits=-4;}if(m.name==='roadMarking'){m.polygonOffset=true;m.polygonOffsetFactor=-5;m.polygonOffsetUnits=-5;}if(['grass','pavement','road'].includes(m.name)){m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;}o.castShadow=!['grass','pavement','water','road','pavingJoint','courtCurb'].includes(m.name);o.receiveShadow=true;
  });
  // All three texture sets are referenced by at least one mesh.
  result.scene.userData.porticoOpening=manifest.porticoOpening;
  result.scene.userData.courtyardFacades=manifest.courtyardFacades||[];
  result.scene.userData.platformHeight=manifest.platformHeight;
  result.scene.userData.dome=manifest.dome;
  result.scene.userData.porticoSample=manifest.porticoSample;
  result.scene.userData.environment=environment;result.scene.userData.sourceModels=manifest.sourceModels;
  result.scene.userData.waterTime=waterTime;
  // Shared instanced tree prototypes replace both the old trunk batch and the
  // 8.5 MB foliage download. Create them before onReady/probe capture so glass
  // always reflects the same complete courtyard that the visitor sees.
  const trees=createCourtyardVegetation({source:result.scene,manifest,windTime:waterTime,lowQuality:options.quality==='low'});
  result.scene.traverse(object=>{if(object instanceof Mesh){const materials=Array.isArray(object.material)?object.material:[object.material];if(materials.some(material=>material.name==='bark'||material.name.startsWith('leaf'))){object.visible=false;object.userData.collision='none';}}});
  result.scene.add(trees);trees.updateMatrixWorld(true);
  result.scene.userData.vegetation=trees;
  result.scene.userData.vegetationStatus='ready';
  return result.scene;
 }catch(error){loaded.forEach(t=>t.dispose());disposeDetail(result.scene);throw error;}
}
export function disposeDetail(group:Group){
 const textures=new Set<Texture>(),geometries=new Set<BufferGeometry>(),materials=new Set<Material>();
 group.traverse(object=>{if(!(object instanceof Mesh))return;geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);if(object.customDepthMaterial)materials.add(object.customDepthMaterial);if(object.customDistanceMaterial)materials.add(object.customDistanceMaterial);});
 for(const material of materials){for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);material.dispose();}
 for(const geometry of geometries)geometry.dispose();for(const texture of textures)texture.dispose();
}
