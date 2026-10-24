import {useEffect,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {DoubleSide,type Group} from 'three';
import {CDS_DOORS,type CDSDoorId} from './cds-door-layout';
import {BU_CDS_MAP_FEATURE,BU_CDS_YAW} from './bu-landmark-layout';
import {buElevation} from './bu-terrain';

type Props={
 inside:boolean;
 activeDoor:CDSDoorId|null;
 openingDoor:CDSDoorId|null;
 onOpened?:()=>void;
};
const OPEN_SECONDS=.72;
const OPEN_ANGLE=80*Math.PI/180;

function DoorLeaf({side}:{side:-1|1}){
 const center=-side*.685;
 return <group>
  <mesh position={[center,1.325,0]}>
   <boxGeometry args={[1.298,2.41,.025]}/>
   <meshStandardMaterial color="#a7c0c1" transparent opacity={.24} roughness={.19} metalness={.08} side={DoubleSide} depthWrite={false}/>
  </mesh>
  {[0,-side*1.37].map((x,index)=><mesh key={`stile-${index}`} position={[x,1.325,0]}>
   <boxGeometry args={[.036,2.65,.055]}/>
   <meshStandardMaterial color="#364043" metalness={.68} roughness={.34}/>
  </mesh>)}
  {[{y:.07,height:.14},{y:2.6,height:.10}].map(({y,height})=><mesh key={y} position={[center,y,0]}>
   <boxGeometry args={[1.37,height,.055]}/>
   <meshStandardMaterial color="#364043" metalness={.68} roughness={.34}/>
  </mesh>)}
  {[-1,1].map(face=><group key={face} position={[-side*1.24,1.0,face*.07]}>
   <mesh><cylinderGeometry args={[.018,.018,.56,8]}/><meshStandardMaterial color="#a7adab" metalness={.86} roughness={.25}/></mesh>
   {[-.2,.2].map(y=><mesh key={y} position={[0,y,-face*.025]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.012,.012,.05,6]}/><meshStandardMaterial color="#8e9998" metalness={.8} roughness={.3}/></mesh>)}
  </group>)}
 </group>;
}

function DoubleDoor({id,x,z,inside,active,opening,onOpened}:{id:CDSDoorId;x:number;z:number;inside:boolean;active:boolean;opening:boolean;onOpened?:()=>void}){
 const left=useRef<Group>(null),right=useRef<Group>(null);
 const progress=useRef(0),completed=useRef(false),callback=useRef(onOpened);
 callback.current=onOpened;
 useEffect(()=>{progress.current=0;completed.current=false;if(left.current)left.current.rotation.y=0;if(right.current)right.current.rotation.y=0;},[opening]);
 useFrame((_state,delta)=>{
  if(!opening||completed.current)return;
  if(document.hidden)return;
  progress.current=Math.min(1,progress.current+Math.min(delta,.05)/OPEN_SECONDS);
  const eased=progress.current*progress.current*(3-2*progress.current);
  const angle=eased*OPEN_ANGLE*(inside?-1:1);
  if(left.current)left.current.rotation.y=angle;
  if(right.current)right.current.rotation.y=-angle;
  if(progress.current>=1){completed.current=true;callback.current?.();}
 });
 return <group name={`cds-${inside?'inside':'outside'}-door-${id}`} position={[x,inside?0:.15,z]}>
  <group name={`cds-door-${id}-left`} ref={left} position={[-1.41,0,0]}><DoorLeaf side={-1}/></group>
  <group name={`cds-door-${id}-right`} ref={right} position={[1.41,0,0]}><DoorLeaf side={1}/></group>
  {inside&&<group>
   {[-1.455,1.455].map(x=><mesh key={x} position={[x,1.4,0]}><boxGeometry args={[.07,2.8,.11]}/><meshStandardMaterial color="#303a3e" metalness={.55} roughness={.4}/></mesh>)}
   <mesh position={[0,2.76,0]}><boxGeometry args={[2.98,.08,.11]}/><meshStandardMaterial color="#303a3e" metalness={.55} roughness={.4}/></mesh>
  </group>}
  {active&&<mesh position={[0,inside?.012:-.138,inside?-.34:.34]} rotation={[-Math.PI/2,0,0]}>
   <planeGeometry args={[1.45,.055]}/>
   <meshBasicMaterial color="#dbc7a0" transparent opacity={.72} depthWrite={false}/>
  </mesh>}
 </group>;
}

/** Door leaves use the CDS authored local metre frame. The exterior wrapper
 * follows the same transform as the complete CDS building. */
export function CDSDoors({inside,activeDoor,openingDoor,onOpened}:Props){
 return <group name="cds-interactive-doors" position={inside?[0,0,0]:[BU_CDS_MAP_FEATURE.x,buElevation(BU_CDS_MAP_FEATURE.x,BU_CDS_MAP_FEATURE.z),BU_CDS_MAP_FEATURE.z]} rotation={[0,inside?0:BU_CDS_YAW,0]}>
  {CDS_DOORS.map(door=><DoubleDoor key={door.id} id={door.id} x={door.local[0]} z={door.local[1]-(inside?.015:.22)} inside={inside} active={activeDoor===door.id} opening={openingDoor===door.id} onOpened={onOpened}/>)}
 </group>;
}
