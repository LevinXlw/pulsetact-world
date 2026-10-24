import {useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {CanvasTexture, Mesh, SRGBColorSpace} from 'three';
import {CharacterAvatar} from './CharacterAvatar';

export function StudentAvatar({walking = false, running = false}: {walking?: boolean; running?: boolean}) {
  return <CharacterAvatar motion={running ? 'Run' : walking ? 'Walk' : 'Idle'}/>;
}

export function DiscoveryMarker({position,title,active,completed}: {position:[number,number,number];title:string;active:boolean;completed:boolean}) {
  const marker=useRef<Mesh>(null);
  useFrame(({clock})=>{if(marker.current){marker.current.position.y=2.1+Math.sin(clock.elapsedTime*1.6)*.12;marker.current.rotation.y=clock.elapsedTime*.35;}});
  const color=completed?'#aecbb3':active?'#f3d589':'#d3ddd0';
  return <group position={position}>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.065,0]}><ringGeometry args={[1.4,1.48,48]}/><meshBasicMaterial color={color} transparent opacity={.8} depthWrite={false}/></mesh>
    <mesh ref={marker} position={[0,2.1,0]}><octahedronGeometry args={[active?.23:.16]}/><meshToonMaterial color={color}/></mesh>
    {active&&<WorldLabel text={title} position={[0,2.65,0]} width={3.2} accent/>}
  </group>;
}

export function WorldLabel({text, position = [0, 2.14, 0], width = 1.15, accent = false}: {text: string; position?: [number, number, number]; width?: number; accent?: boolean}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 768; canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = accent ? '#354c43ee' : '#f6f2e5b8';
    context.beginPath(); context.roundRect(4, 4, 760, 120, 60); context.fill();
    context.fillStyle = accent ? '#f2df9a' : '#3f5652';
    context.font = '500 52px system-ui, "Microsoft YaHei", sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text.slice(0, 24), 384, 65, 680);
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace;
    return result;
  }, [text, accent]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={position} scale={[width, width / 6, 1]} renderOrder={2}><spriteMaterial map={texture} transparent depthTest depthWrite={false}/></sprite>;
}

export function LearningWorkshop({position}: {position: [number, number, number]}) {
  const marker = useRef<Mesh>(null), prism = useRef<Mesh>(null);
  useFrame(({clock}) => {
    if (marker.current) {marker.current.position.y = 4.35 + Math.sin(clock.elapsedTime * 1.4) * .12; marker.current.rotation.y = clock.elapsedTime * .38;}
    if (prism.current) prism.current.rotation.y = clock.elapsedTime * .25;
  });
  return <group position={position} rotation={[0, .432, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .045, 0]} receiveShadow><circleGeometry args={[3.8, 48]}/><meshToonMaterial color="#d1c296"/></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .06, 0]}><ringGeometry args={[3.62, 3.7, 48]}/><meshBasicMaterial color="#f4e5b8"/></mesh>
    {[-2.65, 2.65].map(x => <mesh key={x} position={[x, 1.65, -.55]} castShadow><cylinderGeometry args={[.08, .11, 3.3, 8]}/><meshToonMaterial color="#987f58"/></mesh>)}
    <mesh position={[0, 3.08, -.5]} rotation={[0, 0, .045]} castShadow><boxGeometry args={[5.55, .13, 2.8]}/><meshToonMaterial color="#7c9b78"/></mesh>
    <mesh position={[0, 2.92, .9]} castShadow><boxGeometry args={[5.55, .34, .07]}/><meshToonMaterial color="#b7c698"/></mesh>
    <mesh position={[0, 1.02, 0]} castShadow receiveShadow><cylinderGeometry args={[1.6, 1.6, .14, 32]}/><meshToonMaterial color="#ceb78b"/></mesh>
    {[-.9, .9].map(x => <mesh key={x} position={[x, .49, 0]} castShadow><boxGeometry args={[.12, .98, 1.45]}/><meshToonMaterial color="#827a5b"/></mesh>)}
    <mesh ref={prism} position={[0, 1.5, 0]} castShadow><octahedronGeometry args={[.42]}/><meshStandardMaterial color="#a3d9cf" emissive="#578b7b" emissiveIntensity={.17} roughness={.25} metalness={.18}/></mesh>
    {[-1, 1].map((x, i) => <group key={x} position={[x, 1.16, .15]}><mesh rotation={[0, 0, i ? -.35 : .35]}><boxGeometry args={[.32, .48, .06]}/><meshStandardMaterial color="#badcda" roughness={.2} metalness={.4}/></mesh><mesh position={[0, -.02, 0]}><cylinderGeometry args={[.15, .19, .08, 12]}/><meshToonMaterial color="#b89358"/></mesh></group>)}
    <mesh ref={marker} position={[0, 4.35, 0]}><octahedronGeometry args={[.34]}/><meshBasicMaterial color="#f4dc8c"/></mesh>
    <WorldLabel text="光的路径 · 学习工坊" position={[0, 3.65, 0]} width={5.2} accent/>
  </group>;
}
