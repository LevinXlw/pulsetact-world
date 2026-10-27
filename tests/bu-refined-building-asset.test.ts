import {readFileSync} from 'node:fs';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {BoxGeometry,CubeCamera,Group,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,PMREMGenerator,Scene,Texture,TextureLoader,Vector4,WebGLRenderTarget,type WebGLRenderer} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {loadRefinedBUBuilding} from '../src/features/world/bu-refined-building-asset';
import {questromAssetToWorld} from '../src/features/world/bu-questrom-asset';
import {createPainterlySky} from '../src/features/world/painterly-sky';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture(){
 const scene=new Group(),mesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'glass'}));scene.add(mesh);return {scene,mesh};
}
function fakeRenderer(){
 return {compile:vi.fn(),xr:{enabled:true},shadowMap:{enabled:true},getRenderTarget:()=>null,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
 getViewport:(v:Vector4)=>v.set(1,2,300,200),getScissor:(v:Vector4)=>v.set(3,4,100,90),getScissorTest:()=>true,
 setRenderTarget:vi.fn(),setViewport:vi.fn(),setScissor:vi.fn(),setScissorTest:vi.fn()} as unknown as WebGLRenderer;
}
async function pair(firstOptions:Partial<Parameters<typeof loadRefinedBUBuilding>[1]>={}){
 const a=fixture(),b=fixture();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));
 vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValueOnce({scene:a.scene} as never).mockResolvedValueOnce({scene:b.scene} as never);
 const first=await loadRefinedBUBuilding(new AbortController().signal,{id:'cds',label:'CDS',url:'/a.glb',toWorld:new Matrix4(),probeLocal:[0,2,0],...firstOptions});
 const second=await loadRefinedBUBuilding(new AbortController().signal,{id:'questrom',label:'Questrom',url:'/b.glb',toWorld:new Matrix4(),probeLocal:[5,2,0]});
 const scene=new Scene(),camera=new PerspectiveCamera();scene.add(first.group,second.group);camera.position.set(0,2,10);camera.updateMatrixWorld();
 const renderer=fakeRenderer();
 const render=(mesh:Mesh)=>mesh.onBeforeRender(renderer,scene,camera,mesh.geometry,mesh.material as MeshStandardMaterial,null as never);
 const targets:WebGLRenderTarget[]=[];
 vi.spyOn(PMREMGenerator.prototype,'fromCubemap').mockImplementation(()=>{const target=new WebGLRenderTarget(8,8);targets.push(target);return target;});
 return {a,b,first,second,scene,camera,renderer,render,targets};
}
function pendingSky(scene:Scene){
 const texture=new Texture();let loaded=()=>{},failed=()=>{};
 vi.spyOn(TextureLoader.prototype,'load').mockImplementation((_url,onLoad,_progress,onError)=>{
  loaded=()=>onLoad?.(texture);failed=()=>onError?.(new Error('sky unavailable'));return texture;
 });
 const sky=createPainterlySky({value:0});scene.add(sky);
 return {sky,loaded,failed,dispose:()=>{scene.remove(sky);sky.geometry.dispose();sky.material.dispose();texture.dispose();}};
}
describe('shared BU building reflections',()=>{
 it('places Questrom in its own complete export frame',()=>{
  const source=JSON.parse(readFileSync('assets-source/charles-bu/blender/questrom/input/manifest.json','utf8'));
  expect(questromAssetToWorld().equals(new Matrix4().fromArray(source.toWorld))).toBe(true);
 });
 it('captures nearby buildings once each without recursively starting each other’s probes',async()=>{
  const t=await pair();
  const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(()=>{t.render(t.a.mesh);t.render(t.b.mesh);});
  t.render(t.a.mesh);expect(update).toHaveBeenCalledTimes(1);
  expect(t.first.group.userData.cdsEnvironmentReady).toBe(true);expect(t.second.group.userData.questromEnvironmentReady).not.toBe(true);
  t.render(t.b.mesh);expect(update).toHaveBeenCalledTimes(2);expect(t.second.group.userData.questromEnvironmentReady).toBe(true);
  for(let i=0;i<3;i++){t.render(t.a.mesh);t.render(t.b.mesh);}expect(update).toHaveBeenCalledTimes(2);
  expect(t.renderer.xr.enabled).toBe(true);expect(t.renderer.shadowMap.enabled).toBe(true);expect(t.first.group.visible).toBe(true);
  const dispose=vi.spyOn(t.targets[0],'dispose');t.first.setQuality(true);expect(dispose).toHaveBeenCalledOnce();expect(t.a.mesh.material.envMap).toBeNull();
  t.first.disposeEnvironment();t.second.disposeEnvironment();
 });
 it('waits for the actual painted sky before caching either nearby building reflection',async()=>{
  const t=await pair(),sky=pendingSky(t.scene);
  const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(function(this:CubeCamera){
   expect(this.renderTarget.width).toBe(128);expect((this.children[0] as PerspectiveCamera).far).toBe(260);
   expect(sky.sky.material.uniforms.uSkyReady.value).toBe(1);
  });
  for(let i=0;i<5;i++){t.render(t.a.mesh);t.render(t.b.mesh);}
  expect(update).not.toHaveBeenCalled();expect(t.targets).toHaveLength(0);
  expect(t.a.mesh.material.envMap).toBeNull();expect(t.b.mesh.material.envMap).toBeNull();
  expect(sky.sky.userData.painterlySkyLoadState.status).toBe('loading');
  sky.loaded();expect(sky.sky.userData.painterlySkyLoadState.status).toBe('ready');
  t.render(t.a.mesh);t.render(t.b.mesh);expect(update).toHaveBeenCalledTimes(2);
  const firstMap=t.a.mesh.material.envMap,secondMap=t.b.mesh.material.envMap;
  for(let i=0;i<5;i++){sky.sky.material.uniforms.uSkyTime.value++;t.render(t.a.mesh);t.render(t.b.mesh);}
  expect(update).toHaveBeenCalledTimes(2);expect(t.a.mesh.material.envMap).toBe(firstMap);expect(t.b.mesh.material.envMap).toBe(secondMap);
  const disposals=t.targets.map(target=>vi.spyOn(target,'dispose'));
  t.first.disposeEnvironment();t.second.disposeEnvironment();t.first.disposeEnvironment();
  disposals.forEach(dispose=>expect(dispose).toHaveBeenCalledOnce());sky.dispose();
 });
 it('captures the settled procedural fallback once when the panorama fails without marking its texture ready',async()=>{
  const t=await pair(),sky=pendingSky(t.scene);
  const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(()=>{});
  t.render(t.a.mesh);expect(update).not.toHaveBeenCalled();
  sky.failed();expect(sky.sky.userData.painterlySkyLoadState.status).toBe('fallback');
  expect(sky.sky.material.uniforms.uSkyReady.value).toBe(0);
  for(let i=0;i<5;i++){t.render(t.a.mesh);t.render(t.b.mesh);}
  expect(update).toHaveBeenCalledTimes(2);expect(t.targets).toHaveLength(2);
  expect(t.first.group.userData.cdsEnvironmentReady).toBe(true);expect(t.second.group.userData.questromEnvironmentReady).toBe(true);
  t.first.disposeEnvironment();t.second.disposeEnvironment();sky.dispose();
 });
 it('retains distance, quality and disposal gates while a sky load is pending',async()=>{
  const t=await pair(),sky=pendingSky(t.scene),update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(()=>{});
  t.render(t.a.mesh);t.render(t.b.mesh);t.first.disposeEnvironment();sky.loaded();
  t.render(t.a.mesh);expect(update).not.toHaveBeenCalled();
  t.camera.position.set(600,2,0);t.camera.updateMatrixWorld();t.render(t.b.mesh);expect(update).not.toHaveBeenCalled();
  t.camera.position.set(0,2,10);t.camera.updateMatrixWorld();t.second.setQuality(true);t.render(t.b.mesh);expect(update).not.toHaveBeenCalled();
  t.second.setQuality(false);t.render(t.b.mesh);expect(update).toHaveBeenCalledOnce();
  t.second.disposeEnvironment();sky.dispose();
 });
 it('does not retain a detached sky readiness binding when the scene replaces its sky',async()=>{
  const t=await pair(),oldSky=pendingSky(t.scene),update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(()=>{});
  t.render(t.a.mesh);oldSky.dispose();const replacement=pendingSky(t.scene);oldSky.loaded();
  t.render(t.a.mesh);expect(update).not.toHaveBeenCalled();
  replacement.failed();t.render(t.a.mesh);expect(update).toHaveBeenCalledOnce();
  t.first.disposeEnvironment();t.second.disposeEnvironment();replacement.dispose();
 });
 it('restores the scene and allows the other building to render if a probe fails',async()=>{
  const t=await pair(),warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const water=new Mesh(new BoxGeometry(),new MeshStandardMaterial());water.material.userData.campusWater=true;t.scene.add(water);
  const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementationOnce(()=>{expect(water.visible).toBe(false);throw new Error('probe failure');}).mockImplementation(()=>{});
  t.render(t.a.mesh);expect(warning).toHaveBeenCalledOnce();expect(t.first.group.visible).toBe(true);expect(water.visible).toBe(true);
  expect(t.renderer.xr.enabled).toBe(true);expect(t.renderer.shadowMap.enabled).toBe(true);
  t.render(t.a.mesh);expect(update).toHaveBeenCalledTimes(1);
  t.render(t.b.mesh);expect(update).toHaveBeenCalledTimes(2);expect(t.second.group.userData.questromEnvironmentReady).toBe(true);
  t.first.disposeEnvironment();t.second.disposeEnvironment();
 });
 it('keeps the bounded Stata phone reflection when shadows are disabled',async()=>{
  const t=await pair({id:'stata',label:'Stata Center',environment:{size:64,keepOnLow:true}});
  const update=vi.spyOn(CubeCamera.prototype,'update').mockImplementation(function(this:CubeCamera){expect(this.renderTarget.width).toBe(64);});
  t.render(t.a.mesh);const environment=t.a.mesh.material.envMap;
  expect(environment).not.toBeNull();expect(t.first.group.userData.stataEnvironmentReady).toBe(true);
  t.first.setQuality(true);expect(t.a.mesh.material.envMap).toBe(environment);expect(t.a.mesh.castShadow).toBe(false);
  t.render(t.a.mesh);expect(update).toHaveBeenCalledOnce();
  t.first.disposeEnvironment();t.second.disposeEnvironment();
 });
});
