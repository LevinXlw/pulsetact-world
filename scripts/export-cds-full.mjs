import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {Box3,Group,Matrix4,Mesh,MeshStandardMaterial} from 'three';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';

// Explicit builder ownership isolates the whole building, never a spatial crop.
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}};
const directory='assets-source/charles-bu/blender/full/input';
await mkdir(directory,{recursive:true});
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[],entries:[]},appType:'custom',logLevel:'error'});
try{
 const {createBostonUniversity}=await vite.ssrLoadModule('/src/features/world/boston-university.ts');
 const source=createBostonUniversity({wind:{value:0}}),root=source.cds.visual;
 if(!root?.isGroup)throw new Error('CDS visual ownership has not been exposed by the builder');
 const sample=JSON.parse(await readFile('assets-source/charles-bu/blender/input/manifest.json','utf8')).samples.find(s=>s.id==='cds-ground');
 const toWorld=new Matrix4().fromArray(sample.toWorld),toLocal=toWorld.clone().invert(),group=new Group();
 group.name='CDS complete exterior';root.updateWorldMatrix(true,true);
 const descriptions=[];
 root.traverse(object=>{
  if(!object.isMesh||!object.visible)return;
  const original=Array.isArray(object.material)?object.material[0]:object.material;
  const finish=original.name.replace(/^BU /,'');
  const material=new MeshStandardMaterial({color:original.color.clone(),roughness:original.roughness,metalness:original.metalness,side:original.side});material.name=finish;
  const geometry=object.geometry.clone();geometry.applyMatrix4(toLocal.clone().multiply(object.matrixWorld));
  const mesh=new Mesh(geometry,material);mesh.name=object.name;
  const ground=object.name.startsWith('BU ground');
  mesh.userData={...object.userData,ground,originalMaterial:{name:original.name,finish,color:original.color.toArray(),roughness:original.roughness,metalness:original.metalness}};
  group.add(mesh);descriptions.push({name:mesh.name,finish,ground,triangles:(geometry.index?.count??geometry.attributes.position.count)/3});
 });
 const result=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:true});
 const path=`${directory}/cds-full.glb`;await writeFile(path,Buffer.from(result));
 const bounds=new Box3().setFromObject(group),triangles=descriptions.reduce((n,m)=>n+m.triangles,0);
 const manifest={id:'cds-full',units:'metres',toWorld:sample.toWorld,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},bytes:result.byteLength,sha256:createHash('sha256').update(Buffer.from(result)).digest('hex'),triangles,meshes:descriptions,collision:{ground:source.cds.ground.length,walls:source.cds.walls.length},note:'Complete explicitly owned CDS geometry including tower, east podium, crown, terraces, sloped paving and foundation skirts. Uses the reviewed ground-sample coordinate frame; no spatial clipping.'};
 await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
}finally{await vite.close();}
