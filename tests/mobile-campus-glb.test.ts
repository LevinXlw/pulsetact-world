import {readFileSync} from 'node:fs';
import {BufferGeometry,DoubleSide,InterleavedBufferAttribute,Mesh,MeshLambertMaterial} from 'three';
import {describe,expect,it,vi} from 'vitest';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';

function document(packed:boolean,index32:boolean){
  const normalLength=packed?18:36,indexOffset=packed?56:72,indexLength=index32?12:6;
  return {
    asset:{version:'2.0',generator:'Pulsetact offline mobile campus'},
    buffers:[{byteLength:indexOffset+indexLength}],
    bufferViews:[
      {buffer:0,byteOffset:0,byteLength:36,target:34962},
      {buffer:0,byteOffset:36,byteLength:normalLength,target:34962},
      {buffer:0,byteOffset:indexOffset,byteLength:indexLength,target:34963},
    ],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:'VEC3',normalized:false},
      {bufferView:1,componentType:packed?5122:5126,count:3,type:'VEC3',normalized:packed},
      {bufferView:2,componentType:index32?5125:5123,count:3,type:'SCALAR',normalized:false},
    ],
    materials:[{name:'Stone',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.25,.5,.75,1],metallicFactor:0,roughnessFactor:1}}],
    meshes:[{name:'Baked Boston stair',primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],
    nodes:[{name:'Boston stair',mesh:0,extras:{mobileGround:true,mobileWall:false,mobileHidden:false}}],
    scenes:[{nodes:[0]}],scene:0,
  };
}
type FixtureDocument=ReturnType<typeof document>;
function fixture(change?:(doc:FixtureDocument)=>void,packed=false,index32=false){
  const doc=document(packed,index32),binary=new Uint8Array(84);
  new Float32Array(binary.buffer,0,9).set([1000,2,-1000,1000,3,-999,1001,2,-1000]);
  if(packed)new Int16Array(binary.buffer,36,9).set([0,32767,0,0,32767,0,0,32767,0]);
  else new Float32Array(binary.buffer,36,9).set([0,1,0,0,1,0,0,1,0]);
  const indexOffset=doc.bufferViews[2].byteOffset;
  if(index32)new Uint32Array(binary.buffer,indexOffset,3).set([0,1,2]);else new Uint16Array(binary.buffer,indexOffset,3).set([0,1,2]);
  const binaryLength=Math.ceil(doc.buffers[0].byteLength/4)*4;
  change?.(doc);
  const json=new TextEncoder().encode(JSON.stringify(doc)),jsonLength=Math.ceil(json.length/4)*4,bytes=new ArrayBuffer(28+jsonLength+binaryLength),header=new DataView(bytes);
  header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,bytes.byteLength,true);
  header.setUint32(12,jsonLength,true);header.setUint32(16,0x4e4f534a,true);
  new Uint8Array(bytes,20,jsonLength).fill(32);new Uint8Array(bytes,20,json.length).set(json);
  header.setUint32(20+jsonLength,binaryLength,true);header.setUint32(24+jsonLength,0x004e4942,true);
  new Uint8Array(bytes,28+jsonLength,binaryLength).set(binary.subarray(0,binaryLength));
  return bytes;
}
function dispose(model:ReturnType<typeof parseMobileCampus>){
  model.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();(object.material as MeshLambertMaterial).dispose();}});
}
function byteNormalFixture(change?:(doc:FixtureDocument)=>void){
  const bytes=fixture(doc=>{
    Object.assign(doc,{extensionsUsed:['KHR_mesh_quantization'],extensionsRequired:['KHR_mesh_quantization']});
    Object.assign(doc.bufferViews[1],{byteLength:12,byteStride:4});
    doc.accessors[1].componentType=5120;
    change?.(doc);
  },true);
  const binaryOffset=28+new DataView(bytes).getUint32(12,true);
  // Nonzero padding ensures that a mistaken contiguous VEC3 decoder fails.
  new Int8Array(bytes,binaryOffset+36,12).set([0,127,0,99,-128,0,127,-99,64,-64,0,7]);
  return bytes;
}

