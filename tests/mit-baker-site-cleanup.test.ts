import {describe,it,expect} from 'vitest';
import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial} from 'three';
import {replaceBakerSurveyPlanters} from '../src/features/world/mit-baker-site-cleanup';

function fixture(){
 const points=[-294,3,243,-293,3,243,-294,3,244, // Old low planter.
  -294,7,243,-293,7,243,-294,7,244, // Building above this envelope.
  -294,3,243,-240,3,243,-294,3,244, // Boundary-crossing source face.
  -294,3,243,-293,3,243,-294,3,244]; // Unrelated material in same mesh.
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setIndex(Array.from({length:12},(_,i)=>i));geometry.addGroup(0,9,0);geometry.addGroup(9,3,1);
 const mesh=new Mesh(geometry,[new MeshStandardMaterial({name:'Cambridge buildings (untextured)'}),new MeshStandardMaterial({name:'2025 orthophotography'})]);
 const base=new Group();base.add(mesh);const replacement=new Group();replacement.userData.bakerNorthCourt=true;return {base,replacement,geometry};
}
describe('Baker survey planter replacement',()=>{
 it('preserves source geometry when the new courtyard has not loaded',()=>{
  const f=fixture();expect(replaceBakerSurveyPlanters(f.base)).toBe(0);expect(f.geometry.index!.count).toBe(12);
  expect(replaceBakerSurveyPlanters(f.base,new Group())).toBe(0);
 });
 it('removes only replaced low shells and preserves tall/boundary/other material faces',()=>{
  const f=fixture(),positions=Array.from(f.geometry.attributes.position.array);
  expect(replaceBakerSurveyPlanters(f.base,f.replacement)).toBe(1);
  expect(Array.from(f.geometry.index!.array)).toEqual([3,4,5,6,7,8,9,10,11]);
  expect(f.geometry.groups).toEqual([{start:0,count:6,materialIndex:0},{start:6,count:3,materialIndex:1}]);
  expect(Array.from(f.geometry.attributes.position.array)).toEqual(positions);
  expect(replaceBakerSurveyPlanters(f.base,f.replacement)).toBe(0);
 });
});
