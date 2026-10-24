import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {BufferGeometry,Group,Material,Matrix4,Mesh,MeshLambertMaterial,Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {replaceMobileQuestromVisual} from '../src/features/world/mobile-campus-build';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';
import {createMobileHdMaterials} from '../src/features/world/mobile-hd-materials';

const directory='../assets-source/charles-bu/blender/questrom/';
const placement=JSON.parse(readFileSync(new URL(`${directory}input/manifest.json`,import.meta.url),'utf8')) as {toWorld:number[];triangles:number};
const bytes=(path:string)=>{const file=readFileSync(new URL(path,import.meta.url));return file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer;};
const meshes=(group:Group)=>{const result:Mesh[]=[];group.traverse(object=>{if(object instanceof Mesh)result.push(object);});return result;};
function hash(mesh:Mesh){
  const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.index,result=new Int32Array((index?.count??p.count)*3),point=new Vector3();
  for(let i=0;i<(index?.count??p.count);i++){
    point.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
    for(let axis=0;axis<3;axis++)result[i*3+axis]=Math.round(point.getComponent(axis)*1000);
  }
  return createHash('sha256').update(new Uint8Array(result.buffer)).digest('hex');
}
const triangles=(mesh:Mesh)=>(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3;

describe('offline refined Questrom mobile replacement',()=>{
  let source:Group,baked:Group,landmarks:ReturnType<typeof createBostonUniversity>,retired:Group;
  let originals:Map<Mesh,{geometry:BufferGeometry;matrix:Matrix4;color:number[];ground:boolean}>,oldHashes:Set<string>;
  beforeAll(async()=>{
    source=(await new GLTFLoader().parseAsync(bytes(`${directory}questrom-mobile-source.glb`),'')).scene;source.updateMatrixWorld(true);
    originals=new Map(meshes(source).map(mesh=>{
      const material=mesh.material as MeshLambertMaterial,finish=String(material.userData.bu_source_material);
      return[mesh,{geometry:mesh.geometry,matrix:mesh.matrixWorld.clone(),color:/^glass/i.test(finish)?mesh.userData.originalMaterial.color:material.color.toArray(),ground:mesh.userData.buGround===true}];
    }));
    landmarks=createBostonUniversity({wind:{value:0}});landmarks.group.updateMatrixWorld(true);retired=landmarks.questrom.visual;
    oldHashes=new Set(meshes(retired).map(hash));
    const physics=[...landmarks.questrom.ground,...landmarks.questrom.walls],before=physics.map(hash);
    const materials=[...new Set(meshes(retired).flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]))],spies=materials.map(material=>vi.spyOn(material,'dispose'));
    try{
      replaceMobileQuestromVisual(landmarks,source,placement.toWorld);
      expect(spies.every(spy=>spy.mock.calls.length===0)).toBe(true);
    }finally{spies.forEach(spy=>spy.mockRestore());}
    landmarks.group.updateMatrixWorld(true);expect(physics.map(hash)).toEqual(before);
    baked=parseMobileCampus(bytes('../public/data/mobile/boston.glb'));baked.updateMatrixWorld(true);
  },20000);
  afterAll(()=>{
    const geometry=new Set<BufferGeometry>(),materials=new Set<Material>();
    for(const root of [landmarks.group,source,baked,retired])for(const mesh of meshes(root)){geometry.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material);}
    geometry.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());
  });

  it('replaces only the old skin while retaining all original ground, wall and inscription ownership',()=>{
    expect(retired.parent).toBeNull();expect(landmarks.questrom.extras.parent).toBe(landmarks.group);
    expect(landmarks.questrom.ground).toHaveLength(4);expect(landmarks.questrom.walls).toHaveLength(4);
    for(const mesh of [...landmarks.questrom.ground,...landmarks.questrom.walls]){expect(mesh.parent).toBe(landmarks.group);expect(mesh.visible).toBe(false);}
    for(const mesh of landmarks.questrom.ground)expect(landmarks.ground).toContain(mesh);
    for(const mesh of landmarks.questrom.walls)expect(landmarks.walls).toContain(mesh);
    expect(meshes(landmarks.group).some(mesh=>meshes(retired).includes(mesh))).toBe(false);
    expect(meshes(source).some(mesh=>mesh.name.includes('inscription'))).toBe(false);
  });

  it('uses the exact local-to-world frame and original mobile glass tint with no textures',()=>{
    for(const [mesh,original] of originals){
      expect(mesh.geometry).toBe(original.geometry);
      const expected=new Matrix4().fromArray(placement.toWorld).multiply(original.matrix);
      for(let i=0;i<16;i++)expect(mesh.matrixWorld.elements[i]).toBeCloseTo(expected.elements[i],10);
      const material=mesh.material as MeshLambertMaterial;expect(material).toBeInstanceOf(MeshLambertMaterial);
      expect(material.map).toBeNull();expect(material.normalMap).toBeNull();expect(material.emissive.getHex()).toBe(0);
      expect(material.color.toArray()).toEqual(original.color);
      expect(material.userData.buGroundLayer).toBe(original.ground?'surface':undefined);
      expect(mesh.userData.mobileGround).toBeUndefined();expect(mesh.userData.mobileWall).toBeUndefined();
    }
    expect([...originals.values()].filter(value=>value.ground)).toHaveLength(4);
  });

  it('bakes the entire new skin exactly once and removes all procedural skin duplicates',()=>{
    const all=meshes(baked),refined=all.filter(mesh=>mesh.name.startsWith('BU Questrom refined · '));
    expect(refined).toHaveLength(originals.size);
    for(const sourceMesh of originals.keys()){
      const matches=refined.filter(mesh=>mesh.name===sourceMesh.name);expect(matches).toHaveLength(1);
      expect(hash(matches[0])).toBe(hash(sourceMesh));expect(matches[0].visible).toBe(true);
      expect(matches[0].userData.mobileGround).toBe(false);expect(matches[0].userData.mobileWall).toBe(false);
      expect((matches[0].material as MeshLambertMaterial).color.toArray()).toEqual((sourceMesh.material as MeshLambertMaterial).color.toArray());
      expect((matches[0].material as Material).userData.buGroundLayer).toBe(originals.get(sourceMesh)!.ground?'surface':undefined);
    }
    expect(refined.reduce((sum,mesh)=>sum+triangles(mesh),0)).toBe([...originals.keys()].reduce((sum,mesh)=>sum+triangles(mesh),0));
    expect(refined.reduce((sum,mesh)=>sum+triangles(mesh),0)).toBeGreaterThan(placement.triangles);
    for(const mesh of all.filter(mesh=>mesh.visible&&!refined.includes(mesh)))expect(oldHashes.has(hash(mesh))).toBe(false);
  });

  it('retains all eight physics meshes and the zero-texture campus download budget',()=>{
    const hidden=meshes(baked).filter(mesh=>!mesh.visible&&(mesh.userData.mobileGround||mesh.userData.mobileWall));
    const hashes=new Map<string,Mesh[]>();for(const mesh of hidden){const key=hash(mesh);hashes.set(key,[...(hashes.get(key)??[]),mesh]);}
    for(const sourceMesh of [...landmarks.questrom.ground,...landmarks.questrom.walls]){
      const matches=hashes.get(hash(sourceMesh))!;expect(matches).toHaveLength(1);
      expect(matches[0].userData.mobileGround).toBe(landmarks.questrom.ground.includes(sourceMesh));
      expect(matches[0].userData.mobileWall).toBe(landmarks.questrom.walls.includes(sourceMesh));
    }
    const buffer=bytes('../public/data/mobile/boston.glb'),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,new DataView(buffer).getUint32(12,true))));
    expect(buffer.byteLength).toBeLessThan(25*1024*1024);expect(doc.images).toBeUndefined();expect(doc.textures).toBeUndefined();
  });

  it('uses horizontal brick paving at the entry when phone HD is enabled',()=>{
    const apron=meshes(baked).find(mesh=>mesh.name.startsWith('BU Questrom refined · brickLight · brickPaving'))!;
    expect(apron).toBeDefined();const geometry=apron.geometry,original=apron.material;
    const hd=createMobileHdMaterials(baked,'boston');
    try{
      hd.setQuality(false);
      expect((apron.material as Material).customProgramCacheKey()).toBe('mobile-hd-pavingBrick-v1');
      expect((apron.material as Material).userData.buGroundLayer).toBe('surface');
      expect(apron.geometry).toBe(geometry);
      hd.setQuality(true);expect(apron.material).toBe(original);
    }finally{hd.dispose();}
  });
});
