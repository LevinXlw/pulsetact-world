import {BufferAttribute,BufferGeometry,Color,DoubleSide,FrontSide,Group,InterleavedBuffer,InterleavedBufferAttribute,Mesh,MeshLambertMaterial} from 'three';
import {configureBUGroundLayer} from './bu-ground-layers';

type JsonObject=Record<string,unknown>;
const fail=(message:string):never=>{throw new Error(`Invalid mobile campus GLB: ${message}`);};
function object(value:unknown,label:string):JsonObject{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail(`${label} must be an object`);
  return value as JsonObject;
}
function array(value:unknown,label:string):unknown[]{if(!Array.isArray(value))return fail(`${label} must be an array`);return value;}
function integer(value:unknown,label:string,min=0):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)return fail(`${label} must be an integer >= ${min}`);
  return value;
}
function at(values:unknown[],index:unknown,label:string):JsonObject{
  const i=integer(index,label);if(i>=values.length)return fail(`${label} is out of range`);return object(values[i],label);
}
function only(value:JsonObject,keys:readonly string[],label:string){
  for(const key of Object.keys(value))if(!keys.includes(key))fail(`unsupported ${label}.${key}`);
}
function name(value:unknown){if(value!==undefined&&typeof value!=='string')fail('name must be a string');return value as string|undefined;}

/** Decoder for prepare-mobile-campus.mjs output only, not general glTF.
 * Attributes directly view the downloaded GLB, avoiding GLTFLoader's BIN and
 * bufferView copies. Keep that backing buffer alive only while its campus lives.
 */
