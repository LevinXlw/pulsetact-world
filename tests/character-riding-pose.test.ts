import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Box3,Group,Object3D,Quaternion,Vector3} from 'three';
import {createCharacterRidingPose} from '../src/features/world/character-riding-pose';
import {RIDE_CONTACTS} from '../src/features/world/commute-vehicle-model';
function skeleton(id:string){
 const bytes=readFileSync(`public/assets/characters/mobile/${id}.glb`),jsonLength=bytes.readUInt32LE(12),doc=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
 const nodes=doc.nodes.map((n:any)=>{const o=new Object3D();o.name=n.name;if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
 doc.nodes.forEach((n:any,i:number)=>n.children?.forEach((child:number)=>nodes[i].add(nodes[child])));
 const scene=new Group();doc.scenes[doc.scene??0].nodes.forEach((index:number)=>scene.add(nodes[index]));scene.updateMatrixWorld(true);
 const bounds=new Box3();doc.nodes.forEach((n:any,i:number)=>{if(n.mesh===undefined)return;for(const p of doc.meshes[n.mesh].primitives){const a=doc.accessors[p.attributes.POSITION];for(const x of [a.min[0],a.max[0]])for(const y of [a.min[1],a.max[1]])for(const z of [a.min[2],a.max[2]])bounds.expandByPoint(new Vector3(x,y,z).applyMatrix4(nodes[i].matrixWorld));}});
 const root=new Group(),actor=new Group();root.scale.setScalar(1.75/(bounds.max.y-bounds.min.y));root.position.y=-bounds.min.y*root.scale.y;root.rotation.y=Math.PI;root.add(scene);actor.add(root);
 const pose=createCharacterRidingPose(root,scene);
 const animate=(name:string)=>{const clip=doc.animations.find((a:any)=>a.name===name);for(const channel of clip.channels){const sampler=clip.samplers[channel.sampler],accessor=doc.accessors[sampler.output],view=doc.bufferViews[accessor.bufferView],offset=28+jsonLength+(view.byteOffset??0)+(accessor.byteOffset??0),values=Array.from({length:channel.target.path==='rotation'?4:3},(_,i)=>bytes.readFloatLE(offset+i*4));const object=nodes[channel.target.node];if(channel.target.path==='translation')object.position.fromArray(values);else if(channel.target.path==='rotation')object.quaternion.fromArray(values);else if(channel.target.path==='scale')object.scale.fromArray(values);}actor.updateMatrixWorld(true);};
 const point=(name:string)=>scene.getObjectByName(name)!.getWorldPosition(new Vector3());
 return{root,scene,actor,pose,animate,point};
}
describe('actual avatar riding skeletons',()=>{
 for(const id of ['pixiv','sakurada'])for(const mode of ['motorcycle','broom'] as const)it(`${id} ${mode} holds physical contacts without a cumulative pose over stationary frames`,()=>{
  const s=skeleton(id);s.animate('Seated');const beforeHead=s.scene.getObjectByName('J_Bip_C_Head')!.getWorldQuaternion(new Quaternion());const beforeRoot=s.root.position.clone(),beforeSpine=s.scene.getObjectByName('J_Bip_C_Spine')!.quaternion.clone();s.pose.apply(mode,0);s.actor.updateMatrixWorld(true);
  const snapshot=s.scene.children.map(o=>o.matrixWorld.toArray()),firstSpine=s.scene.getObjectByName('J_Bip_C_Spine')!.quaternion.clone();
  expect(s.scene.getObjectByName('J_Bip_C_Head')!.getWorldQuaternion(new Quaternion()).angleTo(beforeHead)).toBeLessThan(.16);
  expect(s.point('J_Bip_C_Hips').distanceTo(new Vector3(...RIDE_CONTACTS[mode].hip))).toBeLessThan(.0001);
  for(let frame=0;frame<240;frame++){s.pose.restore();s.pose.apply(mode,0);}
  expect(s.scene.getObjectByName('J_Bip_C_Spine')!.quaternion.angleTo(firstSpine)).toBeLessThan(.000001);expect(s.scene.children.map(o=>o.matrixWorld.toArray())).toEqual(snapshot);
  for(const [index,side] of ['L','R'].entries()){
   expect(s.point(`J_Bip_${side}_Hand`).distanceTo(new Vector3(...RIDE_CONTACTS[mode].hands[index]))).toBeLessThan(.09);
   expect(s.point(`J_Bip_${side}_Foot`).distanceTo(new Vector3(...RIDE_CONTACTS[mode].feet[index]))).toBeLessThan(.035);
   expect(Math.sign(s.point(`J_Bip_${side}_Foot`).x)).toBe(index===0?1:-1);
  }
  s.pose.reset();expect(s.root.position.distanceTo(beforeRoot)).toBeLessThan(.000001);expect(s.scene.getObjectByName('J_Bip_C_Spine')!.quaternion.angleTo(beforeSpine)).toBeLessThan(.000001);
  s.animate('Idle');expect(s.point('J_Bip_C_Hips').y).toBeGreaterThan(.85);expect(s.root.position.distanceTo(beforeRoot)).toBeLessThan(.000001);
 });
});
