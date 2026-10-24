import {useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {ACESFilmicToneMapping, DirectionalLight, Group, PerspectiveCamera, Vector3} from 'three';
import {loadWorldAssets, type WorldAssets} from './scene-assets';
import {DiscoveryMarker, LearningWorkshop, WorldLabel} from './scene-actors';
import {WORLD_DOME, WORKSHOP_POSITION} from './world-locations';
import {CharacterAvatar} from './CharacterAvatar';
import {normalizePlayableCharacter, type CharacterId, type CharacterMotion, type PlayableCharacterId} from './character-catalog';
import {campusSpawn,campusLookTarget,campusPlaces,walkableCampus,type CampusId} from './campus-regions';
import {WORLD_DESTINATIONS} from './world-destinations';
import {resolveWorldArrival} from './world-arrival';
import {isMobileWorld} from './mobile-device';
import {BOSTON_DAYLIGHT} from './campus-daylight';
import {isInsideCDSInterior} from './cds-interior-layout';
import {CDS_DOORS,CDS_DOOR_BY_ID,cdsLocalToWorld,type CDSDoorId} from './cds-door-layout';
import {CDSDoors} from './CDSDoors';

export type CharacterReview = {id: CharacterId; motion: CharacterMotion; angle: number; close: boolean};

export type WorldPlayer = {
  id: string;
  nickname: string;
  color: string;
  characterId?: PlayableCharacterId;
  position: [number, number];
  yaw: number;
};
type WorldSceneProps = {
  interior?:'cds';
  interiorDoor?:CDSDoorId;
  activeDoor?:CDSDoorId|null;
  openingDoor?:CDSDoorId|null;
  onDoorOpened?:()=>void;
  mobile?:boolean;
  allowMobileHd?:boolean;
  campusId?:CampusId;
  paused: boolean;
  suspendRendering?: boolean;
  quality: 'standard' | 'low';
  players: WorldPlayer[];
  selfId: string;
  onMove: (position: [number, number], yaw: number, height?:number) => void;
  onInteract: () => void;
  onReady: () => void;
  onError: (message: string) => void;
  moveInput?: {x: number; z: number};
  returnHome?: number;
  characterId?: PlayableCharacterId;
  characterReview?: CharacterReview;
  onCharacterReady?: () => void;
  initialPosition?: [number, number];
  arrivalLookAt?: [number, number];
  onHeadingChange?: (heading: number, domeInFrame: boolean) => void;
  restoredPosition?: [number, number];
  onPositionRestored?: (position: [number, number]) => void;
  discoveries?: {id:string;title:string;position:[number,number];active:boolean;completed:boolean}[];
};

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

function RemoteStudent({player, assets, quality}: {player: WorldPlayer; assets: WorldAssets; quality: 'standard'|'low'}) {
  const group = useRef<Group>(null);
  const previous = useRef<[number, number]>(player.position);
  const moveUntil = useRef(0);
  const previousAt = useRef(performance.now());
  const movementSpeed = useRef(0);
  const [motion, setMotion] = useState<CharacterMotion>('Idle');
  const groundHeight = useMemo(() => assets.collision.groundHeight(...player.position) ?? 3, [assets, player.position[0], player.position[1]]);
  useEffect(() => {
    const now = performance.now();
    const distance = Math.hypot(player.position[0] - previous.current[0], player.position[1] - previous.current[1]);
    if (distance > .04) {
      moveUntil.current = now + 350;
      const elapsed = (now - previousAt.current) / 1000;
      movementSpeed.current = distance / (elapsed > .5 ? .1 : Math.max(.08, elapsed));
      previousAt.current = now;
    }
    previous.current = player.position;
  }, [player.position]);
  useFrame((_, dt) => {
    if (!group.current) return;
    const alpha = 1 - Math.exp(-12 * dt);
    group.current.position.x += (player.position[0] - group.current.position.x) * alpha;
    group.current.position.z += (player.position[1] - group.current.position.z) * alpha;
    group.current.position.y += (groundHeight - group.current.position.y) * alpha;
    group.current.rotation.y += wrapAngle(player.yaw - group.current.rotation.y) * alpha;
    const next = performance.now() < moveUntil.current ? (movementSpeed.current > 5.4 ? 'Run' : 'Walk') : 'Idle';
    if (next !== motion) setMotion(next);
  });
  return <group ref={group} userData={{playerId: player.id}} position={[player.position[0], groundHeight, player.position[1]]} rotation={[0, player.yaw, 0]}>
    <CharacterAvatar key={normalizePlayableCharacter(player.characterId)} id={normalizePlayableCharacter(player.characterId)} motion={motion} quality={quality}/>
    <WorldLabel text={player.nickname}/>
  </group>;
}

function CampusWorld(props: WorldSceneProps) {
  const indoor=props.interior==='cds';
  const doorway=CDS_DOOR_BY_ID[props.interiorDoor??'east'].interior;
  const campusId=props.campusId??'boston',spawn=indoor?doorway.position:campusSpawn(campusId),lookTarget=indoor?doorway.lookAt:campusLookTarget(campusId);
  const initialYaw=Math.atan2(spawn[0]-lookTarget[0],spawn[1]-lookTarget[1]);
  const initialPitch=indoor?-.12:campusId==='umd'?.14:campusId==='arizona'?.08:.025,initialDistance=indoor?3.2:campusId==='umd'?7.2:campusId==='arizona'?7:5.8;
  const lighting=useMemo(()=>{
    // Eastern morning light reveals the depth of McKeldin's east-facing front.
    const offset=campusId==='umd'?new Vector3(110,135,90):new Vector3(...BOSTON_DAYLIGHT.offset);
    const right=new Vector3().crossVectors(new Vector3(0,1,0),offset).normalize();
    return {offset,right,up:new Vector3().crossVectors(offset,right).normalize()};
  },[campusId]);
  const {camera, gl, scene} = useThree();
  const [assets, setAssets] = useState<WorldAssets | null>(null);
  // Fast Refresh replays effects while retaining state. Invalidate ownership
  // synchronously before disposing collision so replayed effects cannot query
  // the previous, already-cleared scene while its replacement is loading.
  const ownedAssets = useRef<WorldAssets | null>(null);
  const selectedCharacter = props.characterReview?.id ?? normalizePlayableCharacter(props.characterId);
  const characterVersion=`${selectedCharacter}:${props.mobile?props.quality:'desktop'}`;
  const characterLoad=useMemo(()=>({version:characterVersion}),[characterVersion]);
  const [readyCharacter, setReadyCharacter] = useState<typeof characterLoad|null>(null);
  const characterReady=readyCharacter===characterLoad;
  const [walking, setWalking] = useState(false), [running, setRunning] = useState(false);
  const live = useRef(props); live.current = props;
  const point = useRef(new Vector3(spawn[0], 3, spawn[1]));
  const actor = useRef<Group>(null), sun = useRef<DirectionalLight>(null);
  const keys = useRef(new Set<string>()), speed = useRef(0), yaw = useRef(initialYaw + Math.PI);
  const look = useRef({yaw: initialYaw, pitch: initialPitch, distance: initialDistance});
  const drag = useRef<{id: number; x: number; y: number} | null>(null);
  const movedAt = useRef(0), firstCamera = useRef(true);
  const placed = useRef(false);
  const scratch = useRef({direction: new Vector3(), forward: new Vector3(), right: new Vector3(), next: new Vector3(), origin: new Vector3(), camera: new Vector3(), ray: new Vector3(), aim: new Vector3(), projected: new Vector3()});

  useEffect(()=>{
    const lost=(event:Event)=>{
      event.preventDefault();
      live.current.onError('画面渲染已中断，请以省电模式重试。探索记录会保留。');
    };
    gl.domElement.addEventListener('webglcontextlost',lost);
    const capture=()=>gl.render(scene,camera);
    gl.domElement.addEventListener('world-capture',capture);
    return()=>{gl.domElement.removeEventListener('webglcontextlost',lost);gl.domElement.removeEventListener('world-capture',capture);};
  },[gl,scene,camera]);

  useEffect(() => {
    const abort = new AbortController(); let owned: WorldAssets | null = null;
    setAssets(null);
    const loading=indoor?import('./cds-interior-assets').then(({loadCDSInteriorAssets})=>loadCDSInteriorAssets(abort.signal,props.mobile??false)):loadWorldAssets(abort.signal,campusId,props.mobile);
    void loading.then(result => {
      if (abort.signal.aborted) {result.dispose(); return;}
      owned = result; ownedAssets.current = result;
      point.current.y = result.collision.groundHeight(...spawn,indoor?0:undefined) ?? (indoor?0:3);
      setAssets(result);
    }).catch(error => {
      if (!abort.signal.aborted) live.current.onError(error instanceof Error ? error.message : '校园场景加载失败，请重新进入');
    });
    return () => {
      abort.abort();
      if (ownedAssets.current === owned) ownedAssets.current = null;
      owned?.dispose();
    };
  }, []);

  useEffect(() => {if (assets && assets === ownedAssets.current && characterReady) live.current.onReady();}, [assets, characterReady]);

  useEffect(() => {
    const clear = () => {keys.current.clear(); speed.current = 0; drag.current = null;};
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (live.current.paused || /INPUT|TEXTAREA|SELECT/.test(target?.tagName) || target?.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {event.preventDefault(); keys.current.add(key);}
      if (key === 'e' && !event.repeat) live.current.onInteract();
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const start = (event: PointerEvent) => {
      if (live.current.paused || event.button !== 0) return;
      drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY};
      gl.domElement.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const previous = drag.current;
      if (!previous || previous.id !== event.pointerId || live.current.paused) return;
      look.current.yaw -= (event.clientX - previous.x) * .004;
      look.current.pitch = Math.max(-.55, Math.min(.5, look.current.pitch - (event.clientY - previous.y) * .003));
      previous.x = event.clientX; previous.y = event.clientY;
    };
    const end = () => {drag.current = null;};
    const wheel = (event: WheelEvent) => {
      if (live.current.paused) return;
      event.preventDefault();
      look.current.distance = Math.max(indoor?1.5:4.5, Math.min(indoor?6:15, look.current.distance + event.deltaY * .007));
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    gl.domElement.addEventListener('pointerdown', start); gl.domElement.addEventListener('pointermove', move);
    gl.domElement.addEventListener('pointerup', end); gl.domElement.addEventListener('pointercancel', end); gl.domElement.addEventListener('lostpointercapture', end);
    gl.domElement.addEventListener('wheel', wheel, {passive: false});
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      gl.domElement.removeEventListener('pointerdown', start); gl.domElement.removeEventListener('pointermove', move);
      gl.domElement.removeEventListener('pointerup', end); gl.domElement.removeEventListener('pointercancel', end); gl.domElement.removeEventListener('lostpointercapture', end);
      gl.domElement.removeEventListener('wheel', wheel);
    };
  }, [gl]);
  useEffect(() => {if (props.paused) {keys.current.clear(); speed.current = 0; drag.current = null;}}, [props.paused]);
  useEffect(()=>{
    if(!props.openingDoor)return;
    const door=CDS_DOOR_BY_ID[props.openingDoor],center=indoor?door.local:cdsLocalToWorld(door.local);
    const doorYaw=Math.atan2(point.current.x-center[0],point.current.z-center[1]);
    look.current={yaw:doorYaw,pitch:-.08,distance:indoor?3.2:4.5};
    yaw.current=doorYaw+Math.PI;firstCamera.current=true;
  },[props.openingDoor]);
  useEffect(() => {if (assets && assets === ownedAssets.current) assets.setQuality(props.quality === 'low');}, [assets, props.quality]);
  useEffect(() => {
    if (!assets || assets !== ownedAssets.current) return;
    // Leave room for people already at the entrance instead of stacking avatars.
    let entrance: [number, number] = [...spawn];
    for (const offset of [0, -1.8, 1.8, -3.6, 3.6, -5.4, 5.4]) {
      const candidate: [number, number] = [spawn[0] + Math.cos(initialYaw) * offset, spawn[1] - Math.sin(initialYaw) * offset];
      if (!live.current.players.some(player => player.id !== live.current.selfId && Math.hypot(player.position[0] - candidate[0], player.position[1] - candidate[1]) < 1.2)) {entrance = candidate; break;}
    }
    const arrival=indoor?{position:[...spawn] as [number,number],height:assets.collision.groundHeight(...spawn,0)??0}:resolveWorldArrival(campusId,!placed.current&&props.initialPosition?props.initialPosition:entrance,(x,z)=>assets.collision.groundHeight(x,z));
    if(!arrival){live.current.onError('找不到可安全落脚的校园入口，请重新加载场景。');return;}
    entrance=arrival.position;
    const explicitLook=!placed.current&&!indoor?props.arrivalLookAt:undefined;
    placed.current = true;
    point.current.set(entrance[0], arrival.height, entrance[1]);
    const destination=indoor?undefined:(campusId==='boston'?WORLD_DESTINATIONS:campusPlaces(campusId)).find(place=>place.lookAt&&Math.hypot(place.position[0]-entrance[0],place.position[1]-entrance[1])<1);
    const entryLook=explicitLook??destination?.lookAt;
    const entryYaw=entryLook?Math.atan2(entrance[0]-entryLook[0],entrance[1]-entryLook[1]):initialYaw;
    look.current = {yaw: entryYaw, pitch: explicitLook?-.08:destination?.view?.pitch??initialPitch, distance: explicitLook?4.5:destination?.view?.distance??initialDistance};
    yaw.current = entryYaw + Math.PI; firstCamera.current = true;
    live.current.onMove(entrance, yaw.current, point.current.y);
  }, [props.returnHome, props.selfId, assets]);
  useEffect(() => {
    if(indoor||!assets||assets!==ownedAssets.current||!props.restoredPosition)return;
    const fallback:[number,number]=campusId==='boston'?[...spawn]:[point.current.x,point.current.z];
    const arrival=resolveWorldArrival(campusId,props.restoredPosition,(x,z)=>assets.collision.groundHeight(x,z),fallback);
    if(arrival){
      const [x,z]=arrival.position;
      point.current.set(x,arrival.height,z);firstCamera.current=true;
      const destination=(campusId==='boston'?WORLD_DESTINATIONS:campusPlaces(campusId)).find(place=>place.lookAt&&Math.hypot(place.position[0]-x,place.position[1]-z)<.1);
      const arrivalLook=props.arrivalLookAt??destination?.lookAt;
      if(arrivalLook){
        const arrivalYaw=Math.atan2(x-arrivalLook[0],z-arrivalLook[1]);
        look.current={yaw:arrivalYaw,pitch:props.arrivalLookAt?-.08:destination?.view?.pitch??initialPitch,distance:props.arrivalLookAt?4.5:destination?.view?.distance??initialDistance};yaw.current=arrivalYaw+Math.PI;
      }
    }else{live.current.onError('找不到可安全落脚的校园入口，请重新加载场景。');return;}
    const restored:[number,number]=[point.current.x,point.current.z];
    live.current.onPositionRestored?.(restored);
    live.current.onMove(restored,yaw.current,point.current.y);
  },[assets,props.restoredPosition]);

  useFrame((_, delta) => {
    if (!assets || assets !== ownedAssets.current || !actor.current) return;
    const dt = Math.min(delta, .05), v = scratch.current, k = keys.current;
    assets.wind.value += dt;
    const active = !props.paused && !document.hidden;
    const dx = active ? Number(k.has('d') || k.has('arrowright')) - Number(k.has('a') || k.has('arrowleft')) + (props.moveInput?.x ?? 0) : 0;
    const dz = active ? Number(k.has('w') || k.has('arrowup')) - Number(k.has('s') || k.has('arrowdown')) + (props.moveInput?.z ?? 0) : 0;
    let moving = false;
    const isRunning = active && k.has('shift');
    if (dx || dz) {
      v.forward.set(-Math.sin(look.current.yaw), 0, -Math.cos(look.current.yaw));
      v.right.set(-v.forward.z, 0, v.forward.x);
      v.direction.copy(v.forward).multiplyScalar(dz).addScaledVector(v.right, dx).normalize();
      speed.current += ((isRunning ? 7.2 : 3.6) - speed.current) * (1 - Math.exp(-10 * dt));
      const step = speed.current * dt;
      const tryStep = (x: number, z: number) => {
        v.next.set(point.current.x + x, point.current.y, point.current.z + z);
        if (indoor?!isInsideCDSInterior(v.next.x,v.next.z):!walkableCampus(campusId,v.next.x,v.next.z)) return false;
        // The authored room has real holes; closed runtime doors still stop
        // the avatar's body before its centre reaches the glass plane.
        if(indoor&&point.current.y<1&&CDS_DOORS.some(door=>Math.abs(v.next.x-door.local[0])<door.width/2+.34&&v.next.z>door.local[1]-.36))return false;
        if (!indoor&&campusId==='boston'&&Math.hypot(v.next.x - WORKSHOP_POSITION[0], v.next.z - WORKSHOP_POSITION[1]) < 1.95) return false;
        const height = assets.collision.groundHeight(v.next.x, v.next.z,indoor?point.current.y:undefined);
        if (height === undefined || Math.abs(height - point.current.y) > .68) return false;
        v.origin.copy(point.current).y += .9;
        v.ray.set(x, 0, z).normalize();
        if (assets.collision.distance(v.origin, v.ray, Math.hypot(x, z) + .34) !== undefined) return false;
        if(indoor){
          // Catch low benches/table edges that the chest ray passes over.
          // Raise this probe above the next valid tread so stairs stay clear.
          v.origin.y=Math.max(point.current.y,height)+.34;
          if(assets.collision.distance(v.origin,v.ray,Math.hypot(x,z)+.34)!==undefined)return false;
        }
        v.next.y = height; point.current.copy(v.next); return true;
      };
      moving = tryStep(v.direction.x * step, v.direction.z * step);
      // Sliding along a facade prevents the character sticking to its edge.
      if (!moving && Math.abs(v.direction.x) > .01 && Math.abs(v.direction.z) > .01) moving = tryStep(v.direction.x * step, 0) || tryStep(0, v.direction.z * step);
      if (moving) yaw.current += wrapAngle(Math.atan2(v.direction.x, v.direction.z) - yaw.current) * (1 - Math.exp(-13 * dt));
    } else speed.current = 0;
    actor.current.position.copy(point.current);
    actor.current.rotation.y = props.characterReview ? initialYaw + props.characterReview.angle : yaw.current;
    if (moving !== walking) setWalking(moving);
    if ((moving && isRunning) !== running) setRunning(moving && isRunning);

    const view = look.current;
    const review = props.characterReview;
    const cameraYaw = review ? initialYaw : view.yaw;
    const cameraDistance = review ? (review.close ? 1.55 : 4.6) : view.distance;
    v.camera.set(point.current.x + Math.sin(cameraYaw) * cameraDistance, point.current.y + (review ? (review.close ? 1.53 : .9) : 2.05), point.current.z + Math.cos(cameraYaw) * cameraDistance);
    v.aim.copy(point.current).y += review ? (review.close ? 1.48 : .65) : 1.25;
    v.ray.copy(v.camera).sub(v.aim);
    const length = v.ray.length(); v.ray.normalize();
    const obstruction = assets.collision.distance(v.aim, v.ray, length, true);
    if (obstruction !== undefined) v.camera.copy(v.aim).addScaledVector(v.ray, Math.max(indoor?.12:1, obstruction - (indoor?.16:.25)));
    // Indoors, follow the collision-safe ray immediately: blending two safe
    // camera positions around a corner can otherwise cut through its wall.
    camera.position.lerp(v.camera, firstCamera.current || indoor ? 1 : 1 - Math.exp(-14 * dt));
    actor.current.visible=!indoor||camera.position.distanceTo(v.aim)>.65;
    assets.update(camera.position,dt);
    if (review) camera.lookAt(v.aim);
    else camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
    firstCamera.current = false;
    if (camera instanceof PerspectiveCamera) {
      const targetFov = review ? 36 : running ? 57 : 52;
      if (Math.abs(camera.fov - targetFov) > .01) {camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4 * dt)); camera.updateProjectionMatrix();}
    }
    if (sun.current) {
      // Snap in the light's image plane, so walking doesn't move shadow edges
      // between texels or make the whole shadow map jump at each world meter.
      const target = sun.current.target.position;
      target.set(point.current.x, point.current.y, point.current.z);
      const texel = 190 / (props.mobile || props.quality === 'low' ? 1024 : 4096);
      for (const axis of [lighting.right, lighting.up]) {
        const projected = target.dot(axis);
        target.addScaledVector(axis, Math.round(projected / texel) * texel - projected);
      }
      sun.current.position.copy(target).add(lighting.offset);
      sun.current.target.updateMatrixWorld();
    }
    movedAt.current += dt;
    if (movedAt.current > .1) {
      movedAt.current = 0;
      props.onMove([point.current.x, point.current.z], yaw.current, point.current.y);
      // Dome vertical bounds come from the surveyed Killian detail manifest.
      const inFrame=!indoor&&campusId==='boston'&&[37.52,47.57].every(height=>{v.projected.set(WORLD_DOME[0],height,WORLD_DOME[1]).project(camera);return Math.abs(v.projected.x)<.72&&Math.abs(v.projected.y)<.94&&v.projected.z>-1&&v.projected.z<1;});
      props.onHeadingChange?.(look.current.yaw,inFrame);
      if (import.meta.env.DEV) {
        const renderedCharacters: {playerId: string; characterId: CharacterId; motion: CharacterMotion}[] = [];
        const doorHinges:{name:string;angle:number}[]=[];
        scene.traverse(object => {
          if(/^cds-door-(west|east)-(left|right)$/.test(object.name))doorHinges.push({name:object.name,angle:object.rotation.y});
          if (object.name === 'campus-character' && object.userData.characterId) renderedCharacters.push({
            playerId: object.parent?.userData.playerId, characterId: object.userData.characterId, motion: object.userData.motion,
          });
        });
        (window as unknown as {__worldScene: unknown}).__worldScene = {
        campusId,interior:props.interior??null,doorHinges,mobile:props.mobile,geometryCount:gl.info.memory.geometries,textureCount:gl.info.memory.textures,position: point.current.toArray(), cameraPosition: camera.position.toArray(), yaw: yaw.current,
        players: props.players.length, walking: moving, calls: gl.info.render.calls, triangles: gl.info.render.triangles,
        workshop: WORKSHOP_POSITION, workshopDistance: Math.hypot(point.current.x - WORKSHOP_POSITION[0], point.current.z - WORKSHOP_POSITION[1]),
        quality: props.quality, objectCount: scene.children.length, domeInFrame: inFrame,
        character: selectedCharacter, characterReady, selfId: props.selfId, renderedCharacters,
        characterMotion: props.characterReview?.motion ?? (running ? 'Run' : walking ? 'Walk' : 'Idle'),
        };
      }
    }
  });

  return <>
    <hemisphereLight args={[indoor?'#fff4df':'#c2d8f2',indoor?'#91988b':campusId==='arizona'?'#c7b18b':campusId==='boston'?BOSTON_DAYLIGHT.ground:'#b6b09e',indoor?1.0:campusId==='umd'?1.2:campusId==='arizona'?1.3:campusId==='boston'?BOSTON_DAYLIGHT.ambient:1.6]}/>
    <directionalLight ref={sun} position={[-95, 115, 135]} intensity={indoor?1.1:campusId==='boston'?BOSTON_DAYLIGHT.intensity:2.9} color={campusId==='boston'?BOSTON_DAYLIGHT.sun:'#fff5dc'} castShadow={!props.mobile} shadow-mapSize={[props.mobile || props.quality === 'low' ? 1024 : 4096, props.mobile || props.quality === 'low' ? 1024 : 4096]} shadow-camera-left={-95} shadow-camera-right={95} shadow-camera-top={95} shadow-camera-bottom={-95} shadow-camera-near={1} shadow-camera-far={390} shadow-bias={-.00008} shadow-normalBias={.035} shadow-radius={3}/>
    {assets && <>
      <primitive object={assets.model}/>
      {(indoor||campusId==='boston')&&<CDSDoors inside={indoor} activeDoor={props.activeDoor??null} openingDoor={props.openingDoor??null} onOpened={props.onDoorOpened}/>}
      <group ref={actor} userData={{playerId: props.selfId}}><CharacterAvatar key={characterVersion} id={selectedCharacter} quality={props.quality} motion={props.characterReview?.motion ?? (running ? 'Run' : walking ? 'Walk' : 'Idle')} onReady={()=>{setReadyCharacter(characterLoad);live.current.onCharacterReady?.();}} onError={props.onError}/></group>
      {props.players.filter(player => player.id !== props.selfId).map(player => <RemoteStudent key={player.id} player={player} assets={assets} quality={props.quality}/>)}
      {!indoor&&campusId==='boston'&&<LearningWorkshop position={[WORKSHOP_POSITION[0], assets.collision.groundHeight(...WORKSHOP_POSITION) ?? 3, WORKSHOP_POSITION[1]]}/>}
      {props.discoveries?.map(discovery => <DiscoveryMarker key={discovery.id} title={discovery.title} active={discovery.active} completed={discovery.completed} position={[discovery.position[0],assets.collision.groundHeight(...discovery.position) ?? 3,discovery.position[1]]}/>)}
    </>}
  </>;
}

export default function WorldScene(props: WorldSceneProps) {
  const [mobile]=useState(()=>props.mobile??isMobileWorld());
  const quality=mobile&&!props.allowMobileHd?'low':props.quality;
  const desert=props.campusId==='arizona',haze=props.interior?'#c8d6d5':desert?'#d4dfd7':'#c5d9d5';
  return <Canvas frameloop={props.suspendRendering ? 'never' : 'always'} shadows={mobile || quality === 'low' ? false : 'soft'} dpr={quality === 'low' ? 1 : [1, 1.5]} camera={{position: [57, 6, 60], fov: 52, near: .12, far: 4200}} gl={{antialias: !mobile, preserveDrawingBuffer: !mobile,powerPreference:mobile?'low-power':'default', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.0}}>
    <color attach="background" args={[haze]}/>
    {!props.interior&&<fog attach="fog" args={[haze,desert?240:180,desert?2800:2600]}/>}
    <CampusWorld key={props.interior??props.campusId??'boston'} {...props} mobile={mobile} quality={quality}/>
  </Canvas>;
}
