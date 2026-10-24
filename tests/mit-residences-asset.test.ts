import {afterEach,describe,expect,it,vi} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Texture} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {loadMITCampusReplacement,loadMITResidences,residenceBaseURL,residenceAssetURL} from '../src/features/world/mit-residences-asset';

function fixture(){
 const scene=new Group(),texture=new Texture(),wall=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'brick',map:texture}));
 const collider=new Mesh(new BoxGeometry(),new MeshStandardMaterial());collider.userData={mitResidenceWall:true,mitResidenceCollisionOnly:true};
 const ground=new Mesh(new BoxGeometry(),new MeshStandardMaterial());ground.userData.mitResidenceGround=true;scene.add(wall,collider,ground);
 return{scene,texture,wall,collider,ground};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('MIT dorm replacement transaction',()=>{
 it('keeps authored PBR and hidden colliders through mobile quality changes',async()=>{
  const fixtures=[fixture(),fixture()];let n=0;vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async()=>({scene:fixtures[n++].scene}) as never);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));
  const result=await loadMITResidences(new AbortController().signal,'mobile');
  expect(result.walls).toHaveLength(2);expect(result.ground).toHaveLength(2);
  for(const f of fixtures){expect(f.wall.material.map).toBe(f.texture);expect(f.collider.visible).toBe(false);}
  for(const low of [true,false]){result.setQuality(low);for(const f of fixtures){expect(f.collider.visible).toBe(false);expect(f.collider.castShadow).toBe(false);expect(f.wall.castShadow).toBe(false);expect(f.ground.castShadow).toBe(false);}}
  result.dispose();
 });
 it('preserves the working Stata base and source dorms when one new model is missing',async()=>{
  const fixtures=[fixture(),fixture()];let n=0;vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async()=>({scene:fixtures[n++].scene}) as never);
  const release=vi.spyOn(fixtures[1].wall.geometry,'dispose');vi.spyOn(console,'warn').mockImplementation(()=>{});
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(new Uint8Array([url.includes('mit-stata')?7:9]),{status:url===residenceAssetURL('maseeh','desktop')?404:200})));
  const result=await loadMITCampusReplacement(new AbortController().signal);
  expect(result.residences).toBeUndefined();expect(new Uint8Array(result.baseBytes)[0]).toBe(7);expect(result.baseUrl).toContain('mit-stata');expect(release).toHaveBeenCalledOnce();result.building.dispose();
 });
 it('disposes both new exteriors if the matching source removal is unavailable',async()=>{
  const fixtures=[fixture(),fixture(),fixture()];let n=0;vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async()=>({scene:fixtures[n++].scene}) as never);
  const releases=fixtures.slice(1).map(f=>vi.spyOn(f.texture,'dispose'));vi.spyOn(console,'warn').mockImplementation(()=>{});
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(new Uint8Array([1]),{status:url===residenceBaseURL('mobile')?404:200})));
  const result=await loadMITCampusReplacement(new AbortController().signal,'mobile');expect(result.residences).toBeUndefined();releases.forEach(r=>expect(r).toHaveBeenCalledOnce());result.building.dispose();
 });
});