describe('zero-copy baked mobile campus GLB decoder',()=>{
  it('reads aligned signed BYTE normals with stride 4, normalized components and zero-copy storage',()=>{
    const bytes=byteNormalFixture(),model=parseMobileCampus(bytes),mesh=model.children[0] as Mesh;
    try{
      const normal=mesh.geometry.getAttribute('normal');
      expect(normal).toBeInstanceOf(InterleavedBufferAttribute);
      expect((normal as InterleavedBufferAttribute).data.stride).toBe(4);
      expect(normal.array).toBeInstanceOf(Int8Array);expect(normal.array.buffer).toBe(bytes);
      expect(normal.count).toBe(3);expect(normal.normalized).toBe(true);
      expect([normal.getX(0),normal.getY(0),normal.getZ(0)]).toEqual([0,1,0]);
      expect([normal.getX(1),normal.getY(1),normal.getZ(1)]).toEqual([-1,0,1]);
      expect([normal.getX(2),normal.getY(2),normal.getZ(2)]).toEqual([64/127,-64/127,0]);
      expect(mesh.geometry.getAttribute('position').array.buffer).toBe(bytes);
      expect(Array.from(mesh.geometry.getIndex()!.array)).toEqual([0,1,2]);
      new Int8Array(bytes,normal.array.byteOffset,12)[8]=32;
      expect(normal.getX(2)).toBe(32/127);
    }finally{dispose(model);}
  });

  it('rejects malformed BYTE normal strides, misalignment, truncated ranges and missing normalization or extension',()=>{
    const invalid:Array<[string,(doc:FixtureDocument)=>void]>=[
      ['missing stride',doc=>{Object.assign(doc.bufferViews[1],{byteStride:undefined});}],
      ['tightly packed stride',doc=>{Object.assign(doc.bufferViews[1],{byteStride:3});}],
      ['unsupported stride',doc=>{Object.assign(doc.bufferViews[1],{byteStride:8});}],
      ['unaligned view',doc=>{doc.bufferViews[1].byteOffset=37;}],
      ['unaligned accessor',doc=>{doc.bufferViews[1].byteLength=16;Object.assign(doc.accessors[1],{byteOffset:1});}],
      ['truncated slot',doc=>{doc.bufferViews[1].byteLength=11;}],
      ['accessor overflow',doc=>{doc.accessors[1].count=4;}],
      ['missing normalization',doc=>{doc.accessors[1].normalized=false;}],
      ['unsigned BYTE',doc=>{doc.accessors[1].componentType=5121;}],
      ['missing required extension',doc=>{Object.assign(doc,{extensionsRequired:[]});}],
      ['missing used extension',doc=>{Object.assign(doc,{extensionsUsed:[]});}],
    ];
    for(const [label,change] of invalid)expect(()=>parseMobileCampus(byteNormalFixture(change)),label).toThrow(/Invalid mobile campus GLB:/);
  });

  it.each([[false,false],[true,true]])('keeps position, normal and index storage in the original download (packed=%s, uint32=%s)',(packed,index32)=>{
    const bytes=fixture(undefined,packed,index32),model=parseMobileCampus(bytes),mesh=model.children[0] as Mesh;
    try{
      const geometry=mesh.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),index=geometry.getIndex()!;
      expect(position.array.buffer).toBe(bytes);expect(normal.array.buffer).toBe(bytes);expect(index.array.buffer).toBe(bytes);
      expect(normal.array).toBeInstanceOf(packed?Int16Array:Float32Array);expect(normal.normalized).toBe(packed);expect(normal.getY(0)).toBe(1);
      expect(index.array).toBeInstanceOf(index32?Uint32Array:Uint16Array);expect(Array.from(index.array)).toEqual([0,1,2]);
      expect(mesh.name).toBe('Boston stair');expect(mesh.userData).toEqual({mobileGround:true,mobileWall:false,mobileHidden:false});
      expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
      const material=mesh.material as MeshLambertMaterial;
      expect(material.color.toArray()).toEqual([.25,.5,.75]);expect(material.side).toBe(DoubleSide);
      expect(geometry.boundingBox?.min.toArray()).toEqual([1000,2,-1000]);expect(geometry.boundingBox?.max.toArray()).toEqual([1001,3,-999]);
      expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
      new Float32Array(bytes,position.array.byteOffset,1)[0]=1000.5;expect(position.getX(0)).toBe(1000.5);
    }finally{dispose(model);}
  });

  it.each(['boston','umd','upenn','arizona'])('decodes the actual baked %s scene with every geometry sharing one GLB backing buffer',campus=>{
    const file=readFileSync(new URL(`../public/data/mobile/${campus}.glb`,import.meta.url));
    const bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer;
    const jsonSize=new DataView(bytes).getUint32(12,true),source=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonSize))) as FixtureDocument;
    const model=parseMobileCampus(bytes);
    try{
      expect(model.children.length).toBe(source.nodes.length);expect(model.children.length).toBeGreaterThan(campus==='boston'?100:0);
      let ground=0,walls=0;
      for(let i=0;i<model.children.length;i++){
        const mesh=model.children[i] as Mesh;
        expect(mesh.geometry.getAttribute('position').array.buffer).toBe(bytes);
        expect(mesh.geometry.getAttribute('normal').array.buffer).toBe(bytes);
        expect(mesh.geometry.getIndex()!.array.buffer).toBe(bytes);
        expect(mesh.name).toBe(source.nodes[i].name);expect(mesh.visible).toBe(!source.nodes[i].extras.mobileHidden);
        expect(Number.isFinite(mesh.geometry.boundingSphere!.radius)).toBe(true);
        ground+=Number(mesh.userData.mobileGround);walls+=Number(mesh.userData.mobileWall);
      }
      expect(ground).toBeGreaterThan(0);expect(walls).toBeGreaterThan(0);
    }finally{dispose(model);}
  });

  it('preserves the terrain / physical surface / paint depth hierarchy through the mobile bake',()=>{
    const materials:MeshLambertMaterial[]=[];
    for(const layer of ['terrain','surface','marking']){
      const model=parseMobileCampus(fixture(doc=>{Object.assign(doc.nodes[0].extras,{buGroundLayer:layer});}));
      try{
        const mesh=model.children[0] as Mesh,material=mesh.material as MeshLambertMaterial;
        expect(mesh.userData.buGroundLayer).toBe(layer);
        expect(material.depthTest).toBe(true);expect(material.depthWrite).toBe(true);
        // HD swaps clone these materials: the layering must survive the switch.
        const hd=material.clone();expect(hd.polygonOffsetFactor).toBe(material.polygonOffsetFactor);hd.dispose();
        materials.push(material);
      }finally{dispose(model);}
    }
    expect(materials[0].polygonOffsetFactor).toBeGreaterThan(materials[1].polygonOffsetFactor);
    expect(materials[1].polygonOffset).toBe(false);
    expect(materials[2].polygonOffsetFactor).toBeLessThan(materials[1].polygonOffsetFactor);
    expect(()=>parseMobileCampus(fixture(doc=>{Object.assign(doc.nodes[0].extras,{buGroundLayer:'disable-depth'});}))).toThrow(/invalid BU ground layer/);
  });

  it.each([
    ['transformed node',(doc:FixtureDocument)=>{Object.assign(doc.nodes[0],{translation:[1,0,0]});}],
    ['external buffer',(doc:FixtureDocument)=>{Object.assign(doc.buffers[0],{uri:'other.bin'});}],
    ['texture',(doc:FixtureDocument)=>{Object.assign(doc,{textures:[{source:0}]});}],
    ['strided view',(doc:FixtureDocument)=>{Object.assign(doc.bufferViews[0],{byteStride:16});}],
    ['accessor range',(doc:FixtureDocument)=>{doc.accessors[0].count=4;}],
    ['unaligned attribute',(doc:FixtureDocument)=>{doc.bufferViews[0].byteOffset=2;}],
    ['wrong position type',(doc:FixtureDocument)=>{doc.accessors[0].componentType=5125;}],
    ['unsupported primitive',(doc:FixtureDocument)=>{Object.assign(doc.meshes[0].primitives[0],{mode:5});}],
    ['duplicate scene node',(doc:FixtureDocument)=>{doc.scenes[0].nodes.push(0);}],
  ])('rejects unsupported or malformed %s',(_label,change)=>{
    expect(()=>parseMobileCampus(fixture(change))).toThrow(/Invalid mobile campus GLB:/);
  });

  it('rejects a wrong header, truncated chunk, invalid vertex index and unnormalized packed normals',()=>{
    const wrong=fixture();new DataView(wrong).setUint32(0,0,true);expect(()=>parseMobileCampus(wrong)).toThrow(/version 2/);
    const truncated=fixture();new DataView(truncated).setUint32(12,truncated.byteLength,true);expect(()=>parseMobileCampus(truncated)).toThrow(/JSON chunk/);
    const invalidIndex=fixture(),jsonLength=new DataView(invalidIndex).getUint32(12,true);
    new DataView(invalidIndex).setUint16(28+jsonLength+72,99,true);expect(()=>parseMobileCampus(invalidIndex)).toThrow(/index exceeds vertex count/);
    expect(()=>parseMobileCampus(fixture(doc=>{doc.accessors[1].normalized=false;},true))).toThrow(/normal normalization/);
  });

  it('disposes geometry and materials already allocated before a later malformed mesh fails',()=>{
    const geometryDispose=vi.spyOn(BufferGeometry.prototype,'dispose'),materialDispose=vi.spyOn(MeshLambertMaterial.prototype,'dispose');
    try{
      const bytes=fixture(doc=>{
        doc.meshes.push({name:'Broken',primitives:[{attributes:{POSITION:999,NORMAL:1},indices:2,material:0}]});
        doc.nodes.push({name:'Broken',mesh:1,extras:{mobileGround:false,mobileWall:true,mobileHidden:true}});doc.scenes[0].nodes.push(1);
      });
      expect(()=>parseMobileCampus(bytes)).toThrow(/accessor is out of range/);
      expect(geometryDispose).toHaveBeenCalledTimes(1);expect(materialDispose).toHaveBeenCalledTimes(1);
    }finally{geometryDispose.mockRestore();materialDispose.mockRestore();}
  });
});
