import {afterEach,describe,expect,it,vi} from 'vitest';
import {CubeCamera,Group,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,PMREMGenerator,Scene,SkinnedMesh,Texture,Vector4,WebGLRenderTarget,type WebGLRenderer} from 'three';
import {attachMITGlassReflection} from '../src/features/world/mit-glass-reflection';

afterEach(()=>vi.restoreAllMocks());

function setup(){
  const model=new Group(),scene=new Scene();scene.add(model);
  const material=new MeshStandardMaterial({name:'porticoGlass'});material.userData.mitRealDetail=true;material.envMapIntensity=1.1;
  const glass=new Mesh(new PlaneGeometry(),material);model.add(glass);
  const camera=new PerspectiveCamera();camera.position.set(20,10,0);camera.updateMatrixWorld();
  const target=new WebGLRenderTarget(1,1),viewport=new Vector4(2,3,800,600),scissor=new Vector4(4,5,600,400);
  const current={target,face:3,mip:2,viewport:viewport.clone(),scissor:scissor.clone(),scissorTest:true};
  const renderer={
    xr:{enabled:true},shadowMap:{autoUpdate:true},autoClear:false,compile:()=>{},
    getRenderTarget:()=>current.target,getActiveCubeFace:()=>current.face,getActiveMipmapLevel:()=>current.mip,
    getViewport:(v:Vector4)=>v.copy(current.viewport),getScissor:(v:Vector4)=>v.copy(current.scissor),getScissorTest:()=>current.scissorTest,
    setRenderTarget:(t:WebGLRenderTarget,f:number,m:number)=>{current.target=t;current.face=f;current.mip=m;},
    setViewport:(v:Vector4)=>current.viewport.copy(v),setScissor:(v:Vector4)=>current.scissor.copy(v),setScissorTest:(v:boolean)=>{current.scissorTest=v;},
  } as unknown as WebGLRenderer;
  const render=()=>glass.onBeforeRender(renderer,scene,camera,glass.geometry,material,null as never);
  return {model,scene,material,glass,camera,renderer,current,target,viewport,scissor,render};
}

describe('MIT static scene glass reflection',()=>{
  it('only hooks marked MIT glazing and defers allocation in low quality or far away',()=>{
    const s=setup(),other=new Mesh(new PlaneGeometry(),new MeshStandardMaterial({name:'porticoGlass'}));s.model.add(other);
    const originalOther=other.onBeforeRender,originalGlass=s.glass.onBeforeRender;
    const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(()=>{throw Error('should not capture');});
    const reflection=attachMITGlassReflection(s.model);expect(reflection.stats.materials).toBe(1);expect(other.onBeforeRender).toBe(originalOther);
    reflection.setQuality(true);s.render();reflection.setQuality(false);s.camera.position.set(500,10,0);s.camera.updateMatrixWorld();s.render();
    expect(update).not.toHaveBeenCalled();expect(reflection.stats.allocated).toBe(false);
    reflection.dispose();expect(s.glass.onBeforeRender).toBe(originalGlass);
  });

  it('captures once, excludes recursive/animated surfaces, preserves state and releases the cached map',()=>{
    const s=setup(),oldTexture=new Texture();s.material.envMap=oldTexture;
    const oldBefore=vi.fn();s.glass.onBeforeRender=oldBefore;
    const waterMaterial=new MeshStandardMaterial();waterMaterial.userData.campusWater=true;
    const water=new Mesh(new PlaneGeometry(),waterMaterial),avatar=new SkinnedMesh(new PlaneGeometry(),new MeshStandardMaterial());s.scene.add(water,avatar);
    const priorHidden=new Mesh(new PlaneGeometry(),waterMaterial);priorHidden.visible=false;s.scene.add(priorHidden);
    const captured=new WebGLRenderTarget(64,64),onDispose=vi.fn();captured.addEventListener('dispose',onDispose);
    const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(()=>{
      expect(s.glass.visible).toBe(false);expect(water.visible).toBe(false);expect(avatar.visible).toBe(false);
      expect(s.renderer.xr.enabled).toBe(false);expect(s.renderer.autoClear).toBe(true);expect(s.current.scissorTest).toBe(false);
      s.current.viewport.set(0,0,128,128);s.current.scissor.set(0,0,128,128);
    });
    vi.spyOn(PMREMGenerator.prototype,'fromCubemap').mockReturnValue(captured);
    const reflection=attachMITGlassReflection(s.model);s.render();s.render();reflection.setQuality(true);s.render();
    expect(update).toHaveBeenCalledTimes(1);expect(oldBefore).toHaveBeenCalledTimes(3);expect(reflection.stats.captures).toBe(1);
    expect(s.material.envMap).toBe(captured.texture);expect(s.material.envMapIntensity).toBe(1.1);
    expect(s.glass.visible&&water.visible&&avatar.visible).toBe(true);expect(priorHidden.visible).toBe(false);
    expect(s.renderer.xr.enabled&&s.renderer.shadowMap.autoUpdate).toBe(true);expect(s.renderer.autoClear).toBe(false);
    expect(s.current).toEqual({target:s.target,face:3,mip:2,viewport:s.viewport,scissor:s.scissor,scissorTest:true});
    reflection.dispose();reflection.dispose();expect(onDispose).toHaveBeenCalledTimes(1);expect(s.material.envMap).toBe(oldTexture);expect(s.glass.onBeforeRender).toBe(oldBefore);
  });

  it('restores the scene after a failed GPU capture and does not retry every frame',()=>{
    const s=setup(),oldTexture=new Texture();s.material.envMap=oldTexture;
    const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(()=>{throw Error('GPU capture failed');});
    const reflection=attachMITGlassReflection(s.model);s.render();s.render();
    expect(update).toHaveBeenCalledTimes(1);expect(s.material.envMap).toBe(oldTexture);expect(s.glass.visible).toBe(true);
    expect(s.renderer.xr.enabled&&s.renderer.shadowMap.autoUpdate).toBe(true);expect(s.renderer.autoClear).toBe(false);
    expect(s.current.target).toBe(s.target);expect(s.current.viewport).toEqual(s.viewport);expect(s.current.scissorTest).toBe(true);
    expect(reflection.stats.error).toContain('GPU capture failed');expect(reflection.stats.allocated).toBe(false);reflection.dispose();
  });
});
