import type {MeshStandardMaterial} from 'three';

// Metre-scaled finishing on existing geometry, not a surveyed paving layout.
export function finishPaving(material:MeshStandardMaterial){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPavingWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvPavingWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vPavingWorld;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 groundUV=vec2(dot(vPavingWorld.xz,vec2(.908,-.41897)),dot(vPavingWorld.xz,vec2(.41897,.908)));
   vec2 cell=groundUV/1.5, edge=min(fract(cell),1.0-fract(cell));
   vec2 aa=max(fwidth(cell),vec2(.001));
   vec2 inside=smoothstep(vec2(.002),vec2(.002)+aa,edge);
   float seam=1.0-min(inside.x,inside.y);
   float variation=fract(sin(dot(floor(cell),vec2(127.1,311.7)))*43758.5453);
   diffuseColor.rgb*=mix(.95,1.04,variation)*(1.0-seam*.18);
  `);
 };material.customProgramCacheKey=()=> 'campus-paving-finish-v1';
}

// Photo-informed limestone courses. Fine grains reuse the local scan, while
// large concrete seams are suppressed; block sizes remain an approximation.
export function finishLimestone(material:MeshStandardMaterial){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vStoneWorld; varying vec3 vStoneNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\nvStoneWorld=(modelMatrix*vec4(position,1.0)).xyz;vStoneNormal=normalize(mat3(modelMatrix)*normal);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vStoneWorld; varying vec3 vStoneNormal;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   float grain=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   vec3 stoneColor=vec3(.58,.55,.48)*mix(.93,1.07,clamp(grain,0.0,1.0));
   if(abs(vStoneNormal.y)<.55){
    float along=vMapUv.x*2.0;
    vec2 grid=vec2(along/1.25+mod(floor(vStoneWorld.y/.55),2.0)*.5,vStoneWorld.y/.55);
    vec2 edge=min(fract(grid),1.0-fract(grid)),aa=max(fwidth(grid),vec2(.001));
    vec2 mask=smoothstep(vec2(.002),vec2(.002)+aa,edge);
    float block=fract(sin(dot(floor(grid),vec2(127.1,311.7)))*43758.5453);
    stoneColor*=mix(.97,1.025,block)*mix(.96,1.0,min(mask.x,mask.y));
   }
   diffuseColor.rgb=stoneColor;
  `);
 };material.customProgramCacheKey=()=> 'campus-limestone-courses-v1';
}

export function finishAsphalt(material:MeshStandardMaterial){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRoadWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRoadWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRoadWorld;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   float broad=sin(vRoadWorld.x*.29+sin(vRoadWorld.z*.17))*sin(vRoadWorld.z*.41);
   float fine=fract(sin(dot(floor(vRoadWorld.xz*24.0),vec2(127.1,311.7)))*43758.5453);
   float nearDetail=1.0-smoothstep(8.0,40.0,length(vViewPosition));
   diffuseColor.rgb*=1.0+broad*.035+(fine-.5)*.05*nearDetail;
  `);
 };material.customProgramCacheKey=()=> 'campus-asphalt-finish-v1';
}
