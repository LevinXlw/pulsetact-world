import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {BufferGeometry,Group,Material,Matrix4,Mesh,MeshLambertMaterial,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {BU_CDS_SOUTH_DOORS,buCDSPoint} from '../src/features/world/bu-cds-entry-layout';
import {replaceMobileCDSVisual} from '../src/features/world/mobile-campus-build';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';

const sourceUrl=new URL('../assets-source/charles-bu/blender/full/cds-mobile-source.glb',import.meta.url);
const placement=JSON.parse(readFileSync(new URL('../assets-source/charles-bu/blender/full/input/manifest.json',import.meta.url),'utf8')) as {toWorld:number[]};
const bytes=(file:URL)=>{const buffer=readFileSync(file);return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer;};
const meshes=(group:Group)=>{const result:Mesh[]=[];group.traverse(object=>{if(object instanceof Mesh)result.push(object);});return result;};
/** The mobile encoder rounds world positions to a millimetre. Compare every
 * triangle corner, including winding, without depending on vertex welding. */
function positionHash(mesh:Mesh){
  const position=mesh.geometry.getAttribute('position'),index=mesh.geometry.getIndex(),values=new Int32Array((index?.count??position.count)*3),point=new Vector3();
  for(let i=0;i<(index?.count??position.count);i++){
    point.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
    for(let axis=0;axis<3;axis++)values[i*3+axis]=Math.round(point.getComponent(axis)*1000);
  }
  return createHash('sha256').update(new Uint8Array(values.buffer)).digest('hex');
}
function dispose(groups:Group[]){
  const geometry=new Set<BufferGeometry>(),materials=new Set<Material>();
  for(const group of groups)for(const mesh of meshes(group)){geometry.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material);}
  geometry.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());
}

