import {afterEach,describe,expect,it,vi} from 'vitest';
import {Group,Matrix4,Mesh,MeshBasicMaterial,PerspectiveCamera,PlaneGeometry,Scene,Vector3,Vector4,WebGLRenderTarget,type WebGLRenderer} from 'three';
import {attachCampusWaterReflection} from '../src/features/world/campus-water-reflection';

afterEach(()=>vi.restoreAllMocks());

function fixture() {
  const material=new MeshBasicMaterial();material.userData.campusWater=true;
  const water=new Mesh(new PlaneGeometry(10,10),material),other=new Mesh(water.geometry,material),hidden=new Mesh(water.geometry,material);
  hidden.visible=false;
  const scene=new Scene();scene.add(water,other,hidden);
  const source=new PerspectiveCamera(60,16/9,.1,3000);
  source.position.set(7,11,19);source.lookAt(2,.24,-2);source.updateMatrixWorld();
  const prior=new WebGLRenderTarget(64,64),viewport=new Vector4(9,13,400,300);
  (source as PerspectiveCamera&{viewport:Vector4}).viewport=viewport.clone();
  let target:WebGLRenderTarget|null=prior,cubeFace=2,mip=1;
  const calls:WebGLRenderTarget[]=[];
  const renderer={
    xr:{enabled:true},shadowMap:{autoUpdate:true},autoClear:false,
    getRenderTarget:()=>target,getActiveCubeFace:()=>cubeFace,getActiveMipmapLevel:()=>mip,
    setRenderTarget:vi.fn((next:WebGLRenderTarget|null,face=0,level=0)=>{
      target=next;cubeFace=face;mip=level;
      if(next&&next!==prior)calls.push(next);
      viewport.copy(next?.viewport??new Vector4(0,0,1600,1000));
    }),
    state:{buffers:{depth:{setMask:vi.fn()}},viewport:(value:Vector4)=>viewport.copy(value)},
    clear:vi.fn(),render:vi.fn((_scene:Scene,_camera:PerspectiveCamera)=>{}),
  };
  const reflectionMaterial={setPlanarReflection:vi.fn()};
  const oldBefore=vi.fn();water.onBeforeRender=oldBefore;
  const pass=attachCampusWaterReflection(water,reflectionMaterial,.24);
  const invoke=()=>water.onBeforeRender(renderer as unknown as WebGLRenderer,scene,source,water.geometry,material,new Group());
  const dispose=()=>{pass.dispose();prior.dispose();water.geometry.dispose();material.dispose();};
  return {water,other,hidden,source,renderer,reflectionMaterial,pass,invoke,prior,viewport,calls,oldBefore,dispose};
}

describe('bounded desktop water reflection',()=>{
  it('allocates lazily, throttles/reuses the target, and releases it on low quality and disposal',()=>{
    const now=vi.spyOn(performance,'now').mockReturnValue(1000),f=fixture();
    expect(f.pass.allocated).toBe(false);
    f.pass.setQuality(true);f.invoke();expect(f.renderer.render).not.toHaveBeenCalled();
    f.pass.setQuality(false);f.invoke();
    expect(f.calls).toHaveLength(1);expect(f.calls[0].width).toBe(768);expect(f.calls[0].height).toBe(384);
    expect(f.pass.frames).toBe(1);
    f.invoke();expect(f.renderer.render).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1100);f.invoke();
    expect(f.renderer.render).toHaveBeenCalledTimes(2);expect(f.calls[1]).toBe(f.calls[0]);
    const released=vi.fn();f.calls[0].addEventListener('dispose',released);
    f.pass.setQuality(true);expect(released).toHaveBeenCalledTimes(1);expect(f.pass.allocated).toBe(false);
    expect(f.reflectionMaterial.setPlanarReflection).toHaveBeenLastCalledWith(null);
    f.pass.setQuality(false);f.invoke();expect(f.calls[2]).not.toBe(f.calls[0]);
    f.dispose();expect(f.water.onBeforeRender).toBe(f.oldBefore);
    expect(f.pass.allocated).toBe(false);
  });

  it('restores mesh visibility, XR, shadows, framebuffer face/mip and camera viewport even when rendering throws',()=>{
    const f=fixture();
    f.renderer.render.mockImplementationOnce(()=>{
      expect(f.water.visible).toBe(false);expect(f.other.visible).toBe(false);expect(f.hidden.visible).toBe(false);
      expect(f.renderer.xr.enabled).toBe(false);expect(f.renderer.shadowMap.autoUpdate).toBe(false);
      throw new Error('simulated GPU render error');
    });
    expect(f.invoke).toThrow('simulated GPU render error');
    expect(f.water.visible).toBe(true);expect(f.other.visible).toBe(true);expect(f.hidden.visible).toBe(false);
    expect(f.renderer.xr.enabled).toBe(true);expect(f.renderer.shadowMap.autoUpdate).toBe(true);
    expect(f.renderer.getRenderTarget()).toBe(f.prior);
    expect(f.renderer.getActiveCubeFace()).toBe(2);expect(f.renderer.getActiveMipmapLevel()).toBe(1);
    expect(f.viewport.toArray()).toEqual([9,13,400,300]);
    // The recursion guard must be cleared after an exception as well. A nested
    // water callback in the next reflected render must not recurse a third time.
    f.renderer.render.mockImplementationOnce(()=>f.invoke());
    f.invoke();expect(f.renderer.render).toHaveBeenCalledTimes(2);expect(f.pass.frames).toBe(1);
    f.dispose();
  });

  it('projects world-space water points consistently and clips geometry under the surface',()=>{
    const f=fixture(),sourceProjection=f.source.projectionMatrix.clone();
    let reflected:PerspectiveCamera|undefined;
    f.renderer.render.mockImplementation((_scene,camera)=>{reflected=camera;});
    f.invoke();expect(reflected).toBeDefined();
    const reflection=reflected!;
    expect(reflection.position.y).toBeCloseTo(.48-f.source.position.y,10);
    expect(f.source.projectionMatrix.equals(sourceProjection)).toBe(true);
    const value=f.reflectionMaterial.setPlanarReflection.mock.calls[0][0] as {matrix:Matrix4};
    const world=new Vector3(2,.24,-2),projected=world.clone().applyMatrix4(value.matrix);
    const sourceNdc=world.clone().project(f.source);
    expect(projected.x).toBeCloseTo(sourceNdc.x*.5+.5,8);
    expect(projected.y).toBeCloseTo(sourceNdc.y*.5+.5,8);
    const clip=(point:Vector3)=>new Vector4(point.x,point.y,point.z,1)
      .applyMatrix4(reflection.matrixWorldInverse).applyMatrix4(reflection.projectionMatrix);
    const above=clip(new Vector3(2,2,-2)),below=clip(new Vector3(2,-2,-2));
    expect(above.z+above.w).toBeGreaterThan(0);
    expect(below.z+below.w).toBeLessThan(0);
    // A camera under the plane should never trigger a reflection pass.
    f.source.position.y=0;f.source.updateMatrixWorld();f.invoke();
    expect(f.renderer.render).toHaveBeenCalledTimes(1);
    f.dispose();
  });
});
