import {describe,expect,it,vi} from 'vitest';
import {Mesh,Vector3} from 'three';
import {createCommuteVehicle,RIDE_CONTACTS} from '../src/features/world/commute-vehicle-model';
describe('rideable commute assets',()=>{
 for(const mode of ['motorcycle','broom'] as const)it(`keeps ${mode} geometry finite and grounded within a bounded mobile budget`,()=>{
  const built=createCommuteVehicle(mode);let meshes=0;
  built.root.traverse(o=>{if(!(o instanceof Mesh))return;meshes++;for(const n of o.geometry.attributes.position.array)expect(Number.isFinite(n)).toBe(true);});
  expect(meshes).toBeLessThan(26);expect(built.root.userData.commute.triangles).toBeLessThan(50000);
  const size=built.bounds.getSize(new Vector3());expect(size.z).toBeGreaterThan(1.8);expect(size.z).toBeLessThan(2.6);expect(size.x).toBeLessThan(.95);
  expect(built.bounds.min.y).toBeGreaterThan(-.005);
  if(mode==='motorcycle'){expect(built.bounds.min.y).toBeLessThan(.01);expect(built.wheels).toHaveLength(2);expect(built.wheels[1].position.z-built.wheels[0].position.z).toBeCloseTo(1.45);}
  else expect(built.bounds.min.y).toBeGreaterThan(.6);
  expect(RIDE_CONTACTS[mode].hip[1]).toBeGreaterThan(built.bounds.min.y);
  console.log(mode,built.root.userData.commute);built.dispose();
 });
 it('rolls wheels with actual speed and disposes shared geometry/materials once',()=>{
  const built=createCommuteVehicle('motorcycle'),wheel=built.wheels[0],materials=new Set();let geometryCount=0;
  built.root.traverse(o=>{if(!(o instanceof Mesh))return;o.geometry.addEventListener('dispose',()=>geometryCount++);materials.add(o.material);});
  const calls=[...materials].map(m=>vi.spyOn(m as any,'dispose'));
  built.update(.05,0,1);expect(wheel.rotation.x).toBe(0);built.update(.05,8,1.05);expect(wheel.rotation.x).toBeCloseTo(.4/.335);
  const meshCount=built.root.userData.commute.meshes;built.dispose();built.dispose();expect(geometryCount).toBe(meshCount);calls.forEach(spy=>expect(spy).toHaveBeenCalledTimes(1));expect(built.root.children).toHaveLength(0);
 });
});
