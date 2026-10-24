import {afterEach,describe,expect,it,vi} from 'vitest';
import {BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,Texture} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {loadStataBuilding,loadStataCampusReplacement,MIT_STATA_ASSET_URL,MIT_STATA_BASE_URL,MIT_STATA_MOBILE_ASSET_URL,MIT_STATA_MOBILE_BASE_URL,stataAssetToWorld} from '../src/features/world/mit-stata-asset';

function fixture(){
  const scene=new Group(),texture=new Texture();
  const wall=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'Stata brick',map:texture}));
  const collider=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'Stata source collision'}));
  collider.userData.stataWall=true;collider.userData.stataCollisionOnly=true;
  const glass=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'Stata glass',metalness:.3,roughness:.18}));
  const ground=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'Stata paving'}));ground.userData.stataGround=true;
  scene.add(wall,glass,ground,collider);return {scene,texture,wall,glass,ground,collider};
}
function parseAs(source:ReturnType<typeof fixture>){
  return vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValue({scene:source.scene} as never);
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('Stata complete exterior integration',()=>{
  it('retains world placement, PBR materials and only the authored collision flags',async()=>{
    const source=fixture(),original=source.wall.material;parseAs(source);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));
    const built=await loadStataBuilding(new AbortController().signal);
    expect(stataAssetToWorld().equals(new Matrix4())).toBe(true);
    expect(built.group.matrix.equals(new Matrix4())).toBe(true);
    expect(built.group.userData.stataRefined).toBe(true);
    expect(built.ground).toEqual([source.ground]);expect(built.walls).toEqual([source.collider]);
    expect(source.collider.visible).toBe(false);expect(source.collider.castShadow).toBe(false);
    expect(source.wall.material).toBe(original);expect(source.wall.material.map).toBe(source.texture);
    expect(source.ground.material.polygonOffset).toBe(true);expect(source.ground.material.polygonOffsetFactor).toBe(-3);expect(source.ground.material.polygonOffsetUnits).toBe(-3);
    expect(source.wall.material.polygonOffset).toBe(false);expect(source.glass.material.polygonOffset).toBe(false);
    expect(source.glass.material.metalness).toBe(.3);expect(source.glass.material.roughness).toBe(.18);
    expect(source.wall.castShadow).toBe(true);expect(source.glass.castShadow).toBe(true);expect(source.ground.castShadow).toBe(false);
    built.setQuality(true);expect(source.wall.castShadow).toBe(false);expect(source.glass.castShadow).toBe(false);expect(source.wall.material.map).toBe(source.texture);
    built.setQuality(false);expect(source.wall.castShadow).toBe(true);expect(source.glass.castShadow).toBe(true);built.dispose();
  });
  it('uses the dedicated phone pair without converting its PBR to Lambert or enabling shadows',async()=>{
    const source=fixture();parseAs(source);
    const fetcher=vi.fn(async(_path:string)=>new Response(new Uint8Array([1])));vi.stubGlobal('fetch',fetcher);
    const replacement=await loadStataCampusReplacement(new AbortController().signal,'mobile');
    expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual([MIT_STATA_MOBILE_BASE_URL,MIT_STATA_MOBILE_ASSET_URL]);
    expect(replacement.building.url).toBe(MIT_STATA_MOBILE_ASSET_URL);
    replacement.building.setQuality(false);expect(source.wall.castShadow).toBe(false);expect(source.glass.castShadow).toBe(false);
    expect(source.wall.material).toBeInstanceOf(MeshStandardMaterial);
    replacement.building.dispose();
  });
  it('discards a decoded replacement when its matching source removal cannot load',async()=>{
    const source=fixture();parseAs(source);
    const geometry=vi.spyOn(source.wall.geometry,'dispose'),material=vi.spyOn(source.wall.material,'dispose'),texture=vi.spyOn(source.texture,'dispose');
    vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(new Uint8Array([1]),{status:path===MIT_STATA_BASE_URL?404:200})));
    await expect(loadStataCampusReplacement(new AbortController().signal)).rejects.toThrow('404');
    expect(geometry).toHaveBeenCalledOnce();expect(material).toHaveBeenCalledOnce();expect(texture).toHaveBeenCalledOnce();
  });
  it('rejects a missing exterior without parsing a partial replacement',async()=>{
    const parser=vi.spyOn(GLTFLoader.prototype,'parseAsync');
    vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(new Uint8Array([1]),{status:path===MIT_STATA_ASSET_URL?404:200})));
    await expect(loadStataCampusReplacement(new AbortController().signal)).rejects.toThrow('404');
    expect(parser).not.toHaveBeenCalled();
  });
});
