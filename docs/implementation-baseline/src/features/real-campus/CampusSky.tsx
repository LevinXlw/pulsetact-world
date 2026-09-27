import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {BackSide,Color,Float32BufferAttribute,Mesh,MeshBasicMaterial,SphereGeometry} from 'three';
export function CampusSky(){
 const mesh=useRef<Mesh>(null);
 const geometry=useMemo(()=>{const g=new SphereGeometry(1400,24,12),p=g.getAttribute('position'),colors=[];
  const horizon=new Color('#bdd6e8'),zenith=new Color('#3486c4');
  for(let i=0;i<p.count;i++){const c=horizon.clone().lerp(zenith,Math.max(0,Math.min(1,p.getY(i)/1000)));colors.push(c.r,c.g,c.b);}
  g.setAttribute('color',new Float32BufferAttribute(colors,3));return g;
 },[]);
 const material=useMemo(()=>{
  const m=new MeshBasicMaterial({vertexColors:true,side:BackSide,depthWrite:false,fog:false});
  m.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSkyRay;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSkyRay=position;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
    varying vec3 vSkyRay;
    float skyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(skyHash(i),skyHash(i+vec2(1,0)),f.x),mix(skyHash(i+vec2(0,1)),skyHash(i+vec2(1,1)),f.x),f.y);}
   `);
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec3 direction=normalize(vSkyRay);
    vec2 uv=direction.xz/(max(direction.y,0.0)+.22)*2.6+vec2(5.7,12.1);
    float cloud=skyNoise(uv)*.53+skyNoise(uv*2.07)*.27+skyNoise(uv*4.13)*.13+skyNoise(uv*8.31)*.07;
    float veil=smoothstep(.51,.73,cloud)*smoothstep(.035,.24,direction.y)*.55;
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.82,.855,.88),veil);
   `);
  };
  m.customProgramCacheKey=()=> 'campus-summer-sky-v2';return m;
 },[]);
 useEffect(()=>()=>{geometry.dispose();material.dispose();},[geometry,material]);useFrame(({camera})=>mesh.current?.position.copy(camera.position));
 return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={-1}/>;
}
