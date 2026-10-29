import {Component,lazy,Suspense,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {LogoutButton,useAuth} from '../auth/AuthGate';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,Bike,BookOpen,Camera,Check,Compass,Leaf,Map,Settings,Sparkles,Sun,User,Wind,X} from 'lucide-react';
import {CharacterChoice} from './CharacterChoice';
import {isPlayableCharacter,normalizePlayableCharacter,type PlayableCharacterId} from './character-catalog';
import {OpticsWorkshop} from './OpticsWorkshop';
import {opticsReducer} from './optics-model';
import {SOLO_SAVE_KEY,readSoloProgress,writeSoloProgress,changeSoloCampus,type SoloProgress} from './solo-progress';
import {SOLO_DISCOVERIES,nearestDiscovery,type DiscoveryId} from './solo-locations';
import {SoloCampusMap} from './SoloCampusMap';
import {WORKSHOP_ARRIVAL,WORLD_SPAWN} from './world-locations';
import type {AtlasSchoolId} from './campus-atlas-data';
import {WORLD_DESTINATIONS,nearestDestination,navigationGuide,regionAt,type RiverPlaceId} from './world-destinations';
import {ALL_CAMPUS_PLACES,campusPlaces,campusRegion,campusSpawn,campusForPlace,nearestCampusPlace,campusNavigationGuide,type CampusId,type CampusPlaceId} from './campus-regions';
import './world.css';
import './solo-world.css';
import './touch-controls.css';
import {isMobileWorld} from './mobile-device';
import {CDS_DOOR_BY_ID,cdsLocalToWorld,getNearCDSDoor,type CDSDoorId} from './cds-door-layout';
import {CommutePanel} from './CommutePanel';
import {getCommuteMode,type CommuteMode} from './commute';

const WorldScene=lazy(()=>import('./WorldScene'));
const CDSInteriorVisit=lazy(()=>import('./CDSInteriorVisit'));
const PROFILE_KEY='pulsetact:world:profile:v1';
const COLORS=['#778a64','#b87b57','#698b9e','#b5a177'];
function storedSave(){try{return localStorage.getItem(SOLO_SAVE_KEY);}catch{return null;}}
type Panel='map'|'journal'|'settings'|'commute'|'profile'|'axis'|'dome'|'optics'|'lesson'|RiverPlaceId|CampusPlaceId|null;
function readProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}');return {nickname:typeof p?.nickname==='string'?p.nickname.slice(0,18):'',color:COLORS.includes(p?.color)?p.color:COLORS[0],characterId:normalizePlayableCharacter(p?.characterId)};}catch{return {nickname:'',color:COLORS[0],characterId:normalizePlayableCharacter(undefined)};}}
class SceneBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true};}componentDidCatch(){this.props.onError();}render(){return this.state.failed?null:this.props.children;}}

