import {
  AddEquation, Color, CustomBlending, DstColorFactor, Mesh, OneFactor,
  ShaderMaterial, Vector2, Vector4, ZeroFactor,
  type Camera, type Object3D, type Scene, type WebGLRenderer,
} from 'three';
import {GTAOPass} from 'three/examples/jsm/postprocessing/GTAOPass.js';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

export const MIT_CONTACT_OCCLUSION = {
  radiusMetres:.65, thicknessMetres:.20, strength:.38,
  samples:16, resolutionScale:.65, maxDimension:1280,
} as const;

/** GTAO's stock normal override ignores the source alpha and vertex shader.
 * Excluding these surfaces avoids solid leaf cards, glass walls and a sky
 * sphere in the depth buffer. Existing opaque reveals/frames still contribute. */
export function contributesMITContactDepth(object:Object3D):boolean {
  if(!(object instanceof Mesh))return false;
  const materials=Array.isArray(object.material)?object.material:[object.material];
  return materials.length>0&&materials.every(material=>
    material.visible&&!material.transparent&&material.opacity>=1&&material.alphaTest===0&&
    !(material instanceof ShaderMaterial)&&!material.userData.campusWater&&
    material.userData.excludeFromContactOcclusion!==true);
}

/** Desktop courtyard-only contact occlusion. The caller decides whether the
 * current campus, quality and position enable it; mobile must pass false.
 *
 * The normal scene render stays on the original framebuffer, preserving its
 * MSAA and per-material tone mapping (notably the toneMapped:false sky). GTAO
 * is computed separately and multiplied gently over that result in display
 * space. This is an explicit screen-space approximation, NOT indirect light,
 * a replacement for baked AO, or a globally linear-light compositing pipeline.
 * There is no OutputPass, so exposure/ACES/sRGB are never applied a second time.
 */
export function createMITSceneRenderer(renderer:WebGLRenderer,scene:Scene){
  const size=new Vector2();
  const stats={version:1,enabled:false,allocated:false,width:0,height:0,
    radiusMetres:MIT_CONTACT_OCCLUSION.radiusMetres,strength:MIT_CONTACT_OCCLUSION.strength,
    samples:MIT_CONTACT_OCCLUSION.samples,excludedMeshes:0,frames:0,occlusionFrames:0,
    calls:0,triangles:0,error:null as string|null,
    method:'bounded-resolution GTAO with display-space contact multiply; no GI'};
  let pass:GTAOPass|undefined,overlay:ShaderMaterial|undefined,quad:FullScreenQuad|undefined;
  let disposed=false,failed=false;

  function release(){
    if(pass){
      // three r176 GTAOPass.dispose omits these two owned shader materials.
      pass.gtaoMaterial.dispose();pass.blendMaterial.dispose();pass.dispose();pass=undefined;
    }
    overlay?.dispose();overlay=undefined;quad?.dispose();quad=undefined;
    stats.allocated=false;stats.width=0;stats.height=0;
  }

  function ensure(camera:Camera){
    renderer.getDrawingBufferSize(size);
    const factor=Math.min(MIT_CONTACT_OCCLUSION.resolutionScale,
      MIT_CONTACT_OCCLUSION.maxDimension/Math.max(size.x,size.y));
    const width=Math.max(1,Math.round(size.x*factor)),height=Math.max(1,Math.round(size.y*factor));
    if(!pass){
      pass=new GTAOPass(scene,camera,width,height);
      pass.output=GTAOPass.OUTPUT.Off;
      pass.updateGtaoMaterial({radius:MIT_CONTACT_OCCLUSION.radiusMetres,
        thickness:MIT_CONTACT_OCCLUSION.thicknessMetres,samples:MIT_CONTACT_OCCLUSION.samples,
        distanceExponent:1.5,distanceFallOff:1,scale:1,screenSpaceRadius:false});
      pass.updatePdMaterial({radius:3,samples:8,rings:2,lumaPhi:8,depthPhi:2,normalPhi:3});
      overlay=new ShaderMaterial({name:'MIT-contact-occlusion-composite',
        uniforms:{tAO:{value:pass.gtaoMap},strength:{value:MIT_CONTACT_OCCLUSION.strength}},
        vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:'varying vec2 vUv; uniform sampler2D tAO; uniform float strength; void main(){float ao=clamp(texture2D(tAO,vUv).r,0.0,1.0);gl_FragColor=vec4(vec3(mix(1.0,ao,strength)),1.0);}',
        toneMapped:false,depthTest:false,depthWrite:false,transparent:true,
        blending:CustomBlending,blendEquation:AddEquation,blendSrc:DstColorFactor,blendDst:ZeroFactor,
        blendEquationAlpha:AddEquation,blendSrcAlpha:ZeroFactor,blendDstAlpha:OneFactor,
      });
      quad=new FullScreenQuad(overlay);stats.allocated=true;
    }
    pass.camera=camera;
    if(stats.width!==width||stats.height!==height){pass.setSize(width,height);stats.width=width;stats.height=height;}
  }

  function render(camera:Camera,enabled:boolean){
    if(disposed)return;
    const autoReset=renderer.info.autoReset;
    renderer.info.autoReset=false;renderer.info.reset();
    stats.enabled=enabled&&!failed;
    try{
      // Exactly one beauty render, including its ordinary reflection callbacks.
      renderer.render(scene,camera);
      stats.frames++;
      if(!stats.enabled){if(pass)release();return;}
      if(renderer.getRenderTarget()!==null)return; // Never post-process nested probes/RT exports.
      const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
      const viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4());
      const scissorTest=renderer.getScissorTest(),autoClear=renderer.autoClear;
      const clear=renderer.getClearColor(new Color()).clone(),alpha=renderer.getClearAlpha();
      const shadowUpdate=renderer.shadowMap.autoUpdate,shadowNeedsUpdate=renderer.shadowMap.needsUpdate;
      const xr=renderer.xr.enabled,override=scene.overrideMaterial;
      const visibility=new Map<Object3D,boolean>();
      try{
        ensure(camera);
        stats.excludedMeshes=0;
        scene.traverse(object=>{
          visibility.set(object,object.visible);
          if(object instanceof Mesh&&object.visible&&!contributesMITContactDepth(object)){
            object.visible=false;stats.excludedMeshes++;
          }
        });
        renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
        renderer.setScissorTest(false);
        pass!.render(renderer,pass!.gtaoRenderTarget,pass!.gtaoRenderTarget,0,false);
        // Restore scene before compositing; no material/visibility state leaks
        // into the following game frame, a reflection probe, or a photo capture.
        visibility.forEach((visible,object)=>{object.visible=visible;});
        scene.overrideMaterial=override;
        renderer.setRenderTarget(target,face,mip);renderer.setViewport(viewport);
        renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
        renderer.autoClear=false;
        quad!.render(renderer);stats.occlusionFrames++;
      }catch(error){
        stats.error=String(error);failed=true;stats.enabled=false;release();
      }finally{
        visibility.forEach((visible,object)=>{object.visible=visible;});
        scene.overrideMaterial=override;
        renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadowUpdate;renderer.shadowMap.needsUpdate=shadowNeedsUpdate;
        renderer.autoClear=autoClear;renderer.setClearColor(clear,alpha);
        renderer.setRenderTarget(target,face,mip);renderer.setViewport(viewport);
        renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
      }
    }finally{
      stats.calls=renderer.info.render.calls;stats.triangles=renderer.info.render.triangles;
      renderer.info.autoReset=autoReset;
    }
  }

  return {render,stats,dispose(){if(disposed)return;disposed=true;release();}};
}
