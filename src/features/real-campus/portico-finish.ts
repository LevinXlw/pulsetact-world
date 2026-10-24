import type {MeshStandardMaterial} from 'three';
import {appendSurfaceFinish,surfaceNoiseGLSL} from './surface-finish';

type Surface='wall'|'trim'|'column'|'floor';

// Physical-scale surface detail for the Building 10 study. Weathering is an
// illustrative material treatment; the reference inventory records its limits.
export function finishPorticoStone(material:MeshStandardMaterial,surface:Surface){
 const curb=material.name==='courtCurb',plinth=material.name==='courtyardPlinth';
 appendSurfaceFinish(material,`portico-stone-v4-${surface}-${curb?'curb':plinth?'plinth':'stone'}`,shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPorticoWorld; varying vec3 vPorticoNormal;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvPorticoWorld=(modelMatrix*vec4(position,1.0)).xyz;vPorticoNormal=normalize(mat3(modelMatrix)*normal);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vPorticoWorld; varying vec3 vPorticoNormal;
   ${surfaceNoiseGLSL}
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 relative=vPorticoWorld.xz-vec2(12.904326,-34.578878);
   float u=dot(relative,vec2(.9080005,-.4189689)),depth=dot(relative,vec2(.4189689,.9080005)),y=vPorticoWorld.y;
   float sideFacing=abs(dot(vPorticoNormal.xz,vec2(.9080005,-.4189689)));
   vec2 surfaceUV=abs(vPorticoNormal.y)>.65?vec2(u,depth):vec2(sideFacing>.65?depth:u,y);
   float scan=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)),0.0,1.0);
   float clouds=campusNoise(surfaceUV*.34)*.55+campusNoise(surfaceUV*1.7)*.3+campusNoise(surfaceUV*7.0)*.15;
   float grain=campusNoise(surfaceUV*41.0),stoneRelief=0.0;
   vec3 stone=mix(vec3(.468,.456,.426),vec3(.551,.531,.489),clouds);
   stone*=mix(.981,1.019,grain)*mix(.975,1.025,scan);
   ${surface==='wall'?`
    float row=floor(y/.55);
    vec2 courses=vec2(surfaceUV.x/1.25+mod(row,2.0)*.5,y/.55);
    float joint=campusJoint(courses,vec2(.0016,.0036));
    float block=campusHash(floor(courses));
    stone*=mix(.955,1.045,block);
    stone=mix(stone,vec3(.38,.378,.352),joint*.25);
    stoneRelief-=joint*.0016;
    float ledge=exp(-abs(y-20.22)*4.5)+exp(-abs(y-23.35)*5.0);
    float sill=exp(-abs(y-7.32)*3.5)+exp(-abs(y-7.96)*4.5)+exp(-abs(y-12.26)*4.5)+exp(-abs(y-16.51)*4.5);
    float streak=pow(campusNoise(vec2(surfaceUV.x*2.4,y*.055)),4.0);
    stone*=1.0-min(.15,ledge*.09*(.4+streak)+sill*.12*streak);
    float base=1.0-smoothstep(4.86,5.6,y);
    stone*=1.0-base*(.028+.052*campusNoise(vec2(surfaceUV.x*3.0,y)));
   `:surface==='column'?`
    float base=1.0-smoothstep(5.3,6.1,y);
    stone*=1.035-base*.045;
   `:surface==='floor'?`
    ${curb?`
     // The 0.4 m units are geometry already; avoid projecting an unrelated tile
     // grid onto this narrow edge or making its top look like white road paint.
     stone=vec3(.282,.274,.254)*mix(.945,1.045,clouds)*mix(.985,1.015,grain);
     stone*=mix(.90,1.0,smoothstep(.15,.8,abs(vPorticoNormal.y)));
    `:`
     vec2 slabs=vec2(u/2.05,depth/1.24);
     float joint=campusJoint(slabs,vec2(.0015));
     stone*=mix(.975,1.025,campusHash(floor(slabs)))*(1.0-joint*.085)*.94;
     stoneRelief-=joint*.0012;
    `}
   `:`stone*=${plinth?'.945':'1.018'};`}
   diffuseColor.rgb=stone;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   roughnessFactor=clamp(roughnessFactor+(.5-clouds)*.08,.77,.97);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   float stoneNear=1.0-smoothstep(6.0,32.0,length(vViewPosition));
   stoneRelief+=(grain-.5)*.00035;
   normal=campusRelief(normal,vViewPosition,stoneRelief*stoneNear);
  `);
 });
}

export function finishPorticoGlass(material:MeshStandardMaterial){
 material.roughness=.21;material.metalness=.08;
 material.transparent=true;material.opacity=material.name==='doorGlass'?.62:.52;material.depthWrite=false;
 appendSurfaceFinish(material,'portico-glazing-v2',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWindowWorld;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvWindowWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWindowWorld;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float u=dot(vWindowWorld.xz-vec2(12.904326,-34.578878),vec2(.9080005,-.4189689));
   vec2 pane=floor(vec2((u+18.0)/.70,vWindowWorld.y/.66));
   float tone=fract(sin(dot(pane,vec2(127.1,311.7)))*43758.5453);
   float lower=1.0-smoothstep(7.0,17.0,vWindowWorld.y);
   diffuseColor.rgb*=mix(.945,1.035,tone)*(1.0-lower*.13);
  `);
 });
}

