import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {Component,useEffect,useRef,type ReactNode} from 'react';
import {Group,Vector3} from 'three';
import {TilesRenderer} from '3d-tiles-renderer/three';
import {GoogleCloudAuthPlugin} from '3d-tiles-renderer/core/plugins';
import {GLTFExtensionsPlugin,ReorientationPlugin} from '3d-tiles-renderer/three/plugins';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {Character} from '../../world/Character';
import {useStore} from '../../state/store';
import {creditStrings,degreesToRadians,googleFailure,MIT_VIEW,moveCalibrationAvatar,viewSettings,type ViewMode} from './config';

export type TileStatus = {phase:'loading'|'ready'|'error';message:string;visible:number;credits:string[]};
type Props = {apiKey:string;mode:ViewMode;height:number;paused:boolean;onStatus:(status:TileStatus)=>void};
class SceneBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true};}componentDidCatch(){this.props.onError();}render(){return this.state.failed?null:this.props.children;}}

function LiveTiles({apiKey,onStatus}:Props){
  const {camera,gl,scene}=useThree();
  const ref=useRef<TilesRenderer|null>(null),last=useRef(0),onStatusRef=useRef(onStatus);onStatusRef.current=onStatus;
  useEffect(()=>{
    let alive=true,failed=false,announced=false;let timer:ReturnType<typeof setTimeout>;
    const tiles=new TilesRenderer();
    const draco=new DRACOLoader();draco.setDecoderPath('/decoders/draco/');
    tiles.registerPlugin(new GoogleCloudAuthPlugin({apiToken:apiKey,autoRefreshToken:false}));
    tiles.registerPlugin(new GLTFExtensionsPlugin({dracoLoader:draco,autoDispose:false}));
    tiles.registerPlugin(new ReorientationPlugin({lat:degreesToRadians(MIT_VIEW.latitude),lon:degreesToRadians(MIT_VIEW.longitude),height:MIT_VIEW.ellipsoidHeight}));
    tiles.errorTarget=12;tiles.downloadQueue.maxJobs=6;tiles.parseQueue.maxJobs=2;
    tiles.setCamera(camera);tiles.setResolutionFromRenderer(camera,gl);
    // Browser-managed HTTP cache only: no custom tile persistence, extraction or offline export.
    scene.add(tiles.group);ref.current=tiles;
    const report=()=>{if(!alive||failed)return;const count=tiles.visibleTiles.size;if(count>0){announced=true;clearTimeout(timer);onStatusRef.current({phase:'ready',message:'Google 三维瓦片已显示；局部细节仍可能继续加载。',visible:count,credits:creditStrings(tiles.getAttributions())});}};
    const error=(event:{error:Error})=>{if(!alive||failed)return;failed=true;clearTimeout(timer);ref.current=null;tiles.group.visible=false;onStatusRef.current({phase:'error',message:googleFailure(event.error),visible:0,credits:[]});};
    tiles.addEventListener('load-error',error);tiles.addEventListener('tile-visibility-change',report);
    onStatusRef.current({phase:'loading',message:'正在请求 MIT 附近的真实三维地图……',visible:0,credits:[]});
    timer=setTimeout(()=>{if(!alive||announced||failed)return;error({error:new Error('timeout')});},35000);
    return ()=>{alive=false;clearTimeout(timer);ref.current=null;tiles.removeEventListener('load-error',error);tiles.removeEventListener('tile-visibility-change',report);scene.remove(tiles.group);tiles.dispose();draco.dispose();};
  },[apiKey,camera,gl,scene]);
  useFrame(({clock})=>{
    const tiles=ref.current;if(!tiles||document.hidden)return;
    tiles.setResolutionFromRenderer(camera,gl);camera.updateMatrixWorld();tiles.update();
    if(clock.elapsedTime-last.current>.5&&tiles.visibleTiles.size){last.current=clock.elapsedTime;onStatusRef.current({phase:'ready',message:'真实影像在线显示 · 覆盖与清晰度请现场检查',visible:tiles.visibleTiles.size,credits:creditStrings(tiles.getAttributions())});}
  });
  return null;
}

