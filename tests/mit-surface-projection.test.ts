import {describe,it,expect} from 'vitest';
import {BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {createMITSurfaceProjection} from '../src/features/world/mit-surface-projection';

describe('MIT paving projected onto surveyed terrain',()=>{
 it('retains a narrow slope crest that regular paving samples would cut through',()=>{
  const vertices:number[]=[];
  for(const [x,y,xx,yy] of [[-120,3,-119.65,3.35],[-119.65,3.35,-118,3]])vertices.push(x,y,180,x,y,182,xx,yy,180,xx,yy,180,x,y,182,xx,yy,182);
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));
  const mesh=new Mesh(geometry,new MeshBasicMaterial()),out:number[]=[];
  createMITSurfaceProjection([mesh])([[-120,0,180],[-118,0,180],[-118,0,182],[-120,0,182]],.025,out);
  const projected=new BufferGeometry();projected.setAttribute('position',new Float32BufferAttribute(out,3));
  const road=new Mesh(projected,new MeshBasicMaterial()),ray=new Raycaster(new Vector3(-119.65,10,181),new Vector3(0,-1,0));
  expect(ray.intersectObject(road)[0].point.y).toBeCloseTo(3.375,4);
  for(let x=-119.95;x<-118.05;x+=.07){ray.ray.origin.x=x;expect(ray.intersectObject(road)[0].point.y-ray.intersectObject(mesh)[0].point.y).toBeCloseTo(.025,4);}
 });
 it('clips outside terrain and keeps the corridor index bounded',()=>{
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([-120,3,180,-120,3,182,-118,3,180],3));
  const mesh=new Mesh(g,new MeshBasicMaterial()),out:number[]=[];
  createMITSurfaceProjection([mesh])([[-121,0,179],[-117,0,179],[-117,0,183],[-121,0,183]],.025,out);
  expect(out.length).toBe(9);mesh.position.x=1000;out.length=0;
  createMITSurfaceProjection([mesh])([[879,0,179],[883,0,179],[883,0,183],[879,0,183]],.025,out);expect(out).toHaveLength(0);
 });
});