// Linear RGB, shared by the ground shader and any local blade geometry.
export const courtyardTurfPalette={low:[.070,.116,.036],high:[.138,.196,.069],dry:[.17,.158,.075]} as const;

export function finishCourtyardGrass(material:MeshStandardMaterial){
 material.color.set('#bdcaa6');material.roughness=1;material.normalScale.set(.10,.10);
 appendSurfaceFinish(material,'courtyard-grass-v5',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGrassWorld;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvGrassWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vGrassWorld;
   ${surfaceNoiseGLSL}
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 relative=vGrassWorld.xz-vec2(12.904326,-34.578878);
   vec2 court=vec2(dot(relative,vec2(.9080005,-.4189689)),dot(relative,vec2(.4189689,.9080005)));
   float localCourt=(1.0-smoothstep(98.0,103.0,abs(court.x)))*smoothstep(5.0,8.0,court.y)*(1.0-smoothstep(152.0,155.0,court.y));
   float scanned=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))*4.0,0.0,1.0);
   vec2 growthWarp=vec2(campusNoise(court*.045),campusNoise(court*.045+vec2(27,61)))*3.2;
   float growth=campusNoise((court+growthWarp)*.13)*.6+campusNoise(court*.63)*.28+campusNoise(court*2.2)*.12;
   float mowingWave=sin(court.y*.5818),mowing=mowingWave/(.4+abs(mowingWave))*.075;
   float nearDetail=1.0-smoothstep(3.0,19.0,length(vViewPosition));
   float blades=campusNoise(court*vec2(37.0,14.0));
   vec3 turf=mix(vec3(${courtyardTurfPalette.low.join(',')}),vec3(${courtyardTurfPalette.high.join(',')}),smoothstep(.12,.88,growth))*mix(.94,1.045,scanned);
   turf*=1.0+mowing+(blades-.5)*.10*nearDetail;
   // The south and side lawns are divided by paths. Measure the dry margin
   // against each real patch, including the central and cross-path boundaries.
   float edgeDistance=min(46.0-abs(court.x),min(court.y-7.0,92.0-court.y));
   if(court.y>94.0){
    float endY=court.y<129.5?128.0:152.0,startY=court.y<129.5?95.0:131.0;
    edgeDistance=min(min(abs(court.x)-2.0,46.0-abs(court.x)),min(court.y-startY,endY-court.y));
   }
   if(abs(court.x)>49.0){
    float endY=court.y<129.5?128.0:139.0,startY=court.y<129.5?106.0:131.0;
    edgeDistance=min(min(abs(court.x)-51.0,97.0-abs(court.x)),min(court.y-startY,endY-court.y));
   }
   float margin=(1.0-smoothstep(0.0,.20+campusNoise(court*3.0)*.32,edgeDistance))*.14;
   turf=mix(turf,vec3(${courtyardTurfPalette.dry.join(',')}),margin);
   diffuseColor.rgb=mix(diffuseColor.rgb,turf,localCourt);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   float turfHeight=(blades-.5)*.0007*nearDetail*localCourt;
   normal=campusRelief(normal,vViewPosition,turfHeight);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   roughnessFactor=mix(roughnessFactor,.96,localCourt);
  `);
 });
}
