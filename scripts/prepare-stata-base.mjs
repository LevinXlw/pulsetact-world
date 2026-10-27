import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

// Remove only the surveyed Stata triangles, retaining every original binary
// byte, vertex attribute, material, texture, node and non-Stata triangle.
// The filtered index accessor is appended; original campus files stay intact.
const sourcePath='assets-source/mit-stata/source.obj';
const outputDirectory='public/assets/mit-stata';
const mobileOnly=process.argv.includes('--mobile-only');
assert(process.argv.slice(2).every(arg=>arg==='--mobile-only'),'Only --mobile-only is supported.');
const reportPath=mobileOnly?'output/mobile-boston-replacements/stata-base-removal-report.json':'output/stata-full-20261022/base-removal-report.json';
const expectedTriangles=1811;
const feetToMetres=1200/3937;
const origin=[766425.8129794697-731100,2956167.074144031-2902900];
const sha256=value=>createHash('sha256').update(value).digest('hex');
const sourceBytes=await readFile(sourcePath);
const sourceVertices=[],sourceTriangles=[];
for(const line of sourceBytes.toString('utf8').split(/\r?\n/)){
  if(line.startsWith('v ')){
    const [easting,northing,height]=line.trim().split(/\s+/).slice(1,4).map(Number);
    sourceVertices.push([(easting-origin[0])*feetToMetres,height*feetToMetres,-(northing-origin[1])*feetToMetres]);
  }else if(line.startsWith('f ')){
    const indices=line.trim().split(/\s+/).slice(1).map(item=>Number(item.split('/')[0])-1);
    assert.equal(indices.length,3,'This source must contain only survey triangles; no inferred triangulation.');
    sourceTriangles.push(indices.map(index=>sourceVertices[index]));
  }
}
assert.equal(sourceTriangles.length,expectedTriangles,'Unexpected Stata source triangle count.');
assert(sourceTriangles.flat(2).every(Number.isFinite),'Source contains invalid coordinates.');
const centroid=triangle=>[0,1,2].map(axis=>(triangle[0][axis]+triangle[1][axis]+triangle[2][axis])/3);
const cellSize=.01;
const cellOf=point=>point.map(value=>Math.floor(value/cellSize));
const buckets=new Map();
sourceTriangles.forEach((triangle,index)=>{const key=cellOf(centroid(triangle)).join(',');const list=buckets.get(key)??[];list.push(index);buckets.set(key,list);});
const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function sourceMatches(triangle,tolerance){
  const cell=cellOf(centroid(triangle)),matches=[];
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    for(const index of buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))??[]){
      const source=sourceTriangles[index];
      for(const permutation of permutations){
        const error=Math.max(...triangle.flatMap((vertex,i)=>vertex.map((value,axis)=>Math.abs(value-source[permutation[i]][axis]))));
        if(error<=tolerance){matches.push({index,error});break;}
      }
    }
  }
  return matches;
}
function parseGLB(bytes){
  assert.equal(bytes.readUInt32LE(0),0x46546c67,'Invalid GLB magic.');assert.equal(bytes.readUInt32LE(4),2,'Only GLB 2 supported.');assert.equal(bytes.readUInt32LE(8),bytes.length,'Invalid GLB length.');
  const chunks=[];for(let offset=12;offset<bytes.length;){const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);chunks.push({type,bytes:bytes.subarray(offset+8,offset+8+length)});offset+=length+8;}
  assert.equal(chunks.length,2,'Unexpected extra GLB chunks.');assert.equal(chunks[0].type,0x4e4f534a);assert.equal(chunks[1].type,0x004e4942);
  const document=JSON.parse(chunks[0].bytes.toString('utf8'));assert.equal(document.buffers.length,1);assert.equal(document.buffers[0].uri,undefined);
  return{document,binary:chunks[1].bytes};
}
function packGLB(document,binary){
  const jsonBytes=Buffer.from(JSON.stringify(document)),json=Buffer.alloc(Math.ceil(jsonBytes.length/4)*4,0x20);jsonBytes.copy(json);
  const bin=Buffer.alloc(Math.ceil(binary.length/4)*4);binary.copy(bin);
  const bytes=Buffer.alloc(12+8+json.length+8+bin.length);bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);
  const binHeader=20+json.length;bytes.writeUInt32LE(bin.length,binHeader);bytes.writeUInt32LE(0x004e4942,binHeader+4);bin.copy(bytes,binHeader+8);return bytes;
}
function accessorValues(document,binary,index){
  const accessor=document.accessors[index],view=document.bufferViews[accessor.bufferView];
  assert.equal(accessor.sparse,undefined,'Sparse accessor is unsupported.');assert.equal(accessor.normalized??false,false,'Normalized accessor is unsupported.');assert.equal(view.buffer??0,0);
  const size={5121:1,5123:2,5125:4,5126:4}[accessor.componentType],components={SCALAR:1,VEC3:3}[accessor.type];assert(size&&components,'Unsupported accessor format.');
  const read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[accessor.componentType],stride=view.byteStride??size*components,start=(view.byteOffset??0)+(accessor.byteOffset??0);
  return Array.from({length:accessor.count},(_,i)=>components===1?binary[read](start+i*stride):Array.from({length:components},(__,axis)=>binary[read](start+i*stride+axis*size)));
}
const triangleCount=(document,primitive)=>primitive.indices===undefined?document.accessors[primitive.attributes.POSITION].count/3:document.accessors[primitive.indices].count/3;
const totalTriangles=document=>document.meshes.reduce((sum,mesh)=>sum+mesh.primitives.reduce((n,primitive)=>n+((primitive.mode??4)===4?triangleCount(document,primitive):0),0),0);
const report={status:'running',createdAt:new Date().toISOString(),source:{path:sourcePath,sha256:sha256(sourceBytes),vertexCount:sourceVertices.length,triangleCount:sourceTriangles.length,coordinateTransform:'[east-originEast, height, -(north-originNorth)] × (1200/3937)',originFeet:origin},assets:[],checks:[]};
await mkdir(outputDirectory,{recursive:true});
try{
  for(const task of [
    {input:'public/data/campuses/mit/campus.glb',output:`${outputDirectory}/campus-without-stata.glb`,tolerance:.00004,precision:'Original float32 world positions.'},
    {input:'public/data/mobile/boston.glb',output:`${outputDirectory}/boston-without-stata.glb`,tolerance:.00053,precision:'World positions rounded to 0.001 m and stored as float32.'},
  ].filter(task=>!mobileOnly||task.input==='public/data/mobile/boston.glb')){
    const inputBytes=await readFile(task.input),{document:original,binary}=parseGLB(inputBytes),document=structuredClone(original),candidates=[];
    for(const [meshIndex,mesh] of document.meshes.entries())for(const [primitiveIndex,primitive] of mesh.primitives.entries())if(['Cambridge buildings (untextured)','Cambridge_buildings_(untextured)'].includes(document.materials[primitive.material]?.name))candidates.push({meshIndex,primitiveIndex,primitive});
    assert.equal(candidates.length,1,'Expected exactly one Cambridge survey building primitive.');
    const {meshIndex,primitiveIndex,primitive}=candidates[0];assert.equal(primitive.mode??4,4,'Source building topology must be triangles.');
    // Both prepared scenes already contain world-space positions; reject a future
    // transformed/instanced source instead of silently matching the wrong frame.
    const meshNodes=document.nodes.map((node,index)=>({node,index})).filter(({node})=>node.mesh===meshIndex);assert.equal(meshNodes.length,1);
    const node=meshNodes[0].node;for(const key of ['matrix','translation','rotation','scale','skin'])assert.equal(node[key],undefined,`Unexpected ${key} on survey node.`);
    assert(!document.nodes.some(parent=>parent.children?.includes(meshNodes[0].index)),'Survey node must have no transformed parent.');
    const positions=accessorValues(document,binary,primitive.attributes.POSITION),originalIndices=primitive.indices===undefined?Array.from({length:positions.length},(_,i)=>i):accessorValues(document,binary,primitive.indices);
    assert.equal(originalIndices.length%3,0);const retainedIndices=[],removedTriangleIndices=[],sourceCounts=new Uint16Array(expectedTriangles);let maximumMatchError=0;
    for(let i=0;i<originalIndices.length;i+=3){
      const indices=originalIndices.slice(i,i+3),triangle=indices.map(index=>positions[index]),matches=sourceMatches(triangle,task.tolerance);
      if(matches.length){
        const match=matches.find(candidate=>sourceCounts[candidate.index]===0);assert(match,`Extra coincident source triangle at runtime triangle ${i/3}.`);sourceCounts[match.index]++;maximumMatchError=Math.max(maximumMatchError,match.error);removedTriangleIndices.push(i/3);
      }else retainedIndices.push(...indices);
    }
    const missing=[...sourceCounts].flatMap((count,index)=>count===1?[]:[index]);assert.equal(removedTriangleIndices.length,expectedTriangles,`${task.input}: must remove exactly ${expectedTriangles}, found ${removedTriangleIndices.length}; missing source triangles ${missing.slice(0,12).join(',')}.`);assert.deepEqual(missing,[],'Every surveyed source triangle must match exactly once.');
    const indexBytes=Buffer.alloc(retainedIndices.length*4);retainedIndices.forEach((index,i)=>indexBytes.writeUInt32LE(index,i*4));
    const appendedOffset=Math.ceil(binary.length/4)*4,newBinary=Buffer.alloc(appendedOffset+indexBytes.length);binary.copy(newBinary);indexBytes.copy(newBinary,appendedOffset);
    const newView=document.bufferViews.length;document.bufferViews.push({buffer:0,byteOffset:appendedOffset,byteLength:indexBytes.length,target:34963});
    const newAccessor=document.accessors.length;document.accessors.push({bufferView:newView,componentType:5125,count:retainedIndices.length,type:'SCALAR',min:[Math.min(...retainedIndices)],max:[Math.max(...retainedIndices)]});
    primitive.indices=newAccessor;document.buffers[0].byteLength=newBinary.length;
    const outputBytes=packGLB(document,newBinary),reloaded=parseGLB(outputBytes),newPrimitive=reloaded.document.meshes[meshIndex].primitives[primitiveIndex];
    assert(binary.equals(reloaded.binary.subarray(0,binary.length)),'Original binary payload changed.');
    assert.deepEqual(accessorValues(reloaded.document,reloaded.binary,newPrimitive.attributes.POSITION),positions,'Original vertex positions changed.');
    const actualRetained=accessorValues(reloaded.document,reloaded.binary,newPrimitive.indices);assert.deepEqual(actualRetained,retainedIndices,'Retained triangle order or winding changed.');
    let remainingMatches=0;for(let i=0;i<actualRetained.length;i+=3)if(sourceMatches(actualRetained.slice(i,i+3).map(index=>positions[index]),task.tolerance).length)remainingMatches++;
    assert.equal(remainingMatches,0,'Source Stata triangles remain in output.');
    const restored=structuredClone(reloaded.document);restored.accessors.pop();restored.bufferViews.pop();restored.buffers[0].byteLength=original.buffers[0].byteLength;
    if(original.meshes[meshIndex].primitives[primitiveIndex].indices===undefined)delete restored.meshes[meshIndex].primitives[primitiveIndex].indices;else restored.meshes[meshIndex].primitives[primitiveIndex].indices=original.meshes[meshIndex].primitives[primitiveIndex].indices;
    assert.deepEqual(restored,original,'Unrelated GLTF metadata changed.');
    const beforeTotal=totalTriangles(original),afterTotal=totalTriangles(reloaded.document);assert.equal(beforeTotal-afterTotal,expectedTriangles);
    const untouchedPrimitives=[];for(const [mi,mesh] of original.meshes.entries())for(const [pi,p] of mesh.primitives.entries())if(mi!==meshIndex||pi!==primitiveIndex){assert.deepEqual(p,reloaded.document.meshes[mi].primitives[pi]);untouchedPrimitives.push({mesh:mi,primitive:pi,material:original.materials[p.material]?.name,triangles:(p.mode??4)===4?triangleCount(original,p):null});}
    await writeFile(task.output,outputBytes);const saved=await readFile(task.output);assert.equal(sha256(saved),sha256(outputBytes),'Saved asset differs from verified bytes.');assert.equal(sha256(await readFile(task.input)),sha256(inputBytes),'Original input file changed.');
    const result={input:task.input,output:task.output,inputSHA256:sha256(inputBytes),outputSHA256:sha256(outputBytes),inputBytes:inputBytes.length,outputBytes:outputBytes.length,precision:task.precision,coordinateToleranceMetres:task.tolerance,maximumMatchErrorMetres:maximumMatchError,buildingPrimitive:{mesh:meshIndex,primitive:primitiveIndex,trianglesBefore:originalIndices.length/3,trianglesAfter:retainedIndices.length/3,removed:removedTriangleIndices.length,allSourceTrianglesMatchedOnce:true,sourceTrianglesRemaining:remainingMatches,retainedIndexSHA256:sha256(indexBytes)},sceneTrianglesBefore:beforeTotal,sceneTrianglesAfter:afterTotal,originalBinarySHA256:sha256(binary),originalBinaryUnchanged:true,metadataUnchangedExceptAppendedIndices:true,unmodifiedPrimitiveCount:untouchedPrimitives.length,unmodifiedTriangleCount:untouchedPrimitives.reduce((sum,p)=>sum+(p.triangles??0),0),removedOriginalTriangleIndices:removedTriangleIndices,untouchedPrimitives};
    if(task.input==='public/data/mobile/boston.glb')await writeFile(task.output.replace(/\.glb$/,'.json'),JSON.stringify({version:1,url:task.output.slice('public'.length),sha256:result.outputSHA256,bytes:result.outputBytes,inputUrl:task.input.slice('public'.length),inputSHA256:result.inputSHA256,inputBytes:result.inputBytes,removedTriangles:result.buildingPrimitive.removed},null,2));
    report.assets.push(result);console.log(JSON.stringify({input:task.input,output:task.output,removed:removedTriangleIndices.length,neighborBuildingTrianglesPreserved:retainedIndices.length/3,otherTrianglesPreserved:result.unmodifiedTriangleCount,maximumMatchErrorMetres:maximumMatchError}));
  }
  report.status='passed';report.checks=['Every one of the 1811 surveyed source Stata triangles matched once in each asset.','Triangle correspondence uses all three world-space vertices; bounding boxes never decide removal.','Every retained building index is unchanged and in the original order, preserving triangle winding.','Every non-target primitive and all original metadata remain unchanged.','The complete original binary chunk is preserved byte for byte, including positions, normals, UVs, textures and old indices.','The output contains no remaining triangle matching the surveyed Stata shell.','Every selected input campus GLB remains byte-identical; separate assets were written and re-read for verification.'];
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;console.error(error);}
finally{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2));}
