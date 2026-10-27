import {CubeCamera,Group,HalfFloatType,LinearFilter,LinearSRGBColorSpace,Mesh,MeshStandardMaterial,PMREMGenerator,SkinnedMesh,Vector3,Vector4,WebGLCubeRenderTarget,type Camera,type Scene,type Texture,type WebGLRenderer,type WebGLRenderTarget} from 'three';

const names=new Set(['porticoGlass','courtyardGlass','doorGlass']);
const rendering=new WeakSet<WebGLRenderer>();
const probePosition=new Vector3(20,12,-20);

/** This is a shared static courtyard probe, not screen-space or planar glass
 * reflection. It captures the actual scene once; it has no per-window parallax
 * correction and intentionally excludes moving characters and water passes. */
export function attachMITGlassReflection(model:Group){
  const materials=new Set<MeshStandardMaterial>();
  const hooks:{mesh:Mesh;before:Mesh['onBeforeRender'];installed:Mesh['onBeforeRender']}[]=[];
  const previous=new Map<MeshStandardMaterial,{envMap:Texture|null;intensity:number}>();
  const stats={resolution:128,captureFar:220,position:probePosition.toArray(),captures:0,materials:0,allocated:false,error:null as string|null,mode:'static courtyard scene probe; desktop only'};
  let enabled=true,disposed=false,failed=false,environment:WebGLRenderTarget|undefined;
  model.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const matched=(Array.isArray(object.material)?object.material:[object.material]).filter((m):m is MeshStandardMaterial=>
      m instanceof MeshStandardMaterial&&names.has(m.name)&&(m.userData.mitRealDetail===true||m.userData.mitArchitectural===true||/^(poetic-campus-|mit-)/.test(String(m.userData.artDirection??''))));
    if(!matched.length)return;
    matched.forEach(material=>{materials.add(material);previous.set(material,{envMap:material.envMap,intensity:material.envMapIntensity});});
    const before=object.onBeforeRender;
    const installed:Mesh['onBeforeRender']=function(this:Mesh,renderer,scene,camera,...rest){
      before.call(this,renderer,scene,camera,...rest);
      capture(renderer,scene,camera);
    };
    object.onBeforeRender=installed;hooks.push({mesh:object,before,installed});
  });
  stats.materials=materials.size;

  function capture(renderer:WebGLRenderer,scene:Scene,source:Camera){
    if(disposed||failed||!enabled||environment||rendering.has(renderer)||!materials.size)return;
    const eye=new Vector3().setFromMatrixPosition(source.matrixWorld);
    if(eye.distanceTo(probePosition)>220)return;
    let skyReady=true;
    model.traverse(object=>{
      if(!(object instanceof Mesh))return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        const uniforms=(material as unknown as {uniforms?:Record<string,{value:unknown}>}).uniforms;
        if(uniforms?.uSkyReady&&uniforms.uSkyReady.value!==1)skyReady=false;
      }
    });
    if(!skyReady)return;

    const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
    const viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest();
    const xr=renderer.xr.enabled,shadowUpdate=renderer.shadowMap.autoUpdate,autoClear=renderer.autoClear;
    const hidden:Mesh[]=[];
    let cube:WebGLCubeRenderTarget|undefined,generator:PMREMGenerator|undefined;
    rendering.add(renderer);
    try{
      // Water has its own reflection callback. Hiding it also prevents this
      // once-only glass capture from invoking six extra water render passes.
      scene.traverse(object=>{
        if(!(object instanceof Mesh)||!object.visible)return;
        const surfaceMaterials=Array.isArray(object.material)?object.material:[object.material];
        if(object instanceof SkinnedMesh||object.userData.excludeFromReflection===true||object.name==='sunlit-seed-motes'||
          surfaceMaterials.some(m=>materials.has(m as MeshStandardMaterial)||m.userData.campusWater)){
          hidden.push(object);object.visible=false;
        }
      });
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.autoClear=true;
      renderer.setScissorTest(false);
      cube=new WebGLCubeRenderTarget(stats.resolution,{type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter,generateMipmaps:false,depthBuffer:true});
      cube.texture.colorSpace=LinearSRGBColorSpace;
      cube.texture.name='MIT courtyard captured radiance';
      // The authored sky renders at clip.xyww with frustumCulled=false, so it
      // remains visible while the normal frustum excludes distant campus assets.
      const camera=new CubeCamera(.5,stats.captureFar,cube);camera.position.copy(probePosition);
      camera.update(renderer,scene);
      generator=new PMREMGenerator(renderer);
      environment=generator.fromCubemap(cube.texture);
      environment.texture.name='MIT courtyard filtered glass reflection';
      for(const material of materials){material.envMap=environment.texture;material.needsUpdate=true;}
      stats.captures++;stats.allocated=true;
    }catch(error){
      failed=true;stats.error=String(error);
      // Keep the previous material and make the failure inspectable without
      // taking down a playable scene or retrying GPU allocation every frame.
      environment?.dispose();environment=undefined;
      for(const [material,old] of previous){material.envMap=old.envMap;material.envMapIntensity=old.intensity;material.needsUpdate=true;}
    }finally{
      hidden.forEach(object=>{object.visible=true;});
      cube?.dispose();generator?.dispose();
      renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadowUpdate;renderer.autoClear=autoClear;
      renderer.setRenderTarget(target,face,mip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
      const cameraViewport=(source as Camera&{viewport?:Vector4}).viewport;
      if(cameraViewport)renderer.state.viewport(cameraViewport);
      rendering.delete(renderer);
    }
  }

  return {
    stats,
    setQuality(low:boolean){enabled=!low;},
    dispose(){
      if(disposed)return;disposed=true;
      for(const hook of hooks)if(hook.mesh.onBeforeRender===hook.installed)hook.mesh.onBeforeRender=hook.before;
      for(const [material,old] of previous)if(material.envMap===environment?.texture){material.envMap=old.envMap;material.envMapIntensity=old.intensity;material.needsUpdate=true;}
      environment?.dispose();environment=undefined;stats.allocated=false;
    },
  };
}
