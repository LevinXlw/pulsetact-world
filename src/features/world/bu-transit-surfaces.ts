import {MeshStandardMaterial} from 'three';
import {configureBUGroundLayer} from './bu-ground-layers';

/** Metre-scaled surface relief, not extra walking geometry. Stone sizes and
 * tactile dome spacing are photo-led approximations, not MBTA shop drawings. */
export function createBUTransitSurface(kind:'ballast'|'tactile'){
  const material=new MeshStandardMaterial({color:kind==='ballast'?'#a49d91':'#c9a63c',roughness:kind==='ballast'?.97:.92});
  material.name=`BU transit ${kind}`;
  material.userData.buTransitSurface=kind;
  configureBUGroundLayer(material,kind==='tactile'?'marking':'surface');
  material.customProgramCacheKey=()=>`bu-transit-${kind}-metres-v2`;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 buTransitWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nbuTransitWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec3 buTransitWorld;
vec2 buStoneHash(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
`);
    const relief=kind==='ballast'?`
vec2 bp=buTransitWorld.xz/.045,bi=floor(bp),bf=fract(bp);float bd=9.,bd2=9.,bs=0.;
for(int by=-1;by<=1;by++)for(int bx=-1;bx<=1;bx++){
  vec2 bo=vec2(float(bx),float(by)),bh=buStoneHash(bi+bo),bv=bf-bo-bh;
  float dd=dot(bv,bv);
  if(dd<bd){bd2=bd;bd=dd;bs=bh.x;}else{bd2=min(bd2,dd);}
}
float edge=max(0.,sqrt(bd2)-sqrt(bd)),stone=smoothstep(.015,.085,edge);
float buGrainFade=1.-smoothstep(10.,38.,length(vViewPosition)),buRelief=(stone*.0018+sqrt(max(0.,bd))*.0008)*buGrainFade;
diffuseColor.rgb*=mix(.94,mix(.77,.88+bs*.20,stone),buGrainFade);
`:`
vec2 tp=buTransitWorld.xz/.060;vec2 tc=fract(tp)-.5;
float td=length(tc),dome=1.-smoothstep(.105,.215,td);
float buGrainFade=1.-smoothstep(8.,32.,length(vViewPosition)),buRelief=dome*.0035*buGrainFade;
diffuseColor.rgb*=.95+.05*dome*buGrainFade;
`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>\n${relief}`);
    // Perturb the actual shaded surface normal so the small raised features
    // respond to the world light. Geometry and collision heights stay intact.
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
vec3 buDx=dFdx(-vViewPosition),buDy=dFdy(-vViewPosition);
vec3 buRx=cross(buDy,normal),buRy=cross(normal,buDx);float buDet=dot(buDx,buRx);
normal=normalize(abs(buDet)*normal-sign(buDet)*(dFdx(buRelief)*buRx+dFdy(buRelief)*buRy));
`);
  };
  return material;
}