function CameraAndAvatar({mode,height,paused}:Props){
  const {camera,gl,setFrameloop}=useThree();const avatar=useStore(s=>s.save.profile.avatar),reduced=useStore(s=>s.save.settings.reducedMotion);
  const player=useRef<Group>(null),keys=useRef(new Set<string>()),position=useRef<[number,number]>([0,0]);
  const orbit=useRef({yaw:Math.PI,pitch:.9,distance:260});const current=useRef({mode,paused});current.current={mode,paused};
  useEffect(()=>{const s=viewSettings[mode];orbit.current={yaw:Math.PI,...s};position.current=[0,0];keys.current.clear();},[mode]);
  useEffect(()=>{keys.current.clear();},[paused]);
  useEffect(()=>{
    const canvas=gl.domElement;let dragging=false;
    const clear=()=>{keys.current.clear();dragging=false;};
    const down=(e:KeyboardEvent)=>{if(current.current.paused||/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){e.preventDefault();keys.current.add(key);}};
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());
    const pointerDown=(e:PointerEvent)=>{if(e.button===2&&!current.current.paused){dragging=true;canvas.setPointerCapture(e.pointerId);}};
    const pointerUp=()=>{dragging=false;};
    const pointerMove=(e:PointerEvent)=>{if(dragging&&!current.current.paused){orbit.current.yaw-=e.movementX*.005;orbit.current.pitch=Math.max(.15,Math.min(1.45,orbit.current.pitch+e.movementY*.004));}};
    const wheel=(e:WheelEvent)=>{if(!current.current.paused){e.preventDefault();orbit.current.distance=Math.max(8,Math.min(600,orbit.current.distance*Math.exp(e.deltaY*.001)));}};
    const context=(e:Event)=>e.preventDefault();const visibility=()=>{clear();setFrameloop(document.hidden?'never':'always');};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',visibility);
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);window.addEventListener('pointerup',pointerUp);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('contextmenu',context);
    return ()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);window.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('contextmenu',context);};
  },[gl,setFrameloop]);
  useFrame((_,dt)=>{if(document.hidden)return;let dx=0,dz=0;const o=orbit.current;if(mode==='avatar'&&!paused){const k=keys.current;dx=Number(k.has('d')||k.has('arrowright'))-Number(k.has('a')||k.has('arrowleft'));dz=Number(k.has('s')||k.has('arrowdown'))-Number(k.has('w')||k.has('arrowup'));const wx=dx*Math.cos(o.yaw)+dz*Math.sin(o.yaw),wz=-dx*Math.sin(o.yaw)+dz*Math.cos(o.yaw);position.current=moveCalibrationAvatar(...position.current,wx,wz,dt);if(player.current&&(dx||dz))player.current.rotation.y=Math.atan2(wx,wz);}
    const [x,z]=position.current;player.current?.position.set(x,height,z);const target=new Vector3(mode==='avatar'?x:0,height+1,mode==='avatar'?z:0);camera.position.set(target.x+Math.sin(o.yaw)*Math.cos(o.pitch)*o.distance,target.y+Math.sin(o.pitch)*o.distance,target.z+Math.cos(o.yaw)*Math.cos(o.pitch)*o.distance);camera.lookAt(target);
  });
  return <group ref={player} visible={mode==='avatar'}><Character avatar={avatar} reduced={reduced}/></group>;
}

export default function GoogleTilesScene(props:Props){
  const fail=()=>props.onStatus({phase:'error',message:'此浏览器无法创建三维场景。请在支持 WebGL2 的 Chrome 或 Edge 中打开本地地址。',visible:0,credits:[]});
  return <SceneBoundary onError={fail}><Canvas camera={{fov:50,near:.2,far:20000000,position:[0,220,-220]}} dpr={[1,1.5]} gl={{antialias:true,alpha:false,preserveDrawingBuffer:false}}><color attach="background" args={['#c9d9df']}/><ambientLight intensity={1.8}/><directionalLight position={[10,30,10]} intensity={2}/><CameraAndAvatar {...props}/><LiveTiles {...props}/></Canvas></SceneBoundary>;
}
