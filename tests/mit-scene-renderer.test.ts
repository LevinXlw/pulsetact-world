import {afterEach,describe,expect,it,vi} from 'vitest';
import {Color,Mesh,MeshBasicMaterial,PerspectiveCamera,PlaneGeometry,Scene,ShaderMaterial,Vector4,type WebGLRenderer} from 'three';
import {GTAOPass} from 'three/examples/jsm/postprocessing/GTAOPass.js';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';
import {contributesMITContactDepth,createMITSceneRenderer} from '../src/features/world/mit-scene-renderer';

afterEach(()=>vi.restoreAllMocks());

function setup(){
  const scene=new Scene(),camera=new PerspectiveCamera(),geometry=new PlaneGeometry();
  const wall=new Mesh(geometry,new MeshBasicMaterial());scene.add(wall);
  const info={autoReset:true,render:{calls:0,triangles:0},reset(){this.render.calls=0;this.render.triangles=0;}};
  const viewport=new Vector4(0,0,1600,1000),scissor=viewport.clone(),clear=new Color('#abcdef');
  const state={target:null as unknown,face:0,mip:0,viewport:viewport.clone(),scissor:scissor.clone(),scissorTest:false,clear:clear.clone(),alpha:1};
  const renderer={info,autoClear:true,xr:{enabled:false},shadowMap:{autoUpdate:true,needsUpdate:true},
    getDrawingBufferSize:(v:{set:(x:number,y:number)=>unknown})=>v.set(1600,1000),
    render:vi.fn(()=>{info.render.calls+=2;info.render.triangles+=100;}),
    getRenderTarget:()=>state.target,getActiveCubeFace:()=>state.face,getActiveMipmapLevel:()=>state.mip,
    setRenderTarget:(target:unknown,face=0,mip=0)=>{state.target=target;state.face=face;state.mip=mip;},
    getViewport:(v:Vector4)=>v.copy(state.viewport),setViewport:(v:Vector4)=>state.viewport.copy(v),
    getScissor:(v:Vector4)=>v.copy(state.scissor),setScissor:(v:Vector4)=>state.scissor.copy(v),
    getScissorTest:()=>state.scissorTest,setScissorTest:(v:boolean)=>{state.scissorTest=v;},
    getClearColor:(v:Color)=>v.copy(state.clear),getClearAlpha:()=>state.alpha,
    setClearColor:(v:Color,a=state.alpha)=>{state.clear.copy(v);state.alpha=a;},
  } as unknown as WebGLRenderer;
  return{scene,camera,geometry,wall,renderer,info,state,viewport,scissor,clear};
}

describe('MIT bounded screen-space contact renderer',()=>{
  it('excludes transparency and shader-deformed/cutout surfaces from the opaque normal override',()=>{
    const g=new PlaneGeometry();
    expect(contributesMITContactDepth(new Mesh(g,new MeshBasicMaterial()))).toBe(true);
    for(const material of [new MeshBasicMaterial({transparent:true}),new MeshBasicMaterial({alphaTest:.5}),new ShaderMaterial()]){
      expect(contributesMITContactDepth(new Mesh(g,material))).toBe(false);
    }
  });

  it('does not allocate post-processing on the disabled path and preserves cumulative frame stats',()=>{
    const s=setup(),normal=vi.spyOn(GTAOPass.prototype,'render').mockImplementation(()=>{});
    const pipeline=createMITSceneRenderer(s.renderer,s.scene);pipeline.render(s.camera,false);
    expect(normal).not.toHaveBeenCalled();expect(pipeline.stats.allocated).toBe(false);
    expect(s.renderer.render).toHaveBeenCalledTimes(1);expect(pipeline.stats.calls).toBe(2);
    expect(pipeline.stats.triangles).toBe(100);expect(s.info.autoReset).toBe(true);pipeline.dispose();
  });

  it('keeps glass/sky out of depth, aggregates all passes, follows drawing-buffer dimensions and restores state',()=>{
    const s=setup(),glass=new Mesh(s.geometry,new MeshBasicMaterial({transparent:true})),sky=new Mesh(s.geometry,new ShaderMaterial());
    const priorHidden=new Mesh(s.geometry,new MeshBasicMaterial());priorHidden.visible=false;s.scene.add(glass,sky,priorHidden);
    vi.spyOn(GTAOPass.prototype,'render').mockImplementation(()=>{
      expect(glass.visible||sky.visible||priorHidden.visible).toBe(false);expect(s.wall.visible).toBe(true);
      expect(s.renderer.shadowMap.autoUpdate||s.renderer.shadowMap.needsUpdate).toBe(false);
      s.info.render.calls+=4;s.info.render.triangles+=500;
    });
    vi.spyOn(FullScreenQuad.prototype,'render').mockImplementation(()=>{
      expect(glass.visible&&sky.visible).toBe(true);expect(priorHidden.visible).toBe(false);
      s.info.render.calls++;s.info.render.triangles+=2;
    });
    const pipeline=createMITSceneRenderer(s.renderer,s.scene);pipeline.render(s.camera,true);
    expect(s.renderer.render).toHaveBeenCalledTimes(1);
    expect(pipeline.stats).toMatchObject({allocated:true,width:1040,height:650,excludedMeshes:2,calls:7,triangles:602,error:null});
    expect(s.info.autoReset).toBe(true);expect(s.renderer.shadowMap.autoUpdate&&s.renderer.shadowMap.needsUpdate).toBe(true);
    expect(s.state.viewport).toEqual(s.viewport);expect(s.state.scissor).toEqual(s.scissor);expect(s.state.clear).toEqual(s.clear);
    pipeline.render(s.camera,false);expect(pipeline.stats.allocated).toBe(false);expect(pipeline.stats.calls).toBe(2);
    pipeline.dispose();pipeline.dispose();
  });

  it('preserves the beauty frame and restores scene state if the AO pass fails',()=>{
    const s=setup(),glass=new Mesh(s.geometry,new MeshBasicMaterial({transparent:true}));s.scene.add(glass);
    const oldOverride=new MeshBasicMaterial();s.scene.overrideMaterial=oldOverride;
    const ao=vi.spyOn(GTAOPass.prototype,'render').mockImplementation(()=>{
      s.scene.overrideMaterial=new MeshBasicMaterial();s.renderer.autoClear=false;
      s.state.viewport.set(0,0,17,18);s.state.clear.set('#000000');throw Error('AO allocation failed');
    });
    const pipeline=createMITSceneRenderer(s.renderer,s.scene);pipeline.render(s.camera,true);pipeline.render(s.camera,true);
    expect(ao).toHaveBeenCalledTimes(1);expect(s.renderer.render).toHaveBeenCalledTimes(2);
    expect(s.scene.overrideMaterial).toBe(oldOverride);expect(glass.visible).toBe(true);
    expect(s.state.viewport).toEqual(s.viewport);expect(s.state.clear).toEqual(s.clear);expect(s.renderer.autoClear).toBe(true);
    expect(pipeline.stats.error).toContain('AO allocation failed');expect(pipeline.stats.allocated).toBe(false);pipeline.dispose();
  });
});
