import {readFileSync} from 'node:fs';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,Texture} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {cdsAssetToWorld,loadCDSBuilding} from '../src/features/world/bu-cds-asset';

function fixture(){
 const scene=new Group(),texture=new Texture();
 const frame=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'frame',map:texture}));
 const glass=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'glass'}));
 const paving=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'paving'}));
 paving.userData.ground=true;scene.add(frame,glass,paving);
 return {scene,texture,frame,glass,paving};
}
function parseAs(scene:Group){
 return vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async()=>({scene}) as Awaited<ReturnType<GLTFLoader['parseAsync']>>);
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('complete CDS asset lifecycle',()=>{
 it('uses the complete export placement without changing the reviewed local frame',()=>{
  const manifest=JSON.parse(readFileSync('assets-source/charles-bu/blender/full/input/manifest.json','utf8'));
  expect(cdsAssetToWorld().equals(new Matrix4().fromArray(manifest.toWorld))).toBe(true);
 });
 it('retains direct lighting and independent ground treatment when quality is lowered',async()=>{
  const source=fixture();parseAs(source.scene);vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3]))));
  const built=await loadCDSBuilding(new AbortController().signal);
  expect(built.group.children).toContain(source.scene);expect(built.group.matrix.equals(cdsAssetToWorld())).toBe(true);
  expect(source.frame.castShadow).toBe(true);expect(source.glass.castShadow).toBe(false);expect(source.paving.castShadow).toBe(false);
  expect(source.paving.material.userData.buGroundLayer).toBe('surface');
  expect(source.paving.material.depthWrite).toBe(true);expect(source.paving.material.polygonOffset).toBe(false);
  built.setQuality(true);expect(source.frame.castShadow).toBe(false);expect(source.frame.material.map).toBe(source.texture);
  built.setQuality(false);expect(source.frame.castShadow).toBe(true);built.disposeEnvironment();
 });
 it('releases decoded geometry and embedded textures if campus travel aborts during parsing',async()=>{
  const source=fixture(),abort=new AbortController();
  const geometry=vi.spyOn(source.frame.geometry,'dispose'),material=vi.spyOn(source.frame.material,'dispose'),texture=vi.spyOn(source.texture,'dispose');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));
  vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async()=>{abort.abort();return {scene:source.scene} as Awaited<ReturnType<GLTFLoader['parseAsync']>>;});
  await expect(loadCDSBuilding(abort.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(geometry).toHaveBeenCalledOnce();expect(material).toHaveBeenCalledOnce();expect(texture).toHaveBeenCalledOnce();
 });
 it('rejects a missing replacement before attempting to parse it',async()=>{
  const parser=vi.spyOn(GLTFLoader.prototype,'parseAsync');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('missing',{status:404})));
  await expect(loadCDSBuilding(new AbortController().signal)).rejects.toThrow('404');expect(parser).not.toHaveBeenCalled();
 });
});
