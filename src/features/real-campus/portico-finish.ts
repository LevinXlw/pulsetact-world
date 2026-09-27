import type {MeshStandardMaterial} from 'three';

type Surface='wall'|'trim'|'column'|'floor';

// Physical-scale surface detail for the Building 10 study. Weathering is an
// illustrative material treatment; the reference inventory records its limits.
export function finishPorticoStone(material:MeshStandardMaterial,surface:Surface){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPorticoWorld; varying vec3 vPorticoNormal;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvPorticoWorld=(modelMatrix*vec4(position,1.0)).xyz;vPorticoNormal=normalize(mat3(modelMatrix)*normal);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vPorticoWorld; varying vec3 vPorticoNormal;
   float stoneHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float stoneNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(stoneHash(i),stoneHash(i+vec2(1,0)),f.x),mix(stoneHash(i+vec2(0,1)),stoneHash(i+vec2(1,1)),f.x),f.y);}
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 relative=vPorticoWorld.xz-vec2(12.904326,-34.578878);
   float u=dot(relative,vec2(.9080005,-.4189689)),depth=dot(relative,vec2(.4189689,.9080005)),y=vPorticoWorld.y;
   vec2 surfaceUV=abs(vPorticoNormal.y)>.65?vec2(u,depth):vec2(abs(vPorticoNormal.x)>.75?depth:u,y);
   float scan=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)),0.0,1.0);
   float clouds=stoneNoise(surfaceUV*.64)*.6+stoneNoise(surfaceUV*2.15)*.4;
   float grain=stoneNoise(surfaceUV*41.0);
   vec3 stone=vec3(.515,.492,.447);
   stone*=mix(.94,1.055,clouds)*mix(.982,1.018,grain)*mix(.965,1.025,scan);
   ${surface==='wall'?`
    float row=floor(y/.55);
    vec2 courses=vec2(surfaceUV.x/1.25+mod(row,2.0)*.5,y/.55);
    vec2 edge=min(fract(courses),1.0-fract(courses)),aa=max(fwidth(courses),vec2(.0002));
    float joint=1.0-min(smoothstep(vec2(.0018),vec2(.0018)+aa,edge).x,smoothstep(vec2(.0018),vec2(.0018)+aa,edge).y);
    float block=stoneHash(floor(courses));
    stone*=mix(.935,1.065,block);
    stone=mix(stone,vec3(.59,.565,.52),joint*.36);
    float ledge=exp(-abs(y-20.73)*4.5)+exp(-abs(y-23.35)*5.0);
    float streak=pow(stoneNoise(vec2(u*2.6,y*.06)),3.0);
    stone*=1.0-min(.28,ledge*.24*(.4+streak*2.0));
    float base=1.0-smoothstep(4.86,5.6,y);
    stone*=1.0-base*(.035+.065*stoneNoise(vec2(u*3.0,y)));
   `:surface==='column'?`
    float base=1.0-smoothstep(5.3,6.1,y);
    stone*=1.035-base*.045;
   `:surface==='floor'?`
    vec2 slabs=vec2(u/2.05,depth/1.24),edge=min(fract(slabs),1.0-fract(slabs)),aa=max(fwidth(slabs),vec2(.0003));
    vec2 inside=smoothstep(vec2(.0015),vec2(.0015)+aa,edge);
    float joint=1.0-min(inside.x,inside.y);
    stone*=mix(.955,1.04,stoneHash(floor(slabs)))*(1.0-joint*.12);
    stone*=.94;
   `:`stone*=1.025;`}
   diffuseColor.rgb=stone;
  `);
 };
 material.customProgramCacheKey=()=>`portico-stone-v1-${surface}`;
}

export function finishPorticoGlass(material:MeshStandardMaterial){
 material.roughness=.21;material.metalness=.08;
 material.transparent=true;material.opacity=material.name==='doorGlass'?.62:.52;material.depthWrite=false;
 material.onBeforeCompile=shader=>{
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
 };
 material.customProgramCacheKey=()=> 'portico-glazing-v1';
}

export function finishCourtyardGrass(material:MeshStandardMaterial){
 material.color.set('#bdcaa6');material.roughness=1;material.normalScale.set(.14,.14);
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGrassWorld;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvGrassWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vGrassWorld;
   float grassHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float grassNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(grassHash(i),grassHash(i+vec2(1,0)),f.x),mix(grassHash(i+vec2(0,1)),grassHash(i+vec2(1,1)),f.x),f.y);}
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 relative=vGrassWorld.xz-vec2(12.904326,-34.578878);
   vec2 court=vec2(dot(relative,vec2(.9080005,-.4189689)),dot(relative,vec2(.4189689,.9080005)));
   float localCourt=(1.0-smoothstep(98.0,103.0,abs(court.x)))*smoothstep(5.0,8.0,court.y)*(1.0-smoothstep(152.0,155.0,court.y));
   float scanned=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))*4.0,0.0,1.0);
   float growth=grassNoise(court*.12)*.55+grassNoise(court*.54)*.3+grassNoise(court*1.8)*.15;
   float mowing=sin(court.y*.63)*.018;
   float nearDetail=1.0-smoothstep(4.0,26.0,length(vViewPosition));
   float blades=grassNoise(court*vec2(38.0,18.0));
   vec3 turf=mix(vec3(.068,.110,.031),vec3(.126,.185,.065),growth)*mix(.91,1.075,scanned);
   turf*=1.0+mowing+(blades-.5)*.15*nearDetail;
   // A narrow, irregular drier margin keeps grass from reading as a green mat.
   float edgeDistance=min(46.0-abs(court.x),min(court.y-7.0,92.0-court.y));
   if(court.y>94.0)edgeDistance=min(46.0-abs(court.x),min(court.y-95.0,152.0-court.y));
   if(abs(court.x)>49.0)edgeDistance=min(min(abs(court.x)-51.0,97.0-abs(court.x)),min(court.y-106.0,139.0-court.y));
   float margin=(1.0-smoothstep(0.0,.46+grassNoise(court*3.0)*.3,edgeDistance))*.16;
   turf=mix(turf,vec3(.17,.17,.087),margin);
   diffuseColor.rgb=mix(diffuseColor.rgb,turf,localCourt);
  `);
 };
 material.customProgramCacheKey=()=> 'courtyard-grass-v3';
}
