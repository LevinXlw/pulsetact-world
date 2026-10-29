import {Group,Object3D,Quaternion,Vector3} from 'three';
import {RIDE_CONTACTS,type RideMode} from './commute-vehicle-model';

/** Retarget the existing seated animation to physical contact points. World
 * directions make this independent of the two avatars' opposite bind axes. */
export function createCharacterRidingPose(root:Group,scene:Object3D){
 const hips=scene.getObjectByName('J_Bip_C_Hips'),spine=scene.getObjectByName('J_Bip_C_Spine'),neck=scene.getObjectByName('J_Bip_C_Neck'),head=scene.getObjectByName('J_Bip_C_Head');
 const base=root.position.clone();let overlay=false;
 const world=new Vector3(),target=new Vector3(),a=new Vector3(),b=new Vector3(),c=new Vector3(),direction=new Vector3(),bend=new Vector3(),elbow=new Vector3(),axis=new Vector3();
 const q=new Quaternion(),parentQ=new Quaternion(),worldQ=new Quaternion(),torsoBaseline=new Quaternion();
 const baseline=new Map<Object3D,{rotation:Quaternion;position:Vector3}>();scene.traverse(o=>{if(o.name.startsWith('J_Bip_')||o.name.startsWith('J_Aim_'))baseline.set(o,{rotation:o.quaternion.clone(),position:o.position.clone()});});
 const restore=()=>{if(!overlay)return;root.position.copy(base);for(const [bone,pose] of baseline){bone.quaternion.copy(pose.rotation);bone.position.copy(pose.position);}overlay=false;root.updateWorldMatrix(true,true);delete root.userData.riding;};
 const limbs=['L','R'].map(side=>({side,
  arm:[scene.getObjectByName(`J_Bip_${side}_UpperArm`),scene.getObjectByName(`J_Bip_${side}_LowerArm`),scene.getObjectByName(`J_Bip_${side}_Hand`)],
  leg:[scene.getObjectByName(`J_Bip_${side}_UpperLeg`),scene.getObjectByName(`J_Bip_${side}_LowerLeg`),scene.getObjectByName(`J_Bip_${side}_Foot`)],
 }));
 function setWorldQuaternion(bone:Object3D,rotation:Quaternion){bone.parent?.getWorldQuaternion(parentQ);bone.quaternion.copy(parentQ.invert()).multiply(rotation);bone.updateWorldMatrix(false,true);}
 function aim(bone:Object3D,child:Object3D,destination:Vector3){
  bone.getWorldPosition(a);child.getWorldPosition(b);direction.copy(destination).sub(a).normalize();b.sub(a).normalize();
  q.setFromUnitVectors(b,direction);bone.getWorldQuaternion(worldQ);worldQ.premultiply(q);setWorldQuaternion(bone,worldQ);
 }
 function solve(chain:(Object3D|undefined)[],contact:Vector3,bendDirection:Vector3){
  const [upper,lower,end]=chain;if(!upper||!lower||!end)return;
  upper.getWorldPosition(a);lower.getWorldPosition(b);end.getWorldPosition(c);
  const length1=a.distanceTo(b),length2=b.distanceTo(c),distance=Math.min(length1+length2-.001,Math.max(Math.abs(length1-length2)+.001,a.distanceTo(contact)));
  direction.copy(contact).sub(a).normalize();target.copy(a).addScaledVector(direction,distance);
  const along=(length1*length1-length2*length2+distance*distance)/(2*distance);
  bend.copy(bendDirection).addScaledVector(direction,-bendDirection.dot(direction)).normalize();
  elbow.copy(a).addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,length1*length1-along*along)));
  // aim() reuses temporary vectors; hold the final hand/foot target separately.
  const tx=target.x,ty=target.y,tz=target.z;
  aim(upper,lower,elbow);target.set(tx,ty,tz);aim(lower,end,target);
 }
 return{apply:(mode:RideMode,time:number)=>{
  // AnimationMixer can skip writing an unchanged constant track. Restore the
  // previous animation pose before each overlay, so leaning never accumulates.
  restore();base.copy(root.position);for(const [bone,pose] of baseline){pose.rotation.copy(bone.quaternion);pose.position.copy(bone.position);}overlay=true;
  const actor=root.parent;if(!actor||!hips)return;const contact=RIDE_CONTACTS[mode],bob=mode==='broom'?Math.sin(time*2.4)*.022:0;
  root.updateWorldMatrix(true,true);hips.getWorldPosition(world);actor.worldToLocal(world);
  root.position.x+=contact.hip[0]-world.x;root.position.y+=contact.hip[1]+bob-world.y;root.position.z+=contact.hip[2]-world.z;root.updateWorldMatrix(true,true);
  let appliedLean=0;
  if(spine){
   spine.getWorldQuaternion(torsoBaseline);axis.set(1,0,0).transformDirection(actor.matrixWorld);
   // The avatars have different arm-to-torso proportions. Pick the smallest
   // forward lean that reaches both grips, rather than stretching their arms.
   for(let angle=mode==='motorcycle'?.63:.60;angle<=1.08;angle+=.075){
    appliedLean=angle;q.setFromAxisAngle(axis,angle);worldQ.copy(torsoBaseline).premultiply(q);setWorldQuaternion(spine,worldQ);
    let reachable=true;
    for(let i=0;i<limbs.length;i++){const [upper,lower,hand]=limbs[i].arm;if(!upper||!lower||!hand)continue;upper.getWorldPosition(a);lower.getWorldPosition(b);hand.getWorldPosition(c);world.fromArray(contact.hands[i]);world.y+=bob;actor.localToWorld(world);if(a.distanceTo(world)>a.distanceTo(b)+b.distanceTo(c)-.015)reachable=false;}
    if(reachable)break;
   }
  }
  // A rider leans the torso towards the grips but keeps looking ahead. Split
  // compensation across neck and head rather than making one sharp neck kink.
  if(appliedLean){
   axis.set(1,0,0).transformDirection(actor.matrixWorld);
   for(const [bone,weight] of [[neck,.60],[head,.30]] as const){if(!bone)continue;bone.getWorldQuaternion(worldQ);q.setFromAxisAngle(axis,-appliedLean*weight);worldQ.premultiply(q);setWorldQuaternion(bone,worldQ);}
  }
  for(let i=0;i<limbs.length;i++){
   const limb=limbs[i],sign=i===0?1:-1;
   world.fromArray(contact.hands[i]);world.y+=bob;actor.localToWorld(world);
   axis.set(sign*.5,-1,-.1).transformDirection(actor.matrixWorld);solve(limb.arm,world,axis);
   // Pixiv's auxiliary shirt bones are siblings of the arm, so they must
   // follow the same shoulder change rather than leaving a seated sleeve.
   const upper=limb.arm[0];if(upper){for(const name of [`J_Aim_${limb.side}_Shoulder`,`J_Aim_${limb.side}_TopsUpperArm`]){const sleeve=scene.getObjectByName(name);if(sleeve&&sleeve.parent===upper.parent){sleeve.quaternion.copy(upper.quaternion);sleeve.updateWorldMatrix(false,true);}}}
   world.fromArray(contact.feet[i]);world.y+=bob;actor.localToWorld(world);axis.set(sign*.25,.1,1).transformDirection(actor.matrixWorld);solve(limb.leg,world,axis);
   const thigh=limb.leg[0],clothing=scene.getObjectByName(`J_Aim_${limb.side}_UpperLeg`);if(thigh&&clothing&&clothing.parent===thigh.parent){clothing.quaternion.copy(thigh.quaternion);clothing.updateWorldMatrix(false,true);}
  }
  root.userData.riding=mode;
 },restore,reset:restore};
}
