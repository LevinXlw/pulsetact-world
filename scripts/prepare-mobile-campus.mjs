import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import {Color,Vector3,Matrix3} from 'three';

/** KHR_mesh_quantization requires each BYTE VEC3 vertex to begin on a 4-byte
 * boundary: xyz + one padding byte, not a tightly packed three-byte stream.
 * https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_mesh_quantization */
export function packMobileNormals(normals){
  if(normals.length%3)throw new Error('Mobile normals must contain complete VEC3 elements');
  const packed=new Int8Array(normals.length/3*4);
  for(let i=0;i<normals.length;i++){
    const value=normals[i];if(!Number.isFinite(value))throw new Error('Mobile normals must be finite');
    packed[Math.floor(i/3)*4+i%3]=Math.round(Math.max(-1,Math.min(1,value))*127);
  }
  return packed;
}

async function prepareMobileCampus(){
const realFetch=globalThis.fetch;
const offlineLandmarks=new Map([
  ['/assets-source/charles-bu/blender/full/cds-mobile-source.glb','assets-source/charles-bu/blender/full/cds-mobile-source.glb'],
  ['/assets-source/charles-bu/blender/full/input/manifest.json','assets-source/charles-bu/blender/full/input/manifest.json'],
  ['/assets-source/charles-bu/blender/questrom/questrom-mobile-source.glb','assets-source/charles-bu/blender/questrom/questrom-mobile-source.glb'],
  ['/assets-source/charles-bu/blender/questrom/input/manifest.json','assets-source/charles-bu/blender/questrom/input/manifest.json'],
]);
globalThis.fetch=async(url,options)=>{
  if(typeof url==='string'&&offlineLandmarks.has(url))return new Response(await readFile(offlineLandmarks.get(url)));
  if(typeof url==='string'&&url.startsWith('/data/mobile/'))return new Response(await readFile(url.includes('/mit-')?'assets-source/mobile/'+url.split('/').at(-1):'public'+url));
  return realFetch(url,options);
};
await mkdir('public/data/mobile',{recursive:true});
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[],entries:[]},appType:'custom',logLevel:'error'});
try{
  const {buildMobileCampus}=await vite.ssrLoadModule('/src/features/world/mobile-campus-build.ts');
  const {REMOTE_LAYOUTS}=await vite.ssrLoadModule('/src/features/world/campus-regions.ts');
  const requested=process.argv.slice(2),campuses=['boston','umd','upenn','arizona'];
  if(requested.some(campus=>!campuses.includes(campus)))throw new Error('Unknown campus selection');
  for(const campus of requested.length?requested:campuses){
    const built=await buildMobileCampus(new AbortController().signal,campus);built.model.updateMatrixWorld(true);
    const doc={asset:{version:'2.0',generator:'Pulsetact offline mobile campus'},extensionsUsed:['KHR_mesh_quantization'],extensionsRequired:['KHR_mesh_quantization'],buffers:[{byteLength:0}],bufferViews:[],accessors:[],materials:[],meshes:[],nodes:[],scenes:[{nodes:[]}],scene:0};
    const chunks=[],p=new Vector3(),n=new Vector3(),normalMatrix=new Matrix3();let bytes=0,triangles=0;
    const buffer=(array,target,byteStride)=>{const padding=(4-bytes%4)%4;if(padding){chunks.push(Buffer.alloc(padding));bytes+=padding;}const id=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:bytes,byteLength:array.byteLength,target,...(byteStride?{byteStride}:{})});chunks.push(Buffer.from(array.buffer,array.byteOffset,array.byteLength));bytes+=array.byteLength;return id;};
    built.model.traverse(mesh=>{
      if(!mesh.isMesh||mesh.name==='Mobile seamless gradient sky')return;
      const geometry=mesh.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),sourceIndex=geometry.getIndex(),positions=[],normals=[],indices=[],unique=new Map(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for(let i=0;i<(sourceIndex?.count??position.count);i++){
        const source=sourceIndex?sourceIndex.getX(i):i;p.fromBufferAttribute(position,source).applyMatrix4(mesh.matrixWorld);if(normal)n.fromBufferAttribute(normal,source).applyNormalMatrix(normalMatrix);else n.set(0,1,0);
        // Millimetre positions and unit normals retain shell / stair geometry,
        // while welding the duplicate triangle corners created by batching.
        const values=[p.x,p.y,p.z,n.x,n.y,n.z].map((v,k)=>Math.round(v*(k<3?1000:10000))/(k<3?1000:10000)),key=values.join(',');
        let index=unique.get(key);if(index===undefined){index=positions.length/3;unique.set(key,index);positions.push(...values.slice(0,3));normals.push(...values.slice(3));for(let k=0;k<3;k++){min[k]=Math.min(min[k],values[k]);max[k]=Math.max(max[k],values[k]);}}indices.push(index);
      }
      triangles+=indices.length/3;const pos=doc.accessors.length;
      doc.accessors.push({bufferView:buffer(new Float32Array(positions),34962),componentType:5126,count:positions.length/3,type:'VEC3',min,max});
      const norm=doc.accessors.length;doc.accessors.push({bufferView:buffer(packMobileNormals(normals),34962,4),componentType:5120,normalized:true,count:normals.length/3,type:'VEC3'});
      const index=doc.accessors.length,big=positions.length/3>65535;doc.accessors.push({bufferView:buffer(big?new Uint32Array(indices):new Uint16Array(indices),34963),componentType:big?5125:5123,count:indices.length,type:'SCALAR'});
      const sourceMaterial=Array.isArray(mesh.material)?mesh.material[0]:mesh.material,color=sourceMaterial.color??new Color('#b1b5a1'),material=doc.materials.length;
      // Keep the exact opt-in frontage shader identity through the offline
      // Lambert bake; all unrelated materials retain their existing names.
      doc.materials.push({name:sourceMaterial.userData.buFrontageGlazing?sourceMaterial.name:mesh.name,doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[color.r,color.g,color.b,1],metallicFactor:0,roughnessFactor:1}});
      const meshId=doc.meshes.length;doc.meshes.push({name:mesh.name,primitives:[{attributes:{POSITION:pos,NORMAL:norm},indices:index,material}]});
      const node=doc.nodes.length;doc.nodes.push({name:mesh.name,mesh:meshId,extras:{mobileGround:!!mesh.userData.mobileGround,mobileWall:!!mesh.userData.mobileWall,mobileHidden:!mesh.visible,...(sourceMaterial.userData.buGroundLayer?{buGroundLayer:sourceMaterial.userData.buGroundLayer}:{})}});doc.scenes[0].nodes.push(node);
    });
    doc.buffers[0].byteLength=bytes;
    const binary=Buffer.concat(chunks),raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),bin=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]),out=Buffer.alloc(28+json.length+bin.length);
    out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);bin.copy(out,28+json.length);
    await writeFile(`public/data/mobile/${campus}.glb`,out);
    const metadata={version:1,campus,bytes:out.length,triangles,meshes:doc.meshes.length,visibleMeshes:doc.nodes.filter(n=>!n.extras.mobileHidden).length,textures:0};
    if(campus!=='boston'){
      const bounds=REMOTE_LAYOUTS[campus].bounds,cell=campus==='umd'?6.25:campus==='arizona'?8:25,minX=Math.floor(bounds.minX/cell)*cell,minZ=Math.floor(bounds.minZ/cell)*cell,columns=Math.ceil((bounds.maxX-minX)/cell)+1,rows=Math.ceil((bounds.maxZ-minZ)/cell)+1;
      const height=campus==='umd'?(await vite.ssrLoadModule('/src/features/world/maryland-terrain.ts')).marylandElevation:campus==='arizona'?(await vite.ssrLoadModule('/src/features/world/arizona-geography.ts')).arizonaElevation:()=>0;
      const values=new Float32Array(columns*rows);for(let z=0;z<rows;z++)for(let x=0;x<columns;x++)values[z*columns+x]=height(minX+x*cell,minZ+z*cell);
      await writeFile(`public/data/mobile/${campus}.ground.bin`,Buffer.from(values.buffer));metadata.grid={minX,minZ,columns,rows,cell};metadata.heightBytes=values.byteLength;
    }
    await writeFile(`public/data/mobile/${campus}.json`,JSON.stringify(metadata,null,2));console.log(JSON.stringify(metadata));built.dispose();
  }
}finally{await vite.close();globalThis.fetch=realFetch;}
}

// Importing the normal encoder for regression tests must never start a bake.
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await prepareMobileCampus();
