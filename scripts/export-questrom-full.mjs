import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {Box3,Group,Matrix4,Mesh,MeshStandardMaterial} from 'three';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';

// Construction scope isolates the whole school, including terrain foundations.
// The runtime CanvasTexture inscription stays outside this geometry export.
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}};
const directory='assets-source/charles-bu/blender/questrom/input';
await mkdir(directory,{recursive:true});
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[],entries:[]},appType:'custom',logLevel:'error'});
try{
 const [{createBostonUniversity},{BU_BUILDING_ANCHORS},{buElevation}]=await Promise.all([
  vite.ssrLoadModule('/src/features/world/boston-university.ts'),
  vite.ssrLoadModule('/src/features/world/charles-geography.ts'),
  vite.ssrLoadModule('/src/features/world/bu-terrain.ts'),
 ]);
 const source=createBostonUniversity({wind:{value:0}}),root=source.questrom.visual;
 if(!root?.isGroup)throw new Error('Questrom visual ownership has not been exposed by the builder');
 const [x,z]=BU_BUILDING_ANCHORS.questrom,base=buElevation(x,z),yaw=-.145;
 const toWorld=new Matrix4().makeTranslation(x,base,z).multiply(new Matrix4().makeRotationY(yaw));
 const toLocal=toWorld.clone().invert(),group=new Group();group.name='Questrom complete exterior';root.updateWorldMatrix(true,true);
 const descriptions=[];
 root.traverse(object=>{
  if(!object.isMesh||!object.visible)return;
  const original=Array.isArray(object.material)?object.material[0]:object.material;
  if(original.map?.isCanvasTexture)throw new Error('Runtime inscription must not enter the geometry export');
  const finish=original.name.replace(/^BU /,'');
  const material=new MeshStandardMaterial({color:original.color.clone(),roughness:original.roughness,metalness:original.metalness,side:original.side});material.name=finish;
  const geometry=object.geometry.clone();geometry.applyMatrix4(toLocal.clone().multiply(object.matrixWorld));
  const mesh=new Mesh(geometry,material);mesh.name=object.name;
  const ground=object.userData.buGround===true;
  mesh.userData={...object.userData,ground,originalMaterial:{name:original.name,finish,color:original.color.toArray(),roughness:original.roughness,metalness:original.metalness}};
  group.add(mesh);descriptions.push({name:mesh.name,finish,ground,triangles:(geometry.index?.count??geometry.attributes.position.count)/3});
 });
 const result=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:true});
 const path=`${directory}/questrom-full.glb`;await writeFile(path,Buffer.from(result));
 const bounds=new Box3().setFromObject(group),triangles=descriptions.reduce((n,m)=>n+m.triangles,0);
 const manifest={id:'questrom-full',units:'metres',toWorld:toWorld.toArray(),frame:{anchor:[x,base,z],yaw},bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},bytes:result.byteLength,sha256:createHash('sha256').update(Buffer.from(result)).digest('hex'),triangles,meshes:descriptions,collision:{ground:source.questrom.ground.length,walls:source.questrom.walls.length},note:'Complete explicitly owned Questrom exterior: stepped masonry wings, roof, glass entrance slot, canopy, draped entry paving and terrain foundation skirts. Local origin is the original Questrom anchor and rigid base; horizontal frame is yaw -0.145, with no crop or additional translation. Runtime canvas inscription is deliberately excluded and remains a separate scene extra. Existing windows and dimensions are authored approximations, not an architectural survey.'};
 await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
}finally{await vite.close();}
