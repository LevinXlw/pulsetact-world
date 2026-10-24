import {createHash} from 'node:crypto';
import {afterAll,describe,expect,it,vi} from 'vitest';
import {Box3,BufferGeometry,CanvasTexture,Group,Material,Matrix4,Mesh,MeshStandardMaterial,Raycaster,Vector3} from 'three';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {BU_BUILDING_ANCHORS} from '../src/features/world/charles-geography';
import {buElevation} from '../src/features/world/bu-terrain';

const campus=createBostonUniversity({wind:{value:0}}),groups=[campus.group];
const [x,z]=BU_BUILDING_ANCHORS.questrom;
const toWorld=new Matrix4().makeTranslation(x,buElevation(x,z),z).multiply(new Matrix4().makeRotationY(-.145));
const meshes=(group:Group)=>{const result:Mesh[]=[];group.traverseVisible(object=>{if(object instanceof Mesh)result.push(object);});return result;};
const geometryHash=(mesh:Mesh)=>{
  const hash=createHash('sha256');
  for(const name of Object.keys(mesh.geometry.attributes).sort()){
    const attribute=mesh.geometry.getAttribute(name);hash.update(name);hash.update(new Uint8Array(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength));
  }
  return hash.digest('hex');
};
afterAll(()=>{
  const geometry=new Set<BufferGeometry>(),materials=new Set<Material>();
  for(const group of groups)group.traverse(object=>{if(object instanceof Mesh){geometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
  geometry.forEach(value=>value.dispose());materials.forEach(value=>{(value as MeshStandardMaterial).map?.dispose();value.dispose();});
});

describe('Questrom complete exterior isolation',()=>{
  it('isolates all stepped wings, paving and foundations, without including CDS or the Castle',()=>{
    const {visual,ground,walls,extras}=campus.questrom,owned=meshes(visual);
    expect(visual.parent).toBe(campus.group);expect(extras.parent).toBe(campus.group);
    expect(owned).toHaveLength(14);expect(owned.reduce((n,mesh)=>n+mesh.geometry.getAttribute('position').count/3,0)).toBe(44262);
    expect(owned.filter(mesh=>mesh.userData.buGround)).toHaveLength(4);
    for(const mesh of owned){expect(mesh.userData.buLandmarkScope).toBe('questrom');expect(mesh.material).not.toBeInstanceOf(Array);expect((mesh.material as MeshStandardMaterial).map).toBeNull();}
    expect(ground).toHaveLength(4);expect(walls).toHaveLength(4);
    expect(walls.filter(mesh=>!mesh.userData.foundationSkirt)).toHaveLength(3);
    expect(new Set(walls)).toEqual(new Set(campus.walls.filter(mesh=>mesh.name.startsWith('Questrom'))));
    for(const mesh of [...ground,...walls]){expect(mesh.parent).toBe(campus.group);expect(mesh.visible).toBe(false);}
    const bounds=new Box3().setFromObject(visual);
    expect(bounds.max.y-buElevation(x,z)).toBeCloseTo(50.51,4);
    expect(campus.cds.visual.parent).toBe(campus.group);
    expect(campus.walls.find(mesh=>mesh.name==='BU Castle')!.userData.buLandmarkScope).toBe('landmarks');
  });

  it('keeps source ground and portal pier collisions unchanged when the complete skin is removed',()=>{
    const {visual,ground,walls}=campus.questrom;
    const ray=new Raycaster(),groundAt=(local:number[])=>{
      const point=new Vector3(local[0],0,local[1]).applyMatrix4(toWorld);
      ray.set(new Vector3(point.x,100,point.z),new Vector3(0,-1,0));const hit=ray.intersectObjects(campus.ground,false)[0];
      expect(hit).toBeDefined();expect(ground).toContain(hit.object);return hit.point.y;
    };
    const points=[[7,21.5],[7,24],[7,29],[4,35],[-25,28],[30,28]],before=points.map(groundAt);
    const untouched=meshes(campus.group).filter(mesh=>mesh.userData.buLandmarkScope!=='questrom').map(mesh=>[mesh,geometryHash(mesh)] as const);
    const wallHashes=walls.map(geometryHash),groundHashes=ground.map(geometryHash);
    campus.group.remove(visual);
    try{
      expect(points.map(groundAt)).toEqual(before);
      expect(walls.map(geometryHash)).toEqual(wallHashes);expect(ground.map(geometryHash)).toEqual(groundHashes);
      for(const [mesh,hash] of untouched)expect(geometryHash(mesh)).toBe(hash);
      expect(meshes(campus.group).some(mesh=>mesh.userData.buLandmarkScope==='questrom')).toBe(false);
    }finally{campus.group.add(visual);}
    for(const collider of ground){expect(campus.ground).toContain(collider);expect(meshes(visual).some(mesh=>mesh.geometry===collider.geometry)).toBe(true);}
  });

  it('inherits the Questrom skirt into its own skin and keeps it coincident with collision',()=>{
    const skirts=campus.questrom.walls.filter(mesh=>mesh.userData.foundationSkirt),skin=meshes(campus.questrom.visual),ray=new Raycaster();
    expect(skirts).toHaveLength(1);
    const count=skirts.reduce((n,mesh)=>n+mesh.geometry.getAttribute('position').count/3,0);
    expect(skin.reduce((n,mesh)=>n+mesh.userData.buFoundationSkirtTriangles,0)).toBe(count);
    for(const skirt of skirts){
      const p=skirt.geometry.getAttribute('position'),normal=skirt.geometry.getAttribute('normal');
      const center=new Vector3().fromBufferAttribute(p,0).add(new Vector3().fromBufferAttribute(p,1)).add(new Vector3().fromBufferAttribute(p,2)).multiplyScalar(1/3).applyMatrix4(skirt.matrixWorld);
      const outward=new Vector3().fromBufferAttribute(normal,0).normalize();ray.set(center.clone().addScaledVector(outward,.3),outward.clone().negate());ray.far=.5;
      expect(ray.intersectObject(skirt,false)[0]).toBeDefined();expect(ray.intersectObjects(skin,false)[0]?.distance).toBeCloseTo(.3,3);
    }
  });

  it('keeps the canvas inscription visible as one independent extra outside exported geometry',()=>{
    const text=vi.fn(),canvas={width:0,height:0,getContext:()=>({clearRect:vi.fn(),fillText:text,textAlign:'',textBaseline:'',fillStyle:'',font:''})};
    vi.stubGlobal('document',{createElement:()=>canvas});
    try{
      const browserCampus=createBostonUniversity({wind:{value:0}});groups.push(browserCampus.group);
      const {visual,extras}=browserCampus.questrom;expect(extras.children).toHaveLength(1);
      const sign=extras.children[0] as Mesh;expect(sign.name).toBe('Questrom entrance inscription');
      expect((sign.material as MeshStandardMaterial).map).toBeInstanceOf(CanvasTexture);
      expect(text.mock.calls.map(args=>args[0])).toEqual(['QUESTROM','SCHOOL OF BUSINESS','RAFIK B. HARIRI BUILDING']);
      browserCampus.group.remove(visual);
      expect(meshes(browserCampus.group).filter(mesh=>mesh.name===sign.name)).toEqual([sign]);
      expect(meshes(visual).some(mesh=>(mesh.material as MeshStandardMaterial).map instanceof CanvasTexture)).toBe(false);
      browserCampus.group.add(visual);
    }finally{vi.unstubAllGlobals();}
  });
});
