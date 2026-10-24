import {describe,expect,it} from 'vitest';
import {Raycaster,Vector3} from 'three';
import {createMITResidenceStreets} from '../src/features/world/mit-residence-streets';
import {MIT_RESIDENCE_PLACES} from '../src/features/world/mit-residence-layout';
describe('MIT terrain-following residence paving',()=>{
 it('faces upward, receives downward ground rays and follows a sloping source',()=>{
  const height=(x:number,z:number)=>3+x*.001+z*.002,built=createMITResidenceStreets(height);built.group.updateMatrixWorld(true);
  for(const mesh of built.ground){const normal=mesh.geometry.getAttribute('normal');for(let i=0;i<normal.count;i++)expect(normal.getY(i)).toBeGreaterThan(.99);}
  for(const point of Object.values(MIT_RESIDENCE_PLACES)){const ray=new Raycaster(new Vector3(point[0],50,point[1]),new Vector3(0,-1,0));const hit=ray.intersectObjects(built.ground)[0];expect(hit).toBeDefined();expect(hit.point.y).toBeCloseTo(height(...point)+.025,4);}
 });
 it('does not invent geometry where terrain is absent',()=>{const built=createMITResidenceStreets(()=>undefined);expect(built.ground).toHaveLength(0);expect(built.group.children).toHaveLength(0);});
});