describe('offline refined CDS mobile replacement',()=>{
  let source:Group,baked:Group,landmarks:ReturnType<typeof createBostonUniversity>,placed:Group;
  let sourceMeshes:Mesh[],oldVisual:Group,oldHashes:Set<string>,groundBefore:number[],groundMeshes:Mesh[],wallMeshes:Mesh[],oldMaterials:Material[];
  const originalSource=new Map<Mesh,{geometry:BufferGeometry;matrix:Matrix4;color:number[];ground:boolean}>();
  const groundAtDoors=()=>{
    const ray=new Raycaster();landmarks.group.updateMatrixWorld(true);
    return BU_CDS_SOUTH_DOORS.flatMap(door=>[door.local[1]+.1,22.49,25.5].map(z=>{
      const point=buCDSPoint(door.local[0],z);ray.set(new Vector3(point[0],200,point[1]),new Vector3(0,-1,0));
      const hit=ray.intersectObjects(landmarks.cds.ground,false)[0];expect(hit).toBeDefined();return hit.point.y;
    }));
  };
  beforeAll(async()=>{
    source=(await new GLTFLoader().parseAsync(bytes(sourceUrl),'')).scene;
    source.updateMatrixWorld(true);sourceMeshes=meshes(source);
    for(const mesh of sourceMeshes){
      const material=mesh.material as MeshLambertMaterial,finish=String(material.userData.bu_source_material);
      originalSource.set(mesh,{geometry:mesh.geometry,matrix:mesh.matrixWorld.clone(),color:/^glass/i.test(finish)?mesh.userData.originalMaterial.color:material.color.toArray(),ground:mesh.userData.buGround===true});
    }
    landmarks=createBostonUniversity({wind:{value:0}});landmarks.group.updateMatrixWorld(true);
    oldVisual=landmarks.cds.visual;oldHashes=new Set(meshes(oldVisual).map(positionHash));groundBefore=groundAtDoors();
    groundMeshes=[...landmarks.ground];wallMeshes=[...landmarks.walls];
    oldMaterials=[...new Set(meshes(oldVisual).flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]))];
    const disposal=oldMaterials.map(material=>vi.spyOn(material,'dispose'));
    try{
      placed=replaceMobileCDSVisual(landmarks,source,placement.toWorld);
      expect(disposal.every(spy=>spy.mock.calls.length===0)).toBe(true);
    }finally{disposal.forEach(spy=>spy.mockRestore());}
    landmarks.group.updateMatrixWorld(true);
    baked=parseMobileCampus(bytes(new URL('../public/data/mobile/boston.glb',import.meta.url)));
    baked.updateMatrixWorld(true);
  },20000);
  afterAll(()=>dispose([source,baked,landmarks.group,oldVisual]));

  it('removes the entire old skin without disposing shared resources or losing any collision mesh',()=>{
    expect(oldVisual.parent).toBeNull();expect(placed.parent).toBe(landmarks.group);
    expect(landmarks.ground).toEqual(groundMeshes);expect(landmarks.walls).toEqual(wallMeshes);
    expect(landmarks.cds.ground).toHaveLength(1);expect(landmarks.cds.walls).toHaveLength(4);
    for(const mesh of [...landmarks.cds.ground,...landmarks.cds.walls]){
      expect(mesh.parent).toBe(landmarks.group);expect(mesh.visible).toBe(false);
    }
    expect(groundAtDoors()).toEqual(groundBefore);
    expect(meshes(landmarks.group).some(mesh=>meshes(oldVisual).includes(mesh))).toBe(false);
  });

  it('keeps every source triangle and the exact export-to-world placement with zero-texture Lambert materials',()=>{
    expect(sourceMeshes).toHaveLength(12);
    let triangles=0,groundOverlays=0;
    for(const mesh of sourceMeshes){
      const original=originalSource.get(mesh)!,material=mesh.material as MeshLambertMaterial;
      expect(mesh.geometry).toBe(original.geometry);
      const expected=new Matrix4().fromArray(placement.toWorld).multiply(original.matrix);
      for(let i=0;i<16;i++)expect(mesh.matrixWorld.elements[i]).toBeCloseTo(expected.elements[i],10);
      expect(material).toBeInstanceOf(MeshLambertMaterial);expect(material.map).toBeNull();expect(material.normalMap).toBeNull();
      expect(material.color.toArray()).toEqual(original.color);expect(material.emissive.getHex()).toBe(0);
      expect(material.userData.buGroundLayer).toBe(original.ground?'surface':undefined);
      expect(mesh.userData.mobileGround).toBeUndefined();expect(mesh.userData.mobileWall).toBeUndefined();
      groundOverlays+=Number(original.ground);triangles+=(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3;
    }
    // Static door leaves/hardware have moved to the runtime door component;
    // only the two openings in the retained recessed backing were cut.
    expect(groundOverlays).toBe(1);expect(triangles).toBe(24730);
  });

  it('bakes exactly one refined skin with the same world-space triangles and readable mobile glass',()=>{
    const all=meshes(baked),refined=all.filter(mesh=>mesh.name.startsWith('BU CDS refined · '));
    expect(refined).toHaveLength(12);
    for(const sourceMesh of sourceMeshes){
      const matches=refined.filter(mesh=>mesh.name===sourceMesh.name);expect(matches).toHaveLength(1);
      const mesh=matches[0];expect(positionHash(mesh)).toBe(positionHash(sourceMesh));
      expect((mesh.material as MeshLambertMaterial).color.toArray()).toEqual((sourceMesh.material as MeshLambertMaterial).color.toArray());
      expect(mesh.visible).toBe(true);expect(mesh.userData.mobileGround).toBe(false);expect(mesh.userData.mobileWall).toBe(false);
      expect((mesh.material as Material).userData.buGroundLayer).toBe(originalSource.get(sourceMesh)!.ground?'surface':undefined);
    }
    // Parent visibility alone cannot exclude a mesh from the offline encoder.
    // This explicitly detects the old source skin still appearing in the bake.
    for(const mesh of all.filter(mesh=>mesh.visible&&!refined.includes(mesh)))expect(oldHashes.has(positionHash(mesh))).toBe(false);
    const glass=refined.find(mesh=>mesh.name.startsWith('BU CDS refined · glass · '))!;
    expect((glass.material as MeshLambertMaterial).color.g).toBeGreaterThan(.2);
  });

  it('retains all five original CDS physics geometries in the bake and stays below the download cap',()=>{
    const hidden=meshes(baked).filter(mesh=>!mesh.visible&&(mesh.userData.mobileGround||mesh.userData.mobileWall));
    for(const sourceMesh of [...landmarks.cds.ground,...landmarks.cds.walls]){
      const hash=positionHash(sourceMesh),matches=hidden.filter(mesh=>positionHash(mesh)===hash);expect(matches).toHaveLength(1);
      expect(matches[0].userData.mobileGround).toBe(landmarks.cds.ground.includes(sourceMesh));
      expect(matches[0].userData.mobileWall).toBe(landmarks.cds.walls.includes(sourceMesh));
    }
    const buffer=bytes(new URL('../public/data/mobile/boston.glb',import.meta.url));
    const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,new DataView(buffer).getUint32(12,true))));
    // 2026-10-27: retain the three recovered Commonwealth facades, West survey and terrace; measured 29,606,692 bytes.
    expect(buffer.byteLength).toBeLessThan(30*1024*1024);
    expect(doc.images).toBeUndefined();expect(doc.textures).toBeUndefined();
    const metadata=JSON.parse(readFileSync(new URL('../public/data/mobile/boston.json',import.meta.url),'utf8'));
    expect(metadata.bytes).toBe(buffer.byteLength);expect(metadata.textures).toBe(0);
  });
});
