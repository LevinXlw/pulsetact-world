import {useEffect,useRef,useState} from 'react';
import {useFrame} from '@react-three/fiber';
import {AnimationMixer,Group,Mesh,SkinnedMesh,type AnimationAction,type AnimationClip,type Skeleton} from 'three';
import {GLTFLoader,type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

export type PersonId='nathan'|'sophia';
export type RealisticPersonProps={
 person:PersonId;
 /** Omit for ambient characters to play their supplied animation. */
 walking?:boolean;
 paused?:boolean;
 reduced?:boolean;
 playbackRate?:number;
 /** Initial animation offset in seconds, so nearby people need not move in sync. */
 timeOffset?:number;
 onLoad?:(scene:Group)=>void;
 onError?:(message:string)=>void;
};

// These two immutable source assets are shared for the lifetime of the page.
// Each rendered person owns a separate skeleton and mixer, but not the textures.
const sources=new Map<PersonId,Promise<GLTF>>();
function loadPerson(person:PersonId){
 const cached=sources.get(person);if(cached)return cached;
 const pending=fetch(`/assets/people/${person}.glb`).then(response=>{
  if(!response.ok)throw new Error(`${person} 人物模型加载失败 (${response.status})`);
  return response.arrayBuffer();
 }).then(bytes=>new GLTFLoader().parseAsync(bytes,'/assets/people/'));
 sources.set(person,pending);
 void pending.catch(()=>{if(sources.get(person)===pending)sources.delete(person);});
 return pending;
}

type PersonInstance={
 person:PersonId;scene:Group;mixer:AnimationMixer;clips:AnimationClip[];
 action:AnimationAction|null;poseOnly:boolean;skeletons:Set<Skeleton>;
};

function setMotion(instance:PersonInstance,walking:boolean|undefined,timeOffset:number,immediate:boolean){
 const preferred=walking===undefined?undefined:instance.clips.find(clip=>(walking?/walk|locomotion/i:/idle|stand|breath/i).test(clip.name));
 const clip=preferred||instance.clips[0];
 const poseOnly=walking===false&&!preferred;
 if(!clip){instance.poseOnly=true;return;}
 if(instance.action?.getClip()!==clip){
  const previous=instance.action,action=instance.mixer.clipAction(clip);
  action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  action.time=clip.duration>0?((timeOffset%clip.duration)+clip.duration)%clip.duration:0;
  if(previous&&!immediate){previous.fadeOut(.2);action.fadeIn(.2);}else previous?.stop();
  instance.action=action;
 }else if(poseOnly&&!instance.poseOnly){
  // A single walk-only asset can still stop without falling back to its bind pose.
  instance.action.time=clip.duration>0?((timeOffset%clip.duration)+clip.duration)%clip.duration:0;
 }
 instance.poseOnly=poseOnly;
 if(immediate){
  instance.clips.forEach(other=>{if(other!==clip)instance.mixer.existingAction(other)?.stop();});
  instance.action!.stopFading().setEffectiveWeight(1);
 }
 instance.mixer.update(0);
 instance.scene.updateMatrixWorld(true);
 const state=instance.scene.userData.realisticPerson;
 state.clip=clip.name;state.poseOnly=poseOnly;state.time=instance.action!.time;
}

function releasePerson(instance:PersonInstance){
 instance.mixer.stopAllAction();
 instance.mixer.uncacheRoot(instance.scene);
 instance.skeletons.forEach(skeleton=>skeleton.dispose());
 // Geometry, materials and texture maps belong to the shared source cache.
}

export function RealisticPerson(props:RealisticPersonProps){
 const {person,walking,timeOffset=0,paused=false,reduced=false}=props;
 const live=useRef(props);live.current=props;
 const [loaded,setLoaded]=useState<PersonInstance|null>(null);
 const instance=loaded?.person===person?loaded:null;

 useEffect(()=>{
  let cancelled=false,owned:PersonInstance|null=null;
  setLoaded(null);
  void loadPerson(person).then(source=>{
   if(cancelled)return;
   const scene=clone(source.scene) as Group,skeletons=new Set<Skeleton>();
   scene.name=`RealisticPerson:${person}`;
   scene.userData.realisticPerson={person,ready:true,clip:null,time:0,paused:!!live.current.paused,reduced:!!live.current.reduced,poseOnly:false};
   scene.userData.collision='none';
   scene.traverse(object=>{
    if(object instanceof Mesh){object.castShadow=true;object.receiveShadow=true;object.userData.collision='none';}
    if(object instanceof SkinnedMesh){
     skeletons.add(object.skeleton);
     // A bind-pose bounding box can cut off animated limbs at the screen edge.
     object.frustumCulled=false;
    }
   });
   owned={person,scene,mixer:new AnimationMixer(scene),clips:source.animations,action:null,poseOnly:false,skeletons};
   // Evaluate a real animation pose before mounting, including when already paused.
   const current=live.current;
   setMotion(owned,current.reduced&&current.walking===true?false:current.walking,current.timeOffset??0,true);
   setLoaded(owned);
   live.current.onLoad?.(scene);
  }).catch(error=>{
   if(!cancelled)live.current.onError?.(error instanceof Error?error.message:`${person} 人物模型加载失败`);
  });
  return()=>{cancelled=true;if(owned)releasePerson(owned);};
 },[person]);

 useEffect(()=>{
  // Pausing preserves the exact pose. Reduced motion uses a standing pose when
  // available, rather than leaving a moving character balanced on a raised foot.
  if(instance&&!paused)setMotion(instance,reduced&&walking===true?false:walking,timeOffset,reduced);
 },[instance,walking,timeOffset,paused,reduced]);

 useFrame((_,delta)=>{
  if(!instance)return;
  const current=live.current,state=instance.scene.userData.realisticPerson;
  state.paused=!!current.paused;state.reduced=!!current.reduced;
  const rate=current.playbackRate??1;
  if(!current.paused&&!current.reduced&&!document.hidden&&!instance.poseOnly&&Number.isFinite(rate)&&rate>0){
   instance.mixer.update(Math.min(delta,.05)*rate);
  }
  state.time=instance.action?.time??0;
 });

 return instance?<primitive object={instance.scene} dispose={null}/>:null;
}
