import {describe,expect,it,vi} from 'vitest';
import {BoxGeometry,DoubleSide,Mesh,MeshBasicMaterial,PlaneGeometry,Vector3} from 'three';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {clampPitch,stroll,strollStart} from '../src/features/real-campus/stroll-controls';
import {insideCampus} from '../src/features/real-campus/local-data';

function prepare(mesh:Mesh){mesh.geometry.computeBoundingBox();mesh.updateMatrixWorld(true);return mesh;}
describe('environment stroll',()=>{
 it('starts inside the courtyard and preserves the original story spawn',()=>{
  const spawn:[number,number]=[16.742,55.459],start=strollStart('mit',spawn,true);
  expect(start).not.toEqual(spawn);expect(insideCampus(start,420)).toBe(true);
  expect(strollStart('mit',spawn,false)).toEqual(spawn);expect(strollStart('harvard',spawn,true)).toEqual(spawn);
  expect(spawn).toEqual([16.742,55.459]);expect(stroll.eyeHeight).toBe(1.65);expect(stroll.fov).toBe(48);
 });
 it('limits vertical drag before it can invert the view',()=>{
  expect(clampPitch(10)).toBeLessThan(Math.PI/2);expect(clampPitch(-10)).toBeGreaterThan(-Math.PI/2);expect(clampPitch(.4)).toBe(.4);
 });
 it('finds the highest walkable surface using world transforms',()=>{
  const material=new MeshBasicMaterial({side:DoubleSide}),floor=new Mesh(new PlaneGeometry(30,30),material);
  floor.rotation.x=-Math.PI/2;floor.position.y=2;prepare(floor);
  const step=new Mesh(new BoxGeometry(2,.3,2),material);step.position.set(4,2.15,0);prepare(step);
  const collision=new CampusCollision();collision.rebuild([floor,step],[]);
  expect(collision.groundHeight(0,0)).toBeCloseTo(2);expect(collision.groundHeight(4,0)).toBeCloseTo(2.3);
  expect(collision.groundHeight(30,30)).toBeUndefined();collision.clear();expect(collision.groundHeight(0,0)).toBeUndefined();
 });
 it('blocks nearby walls while skipping triangle queries for remote meshes',()=>{
  const material=new MeshBasicMaterial({side:DoubleSide}),wall=new Mesh(new BoxGeometry(1,4,6),material),remote=new Mesh(new BoxGeometry(1,4,6),material);
  wall.position.set(3,2,0);remote.position.set(100,2,0);prepare(wall);prepare(remote);
  const remoteQuery=vi.spyOn(remote,'raycast'),collision=new CampusCollision();collision.rebuild([],[wall,remote]);
  expect(collision.distance(new Vector3(0,.9,0),new Vector3(1,0,0),4)).toBeCloseTo(2.5);
  expect(remoteQuery).not.toHaveBeenCalled();expect(collision.distance(new Vector3(0,.9,0),new Vector3(-1,0,0),4)).toBeUndefined();
 });
 it('includes ground for the story camera without turning it into a walking wall',()=>{
  const ground=prepare(new Mesh(new BoxGeometry(20,1,20),new MeshBasicMaterial({side:DoubleSide}))),collision=new CampusCollision();collision.rebuild([ground],[]);
  const eye=new Vector3(0,3,0),down=new Vector3(0,-1,0);
  expect(collision.distance(eye,down,4)).toBeUndefined();expect(collision.distance(eye,down,4,true)).toBeCloseTo(2.5);
 });
});
