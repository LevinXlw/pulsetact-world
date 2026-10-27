import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';

const names=['columnStone','columnTrim','windowInterior','windowFrame','interiorShade','entranceDoor',
  'doorGlass','entrancePanel','entranceFrame','doorHardware','stepNosing','lettering'];
const bytes=readFileSync('public/data/killian/mobile-portico.glb');
const sourceBytes=readFileSync('public/data/killian/detail.glb');
const meta=JSON.parse(readFileSync('public/data/killian/mobile-portico.json','utf8'));
const manifest=JSON.parse(readFileSync('public/data/killian/detail-manifest.json','utf8'));
const jsonLength=sourceBytes.readUInt32LE(12);
const source=JSON.parse(sourceBytes.toString('utf8',20,20+jsonLength));
const model=parseMobileCampus(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
model.updateMatrixWorld(true);
const meshes=model.children as Mesh[];
const materialName=(mesh:Mesh)=>(Array.isArray(mesh.material)?mesh.material[0]:mesh.material).name;
const find=(name:string)=>meshes.find(mesh=>materialName(mesh)===name)!;
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

function sourceValues(id:number):Float32Array|Uint16Array|Uint32Array{
  const accessor=source.accessors[id],view=source.bufferViews[accessor.bufferView];
  const offset=sourceBytes.byteOffset+28+jsonLength+(view.byteOffset??0)+(accessor.byteOffset??0);
  const count=accessor.count*(accessor.type==='VEC3'?3:1);
  if(accessor.componentType===5126)return new Float32Array(sourceBytes.buffer,offset,count);
  if(accessor.componentType===5123)return new Uint16Array(sourceBytes.buffer,offset,count);
  return new Uint32Array(sourceBytes.buffer,offset,count);
}

describe('retained mobile MIT portico asset',()=>{
  it('decodes the exact twelve omitted components and records both source and output hashes',()=>{
    expect(meshes.map(materialName).sort()).toEqual([...names].sort());
    expect(meta.meshes).toBe(12);expect(meta.textures).toBe(0);
    expect(meta.bytes).toBe(bytes.length);expect(meta.sha256).toBe(hash(bytes));
    expect(meta.sourceSha256).toBe(hash(sourceBytes));
    expect(meshes.reduce((sum,mesh)=>sum+mesh.geometry.index!.count/3,0)).toBe(meta.triangles);
    expect(meshes.reduce((sum,mesh)=>sum+mesh.geometry.getAttribute('position').count,0)).toBe(meta.vertices);
  });

  it('preserves every source triangle position and uses finite indexed, normalized geometry',()=>{
    let mismatches=0,invalidNormals=0,maxNormalError=0;
    for(const sourceMesh of source.meshes)for(const primitive of sourceMesh.primitives){
      const name=source.materials[primitive.material].name;if(!names.includes(name))continue;
      const position=sourceValues(primitive.attributes.POSITION);
      const order=primitive.indices===undefined?null:sourceValues(primitive.indices);
      const mesh=find(name),p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal'),index=mesh.geometry.index!;
      expect(index.count).toBe(order?.length??position.length/3);
      for(let i=0;i<index.count;i++){
        const original=(order?order[i]:i)*3,j=index.getX(i);
        if(j>=p.count||p.getX(j)!==position[original]||p.getY(j)!==position[original+1]||p.getZ(j)!==position[original+2])mismatches++;
      }
      for(let i=0;i<n.count;i++){
        const length=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));
        if(!Number.isFinite(length))invalidNormals++;
        maxNormalError=Math.max(maxNormalError,Math.abs(length-1));
      }
      expect(mesh.geometry.boundingBox!.min.toArray().every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.boundingBox!.max.toArray().every(Number.isFinite)).toBe(true);
    }
    expect(mismatches).toBe(0);expect(invalidNormals).toBe(0);
    expect(maxNormalError).toBeLessThan(.015);
  });

  it('restores all ten aligned shafts from base molding to capital and the original wall collision flags',()=>{
    const columns=find('columnStone'),trim=find('columnTrim');
    const {center,normal:[nx,,nz]}=manifest.porticoOpening;
    const direction=new Vector3(-nx,0,-nz).normalize(),ray=new Raycaster();
    for(let i=0;i<10;i++){
      const x=(i-4.5)*4.1,z=1.15+.4*(1-(x/19)**2);
      ray.set(new Vector3(center[0]+nz*x+nx*(z+3),12,center[2]-nx*x+nz*(z+3)),direction);
      const hits=ray.intersectObject(columns);
      expect(hits.length,`Column ${i+1}`).toBeGreaterThan(0);
      expect(hits[0].distance).toBeGreaterThan(2.2);expect(hits[0].distance).toBeLessThan(2.6);
    }
    expect(columns.geometry.boundingBox!.min.y).toBeCloseTo(manifest.platformHeight+.62,4);
    expect(columns.geometry.boundingBox!.max.y).toBeCloseTo(18.92,4);
    expect(trim.geometry.boundingBox!.min.y).toBeCloseTo(manifest.platformHeight,4);
    expect(trim.geometry.boundingBox!.max.y).toBeGreaterThan(19.5);
    for(const mesh of meshes){
      expect(mesh.userData.mobileWall).toBe(['columnStone','entranceDoor','entrancePanel'].includes(materialName(mesh)));
      expect(mesh.userData.mobileGround).toBe(false);expect(mesh.visible).toBe(true);
    }
  });
});
