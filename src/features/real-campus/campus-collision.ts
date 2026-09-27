import {Box3,Mesh,Raycaster,Vector3,type Intersection} from 'three';

type Entry={mesh:Mesh;bounds:Box3};
// Static broad phase: foliage/detail never joins the walking query, and remote
// meshes are rejected before Three.js visits their triangles. Reuse query buffers.
export class CampusCollision {
 private ground:Entry[]=[];
 private walls:Entry[]=[];
 private all:Entry[]=[];
 private ray=new Raycaster();
 private candidates:Mesh[]=[];
 private hits:Intersection[]=[];
 private origin=new Vector3();
 private down=new Vector3(0,-1,0);
 private end=new Vector3();
 private query=new Box3();
 rebuild(ground:Mesh[],walls:Mesh[]){
  const entry=(mesh:Mesh):Entry=>({mesh,bounds:mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)});
  this.ground=ground.map(entry);this.walls=walls.map(entry);this.all=[...this.ground,...this.walls];
 }
 clear(){this.ground=[];this.walls=[];this.all=[];this.candidates.length=0;this.hits.length=0;}
 groundHeight(x:number,z:number){
  this.candidates.length=0;this.hits.length=0;
  for(const item of this.ground)if(x>=item.bounds.min.x&&x<=item.bounds.max.x&&z>=item.bounds.min.z&&z<=item.bounds.max.z)this.candidates.push(item.mesh);
  this.origin.set(x,300,z);this.ray.set(this.origin,this.down);this.ray.near=0;this.ray.far=600;
  return this.ray.intersectObjects(this.candidates,false,this.hits)[0]?.point.y;
 }
 distance(origin:Vector3,direction:Vector3,reach:number,includeGround=false){
  this.end.copy(origin).addScaledVector(direction,reach);
  this.query.min.copy(origin).min(this.end);this.query.max.copy(origin).max(this.end);this.query.expandByScalar(.02);
  this.candidates.length=0;this.hits.length=0;
  for(const item of includeGround?this.all:this.walls)if(this.query.intersectsBox(item.bounds))this.candidates.push(item.mesh);
  this.ray.set(origin,direction);this.ray.near=0;this.ray.far=reach;
  return this.ray.intersectObjects(this.candidates,false,this.hits)[0]?.distance;
 }
}
