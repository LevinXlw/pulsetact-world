import {useEffect,useState} from 'react';
import {useFrame} from '@react-three/fiber';
import {createCommuteVehicle,type RideMode} from './commute-vehicle-model';

export function CommuteVehicle({mode,moving=false,speedRef}:{mode:RideMode;moving?:boolean;speedRef?:{current:number}}){
 const [model,setModel]=useState<ReturnType<typeof createCommuteVehicle>|null>(null);
 useEffect(()=>{const owned=createCommuteVehicle(mode);setModel(owned);return()=>owned.dispose();},[mode]);
 useFrame(({clock},dt)=>model?.update(dt,moving?(speedRef?.current??7):0,clock.elapsedTime));
 return model?<primitive object={model.root} dispose={null}/>:null;
}