export function parseMobileCampus(bytes:ArrayBuffer):Group{
  if(bytes.byteLength<28)fail('truncated header');
  const header=new DataView(bytes);
  if(header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2)fail('expected GLB version 2');
  if(header.getUint32(8,true)!==bytes.byteLength)fail('file length does not match header');
  const jsonSize=header.getUint32(12,true),binHeader=20+jsonSize;
  if(jsonSize%4||binHeader+8>bytes.byteLength||header.getUint32(16,true)!==0x4e4f534a)fail('invalid JSON chunk');
  const binarySize=header.getUint32(binHeader,true),binaryOffset=binHeader+8;
  if(binarySize%4||header.getUint32(binHeader+4,true)!==0x004e4942||binaryOffset+binarySize!==bytes.byteLength)fail('invalid BIN chunk');
  let parsed:unknown;
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes,20,jsonSize)));}
  catch{return fail('invalid JSON');}
  const doc=object(parsed,'document');
  only(doc,['asset','extensionsUsed','extensionsRequired','buffers','bufferViews','accessors','materials','meshes','nodes','scenes','scene'],'document');
  for(const key of ['extensionsUsed','extensionsRequired'])if(doc[key]!==undefined){
    for(const extension of array(doc[key],key))if(extension!=='KHR_mesh_quantization')fail(`unsupported extension ${String(extension)}`);
  }
  const asset=object(doc.asset,'asset');if(asset.version!=='2.0')fail('unsupported glTF asset version');
  const buffers=array(doc.buffers,'buffers');if(buffers.length!==1)fail('expected one embedded buffer');
  const buffer=object(buffers[0],'buffer');only(buffer,['byteLength'],'buffer');
  const byteLength=integer(buffer.byteLength,'buffer byteLength');
  if(byteLength>binarySize||binarySize-byteLength>3)fail('embedded buffer length exceeds BIN chunk');
  const views=array(doc.bufferViews,'bufferViews'),accessors=array(doc.accessors,'accessors');
  const meshDocs=array(doc.meshes,'meshes'),materialDocs=array(doc.materials,'materials'),nodes=array(doc.nodes,'nodes'),scenes=array(doc.scenes,'scenes');
  if(scenes.length!==1||integer(doc.scene,'scene')!==0)fail('expected one scene');
  const scene=object(scenes[0],'scene');only(scene,['nodes','name'],'scene');
  const roots=array(scene.nodes,'scene nodes');
  if(roots.length!==nodes.length||new Set(roots).size!==roots.length)fail('expected all nodes once at the scene root');

  function attribute(index:unknown,kind:'position'|'indices'):BufferAttribute;
  function attribute(index:unknown,kind:'normal'):BufferAttribute|InterleavedBufferAttribute;
  function attribute(index:unknown,kind:'position'|'normal'|'indices'){
    const accessor=at(accessors,index,`${kind} accessor`);
    only(accessor,['bufferView','byteOffset','componentType','count','type','min','max','normalized'],'accessor');
    const isIndex=kind==='indices',component=integer(accessor.componentType,'componentType');
    const byteNormal=kind==='normal'&&component===5120;
    const packedNormal=kind==='normal'&&(component===5122||byteNormal);
    if(accessor.type!==(isIndex?'SCALAR':'VEC3')||(isIndex?![5123,5125].includes(component):component!==5126&&!packedNormal))fail(`unsupported ${kind} type`);
    if(packedNormal?accessor.normalized!==true:accessor.normalized!==undefined&&accessor.normalized!==false)fail(`unsupported ${kind} normalization`);
    const count=integer(accessor.count,`${kind} count`,1),components=isIndex?1:3,width=byteNormal?1:component===5123||packedNormal?2:4;
    if(isIndex&&count%3)fail('index count is not a triangle list');
    const view=at(views,accessor.bufferView,`${kind} bufferView`);
    only(view,['buffer','byteOffset','byteLength','target','byteStride'],'bufferView');
    if(view.buffer!==0)fail('unsupported external buffer');
    if(view.target!==undefined&&view.target!==(isIndex?34963:34962))fail(`invalid ${kind} buffer target`);
    const start=integer(view.byteOffset??0,'bufferView byteOffset'),length=integer(view.byteLength,'bufferView byteLength');
    // The new BYTE VEC3 format is deliberately narrow: a four-byte slot with
    // one unused padding byte. Legacy SHORT/FLOAT streams remain supported.
    // No general-purpose interleaved attributes or non-vertex strides accepted.
    if(byteNormal?view.byteStride!==4:view.byteStride!==undefined)fail(`unsupported ${kind} byteStride`);
    if(byteNormal&&(!array(doc.extensionsUsed??[],'extensionsUsed').includes('KHR_mesh_quantization')||!array(doc.extensionsRequired??[],'extensionsRequired').includes('KHR_mesh_quantization')))fail('BYTE normal requires KHR_mesh_quantization');
    const local=integer(accessor.byteOffset??0,'accessor byteOffset'),size=count*(byteNormal?4:components*width);
    if(!Number.isSafeInteger(size)||start+length>byteLength||local+size>length)fail(`${kind} accessor exceeds its bufferView`);
    const offset=binaryOffset+start+local;
    if(offset%width||(byteNormal&&(start%4||local%4)))fail(`unaligned ${kind} accessor`);
    if(byteNormal)return new InterleavedBufferAttribute(new InterleavedBuffer(new Int8Array(bytes,offset,size),4),3,0,true);
    const values=packedNormal?new Int16Array(bytes,offset,count*components):component===5123?new Uint16Array(bytes,offset,count):component===5125?new Uint32Array(bytes,offset,count):new Float32Array(bytes,offset,count*components);
    if(!isIndex)for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i]))fail(`non-finite ${kind}`);
    return new BufferAttribute(values,components,packedNormal);
  }

  const model=new Group(),geometries=new Set<BufferGeometry>(),materials=new Map<number,MeshLambertMaterial>();
  model.name=name(scene.name)??'Mobile campus';
  try{
    for(const root of roots){
      const node=at(nodes,root,'node');only(node,['name','mesh','extras'],'node');
      const meshDoc=at(meshDocs,node.mesh,'mesh');only(meshDoc,['name','primitives'],'mesh');
      const primitives=array(meshDoc.primitives,'primitives');if(primitives.length!==1)fail('expected one primitive per mesh');
      const primitive=object(primitives[0],'primitive');only(primitive,['attributes','indices','material','mode'],'primitive');
      if(primitive.mode!==undefined&&primitive.mode!==4)fail('unsupported primitive mode');
      const attributes=object(primitive.attributes,'attributes');only(attributes,['POSITION','NORMAL'],'attributes');
      const position=attribute(attributes.POSITION,'position'),normal=attribute(attributes.NORMAL,'normal'),indices=attribute(primitive.indices,'indices');
      if(position.count!==normal.count)fail('position and normal counts differ');
      for(let i=0;i<indices.count;i++)if(indices.getX(i)>=position.count)fail('index exceeds vertex count');
      const geometry=new BufferGeometry();geometries.add(geometry);
      geometry.setAttribute('position',position);geometry.setAttribute('normal',normal);geometry.setIndex(indices);
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const materialId=integer(primitive.material,'material');let material=materials.get(materialId);
      if(!material){
        const source=at(materialDocs,materialId,'material');only(source,['name','doubleSided','pbrMetallicRoughness'],'material');
        if(source.doubleSided!==undefined&&typeof source.doubleSided!=='boolean')fail('doubleSided must be boolean');
        const pbr=object(source.pbrMetallicRoughness,'pbrMetallicRoughness');only(pbr,['baseColorFactor','metallicFactor','roughnessFactor'],'pbrMetallicRoughness');
        if(pbr.metallicFactor!==0||pbr.roughnessFactor!==1)fail('unsupported material shading');
        const factor=array(pbr.baseColorFactor,'baseColorFactor');
        if(factor.length!==4||factor.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)||factor[3]!==1)fail('unsupported baseColorFactor');
        material=new MeshLambertMaterial({color:new Color(factor[0] as number,factor[1] as number,factor[2] as number),side:source.doubleSided?DoubleSide:FrontSide});
        materials.set(materialId,material);material.name=name(source.name)??'';
      }
      const mesh=new Mesh(geometry,material);mesh.name=name(node.name)??name(meshDoc.name)??'';
      const extras=node.extras===undefined?{}:object(node.extras,'extras');only(extras,['mobileGround','mobileWall','mobileHidden','buGroundLayer'],'extras');
      for(const key of Object.keys(extras))if(key!=='buGroundLayer'&&typeof extras[key]!=='boolean')fail(`${key} must be boolean`);
      if(extras.buGroundLayer!==undefined){
        const layer=extras.buGroundLayer;
        if(layer!=='terrain'&&layer!=='surface'&&layer!=='marking')fail('invalid BU ground layer');
        configureBUGroundLayer(material,layer as 'terrain'|'surface'|'marking');
      }
      mesh.userData={...extras};mesh.visible=extras.mobileHidden!==true;model.add(mesh);
    }
    return model;
  }catch(error){
    geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());model.clear();throw error;
  }
}
