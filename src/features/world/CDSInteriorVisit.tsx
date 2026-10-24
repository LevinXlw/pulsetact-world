import {Component,lazy,Suspense,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,DoorOpen,RotateCcw,Sun} from 'lucide-react';
import type {PlayableCharacterId} from './character-catalog';
import {CDS_DOOR_BY_ID,getNearCDSDoor,type CDSDoorId} from './cds-door-layout';
import './cds-interior.css';

const WorldScene=lazy(()=>import('./WorldScene'));
type Props={entryDoor:CDSDoorId;mobile:boolean;characterId:PlayableCharacterId;quality:'standard'|'low';onQualityChange:(quality:'standard'|'low')=>void;onExit:(door?:CDSDoorId)=>void};
class InteriorBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(){this.props.onError();}render(){return this.state.failed?null:this.props.children;}
}
const directions=[{x:0,z:1,label:'向前',Icon:ArrowUp},{x:-1,z:0,label:'向左',Icon:ArrowLeft},{x:0,z:-1,label:'向后',Icon:ArrowDown},{x:1,z:0,label:'向右',Icon:ArrowRight}];

export default function CDSInteriorVisit({entryDoor,mobile,characterId,quality,onQualityChange,onExit}:Props){
 const spawn=CDS_DOOR_BY_ID[entryDoor].interior.position;
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[returnHome,setReturnHome]=useState(0);
 const [position,setPosition]=useState<[number,number]>([...spawn]),[height,setHeight]=useState(0),[moveInput,setMoveInput]=useState({x:0,z:0});
 const [openingDoor,setOpeningDoor]=useState<CDSDoorId|null>(null),openingRef=useRef<CDSDoorId|null>(null);
 const current=useRef({position,height,ready});current.current={position,height,ready};
 const clearMove=useCallback(()=>setMoveInput({x:0,z:0}),[]);
 const exit=useCallback(()=>{openingRef.current=null;clearMove();onExit();},[clearMove,onExit]);
 const onMove=useCallback((point:[number,number],_yaw:number,playerHeight?:number)=>{setPosition(point);if(playerHeight!==undefined)setHeight(playerHeight);},[]);
 const nearExit=getNearCDSDoor(position,height,true);
 const interact=useCallback(()=>{
  const state=current.current;if(!state.ready||openingRef.current)return;
  const door=getNearCDSDoor(state.position,state.height,true);if(!door)return;
  openingRef.current=door.id;setOpeningDoor(door.id);clearMove();
 },[clearMove]);
 const finishExit=useCallback(()=>{
  const id=openingRef.current;if(!id)return;
  openingRef.current=null;onExit(id);
 },[onExit]);
 const sceneReady=useCallback(()=>{setReady(true);setError('');},[]);
 const sceneError=useCallback((message:string)=>{openingRef.current=null;setOpeningDoor(null);clearMove();setReady(false);setError(message);},[clearMove]);
 useEffect(()=>{const clearWhenHidden=()=>{if(document.hidden)clearMove();};window.addEventListener('blur',clearMove);document.addEventListener('visibilitychange',clearWhenHidden);return()=>{window.removeEventListener('blur',clearMove);document.removeEventListener('visibilitychange',clearWhenHidden);};},[clearMove]);
 useEffect(()=>{if(ready||error)return;const timeout=setTimeout(()=>sceneError('室内加载时间过长。可以以省电模式重试，或先返回校园。'),90000);return()=>clearTimeout(timeout);},[ready,error,attempt,quality,sceneError]);
 function retry(){clearMove();setReady(false);setError('');setPosition([...spawn]);setHeight(0);onQualityChange('low');setAttempt(value=>value+1);}
 function changeQuality(){clearMove();if(mobile)setReady(false);onQualityChange(quality==='low'?'standard':'low');}
 return <main className={`cds-visit${mobile?' cds-visit-mobile':''}`} data-testid="cds-interior-visit" aria-label="CDS 室内漫游">
  <div className="cds-visit-scene">{!error&&<InteriorBoundary key={attempt} onError={()=>sceneError('室内画面暂时无法显示，请重试或返回校园。')}><Suspense fallback={null}><WorldScene interior="cds" interiorDoor={entryDoor} mobile={mobile} allowMobileHd quality={quality} characterId={characterId} players={[]} selfId="solo" paused={!ready||!!openingDoor} moveInput={moveInput} returnHome={returnHome} onMove={onMove} onInteract={interact} onReady={sceneReady} onError={sceneError} activeDoor={nearExit?.id} openingDoor={openingDoor} onDoorOpened={finishExit}/></Suspense></InteriorBoundary>}</div>
  <header className="cds-visit-header"><div className="cds-visit-title"><span>BOSTON UNIVERSITY</span><strong>CDS</strong><small>1F–2F 公共空间</small></div>{!ready&&<button className="cds-visit-exit" onClick={exit}><DoorOpen size={17}/>返回校园</button>}</header>
  <nav className="cds-visit-tools" aria-label="室内工具"><button disabled={!ready||!!openingDoor} onClick={()=>{clearMove();setReturnHome(value=>value+1);}}><RotateCcw size={15}/>回到入口</button><button disabled={!ready||!!openingDoor} onClick={changeQuality}><Sun size={15}/>{mobile?(quality==='low'?'切换清晰画面':'切回省电画面'):(quality==='low'?'切换标准画质':'切换省电模式')}</button></nav>
  {!ready&&!error&&<div className="cds-visit-loading" role="status"><span className="cds-visit-spinner"/><strong>正在进入 CDS</strong><p>准备室内空间与人物，请稍候。</p></div>}
  {error&&<section className="cds-visit-error" role="alert"><h1>暂时无法进入 CDS</h1><p>{error}</p><button onClick={retry}>以省电模式重试</button><button onClick={exit}>返回校园</button></section>}
  {ready&&nearExit&&<button className="cds-visit-interact" data-door={nearExit.id} data-phase={openingDoor?'opening':'closed'} disabled={!!openingDoor} onClick={interact}>{!mobile&&<kbd>E</kbd>}<DoorOpen size={17}/><span>{openingDoor?'正在开门…':'开门离开'}<small>{nearExit.title} · 返回校园</small></span></button>}
  {mobile&&ready&&<nav className="cds-visit-pad" aria-label="室内移动方向">{directions.map(({x,z,label,Icon})=><button key={label} aria-label={label} disabled={!!openingDoor} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);setMoveInput({x,z});}} onPointerUp={clearMove} onPointerCancel={clearMove} onLostPointerCapture={clearMove}><Icon size={21}/></button>)}</nav>}
  <footer className="cds-visit-footer"><span>公共阶梯 · 咖啡区 · 二层学习区</span><span>{mobile?'拖动视角 · 走近玻璃门离开':'WASD 移动 · 拖动视角 · 门前按 E 开门'}</span></footer>
 </main>;
}
