import type {MeshStandardMaterial} from 'three';

type SurfaceShader=Parameters<MeshStandardMaterial['onBeforeCompile']>[0];

// Capture the old cache key before installing a wrapper: Three's default key
// reads onBeforeCompile, so a deferred call would describe the new hook twice.
export function appendSurfaceFinish(material:MeshStandardMaterial,key:string,finish:(shader:SurfaceShader)=>void){
 const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{previous.call(material,shader,renderer);finish(shader);};
 material.customProgramCacheKey=()=>`${previousKey}|${key}`;
}

export const surfaceNoiseGLSL=`
 #ifndef CAMPUS_SURFACE_NOISE
 #define CAMPUS_SURFACE_NOISE
 float campusHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float campusNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(campusHash(i),campusHash(i+vec2(1,0)),f.x),mix(campusHash(i+vec2(0,1)),campusHash(i+vec2(1,1)),f.x),f.y);}
 float campusJoint(vec2 p,vec2 width){
  vec2 edge=min(fract(p),1.0-fract(p)),aa=max(fwidth(p),vec2(.00001));
  vec2 interior=smoothstep(width,width+aa,edge);
  return 1.0-min(interior.x,interior.y);
 }
 // Metre-scaled relief preserves the scan normal; it never displaces walkable
 // geometry or silhouettes. Fade microscopic detail before it can shimmer.
 vec3 campusRelief(vec3 existingNormal,vec3 viewPosition,float height){
  vec3 dx=dFdx(-viewPosition),dy=dFdy(-viewPosition);
  vec3 rx=cross(dy,existingNormal),ry=cross(existingNormal,dx);
  float determinant=dot(dx,rx);
  if(abs(determinant)<.00000001)return existingNormal;
  return normalize(abs(determinant)*existingNormal-sign(determinant)*(dFdx(height)*rx+dFdy(height)*ry));
 }
 #endif
`;

// Match the modelled cross-joint pitches rather than adding another heavy grid.
export function finishPaving(material:MeshStandardMaterial){
 material.normalScale.set(.14,.14);
 appendSurfaceFinish(material,'campus-paving-finish-v4',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPavingWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvPavingWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vPavingWorld;${surfaceNoiseGLSL}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 groundRelative=vPavingWorld.xz-vec2(12.904326,-34.578878);
   vec2 groundUV=vec2(dot(groundRelative,vec2(.9080005,-.4189689)),dot(groundRelative,vec2(.4189689,.9080005)));
   vec2 slabs=groundUV/2.4;
   if(abs(groundUV.x)<2.01&&groundUV.y>95.0){slabs=vec2(groundUV.x/4.0+.5,(groundUV.y-96.4)/1.6);}
   else if(abs(groundUV.x)>46.0&&abs(groundUV.x)<54.3&&groundUV.y<152.0){slabs=vec2((abs(groundUV.x)-46.0)/8.2,(groundUV.y-(groundUV.y>95.0?97.2:8.8))/2.4);}
   float pavingJoint=campusJoint(slabs,vec2(.0011));
   float pavingBlock=campusHash(floor(slabs)),pavingCloud=campusNoise(groundUV*.31)*.65+campusNoise(groundUV*1.6)*.35;
   float pavingScan=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   // Retain the photographed aggregate and pebbles. A small neutral lift softens
   // the scanned seams without compressing every grain into a pale flat color.
   vec3 aggregate=mix(diffuseColor.rgb,vec3(pavingScan)*vec3(1.035,1.015,.97),.25)*.85+vec3(.038,.037,.035);
   aggregate*=mix(.965,1.035,pavingBlock)*mix(.95,1.04,pavingCloud);
   aggregate=mix(aggregate,aggregate*vec3(.91,.92,.91),pavingJoint);
   diffuseColor.rgb=aggregate;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   roughnessFactor=clamp(roughnessFactor+(.5-pavingCloud)*.045,.82,1.0);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   float pavingDetail=1.0-smoothstep(5.0,24.0,length(vViewPosition));
   float pavingHeight=(campusNoise(groundUV*31.0)-.5)*.00045-pavingJoint*.0012;
   normal=campusRelief(normal,vViewPosition,pavingHeight*pavingDetail);
  `);
 });
}

// Photo-informed limestone courses. Fine grains reuse the local scan, while
// large concrete seams are suppressed; block sizes remain an approximation.
export function finishLimestone(material:MeshStandardMaterial){
 appendSurfaceFinish(material,'campus-limestone-courses-v3',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vStoneWorld; varying vec3 vStoneNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\nvStoneWorld=(modelMatrix*vec4(position,1.0)).xyz;vStoneNormal=normalize(mat3(modelMatrix)*normal);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vStoneWorld; varying vec3 vStoneNormal;${surfaceNoiseGLSL}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 limestoneUV=vec2(vMapUv.x*2.0,vStoneWorld.y);
   float stoneGrain=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)),0.0,1.0);
   float limestoneCloud=campusNoise(limestoneUV*.37)*.65+campusNoise(limestoneUV*2.4)*.35;
   vec3 stoneColor=mix(vec3(.505,.485,.443),vec3(.566,.543,.495),limestoneCloud)*mix(.965,1.035,stoneGrain);
   float limestoneJoint=0.0;
   if(abs(vStoneNormal.y)<.55){
    vec2 grid=vec2(limestoneUV.x/1.25+mod(floor(vStoneWorld.y/.55),2.0)*.5,vStoneWorld.y/.55);
    limestoneJoint=campusJoint(grid,vec2(.0016,.0036));
    float block=campusHash(floor(grid));
    stoneColor*=mix(.96,1.04,block);
    stoneColor=mix(stoneColor,vec3(.405,.399,.372),limestoneJoint*.26);
    float rain=pow(campusNoise(vec2(limestoneUV.x*1.8,limestoneUV.y*.065)),5.0);
    stoneColor*=1.0-rain*.12;
   }
   diffuseColor.rgb=stoneColor;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   float limestoneNear=1.0-smoothstep(8.0,45.0,length(vViewPosition));
   float limestoneHeight=(campusNoise(limestoneUV*32.0)-.5)*.0003-limestoneJoint*.0014;
   normal=campusRelief(normal,vViewPosition,limestoneHeight*limestoneNear);
  `);
 });
}

export function finishAsphalt(material:MeshStandardMaterial){
 appendSurfaceFinish(material,'campus-asphalt-finish-v2',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRoadWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRoadWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vRoadWorld;${surfaceNoiseGLSL}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   float broad=campusNoise(vRoadWorld.xz*.19)*.7+campusNoise(vRoadWorld.xz*.53)*.3;
   float fine=campusNoise(vRoadWorld.xz*24.0);
   float nearDetail=1.0-smoothstep(8.0,40.0,length(vViewPosition));
   diffuseColor.rgb*=1.0+(broad-.5)*.09+(fine-.5)*.055*nearDetail;
  `);
 });
}
