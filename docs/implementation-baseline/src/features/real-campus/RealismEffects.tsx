import {useEffect,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {HalfFloatType,WebGLRenderTarget} from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/examples/jsm/postprocessing/SSAOPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';

// Standard quality only. All buffers and passes are released when leaving this mode.
export function RealismEffects(){
 const {gl,scene,camera,size,viewport}=useThree();
 const owned=useRef<{composer:EffectComposer;ao:SSAOPass}|null>(null);
 useEffect(()=>{
  const target=new WebGLRenderTarget(1,1,{type:HalfFloatType,samples:Math.min(4,gl.capabilities.maxSamples)});
  const composer=new EffectComposer(gl,target),beauty=new RenderPass(scene,camera);
  const ao=new SSAOPass(scene,camera,1,1,16),output=new OutputPass();
  ao.kernelRadius=.65;ao.minDistance=.0001;ao.maxDistance=.003;
  // Beauty already updated the sunlight shadow. The normal/depth pass needs
  // no second shadow render of the entire campus.
  const renderAO=ao.render.bind(ao);
  ao.render=(...args)=>{const update=gl.shadowMap.autoUpdate;gl.shadowMap.autoUpdate=false;
   try{renderAO(...args);}finally{gl.shadowMap.autoUpdate=update;}
  };
  composer.addPass(beauty);composer.addPass(ao);composer.addPass(output);
  owned.current={composer,ao};
  return()=>{owned.current=null;delete scene.userData.realismRender;beauty.dispose();ao.dispose();output.dispose();composer.dispose();};
 },[gl,scene,camera]);
 useEffect(()=>{const p=owned.current;if(!p)return;p.composer.setPixelRatio(viewport.dpr);p.composer.setSize(size.width,size.height);},[size.width,size.height,viewport.dpr]);
 useFrame((_,dt)=>{
  const p=owned.current;if(!p){gl.render(scene,camera);return;}
  // Walking changes FOV; keep the depth reconstruction in sync without resizing buffers.
  p.ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
  p.ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
  const autoReset=gl.info.autoReset;
  try{gl.info.autoReset=false;gl.info.reset();p.composer.render(dt);
   scene.userData.realismRender={calls:gl.info.render.calls,triangles:gl.info.render.triangles};
  }finally{gl.info.autoReset=autoReset;}
 },1);
 return null;
}