export default function SoloWorldPage(){
  const [mobile]=useState(isMobileWorld);
  const {username}=useAuth();
  const [params,setParams]=useSearchParams();
  const [profile]=useState(readProfile);
  const [nickname,setNickname]=useState(profile.nickname),[color,setColor]=useState(profile.color);
  const [characterId,setCharacterId]=useState<PlayableCharacterId>(()=>isPlayableCharacter(params.get('character'))?params.get('character') as PlayableCharacterId:profile.characterId);
  const [progress,setProgress]=useState(()=>{
    const saved=readSoloProgress();
    // Each phone visit starts safely; HD is an explicit in-world choice.
    if(mobile)saved.quality='low';
    return saved;
  });
  const initialPosition=useRef(progress.position);
  const [restoredPosition,setRestoredPosition]=useState<[number,number]>();
  const lastStored=useRef(storedSave());
  const [position,setPosition]=useState<[number,number]>(progress.position??campusSpawn(progress.campus));
  const positionRef=useRef(position),progressRef=useRef(progress);progressRef.current=progress;
  const awaitingSceneRestore=useRef(false);
  const [interior,setInterior]=useState(false);
  const interiorRef=useRef(false);
  const [entryDoor,setEntryDoor]=useState<CDSDoorId>('east');
  const [openingDoor,setOpeningDoor]=useState<CDSDoorId|null>(null);
  const openingDoorRef=useRef<CDSDoorId|null>(null);
  const [feetHeight,setFeetHeight]=useState(NaN),feetHeightRef=useRef(NaN);
  const [arrivalLookAt,setArrivalLookAt]=useState<[number,number]>();
  const [heading,setHeading]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [sceneAttempt,setSceneAttempt]=useState(0),[slowLoading,setSlowLoading]=useState(false);
  const [qualityChanging,setQualityChanging]=useState(false);
  const domeInFrame=useRef(false);
  const onHeadingChange=useCallback((next:number,inFrame:boolean)=>{setHeading(next);domeInFrame.current=inFrame;},[]);
  const [entered,setEntered]=useState(()=>{if(mobile)return false;try{return sessionStorage.getItem('pulsetact:world:entered')==='yes';}catch{return false;}});
  const [sceneStarted,setSceneStarted]=useState(!mobile);
  const [panel,setPanel]=useState<Panel>(null),[toast,setToast]=useState(''),[returnHome,setReturnHome]=useState(0);
  const [moveInput,setMoveInput]=useState({x:0,z:0}),[photoBusy,setPhotoBusy]=useState(false),[storageIssue,setStorageIssue]=useState(false);
  const [commuteMode,setCommuteMode]=useState<CommuteMode>('walk'),[boosting,setBoosting]=useState(false);
  const [observation,setObservation]=useState('');
  const worldRef=useRef<HTMLElement>(null),panelRef=useRef<HTMLDivElement>(null);
  const handleSceneError=useCallback((message:string)=>{
    if(interiorRef.current)return;
    openingDoorRef.current=null;setOpeningDoor(null);
    setReady(false);setPanel(null);
    if(mobile&&progressRef.current.quality==='standard'&&message.startsWith('人物加载失败')){
      setProgress(previous=>({...previous,quality:'low'}));setQualityChanging(true);
      setToast('高清人物暂时未能加载，已返回省电模式。你可以稍后再次切换。');return;
    }
    setQualityChanging(false);setError(message);
  },[mobile]);
  const campus=progress.campus,localPlaces=campus==='boston'?[...SOLO_DISCOVERIES,...WORLD_DESTINATIONS]:campusPlaces(campus);
  const target=localPlaces.find(point=>point.id===progress.trackedId)??localPlaces[0];
  const near=campus==='boston'?(nearestDiscovery(position)??nearestDestination(position)):nearestCampusPlace(campus,position);
  const nearDoor=campus==='boston'?getNearCDSDoor(position,feetHeight):undefined;
  const region=campus==='boston'?regionAt(position):campusRegion(campus);
  const guide=campus==='boston'?navigationGuide(position,target.position):campusNavigationGuide(campus,position,target.position);
  const placePanel=[...WORLD_DESTINATIONS,...ALL_CAMPUS_PLACES].find(point=>point.id===panel);
  const placeVisits=campus==='boston'?progress.visitedPlaces:progress.campusVisits;
  const distance=Math.hypot(position[0]-target.position[0],position[1]-target.position[1]);
  const bearing=heading+Math.PI-Math.atan2(guide.point[0]-position[0],guide.point[1]-position[1]);
  const direction=Math.atan2(Math.sin(bearing),Math.cos(bearing));
  const finished=progress.visited.length===SOLO_DISCOVERIES.length;
  const commute=getCommuteMode(commuteMode);
  const notify=useCallback((message:string)=>setToast(message),[]);
  const openPanel=useCallback((next:Panel)=>{if(openingDoorRef.current)return;setMoveInput({x:0,z:0});setBoosting(false);setPanel(next);},[]);
  const commuteBlocked=useCallback(()=>{setCommuteMode('walk');setBoosting(false);notify('这里空间较窄，请走到开阔的路面再召唤。');},[notify]);
  function chooseCommute(next:CommuteMode){
    if(!ready||!entered||interiorRef.current||openingDoorRef.current||awaitingSceneRestore.current)return;
    setMoveInput({x:0,z:0});setBoosting(false);setCommuteMode(next);setPanel(null);
    notify(next==='walk'?'已收起通勤工具，继续步行。':next==='motorcycle'?'摩托车已召唤。Shift 或按住加速，更快到达下一站。':'魔法扫帚已召唤，沿地形低空巡航。');
  }
  const onMove=useCallback((next:[number,number],_yaw:number,height?:number)=>{
    // Storage and the R3F scene update in separate roots. Discard the old
    // scene's position until it has applied the newly adopted checkpoint.
    if(awaitingSceneRestore.current||interiorRef.current)return;
    feetHeightRef.current=height??NaN;setFeetHeight(height??NaN);
    positionRef.current=next;setPosition(next);
  },[]);
  const onPositionRestored=useCallback((next:[number,number])=>{
    awaitingSceneRestore.current=false;positionRef.current=next;setPosition(next);
    setProgress(previous=>({...previous,position:next,campusPositions:{...previous.campusPositions,[previous.campus]:next}}));
  },[]);
  function interact(){
    if(openingDoorRef.current)return;
    const active=progressRef.current.campus;
    if(active==='boston'&&getNearCDSDoor(positionRef.current,feetHeightRef.current)){enterCDS();return;}
    const point=active==='boston'?(nearestDiscovery(positionRef.current)??nearestDestination(positionRef.current)):nearestCampusPlace(active,positionRef.current);
    if(point)openPanel(point.id);
  }
  const adoptStored=useCallback(()=>{
    const raw=storedSave();if(raw===lastStored.current)return false;
    lastStored.current=raw;const saved=readSoloProgress(),changed=saved.campus!==progressRef.current.campus;
    // Another tab may update progress, but only this phone's explicit action
    // may enable HD and allocate its additional character textures.
    if(mobile)saved.quality=progressRef.current.quality;
    const next=saved.position??campusSpawn(saved.campus);
    if(!interiorRef.current||changed){openingDoorRef.current=null;setOpeningDoor(null);setArrivalLookAt(undefined);}
    if(changed){interiorRef.current=false;setInterior(false);setReady(false);setError('');setPanel(null);initialPosition.current=next;}
    progressRef.current=saved;setProgress(saved);
    if(saved.position||changed){setCommuteMode('walk');setBoosting(false);awaitingSceneRestore.current=true;positionRef.current=next;setPosition(next);setRestoredPosition(next);}
    return true;
  },[mobile]);
  const persist=useCallback((force=false)=>{
    if(!force&&(document.hidden||!document.hasFocus()))return;
    // A newer save belongs to another tab: adopt it before writing anything.
    if(adoptStored()||awaitingSceneRestore.current)return;
    const current=progressRef.current;
    const ok=writeSoloProgress({...current,position:positionRef.current,campusPositions:{...current.campusPositions,[current.campus]:positionRef.current}});
    if(ok)lastStored.current=storedSave();setStorageIssue(!ok);
  },[adoptStored]);
  useEffect(()=>{persist();},[progress,persist]);
  useEffect(()=>{
    const flush=()=>persist(true),visible=()=>{if(!document.hidden)adoptStored();},storage=(event:StorageEvent)=>{if(event.key===SOLO_SAVE_KEY)adoptStored();};
    const timer=window.setInterval(()=>persist(),3000);window.addEventListener('pagehide',flush);window.addEventListener('storage',storage);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    return()=>{flush();clearInterval(timer);window.removeEventListener('pagehide',flush);window.removeEventListener('storage',storage);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[persist,adoptStored]);
  useEffect(()=>{try{localStorage.setItem(PROFILE_KEY,JSON.stringify({nickname,color,characterId}));}catch{setStorageIssue(true);}},[nickname,color,characterId]);
  useEffect(()=>{if(!params.has('character'))return;const next=new URLSearchParams(params);next.delete('character');setParams(next,{replace:true});},[params,setParams]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4200);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{const clear=()=>{setMoveInput({x:0,z:0});setBoosting(false);};window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);return()=>{window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);};},[]);
  useEffect(()=>{if(!panel||panel==='lesson')return;const previous=document.activeElement as HTMLElement|null;const timer=setTimeout(()=>panelRef.current?.querySelector<HTMLElement>('button,input')?.focus(),30);return()=>{clearTimeout(timer);previous?.focus();};},[panel]);
  useEffect(()=>{
    if(!mobile||!entered||sceneStarted)return;
    // Let the phone keyboard close before allocating the first drawing buffer.
    const timer=window.setTimeout(()=>setSceneStarted(true),350);
    return()=>clearTimeout(timer);
  },[mobile,entered,sceneStarted]);
  useEffect(()=>{
    setSlowLoading(false);
    if(!sceneStarted||ready||error)return;
    const slow=window.setTimeout(()=>setSlowLoading(true),15000);
    const timeout=window.setTimeout(()=>handleSceneError('校园加载时间过长。请检查网络后重试，你的昵称和探索记录会保留。'),90000);
    return()=>{clearTimeout(slow);clearTimeout(timeout);};
  },[ready,error,campus,characterId,sceneAttempt,handleSceneError,sceneStarted,progress.quality]);

  function enter(){
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    setNickname(nickname.trim()||'漫游者');setEntered(true);
    try{sessionStorage.setItem('pulsetact:world:entered','yes');}catch{}
  }
  function retryScene(){
    setCommuteMode('walk');setBoosting(false);
    initialPosition.current=positionRef.current;setReady(false);setError('');setPanel(null);
    setQualityChanging(false);setProgress(previous=>({...previous,quality:'low'}));setSceneAttempt(previous=>previous+1);
  }
  function changeQuality(quality:SoloProgress['quality']){
    if(quality===progress.quality)return;
    setMoveInput({x:0,z:0});setPanel(null);
    if(mobile){setReady(false);setQualityChanging(true);}
    setProgress(previous=>({...previous,quality}));
  }
  function sceneReady(){
    if(interiorRef.current)return;
    setReady(true);setQualityChanging(false);
    if(qualityChanging&&progress.quality==='standard')notify('高清材质已开启。可随时在设置中切回省电模式。');
  }
  function chooseCharacter(next:PlayableCharacterId){if(next!==characterId){setReady(false);setError('');setCharacterId(next);}}
  function enterCDS(){
    if(!ready||!entered||panel||awaitingSceneRestore.current||openingDoorRef.current||progressRef.current.campus!=='boston')return;
    persist(true);
    if(awaitingSceneRestore.current||progressRef.current.campus!=='boston')return;
    const door=getNearCDSDoor(positionRef.current,feetHeightRef.current);if(!door)return;
    setCommuteMode('walk');setBoosting(false);
    openingDoorRef.current=door.id;setOpeningDoor(door.id);setMoveInput({x:0,z:0});
  }
  function finishCDSEntry(){
    const id=openingDoorRef.current;
    if(!id||progressRef.current.campus!=='boston'||awaitingSceneRestore.current||getNearCDSDoor(positionRef.current,feetHeightRef.current)?.id!==id)return;
    initialPosition.current=[...positionRef.current];
    setEntryDoor(id);openingDoorRef.current=null;setOpeningDoor(null);
    setMoveInput({x:0,z:0});setPanel(null);setError('');
    setProgress(previous=>({...previous,visitedPlaces:[...new Set([...previous.visitedPlaces,'bu-cds'])]}));
    interiorRef.current=true;setInterior(true);
  }
  function exitCDS(doorId?:CDSDoorId){
    const door=CDS_DOOR_BY_ID[doorId??entryDoor];
    const next:[number,number]=[...door.exterior.position];
    setArrivalLookAt([...door.exterior.lookAt]);
    feetHeightRef.current=NaN;setFeetHeight(NaN);
    initialPosition.current=next;
    // Returning is an explicit trip to this visit's entrance. Keep newly
    // adopted discoveries, but do not let another tab move this doorway.
    positionRef.current=next;setPosition(next);
    const current=progressRef.current;
    const returned={...current,position:next,campusPositions:{...current.campusPositions,[current.campus]:next}};
    progressRef.current=returned;setProgress(returned);
    awaitingSceneRestore.current=false;setRestoredPosition(undefined);
    setReady(false);setError('');setPanel(null);setMoveInput({x:0,z:0});
    interiorRef.current=false;setInterior(false);notify('已返回 CDS 门口。');
  }
  function leave(){persist();setEntered(false);setPanel(null);setCommuteMode('walk');setBoosting(false);try{sessionStorage.removeItem('pulsetact:world:entered');}catch{}}
  function switchCampus(nextCampus:CampusId,target?:{id:string;position:[number,number]}){
    if(!ready||openingDoorRef.current)return;
    setArrivalLookAt(undefined);
    if(nextCampus===progressRef.current.campus&&!target){setPanel(null);return;}
    setCommuteMode('walk');setBoosting(false);
    const next=changeSoloCampus(progressRef.current,positionRef.current,nextCampus,target);
    awaitingSceneRestore.current=true;setMoveInput({x:0,z:0});setPanel(null);setError('');
    if(nextCampus!==progressRef.current.campus){setReady(false);initialPosition.current=next.position;}
    progressRef.current=next;positionRef.current=next.position!;setPosition(next.position!);setRestoredPosition(next.position);setProgress(next);
    notify(`前往 ${campusRegion(nextCampus).title}。探索记录已保留。`);
  }
  function enterAtlasSchool(id:AtlasSchoolId){
    if(id==='harvard')return;
    if(id==='mit')switchCampus('boston',{id:'axis',position:[...WORLD_SPAWN]});
    else if(id==='bu')switchCampus('boston',WORLD_DESTINATIONS.find(point=>point.id==='bu-marsh'));
    else switchCampus(id);
  }
  function track(id:string){
    const destination=[...SOLO_DISCOVERIES,...WORLD_DESTINATIONS,...ALL_CAMPUS_PLACES].find(point=>point.id===id);if(!destination)return;
    const nextCampus=campusForPlace(id)??'boston';
    if(nextCampus!==campus){switchCampus(nextCampus,id==='optics'?{id,position:[...WORKSHOP_ARRIVAL]}:destination);return;}
    setProgress(previous=>({...previous,trackedId:id}));setPanel(null);notify('方向已经标记，沿着指针慢慢走。');
  }
  function travel(id:RiverPlaceId|CampusPlaceId){
    const destination=[...WORLD_DESTINATIONS,...ALL_CAMPUS_PLACES].find(point=>point.id===id);if(!destination||!ready)return;
    setCommuteMode('walk');setBoosting(false);
    const door=id==='bu-cds'?CDS_DOOR_BY_ID.east:undefined;
    const next:[number,number]=[...(door?.exterior.position??destination.position)];
    const nextCampus=campusForPlace(id)??'boston';
    if(nextCampus!==campus){switchCampus(nextCampus,{...destination,position:next});}
    setArrivalLookAt(door?cdsLocalToWorld(door.local):undefined);
    awaitingSceneRestore.current=true;setMoveInput({x:0,z:0});setRestoredPosition(next);setPanel(null);
    setProgress(previous=>({...previous,trackedId:id}));notify(door?'已到 CDS 东侧玻璃门前。按 E 或点击「开门进入」。':`前往${destination.title}。抵达后按 E，把这里收进手册。`);
  }
  function visitPlace(id:RiverPlaceId|CampusPlaceId){
    const destination=[...WORLD_DESTINATIONS,...ALL_CAMPUS_PLACES].find(point=>point.id===id);
    if((campusForPlace(id)??'boston')!==campus)return;
    if(!destination||Math.hypot(positionRef.current[0]-destination.position[0],positionRef.current[1]-destination.position[1])>destination.radius)return;
    setProgress(previous=>campus==='boston'?({...previous,visitedPlaces:[...new Set([...previous.visitedPlaces,id])]}):({...previous,campusVisits:[...new Set([...previous.campusVisits,id])]}));
    setPanel(null);notify(`「${destination.title}」已收进${campus==='boston'?'河岸漫游':'校园'}手册。`);
  }
  function finishPoint(id:DiscoveryId,extra:Partial<SoloProgress>={}){
    setProgress(previous=>{
      const visited=[...new Set([...previous.visited,id])];
      const next=SOLO_DISCOVERIES.find(point=>!visited.includes(point.id));
      return {...previous,...extra,visited,trackedId:next?.id??id};
    });
  }
  const capture=useCallback(()=>{
    if(!ready||photoBusy)return;
    const canvas=worldRef.current?.querySelector('canvas');if(!canvas)return;
    // Award the viewpoint only when the photograph is taken at its actual spot.
    const atViewpoint=progressRef.current.campus==='boston'&&nearestDiscovery(positionRef.current)?.id==='dome';
    const atDome=atViewpoint&&domeInFrame.current;
    setPhotoBusy(true);
    // Mobile avoids retaining a second framebuffer; render on demand for a photo.
    canvas.dispatchEvent(new Event('world-capture'));
    canvas.toBlob(blob=>{
      setPhotoBusy(false);if(!blob){notify('照片没有生成，请再试一次。');return;}
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`pulsetact-${progressRef.current.campus}-${Date.now()}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
      setProgress(previous=>{
        const visited=atDome?[...new Set([...previous.visited,'dome'])]:previous.visited;
        const next=SOLO_DISCOVERIES.find(point=>!visited.includes(point.id));
        return {...previous,photos:previous.photos+1,visited,photoSpots:atDome?[...new Set([...previous.photoSpots,'dome'])]:previous.photoSpots,trackedId:atDome?(next?.id??'dome'):previous.trackedId};
      });
      notify(atDome?'「穹顶留影」已收进手册，照片已下载。':atViewpoint?'照片已下载。拖动镜头，把整个穹顶收入画面，再留一张影。':'校园照片已下载。');
    },'image/png');
  },[ready,photoBusy,notify]);

  useEffect(()=>{
    function key(event:KeyboardEvent){
      if(interiorRef.current||openingDoorRef.current)return;
      if(event.key==='Escape'){setPanel(previous=>previous?null:entered?'settings':null);return;}
      if(panel&&event.key==='Tab'){
        const items=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')??[]).filter(item=>item.getClientRects().length>0);
        if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}
        else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}return;
      }
      if(!entered||panel||event.ctrlKey||event.metaKey||event.altKey||/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName))return;
      if(event.key.toLowerCase()==='m'){event.preventDefault();openPanel('map');}
      if(event.key.toLowerCase()==='j'){event.preventDefault();openPanel('journal');}
      if(event.key.toLowerCase()==='p'){event.preventDefault();capture();}
      if(event.key.toLowerCase()==='v'){event.preventDefault();openPanel('commute');}
    }
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[entered,panel,openPanel,capture]);

  if(interior)return <Suspense fallback={<main className="pw-world"><div className="pw-loading"><p>正在进入 CDS 公共空间…</p><button className="pw-primary" onClick={()=>exitCDS()}>返回校园</button></div></main>}><CDSInteriorVisit entryDoor={entryDoor} mobile={mobile} characterId={characterId} quality={progress.quality} onQualityChange={quality=>setProgress(previous=>({...previous,quality}))} onExit={exitCDS}/></Suspense>;

  const title=panel==='commute'?'选择你的通勤方式':panel==='map'?'跟着好奇心，慢慢走':panel==='journal'?'我的校园手册':panel==='profile'?'这次旅程中的你':panel==='settings'?'让漫游更自在':placePanel?.title??SOLO_DISCOVERIES.find(point=>point.id===panel)?.title??'';
  return <main ref={worldRef} className={`pw-world solo-world ${mobile?'pw-mobile-world':''} ${!entered?'pw-choosing':''}`} data-testid="world-page" data-commute-mode={commuteMode} data-door-opening={!!openingDoor}>
    <div className="pw-scene">{sceneStarted&&!error&&<SceneBoundary key={sceneAttempt} onError={()=>handleSceneError('校园场景暂时未能启动，请以省电模式重试。')}><Suspense fallback={null}>
      <WorldScene allowMobileHd commuteMode={commuteMode} boosting={boosting} onCommuteBlocked={commuteBlocked} campusId={campus} suspendRendering={panel==='map'&&ready&&entered} paused={!entered||!!panel||!ready||!!openingDoor} quality={progress.quality} players={[]} selfId="solo" characterId={characterId} characterReview={!entered?{id:characterId,motion:'Idle',angle:Math.PI/10,close:false}:undefined} initialPosition={initialPosition.current} arrivalLookAt={arrivalLookAt} restoredPosition={restoredPosition} onPositionRestored={onPositionRestored} onMove={onMove} onHeadingChange={onHeadingChange} onInteract={interact} onReady={sceneReady} onError={handleSceneError} moveInput={moveInput} returnHome={returnHome} activeDoor={entered&&!panel?nearDoor?.id:null} openingDoor={openingDoor} onDoorOpened={finishCDSEntry} discoveries={localPlaces.filter(point=>point.id!=='optics'&&Math.hypot(position[0]-point.position[0],position[1]-point.position[1])>point.radius+2).map(point=>({...point,active:point.id===target.id,completed:progress.visited.includes(point.id)||placeVisits.includes(point.id)}))}/>
    </Suspense></SceneBoundary>}</div>
    <div className="pw-shade"/>
    {(entered||sceneStarted)&&!ready&&!error&&<div className="pw-loading" role={entered?'status':undefined}><Compass size={45}/><p>{qualityChanging?(progress.quality==='standard'?'正在准备高清材质':'正在返回省电模式'):`正在准备${region.title}`}</p><span>{qualityChanging?'当前位置与探索记录会保留':'正在加载校园与人物，完成后会自动进入'}</span>{mobile&&qualityChanging&&progress.quality==='standard'&&<button type="button" onClick={()=>changeQuality('low')}>返回省电模式</button>}{entered&&slowLoading&&<><span>首次加载可能需要更久，请稍候或尝试省电模式。</span><button type="button" onClick={retryScene}>以省电模式重试</button></>}</div>}
    <header className="pw-topbar"><Link className="pw-wordmark" to="/" aria-label="Pulsetact World 首页"><Leaf/><div><strong>pulsetact</strong><small>WORLD</small></div></Link><div className="pw-location"><span>{region.eyebrow}</span><div><i/><span>{region.label}</span><b>◇</b><span>{region.detail}</span><i/></div></div><button className="pw-profile" onClick={()=>openPanel('profile')} aria-label="校园身份"><span className="pw-avatar-dot" style={{background:color}}><User size={18}/></span><span>{nickname||'你的校园旅程'}<small>SOLO EXPLORER</small></span></button></header>
    {!entered?<>
      <section className="pw-intro"><span className="pw-eyebrow"><Sun size={13}/> A WALK OF YOUR OWN</span><h1>让好奇心，<br/>带你走一段路。</h1><p>沿查尔斯河走到 BU，再去 Maryland 和 Penn。<br/>按照自己的节奏，收藏每座校园的风景。</p><CharacterChoice value={characterId} onChange={chooseCharacter}/><Link className="pw-character-preview-link" to={`/characters?character=${characterId}`}>近距离看看这两个角色 ↗</Link><form onSubmit={event=>{event.preventDefault();enter();}}><label htmlFor="solo-nickname">旅途中，怎么称呼你？</label><input id="solo-nickname" autoComplete="nickname" enterKeyHint="go" placeholder="给自己起个名字" value={nickname} maxLength={18} onChange={event=>setNickname(event.target.value)} required/><button className="pw-primary" type="submit">{progress.visited.length||progress.position?'继续校园漫游':'开始校园漫游'}<ArrowRight size={17}/></button></form>{!ready&&!error&&<div className="solo-entry-loading" role="status"><span>{!sceneStarted?'已启用手机省电模式，准备好就出发。':slowLoading?'校园仍在准备，可先提交昵称；完成后会自动进入。':'校园正在准备，可以先起名并开始漫游。'}</span>{slowLoading&&<button type="button" onClick={retryScene}>以省电模式重试</button>}</div>}<p className="pw-footnote">单人探索 · 四座大学城 · 本机存档</p></section>
      <footer className="pw-preview-note"><span>{campusRegion(campus).label}<br/>真实校园布局 · 风格化户外探索<br/><LogoutButton className="auth-entry-logout" beforeLogout={()=>persist(true)}/></span><span>WALK. NOTICE. DISCOVER.</span></footer>
    </>:ready?<>
      <section className="pw-chapter"><span>{campus!=='boston'?'A CAMPUS OF YOUR OWN':region.id==='mit'?'YOUR FIRST WALK AT MIT':'A WALK ALONG THE CHARLES'}</span><h1>{region.title}</h1><p>{region.id==='mit'&&finished?'这一段旅程，已经成为你的故事。':region.description}</p><button className="solo-progress" onClick={()=>openPanel('journal')} aria-label={`探索进度 ${campus==='boston'?progress.visited.length:localPlaces.filter(p=>placeVisits.includes(p.id)).length}/${campus==='boston'?3:localPlaces.length}`}><span>{(campus==='boston'?SOLO_DISCOVERIES:localPlaces).map(point=><i key={point.id} className={(campus==='boston'?progress.visited:placeVisits).includes(point.id)?'done':''}/>)}</span>{campus==='boston'?<>{progress.visited.length} / 3 处发现{region.id!=='mit'&&` · 校园与河岸 ${progress.visitedPlaces.length}/${WORLD_DESTINATIONS.length}`}</>:<>{localPlaces.filter(point=>placeVisits.includes(point.id)).length} / {localPlaces.length} 处到访</>}</button></section>
      {!panel&&<button className="solo-wayfinder" onClick={()=>openPanel('map')} aria-label={`当前目标 ${target.title}`}><span className="solo-direction"><ArrowUp size={23} style={{transform:`rotate(${direction}rad)`}}/></span><span><small>{distance<=target.radius?'已经抵达 · 按 E 互动':guide.viaRoute?campus==='boston'?'沿校园步道与桥梁前进':'沿校园步道前进':'正在前往'}</small><strong>{target.title}</strong><em>{Math.round(guide.distance)} 米{guide.viaRoute?' · 步行路线':` · ${target.subtitle}`}</em></span></button>}
      <nav className="pw-tools" aria-label="场景工具"><button className="pw-round" onClick={capture} disabled={!ready||photoBusy} aria-label="拍照下载" title="拍照 P"><Camera/></button><button className="pw-round" onClick={()=>openPanel('settings')} aria-label="设置"><Settings/></button></nav>
      {nearDoor&&!panel?<button className="pw-interaction" data-testid="enter-cds-interior" data-door={nearDoor.id} data-phase={openingDoor?'opening':'closed'} disabled={!!openingDoor} onClick={enterCDS}>{!mobile&&<kbd>E</kbd>}<span>{openingDoor?'正在开门…':'开门进入'}<small>{nearDoor.title} · 一层大厅</small></span><ArrowRight size={15}/></button>:near&&!panel&&<button className="pw-interaction" onClick={()=>openPanel(near.id)}><kbd>E</kbd><span>{near.title}<small>{near.id==='dome'?'取景与拍照':near.id==='axis'?'停下来观察':near.id==='optics'?'开始独自实验':'看看这里 · 记录到访'}</small></span><ArrowRight size={15}/></button>}
      <footer className="pw-bottom"><div className="pw-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 漫步<span>拖动观察 · Shift 加速 · V 通勤 · E 互动</span></div><nav className="pw-dock" aria-label="世界菜单"><button aria-pressed={panel==='map'} onClick={()=>openPanel('map')}><Map/><span>地图</span></button><button aria-pressed={panel==='commute'} onClick={()=>openPanel('commute')}><Bike/><span>通勤</span></button><button aria-pressed={panel==='optics'||panel==='lesson'} onClick={()=>openPanel('optics')}><Sparkles/><span>工坊</span></button><button aria-pressed={panel==='journal'} onClick={()=>openPanel('journal')}><BookOpen/><span>手册</span></button></nav><span className="solo-save-state">{storageIssue?'本机存储不可用 · 本次仍可探索':'单人漫游 · 本机自动保存'}</span></footer>
      {!panel&&commuteMode!=='walk'&&<div className="solo-ride-controls"><button type="button" className="solo-ride-status" onClick={()=>chooseCommute('walk')} aria-label="收起通勤工具">{commuteMode==='motorcycle'?<Bike size={18}/>:<Wind size={18}/>}<span>{commute.title}<small>点击收起 · 恢复步行</small></span></button><button type="button" className="solo-ride-boost" aria-label="加速通勤" aria-pressed={boosting} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);setBoosting(true);}} onPointerUp={()=>setBoosting(false)} onPointerCancel={()=>setBoosting(false)} onLostPointerCapture={()=>setBoosting(false)}>按住加速 ↑</button></div>}
      {!panel&&<nav className="pw-mobile-pad" aria-label="移动方向">{[{x:0,z:1,label:'向前',icon:ArrowUp},{x:-1,z:0,label:'向左',icon:ArrowLeft},{x:0,z:-1,label:'向后',icon:ArrowDown},{x:1,z:0,label:'向右',icon:ArrowRight}].map(d=><button key={d.label} aria-label={d.label} disabled={!!openingDoor} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);setMoveInput({x:d.x,z:d.z});}} onPointerUp={()=>setMoveInput({x:0,z:0})} onPointerCancel={()=>setMoveInput({x:0,z:0})} onLostPointerCapture={()=>setMoveInput({x:0,z:0})}><d.icon size={18}/></button>)}</nav>}
    </>:null}
    {panel&&<div className="pw-overlay" onPointerDown={event=>{if(event.target===event.currentTarget)setPanel(null);}}>
      {panel==='lesson'?<div className="pw-lesson-shell"><OpticsWorkshop state={progress.lesson} onChange={patch=>setProgress(previous=>({...previous,lesson:opticsReducer(previous.lesson,patch)}))} onComplete={()=>{finishPoint('optics',{completedAt:progress.completedAt??new Date().toISOString()});setPanel('journal');notify('「光的路径」已收进你的校园手册。');}} onClose={()=>setPanel(null)} nickname={nickname} connected={false} connectionNotice={<span>个人实验 · 进度自动保存，随时可以继续</span>}/></div>:<div className={`pw-panel ${panel==='map'?'wide pw-map-panel':''}`} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="solo-panel-title">
        <header><div><span className="pw-eyebrow">{region.label} · A WALK OF YOUR OWN</span><h2 id="solo-panel-title">{title}</h2></div><button className="pw-close" onClick={()=>setPanel(null)} aria-label="关闭面板"><X size={17}/></button></header>
        {panel==='commute'&&<CommutePanel mode={commuteMode} onSelect={chooseCommute}/>}
        {panel==='map'&&<SoloCampusMap key={campus} campusId={campus} campusVisits={progress.campusVisits} onCampusChange={switchCampus} onSchoolEnter={enterAtlasSchool} position={position} trackedId={target.id} completedIds={progress.visited} visitedPlaces={progress.visitedPlaces} onTrack={track} onTravel={travel}/>}
        {placePanel&&<><span className="pw-pill">{campus==='boston'?'河岸漫游':'校园漫游'} · {placeVisits.includes(placePanel.id)?'已收进手册':'新的落脚点'}</span><h3 className="solo-prompt">{placePanel.subtitle}</h3><p>{placePanel.description}</p><div className="solo-place-stamp"><Compass size={30}/><div><strong>{placePanel.title}</strong><p>{placePanel.note}</p></div></div>{placePanel.id==='bu-cds'&&<div className="solo-cds-entry"><p>公共入口在面向 Commonwealth Avenue 的两组玻璃门。走近门前，按 E 或点击「开门进入」，即可探索一层大厅和二层学习区。</p><p className="pw-muted-note">从地图快速前往 CDS，会抵达东侧入口。</p></div>}<p className="pw-muted-note">停下来转动镜头，看看来时的方向。按 P 或点击相机，可以下载此刻的风景。</p>{placeVisits.includes(placePanel.id)?<button className="pw-primary" onClick={()=>setPanel(null)}>继续漫游 <ArrowRight size={16}/></button>:<button className="pw-primary" onClick={()=>visitPlace(placePanel.id)}>记录这次到访 <Check size={16}/></button>}</>}
        {panel==='axis'&&<><span className="pw-pill">01 · 观察建筑</span><p className="solo-prompt">面向穹顶，看看中央柱廊与两侧建筑。哪一种描述最接近你眼前的布局？</p><div className="solo-answers">{['中央入口形成中轴，两翼在两侧展开','穹顶偏在庭院的一角','建筑只分布在草坪的一侧'].map((answer,index)=><button key={answer} className={observation===answer?'selected':''} onClick={()=>setObservation(answer)} aria-pressed={observation===answer}>{answer}</button>)}</div>{observation&&<p className="solo-feedback" role="status">{observation.startsWith('中央')?'你找到了：穹顶、柱廊和庭院的开阔空间，把视线引向中央。下次走近建筑时，也可以试着寻找它的视觉中心。':'再抬头看看中央柱廊，以及左右两侧的建筑。你可以关掉手册，转动镜头再观察。'}</p>}<button className="pw-primary" disabled={!observation.startsWith('中央')} onClick={()=>{finishPoint('axis');setPanel(null);notify('「庭院的中轴」已收进手册。接下来去给穹顶留一张照片。');}}>记下这个发现 <Check size={16}/></button></>}
        {panel==='dome'&&<><span className="pw-pill">02 · 留下一个视角</span><h3 className="solo-prompt">穹顶、草坪，还有此刻的光。</h3><p>关掉手册，拖动镜头，把中央穹顶放进画面。滚轮可以调整远近；准备好后点击相机，或按 P 拍照。</p><p className="pw-muted-note">在这处观景点拍下的照片，会点亮「穹顶留影」印记，并直接下载到设备。</p><button className="pw-primary" onClick={()=>setPanel(null)}>开始取景 <Camera size={16}/></button></>}
        {panel==='optics'&&<><span className="pw-pill">03 · 互动小课 · 约 5–15 分钟</span><h3 className="solo-prompt">如果光也会转弯，<br/>它会带你去哪里？</h3><p>先让一束光经过镜面，观察反射的规律；再用两面镜子，把光送到远处的接收环。你可以独自完成全部步骤。</p><ol className="solo-lesson-list"><li>观察一次反射</li><li>预测并验证角度关系</li><li>连接两面镜子，点亮终点</li></ol>{entered&&campus==='boston'&&nearestDiscovery(position)?.id==='optics'?<button className="pw-primary" onClick={()=>setPanel('lesson')}>{progress.lesson.stage>0?'继续我的实验':'开始个人实验'}<ArrowRight size={16}/></button>:<><p className="pw-muted-note">{campus==='boston'?`走到庭院的木桌旁开始实验。距离你约 ${Math.round(Math.hypot(position[0]-SOLO_DISCOVERIES[2].position[0],position[1]-SOLO_DISCOVERIES[2].position[1]))} 米。`:'这间光学工坊位于 MIT Killian Court，可以返回 Boston 继续实验。'}</p><button className="pw-primary" onClick={()=>track('optics')}>{campus==='boston'?'标记工坊方向':'前往 MIT 工坊'} <Compass size={16}/></button></>}<p className="pw-muted-note">Pulsetact 原创互动活动，不对应 MIT 正式课程或学分。</p></>}
        {panel==='journal'&&<><div className={`solo-journal-cover ${finished?'complete':''}`}><Leaf size={28}/><span>MY FIRST MIT WALK</span><h3>{finished?'MIT · 初访纪念':'属于你的三处发现'}</h3><p>{finished?'你观察过庭院，收藏过穹顶，也让一束光抵达了终点。':'不用赶路。每一个停下来的瞬间，都可以成为旅程的一部分。'}</p><strong>{progress.visited.length} / 3</strong></div><div className="solo-journal-list">{SOLO_DISCOVERIES.map((point,index)=><article key={point.id}><span className={progress.visited.includes(point.id)?'done':''}>{progress.visited.includes(point.id)?<Check size={16}/>:String(index+1).padStart(2,'0')}</span><div><h3>{point.title}</h3><p>{progress.visited.includes(point.id)?point.id==='axis'?'看见穹顶与柱廊构成的视觉中心。':point.id==='dome'?'留住属于自己的庭院视角。':'入射角等于反射角，两镜接力完成。':point.task}</p></div><button onClick={()=>track(point.id)}>{progress.visited.includes(point.id)?'再去看看':'前往'}</button></article>)}</div><p className="pw-muted-note">已下载 {progress.photos} 张照片 · 照片保存在设备的下载目录。{progress.lesson.stage>0&&!progress.visited.includes('optics')?'光学实验进度已保留。':''}</p></>}
        {panel==='journal'&&<><hr/><div className="pw-row"><h3>沿河而来的校园记忆</h3><span className="pw-pill">{progress.visitedPlaces.length} / {WORLD_DESTINATIONS.length} 已到访</span></div><p className="pw-muted-note">从 MIT 出发，走过查尔斯河，继续到 Boston University。</p><div className="solo-journal-list">{WORLD_DESTINATIONS.map((point,index)=><article key={point.id}><span className={progress.visitedPlaces.includes(point.id)?'done':''}>{progress.visitedPlaces.includes(point.id)?<Check size={16}/>:String(index+1).padStart(2,'0')}</span><div><h3>{point.title}</h3><p>{point.subtitle}</p></div><button onClick={()=>track(point.id)}>{progress.visitedPlaces.includes(point.id)?'再去看看':'前往'}</button></article>)}</div></>}
        {panel==='journal'&&<><hr/><div className="pw-row"><h3>不同校园，相遇的风景</h3><span className="pw-pill">{progress.campusVisits.length} / {ALL_CAMPUS_PLACES.length} 已到访</span></div><div className="solo-journal-list">{ALL_CAMPUS_PLACES.map((point,index)=><article key={point.id}><span className={progress.campusVisits.includes(point.id)?'done':''}>{progress.campusVisits.includes(point.id)?<Check size={16}/>:String(index+1).padStart(2,'0')}</span><div><h3>{point.title}</h3><p>{campusRegion(campusForPlace(point.id)!).short} · {point.subtitle}</p></div><button onClick={()=>track(point.id)}>前往</button></article>)}</div></>}
        {panel==='settings'&&<><div className="pw-settings-row"><span>{mobile?`画面 · ${progress.quality==='standard'?'高清材质':'省电模式'}`:'画面质量'}<small>{mobile?'高清让人物、墙面与地面更清晰，耗电会增加。每次重新打开先以省电模式进入。':'省电模式减少植被细节与阴影开销'}</small></span><button onClick={()=>changeQuality(progress.quality==='standard'?'low':'standard')}>{mobile?(progress.quality==='standard'?'切回省电':'切换高清材质'):(progress.quality==='standard'?'标准':'省电')}</button></div><div className="pw-settings-row"><span>回到{campus==='boston'?'庭院':'校园'}入口<small>找回熟悉的方向，探索记录会保留</small></span><button onClick={()=>{setCommuteMode('walk');setBoosting(false);setArrivalLookAt(undefined);setRestoredPosition(undefined);setReturnHome(value=>value+1);setPanel(null);}}>回到入口</button></div><div className="pw-settings-row auth-account-row"><span>登录账号 · {username}<small>退出后，这台设备的探索记录会保留</small></span><LogoutButton beforeLogout={()=>persist(true)}/></div><p className="pw-muted-note">WASD / 方向键行走 · Shift 快走 · 拖动观察<br/>E 互动 · V 通勤 · M 地图 · J 手册 · P 拍照 · Esc 关闭<br/>触屏设备使用左下方方向按钮，拖动画面转动镜头。</p><p className="pw-muted-note">每座校园的位置、实验和探索记录保存在当前浏览器；清除站点数据会清除记录。</p><button className="pw-secondary" onClick={leave}>保存并暂别校园</button></>}
        {panel==='profile'&&<><CharacterChoice value={characterId} onChange={chooseCharacter}/><label className="solo-name-label">旅途中，怎么称呼你？<input value={nickname} maxLength={18} onChange={event=>setNickname(event.target.value)} aria-label="修改昵称"/></label><div className="pw-color-options"><span>身份标记颜色</span>{COLORS.map((value,index)=><button key={value} aria-label={`身份颜色 ${index+1}`} aria-pressed={color===value} style={{background:value}} onClick={()=>setColor(value)}/>)}</div><Link className="solo-preview-link" to={`/characters?character=${characterId}`}>近距离预览人物 ↗</Link><p className="pw-muted-note">当前为单人探索。形象和昵称会保存在这台设备上。</p></>}
      </div>}
    </div>}
    {error&&<div className="pw-scene-error" role="alert"><div><h2>校园还没准备好</h2><p>{error}</p><button className="pw-primary" onClick={retryScene}>以省电模式重试</button></div></div>}
    {toast&&<div className="pw-toast" role="status">{toast}</div>}
  </main>;
}
