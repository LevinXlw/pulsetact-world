import {humanViews,type Inspection} from './inspection';
import {RealismEffects} from './RealismEffects';
import {useEffect,useRef,useState} from 'react';
import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {Group,Mesh,Vector3,PerspectiveCamera,CubeCamera,WebGLCubeRenderTarget,PMREMGenerator,HalfFloatType,MeshStandardMaterial,DirectionalLight,ACESFilmicToneMapping} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Character} from '../../world/Character';
import {useStore} from '../../state/store';
import type {Position} from '../../types';
import {insideCampus,localTargets,type CampusManifest} from './local-data';
import {openPortico} from './portico';
import {loadKillianDetail,disposeDetail} from './killian-detail';
import {approach,turnTowards,traversal} from './traversal';
import {applyCampusSurfaces,tintCampusBuildings,extractSurveyedBridge} from './campus-surfaces';
import {isCampusWater} from './environment';
import {CampusSky} from './CampusSky';
import {CampusCollision} from './campus-collision';
import {stroll,strollStart,clampPitch,type CampusMode} from './stroll-controls';
import {courtyardLighting} from './courtyard-lighting';
export type LocalSceneApi={focus:(p:Position)=>void;home:()=>void;capture:()=>Promise<Blob>};
type Props={data:CampusManifest;mode:CampusMode;paused:boolean;presentation?:boolean;inspection?:Inspection|null;detail?:boolean;quality?:'standard'|'low';objective?:Position;onReady:(api:LocalSceneApi)=>void;onError:(message:string)=>void;onPosition:(p:Position)=>void;onVegetationStatus?:(status:string)=>void;onInteract:()=>void};
function World(props:Props){
 const {data,mode,paused,onReady,onError,onPosition}=props;
 const {camera,gl,scene}=useThree(),[model,setModel]=useState<Group|null>(null),[walking,setWalking]=useState(false);
 const avatar=useStore(s=>s.save.profile.avatar),reduced=useStore(s=>s.save.settings.reducedMotion);
 const actor=useRef<Group>(null),controls=useRef<OrbitControls|null>(null),keys=useRef(new Set<string>());
 const point=useRef(new Vector3(data.spawn[0],0,data.spawn[1])),ground=useRef<Mesh[]>([]),walls=useRef<Mesh[]>([]);
 const collision=useRef(new CampusCollision()),last=useRef(0),live=useRef(props);live.current=props;
 const sun=useRef<DirectionalLight>(null);
 const speed=useRef(0),desiredCamera=useRef<Vector3|null>(null);
 const strollPoint=useRef<Position>(strollStart(data.campus,data.spawn,!!props.detail)),storyPoint=useRef<Position>([...data.spawn]),previousMode=useRef<CampusMode|null>(null);
 const look=useRef({yaw:0,pitch:0}),drag=useRef<{id:number;x:number;y:number}|null>(null);
 const scratch=useRef({forward:new Vector3(),right:new Vector3(),direction:new Vector3(),next:new Vector3(),origin:new Vector3(),follow:new Vector3(),offset:new Vector3(),savedCamera:new Vector3(),position:[0,0] as Position});
 const height=(x:number,z:number)=>collision.current.groundHeight(x,z);
 const applyStrollCamera=()=>{const {yaw,pitch}=look.current;camera.position.copy(point.current);camera.position.y+=stroll.eyeHeight;camera.rotation.set(pitch,yaw,0,'YXZ');controls.current?.target.copy(point.current).setY(point.current.y+stroll.eyeHeight);};
 useEffect(()=>{
  const abort=new AbortController();let owned:Group|null=null;
  void fetch(`/data/campuses/${data.campus}/campus.glb`,{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error('本地模型文件未找到');return r.arrayBuffer();}).then(b=>new GLTFLoader().parseAsync(b,'')).then(async g=>{
   if(data.campus==='mit'&&props.detail){try{const detail=await loadKillianDetail(abort.signal,{quality:live.current.quality});tintCampusBuildings(g.scene,data.models||[],detail.userData.sourceModels);extractSurveyedBridge(g.scene,data.models||[]);g.scene.userData.detailLayer=detail;g.scene.userData.environment=detail.userData.environment;g.scene.userData.waterTime=detail.userData.waterTime;g.scene.userData.openingTrianglesRemoved=openPortico(g.scene,detail.userData.porticoOpening,detail.userData.dome,detail.userData.courtyardFacades);applyCampusSurfaces(g.scene,detail,data.radius);g.scene.add(detail);}catch(e){disposeDetail(g.scene);throw e;}}
   if(abort.signal.aborted){disposeDetail(g.scene);return;}owned=g.scene;
   g.scene.traverse(o=>{if(o instanceof Mesh){o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();const m=Array.isArray(o.material)?o.material[0]:o.material;if(o.userData.collision!=='none')o.castShadow=!m.name.includes('orthophotography')&&!['grass','pavement','steps','porticoFloor','water','road','courtCurb','pavingJoint'].includes(m.name);o.receiveShadow=true;if('map' in m&&m.map)(m.map as import('three').Texture).anisotropy=8;if(o.userData.collision!=='none'&&!m.name.startsWith('leaf')&&!['trim','metal','glass','water','roadMarking'].includes(m.name))(o.userData.collision==='ground'||m.name.includes('orthophotography')||['grass','pavement','steps','porticoFloor','road','courtCurb','bridgeDeck','bridgeWalk','arterial','surveyedBridge'].includes(m.name)?ground.current:walls.current).push(o);}});
   g.scene.updateMatrixWorld(true);collision.current.rebuild(ground.current,walls.current);point.current.y=height(point.current.x,point.current.z)??0;setModel(g.scene);
  }).catch(e=>{if(!abort.signal.aborted)onError(e instanceof Error?e.message:'模型加载失败');});
  return()=>{abort.abort();if(owned)disposeDetail(owned);ground.current=[];walls.current=[];collision.current.clear();};
 },[data.campus,props.detail]);
 useEffect(()=>{model?.userData.detailLayer?.userData.vegetation?.userData.setQuality?.(props.quality||'standard');},[model,props.quality]);
 // Bake the loaded courtyard once. This probe has no network dependency or per-frame cost.
 useEffect(()=>{
  if(!model||data.campus!=='mit'||!props.detail)return;
  const glass:Mesh[]=[],materials=new Set<MeshStandardMaterial>();
  model.traverse(o=>{if(o instanceof Mesh){const m=o.material as MeshStandardMaterial;if(['glass','porticoGlass','doorGlass','courtyardGlass'].includes(m.name)){glass.push(o);materials.add(m);}}});
  const cube=new WebGLCubeRenderTarget(256,{type:HalfFloatType}),probe=new CubeCamera(.2,1500,cube),pmrem=new PMREMGenerator(gl);
  probe.position.set(27,12,-4);
  const visible=glass.map(o=>o.visible);
  let reflection:ReturnType<PMREMGenerator['fromCubemap']>|undefined;
  try{glass.forEach(o=>{o.visible=false;});scene.updateMatrixWorld(true);probe.update(gl,scene);reflection=pmrem.fromCubemap(cube.texture);
   materials.forEach(m=>{m.envMap=reflection!.texture;m.envMapIntensity=m.name==='glass'?1.4:1.1;if(m.name==='glass'){m.color.set('#2b3538');m.metalness=.05;m.roughness=.22;}m.needsUpdate=true;});
  }finally{glass.forEach((o,i)=>{o.visible=visible[i];});cube.dispose();pmrem.dispose();}
  return()=>{materials.forEach(m=>{m.envMap=null;});reflection?.dispose();};
 },[model,data.campus,props.detail,gl,scene]);
 useEffect(()=>{
  const c=new OrbitControls(camera,gl.domElement);controls.current=c;c.enableDamping=true;c.dampingFactor=.09;c.maxPolarAngle=Math.PI*.82;c.minDistance=7;c.maxDistance=650;
  const clear=()=>{keys.current.clear();speed.current=0;drag.current=null;};
  const down=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(/INPUT|TEXTAREA|SELECT/.test(target?.tagName)||target?.isContentEditable||e.ctrlKey||e.metaKey||e.altKey||live.current.paused)return;
   if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(e.key.toLowerCase())){e.preventDefault();keys.current.add(e.key.toLowerCase());}
   if(e.key.toLowerCase()==='e'&&!e.repeat&&live.current.mode==='walk'&&!live.current.presentation)live.current.onInteract();};
  const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());
  const start=(e:PointerEvent)=>{if(live.current.mode!=='stroll'||live.current.paused||e.button!==0)return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};gl.domElement.setPointerCapture(e.pointerId);};
  const move=(e:PointerEvent)=>{const previous=drag.current;if(!previous||previous.id!==e.pointerId||live.current.paused)return;look.current.yaw-=(e.clientX-previous.x)*stroll.lookSensitivity;look.current.pitch=clampPitch(look.current.pitch-(e.clientY-previous.y)*stroll.lookSensitivity);previous.x=e.clientX;previous.y=e.clientY;};
  const end=()=>{drag.current=null;};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);
  gl.domElement.addEventListener('pointerdown',start);gl.domElement.addEventListener('pointermove',move);gl.domElement.addEventListener('pointerup',end);gl.domElement.addEventListener('pointercancel',end);gl.domElement.addEventListener('lostpointercapture',end);
  return()=>{c.dispose();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);gl.domElement.removeEventListener('pointerdown',start);gl.domElement.removeEventListener('pointermove',move);gl.domElement.removeEventListener('pointerup',end);gl.domElement.removeEventListener('pointercancel',end);gl.domElement.removeEventListener('lostpointercapture',end);};
 },[camera,gl]);
 useEffect(()=>{if(paused){keys.current.clear();speed.current=0;drag.current=null;}},[paused]);
 useEffect(()=>{
  if(!model||!controls.current)return;const c=controls.current;c.enabled=mode!=='stroll'&&!paused;c.enablePan=mode==='orbit';c.minDistance=mode==='orbit'?(props.inspection==='sampledoor'?2:7):2.5;c.maxDistance=mode==='orbit'?650:12;desiredCamera.current=null;keys.current.clear();speed.current=0;drag.current=null;
  if(previousMode.current==='walk')storyPoint.current=[point.current.x,point.current.z];
  if(previousMode.current==='stroll')strollPoint.current=[point.current.x,point.current.z];
  if(mode==='walk'){const p=storyPoint.current;point.current.set(p[0],height(...p)??0,p[1]);}
  if(mode==='stroll'){const p=strollPoint.current;point.current.set(p[0],height(...p)??0,p[1]);}
  const aimStroll=()=>{const target=data.campus==='mit'?[12.9043,-34.5789]:data.points['harvard-widener']||data.spawn;look.current.yaw=Math.atan2(point.current.x-target[0],point.current.z-target[1]);look.current.pitch=data.campus==='mit'?.085:0;applyStrollCamera();};
  const focus=(p:Position)=>{const y=height(...p)??0;desiredCamera.current=null;if(mode==='stroll'){point.current.set(p[0],y,p[1]);aimStroll();return;}c.target.set(p[0],y+1.35,p[1]);camera.position.set(p[0]+(mode==='orbit'?100:1),y+(mode==='orbit'?220:3.5),p[1]+(mode==='orbit'?190:6));c.update();};
  focus([point.current.x,point.current.z]);
  previousMode.current=mode;
  if(camera instanceof PerspectiveCamera){camera.fov=mode==='stroll'?stroll.fov:mode==='orbit'?48:58;camera.updateProjectionMatrix();}
  if(data.campus==='mit'&&props.inspection&&mode==='orbit'){
   const buildings={building7:[-90.327,-8.591],building5:[-72.548,48.263],building2:[169.534,40.487],building1:[-38.319,111.099],building6:[131.15,-46.605],building8:[108.269,-102.208],building11:[-60.713,-43.132]} as const;
   if(props.inspection==='overview'){c.target.set(0,0,0);camera.position.set(140,580,430);c.update();}
   else if(props.inspection in humanViews){const view=humanViews[props.inspection as keyof typeof humanViews],p=view.position,t=view.target;camera.position.set(p[0],(height(...p)??4)+1.65,p[1]);c.target.set(t[0],(height(...t)??4)+view.aimHeight,t[1]);c.update();}
   else if(props.inspection==='river'){c.target.set(70,2,220);camera.position.set(-190,130,380);c.update();}
   else if(props.inspection==='bridge'){
    const b=model.userData.environment?.bridge;
    if(b){const x=b.start[0]+(b.end[0]-b.start[0])*.2,z=b.start[1]+(b.end[1]-b.start[1])*.2,y=b.deckHeight;c.target.set(x,y+1,z);camera.position.set(x-10,y+4,z-24);c.update();}
   }
   else if(props.inspection in buildings){
    const [x,z]=buildings[props.inspection as keyof typeof buildings];
    // Face the measured courtyard elevations; the default distant view hides
    // these smaller buildings behind their neighbours.
    const closeViews={building6:{aim:[132.53,14,-21.23],eye:[105,36,-8]},building8:{aim:[114.29,14,-105.56],eye:[132,30,-114]},building11:{aim:[-52.09,13,-46.87],eye:[-35,28,-54.5]}} as const;
    const close=closeViews[props.inspection as keyof typeof closeViews];
    if(close){c.target.set(close.aim[0],close.aim[1],close.aim[2]);camera.position.set(close.eye[0],close.eye[1],close.eye[2]);}
    else{c.target.set(x,12,z);camera.position.set(x-65,65,z+90);}c.update();
   }else{
   const center=new Vector3(12.9043,0,-34.5789),normal=new Vector3(.41897,0,.908),tangent=new Vector3(.908,0,-.41897);
   const views={aerial:{distance:125,side:35,height:100,aim:10},eye:{distance:77,side:0,height:1.65,aim:17},entrance:{distance:12,side:-7,height:1.65,aim:10}};
   const v=views[props.inspection as keyof typeof views],p=center.clone().addScaledVector(normal,v.distance).addScaledVector(tangent,v.side);p.y=(height(p.x,p.z)??4)+v.height;
   camera.position.copy(p);c.target.copy(center).setY(v.aim);c.update();
   }
  }
  onPosition([point.current.x,point.current.z]);
  onReady({focus,home:()=>{const p=mode==='stroll'?strollStart(data.campus,data.spawn,!!props.detail):data.spawn;point.current.set(p[0],height(...p)??0,p[1]);focus(p);onPosition(p);},capture:()=>new Promise((resolve,reject)=>{gl.domElement.toBlob(b=>b?resolve(b):reject(new Error('照片生成失败')),'image/png');})});
 },[model,mode,props.inspection]);
 useFrame((_,delta)=>{
  if(!model||!controls.current||!actor.current)return;if(model.userData.waterTime&&!reduced&&props.quality!=='low')model.userData.waterTime.value+=Math.min(delta,.05);const c=controls.current;let moving=false;
  const dt=Math.min(delta,.05),v=scratch.current;if(desiredCamera.current){camera.position.copy(desiredCamera.current);desiredCamera.current=null;}c.enabled=!paused&&mode!=='stroll';
  if(paused){keys.current.clear();speed.current=0;}
  if(mode==='stroll')applyStrollCamera();
  if((mode==='walk'||mode==='stroll')&&!paused&&!document.hidden){
   const k=keys.current,dx=Number(k.has('d')||k.has('arrowright'))-Number(k.has('a')||k.has('arrowleft')),dz=Number(k.has('w')||k.has('arrowup'))-Number(k.has('s')||k.has('arrowdown'));
   if(dx||dz){
    const forward=v.forward;camera.getWorldDirection(forward);forward.y=0;forward.normalize();
    const direction=v.direction.copy(forward).multiplyScalar(dz).addScaledVector(v.right.set(-forward.z,0,forward.x),dx).normalize();
    speed.current=approach(speed.current,k.has('shift')?traversal.runSpeed:traversal.walkSpeed,traversal.acceleration*dt);
    const distance=dt*speed.current,next=v.next.copy(point.current).addScaledVector(direction,distance);
    v.origin.copy(point.current).y+=.9;
    const hit=collision.current.distance(v.origin,direction,distance+.5),y=height(next.x,next.z);v.position[0]=next.x;v.position[1]=next.z;
    if(hit===undefined&&!isCampusWater(model.userData.environment,next.x,next.z)&&y!==undefined&&Math.abs(y-point.current.y)<.65&&insideCampus(v.position,data.radius)){next.y=y;point.current.copy(next);moving=true;actor.current.rotation.y=turnTowards(actor.current.rotation.y,Math.atan2(direction.x,direction.z),dt);}else speed.current=0;
   }else speed.current=0;
   if(mode==='walk'){const follow=v.follow.copy(point.current);follow.y+=1.35;follow.sub(c.target).multiplyScalar(reduced?1:1-Math.exp(-12*dt));c.target.add(follow);camera.position.add(follow);}else applyStrollCamera();
  }
  actor.current.position.copy(point.current);actor.current.visible=mode==='walk'&&!props.presentation;if(mode!=='stroll')c.update();
  if(sun.current){const light=sun.current,distance=camera.position.distanceTo(c.target),extent=Math.min(230,Math.max(95,distance*.75));camera.getWorldDirection(v.forward);const ahead=mode==='stroll'?32:0,x=Math.round((c.target.x+v.forward.x*ahead)*4)/4,z=Math.round((c.target.z+v.forward.z*ahead)*4)/4,[sx,sy,sz]=courtyardLighting.sun.offset;light.position.set(x+sx,sy,z+sz);light.target.position.set(x,0,z);light.target.updateMatrixWorld();const shadow=light.shadow.camera;if(Math.abs(shadow.right-extent)>2){shadow.left=-extent;shadow.right=extent;shadow.top=extent;shadow.bottom=-extent;shadow.updateProjectionMatrix();}}if(moving!==walking)setWalking(moving);
  if(mode==='walk'){
   desiredCamera.current=v.savedCamera.copy(camera.position);const offset=v.offset.copy(camera.position).sub(c.target),distance=offset.length();offset.normalize();
   const hit=collision.current.distance(c.target,offset,distance,true);if(hit!==undefined)camera.position.copy(c.target).addScaledVector(offset,Math.max(.3,hit-.35));camera.lookAt(c.target);
  }
  if(camera instanceof PerspectiveCamera){const fov=mode!=='walk'?48:(!reduced&&speed.current>4?64:58);if(Math.abs(fov-camera.fov)>.001){camera.fov=mode==='stroll'?stroll.fov:camera.fov+(fov-camera.fov)*(1-Math.exp(-6*dt));camera.updateProjectionMatrix();}}
  last.current+=delta;if(last.current>.25){last.current=0;props.onVegetationStatus?.(model.userData.detailLayer?.userData.vegetationStatus||'ready');onPosition([point.current.x,point.current.z]);if(import.meta.env.DEV)(window as unknown as {__localCampus:unknown}).__localCampus={campus:data.campus,vegetationStatus:model.userData.detailLayer?.userData.vegetationStatus||'ready',quality:props.quality||'standard',ambientOcclusion:!!scene.userData.realismRender,presentation:!!props.presentation,cameraPosition:camera.position.toArray(),cameraGroundHeight:height(camera.position.x,camera.position.z),fov:camera instanceof PerspectiveCamera?camera.fov:null,position:point.current.toArray(),cameraForward:camera.getWorldDirection(v.forward).toArray(),mode,openingTrianglesRemoved:model.userData.openingTrianglesRemoved||0,surfaceTriangles:model.userData.surfaceTriangles,calls:scene.userData.realismRender?.calls??gl.info.render.calls,triangles:scene.userData.realismRender?.triangles??gl.info.render.triangles};}
 });
 return <><hemisphereLight args={[courtyardLighting.fill.sky,courtyardLighting.fill.ground,props.detail&&data.campus==='mit'?courtyardLighting.fill.intensity:1.1]}/>{props.detail&&data.campus==='mit'?<directionalLight ref={sun} position={[...courtyardLighting.sun.offset]} intensity={courtyardLighting.sun.intensity} color={courtyardLighting.sun.color} castShadow shadow-mapSize={[4096,4096]} shadow-camera-left={-140} shadow-camera-right={140} shadow-camera-top={140} shadow-camera-bottom={-140} shadow-camera-near={1} shadow-camera-far={700} shadow-bias={-.00008} shadow-normalBias={.035}/>:<directionalLight position={[-70,150,85]} intensity={2.5} color="#fff0d7" castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-140} shadow-camera-right={140} shadow-camera-top={140} shadow-camera-bottom={-140} shadow-camera-near={1} shadow-camera-far={450} shadow-bias={-.0002} shadow-normalBias={.1}/>} {model&&<primitive object={model}/>}<group ref={actor} rotation={[0,Math.PI,0]}>{mode==='walk'&&<Character avatar={avatar} walking={walking} reduced={reduced}/>}</group>{model&&mode==='walk'&&!props.presentation&&localTargets(data).filter(t=>t.kind==='npc').map((t,i)=><group key={t.id} position={[t.position[0],height(...t.position)??0,t.position[1]]} rotation={[0,Math.atan2(point.current.x-t.position[0],point.current.z-t.position[1]),0]}><Character avatar={{outfit:i?'#537782':'#b68353',skin:'#d8ae89',hair:i?'long':'short'}}/><mesh position={[0,2.5,0]} rotation={[0,0,Math.PI/4]}><boxGeometry args={[.23,.23,.08]}/><meshBasicMaterial color="#ffe0a0"/></mesh></group>)}{mode==='walk'&&!props.presentation&&props.objective&&model&&<mesh position={[props.objective[0],(height(...props.objective)??0)+.12,props.objective[1]]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.8,1,32]}/><meshBasicMaterial color="#ffcc70" side={2}/></mesh>}</>;
}
export default function LocalCampusScene(props:Props){return <Canvas shadows={props.quality!=='low'} dpr={props.quality==='low'?.85:[1,1.5]} camera={{position:[100,220,190],near:.2,far:1800,fov:48}} gl={{antialias:true,preserveDrawingBuffer:true,toneMapping:ACESFilmicToneMapping,toneMappingExposure:props.detail&&props.data.campus==='mit'?courtyardLighting.exposure:1}}><color attach="background" args={[courtyardLighting.fog.color]}/>{props.detail&&props.data.campus==='mit'&&<fog attach="fog" args={[courtyardLighting.fog.color,courtyardLighting.fog.near,courtyardLighting.fog.far]}/>}{props.detail&&props.data.campus==='mit'&&<CampusSky/>}<World {...props}/>{props.detail&&props.data.campus==='mit'&&props.quality!=='low'&&<RealismEffects/>}</Canvas>;}
