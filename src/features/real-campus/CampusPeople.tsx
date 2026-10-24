import {useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {Group} from 'three';
import {RealisticPerson} from './RealisticPerson';
import {sampleCampusWalker,campusWalkerInitialDistance,campusSophiaPosition,campusSophiaYaw,campusWalkingSpeed} from './campus-people';

export function CampusPeople({height,paused,reduced}:{height:(x:number,z:number)=>number|undefined;paused:boolean;reduced:boolean}){
 const walker=useRef<Group>(null),distance=useRef(campusWalkerInitialDistance);
 const start=sampleCampusWalker(campusWalkerInitialDistance),standing=campusSophiaPosition;
 useFrame((_,delta)=>{
  if(!walker.current)return;
  // Advance both the path and the mocap only while the scene is active.
  if(!paused&&!reduced&&!document.hidden)distance.current+=Math.min(delta,.05)*campusWalkingSpeed;
  const sample=sampleCampusWalker(distance.current),[x,z]=sample.position;
  walker.current.position.set(x,height(x,z)??0,z);walker.current.rotation.y=sample.yaw;
 });
 return <group name="campus-people">
  <group ref={walker} name="campus-walker" position={[start.position[0],height(...start.position)??0,start.position[1]]} rotation={[0,start.yaw,0]}>
   <RealisticPerson person="nathan" walking paused={paused} reduced={reduced}/>
  </group>
  <group name="campus-standing-person" position={[standing[0],height(...standing)??0,standing[1]]} rotation={[0,campusSophiaYaw,0]}>
   <RealisticPerson person="sophia" paused={paused} reduced={reduced}/>
  </group>
 </group>;
}
