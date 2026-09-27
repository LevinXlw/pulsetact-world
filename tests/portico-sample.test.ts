import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {Group,Mesh,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

const manifest=JSON.parse(readFileSync('public/data/killian/detail-manifest.json','utf8'));
const sample=manifest.porticoSample,opening=manifest.porticoOpening;
let scene:Group;
beforeAll(async()=>{
 const bytes=readFileSync('public/data/killian/detail.glb');
 const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
 scene=(await new GLTFLoader().parseAsync(buffer,'')).scene;scene.updateMatrixWorld(true);
});
function point(x:number,y:number,depth:number){
 const c=opening.center,n=opening.normal;
 return new Vector3(c[0]+n[2]*x+n[0]*depth,y,c[2]-n[0]*x+n[2]*depth);
}
function meshes(names:string[]){const result:Mesh[]=[];scene.traverse(o=>{if(o instanceof Mesh&&!Array.isArray(o.material)&&names.includes(o.material.name))result.push(o);});return result;}

it('wall apertures are empty and their adjacent reveals remain solid',()=>{
 const walls=meshes(['porticoWall']),n=opening.normal;
 const ray=new Raycaster(undefined,new Vector3(-n[0],0,-n[2]),0,sample.wall.thickness+.5);
 expect(walls.length).toBeGreaterThan(0);
 for(const h of sample.openings){
  const y=(h.bottom+h.top)/2;
  ray.ray.origin.copy(point(h.x,y,sample.wall.front+.2));
  expect(ray.intersectObjects(walls,false),h.id+' must not have a solid wall behind its opening').toHaveLength(0);
  ray.ray.origin.copy(point(h.x+h.w/2+.07,y,sample.wall.front+.2));
  expect(ray.intersectObjects(walls,false).length,h.id+' needs a solid reveal').toBeGreaterThan(0);
 }
});

it('window glass is set behind the face of the wall, with a separate cavity back',()=>{
 const windows=meshes(['porticoGlass']),backs=meshes(['windowInterior']),n=opening.normal;
 const ray=new Raycaster(undefined,new Vector3(-n[0],0,-n[2]),0,2);
 for(const h of sample.openings.filter((h:{kind:string})=>h.kind==='window')){
  ray.ray.origin.copy(point(h.x+.13,(h.bottom+h.top)/2+.11,sample.wall.front+.1));
  const glass=ray.intersectObjects(windows,false)[0],back=ray.intersectObjects(backs,false)[0];
  expect(glass).toBeDefined();expect(back).toBeDefined();
  expect(glass.distance).toBeGreaterThan(.35);
  expect(back.distance-glass.distance).toBeGreaterThan(.5);
 }
});

it('the center route preserves the existing five step heights and landing',()=>{
 const surfaces=meshes(['steps','porticoFloor']);
 const ray=new Raycaster(undefined,new Vector3(0,-1,0),0,5);
 for(const [depth,expected] of [[1,manifest.platformHeight],...Array.from({length:5},(_,i)=>[3+.62*i,manifest.platformHeight-.15*i])]){
  ray.ray.origin.copy(point(0,manifest.platformHeight+2,depth));
  expect(ray.intersectObjects(surfaces,false)[0].point.y).toBeCloseTo(expected,3);
 }
});
