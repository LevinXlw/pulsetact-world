import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {BufferGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshStandardMaterial,Vector3,Box3} from 'three';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';

// Read the reviewed source builders; no production replacement or collider edit.
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}};
const directory='assets-source/charles-bu/blender/input';
await mkdir(directory,{recursive:true});
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[],entries:[]},appType:'custom',logLevel:'error'});
const sourceFor=finish=>({brownstone:'limestone',sandstone:'limestone',stone:'limestone',wood:'entranceDoor',paving:'pavement',pavingBrick:'pavement',granite:'pavement',soil:'pavement',turf:'grass',hedge:'grass',hedgeLight:'grass',shade:'interiorShade',inset:'interiorShade',glassStained:'interiorShade',iron:'frame',metal:'frame',white:'trim',red:'brick',brickLight:'brick',brickBuff:'brick',brickRose:'brick',brickDark:'brick'})[finish]??finish;
function clipped(poly,axis,bound,sign){
 const out=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=(a.p[axis]-bound)*sign,db=(b.p[axis]-bound)*sign;
  if(da>=-1e-7)out.push(a);
  if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({p:a.p.map((v,j)=>v+(b.p[j]-v)*t),n:a.n.map((v,j)=>v+(b.n[j]-v)*t),h:a.h+(b.h-a.h)*t,yaw:a.yaw+(b.yaw-a.yaw)*t});}
 }return out;
}
function sampleModel(source,worldToLocal,crop){
 const group=new Group();source.updateMatrixWorld(true);
 source.traverse(object=>{
  if(!object.isMesh||!object.visible)return;
  const g=object.geometry,position=g.getAttribute('position'),normal=g.getAttribute('normal'),height=g.getAttribute('campusBaseHeight'),yaw=g.getAttribute('campusYaw');
  const transform=worldToLocal.clone().multiply(object.matrixWorld),vertices=[],normals=[],heights=[],yaws=[];
  const point=new Vector3(),n=new Vector3(),indices=g.index;
  const vertex=index=>({p:point.fromBufferAttribute(position,index).applyMatrix4(transform).toArray(),n:n.fromBufferAttribute(normal,index).transformDirection(transform).toArray(),h:height?.getX(index)??0,yaw:yaw?.getX(index)??0});
  const count=indices?.count??position.count;
  for(let i=0;i<count;i+=3){
   let poly=[0,1,2].map(k=>vertex(indices?indices.getX(i+k):i+k));
   if(crop)for(let axis=0;axis<3;axis++){poly=clipped(poly,axis,crop.min[axis],1);if(!poly.length)break;poly=clipped(poly,axis,crop.max[axis],-1);if(!poly.length)break;}
   for(let k=1;k<poly.length-1;k++)for(const v of [poly[0],poly[k],poly[k+1]]){vertices.push(...v.p);normals.push(...v.n);heights.push(v.h);yaws.push(v.yaw);}
  }
  if(!vertices.length)return;
  const original=Array.isArray(object.material)?object.material[0]:object.material,finish=original.name.split(' · ').at(-1).replace(/^BU /,'');
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));
  geometry.setAttribute('_CAMPUS_BASE_HEIGHT',new Float32BufferAttribute(heights,1));geometry.setAttribute('_CAMPUS_YAW',new Float32BufferAttribute(yaws,1));
  const material=new MeshStandardMaterial({color:original.color.clone(),roughness:original.roughness,metalness:original.metalness,side:original.side});material.name=finish;
  const mesh=new Mesh(geometry,material);mesh.name=object.name;
  mesh.userData.originalMaterial={name:original.name,finish,surface:sourceFor(finish),color:original.color.toArray(),roughness:original.roughness,metalness:original.metalness,emissive:original.emissive.toArray(),emissiveIntensity:original.emissiveIntensity,side:original.side};
  mesh.userData.ground=object.name.startsWith('BU ground')||object.name.includes('ground:');group.add(mesh);
 });
 return group;
}
try{
 const [{createBUFullCampus},{BU_FULL_BUILDINGS},{buElevation},{createBostonUniversity},{BU_CDS_MAP_FEATURE,BU_CDS_YAW}]=await Promise.all([
  vite.ssrLoadModule('/src/features/world/bu-full-campus.ts'),vite.ssrLoadModule('/src/features/world/bu-full-layout.ts'),vite.ssrLoadModule('/src/features/world/bu-terrain.ts'),vite.ssrLoadModule('/src/features/world/boston-university.ts'),vite.ssrLoadModule('/src/features/world/bu-landmark-layout.ts')
 ]);
 const b=BU_FULL_BUILDINGS.find(b=>b.id==='boston-12068'),base=buElevation(b.x,b.z),cds=BU_CDS_MAP_FEATURE,cdsBase=buElevation(cds.x,cds.z);
 const houseToWorld=new Matrix4().makeTranslation(b.x,base,b.z);
 const cdsToWorld=new Matrix4().makeTranslation(cds.x,cdsBase,cds.z).multiply(new Matrix4().makeRotationY(BU_CDS_YAW)).multiply(new Matrix4().makeTranslation(35.75,0,21.15));
 const samples=[
  {id:'bay-state-192',source:createBUFullCampus({buildingIds:new Set([b.id]),includeSpaces:false,signage:false}).group,toWorld:houseToWorld,origin:[b.x,base,b.z],note:'Reviewed authored 192 Bay State exterior, local metre coordinates. City footprint retained; window details are not surveyed.'},
  {id:'cds-ground',source:createBostonUniversity({wind:{value:0}}).group,toWorld:cdsToWorld,crop:{min:[-13.75,-.6,-4.35],max:[13.75,7.5,4.35]},note:'Clipped study of the existing authored CDS south podium: doors, retained canopy columns and threshold paving. Cut edges are sample boundaries, not new real-world walls.'}
 ];
 const manifest={date:'2026-10-19',units:'metres',coordinateSystem:'glTF Y-up; Blender importer performs standard axis conversion',samples:[]};
 for(const sample of samples){
  const group=sampleModel(sample.source,sample.toWorld.clone().invert(),sample.crop);group.name=sample.id;
  const output=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:true});await writeFile(`${directory}/${sample.id}.glb`,Buffer.from(output));
  const box=new Box3().setFromObject(group),triangles=group.children.reduce((total,m)=>total+m.geometry.attributes.position.count/3,0);
  manifest.samples.push({id:sample.id,note:sample.note,toWorld:sample.toWorld.toArray(),bounds:{min:box.min.toArray(),max:box.max.toArray()},triangles,meshes:group.children.length,bytes:output.byteLength,sha256:createHash('sha256').update(Buffer.from(output)).digest('hex'),materials:group.children.map(m=>m.userData.originalMaterial)});
  console.log(JSON.stringify({id:sample.id,triangles,meshes:group.children.length,bytes:output.byteLength,bounds:manifest.samples.at(-1).bounds}));
 }
 await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2));
}finally{await vite.close();}
