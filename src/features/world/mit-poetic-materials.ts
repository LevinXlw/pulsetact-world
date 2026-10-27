import {MeshPhysicalMaterial, MeshStandardMaterial, Vector2} from 'three';

/** Original warm campus colours remain the base. The 2026-10-26 direction
 * preserves real material detail; the demo is an atmosphere reference only. */
export const MIT_POETIC_PALETTE = {
  stone:'#e0d4b9',column:'#e9dfc6',trim:'#ede2c7',paving:'#cfbfa2',
  glass:'#4c6975',frame:'#65716d',wood:'#79573c',interior:'#354b57',
} as const;

type Finish='stone'|'column'|'trim'|'paving'|'glass'|'frame'|'wood'|'interior';
const finishes:Record<string,Finish>={
  stone:'stone',columnStone:'column',columnTrim:'trim',trim:'trim',
  porticoStone:'stone',porticoWall:'stone',porticoTrim:'trim',
  courtyardWall:'stone',courtyardPlinth:'stone',courtyardTrim:'trim',
  porticoFloor:'paving',steps:'paving',stepNosing:'trim',
  porticoGlass:'glass',courtyardGlass:'glass',doorGlass:'glass',
  courtyardFrame:'frame',windowFrame:'frame',entranceFrame:'wood',
  entranceDoor:'wood',entrancePanel:'wood',
  courtyardInterior:'interior',windowInterior:'interior',interiorShade:'interior',
};

export function isMITPoeticSurface(name:string){return name in finishes;}

/** Photo-informed stone courses, fine surface relief and continuous PBR light.
 * Course dimensions follow portico-study.json; individual stains and block
 * boundaries are authored approximations, not a surveyed texture. */
export function createMITPoeticSurface(name:string,options:{mobile?:boolean}={}):MeshStandardMaterial {
  const finish=finishes[name]??'stone';
  const glazing=finish==='glass',stone=['stone','column','trim','paving'].includes(finish);
  const parameters={name,color:MIT_POETIC_PALETTE[finish],
    roughness:glazing?.18:finish==='frame'?.48:finish==='wood'?.62:.86,
    metalness:finish==='frame'?.23:0,
  };
  const material:MeshStandardMaterial=glazing&&!options.mobile
    ?new MeshPhysicalMaterial({...parameters,ior:1.52,specularIntensity:1})
    :new MeshStandardMaterial(parameters);
  material.userData.artDirection='poetic-campus-real-detail-v2';
  material.userData.mitRealDetail=true;
  material.userData.finish=finish;
  material.userData.originalPalette=MIT_POETIC_PALETTE[finish];
  // The photographed metal muntins are warm grey in light, not black bars.
  // Keep the campus's low-saturation palette while restoring their material.
  if(finish==='frame')material.color.set('#a09c89');
  if(finish==='paving'||name==='stepNosing'){
    material.polygonOffset=true;material.polygonOffsetFactor=-2;material.polygonOffsetUnits=-2;
  }
  if(glazing&&!options.mobile){material.transparent=true;material.opacity=name==='courtyardGlass'?.62:.72;material.depthWrite=false;material.envMapIntensity=1.1;}
  material.onBeforeCompile=shader=>{
    shader.uniforms.uMITAxes={value:new Vector2(.908,.419)};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>
        varying vec3 vMITWorld; varying vec3 vMITNormal;`)
      .replace('#include <project_vertex>',`#include <project_vertex>
        vec4 mitLocal=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          mitLocal=instanceMatrix*mitLocal;
        #endif
        vMITWorld=(modelMatrix*mitLocal).xyz;
        vMITNormal=inverseTransformDirection(transformedNormal,viewMatrix);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vMITWorld; varying vec3 vMITNormal; uniform vec2 uMITAxes;
      float mitHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
      float mitNoise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mitHash(i),mitHash(i+vec2(1.,0.)),f.x),mix(mitHash(i+vec2(0.,1.)),mitHash(i+1.),f.x),f.y);
      }
      float mitSeam(vec2 p,vec2 size,float width){
        vec2 edge=min(fract(p/size),1.0-fract(p/size))*size;
        vec2 aa=max(fwidth(p)*.7,vec2(.001));
        return max(1.-smoothstep(width-aa.x,width+aa.x,edge.x),1.-smoothstep(width-aa.y,width+aa.y,edge.y))
          *(1.-smoothstep(.06,.28,max(aa.x,aa.y)));
      }
      // y metres are absolute in the recorded campus frame; x/z follow the
      // facade orientation. Horizontal treads must not use wall coordinates.
      vec3 mitAxes(vec3 p){return vec3(dot(p.xz,vec2(uMITAxes.x,-uMITAxes.y)),p.y,dot(p.xz,uMITAxes.yx));}
      float mitRelief=0.;
      float mitGrain=0.;`);
    if(stone)shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 mitP=vec3(dot(vMITWorld.xz,vec2(uMITAxes.x,-uMITAxes.y)),vMITWorld.y,dot(vMITWorld.xz,uMITAxes.yx));
      vec3 mitN=normalize(vMITNormal);
      vec3 mitNormal=vec3(dot(mitN.xz,vec2(uMITAxes.x,-uMITAxes.y)),mitN.y,dot(mitN.xz,uMITAxes.yx));
      vec2 mitFace=abs(mitNormal.x)>abs(mitNormal.z)?mitP.zy:mitP.xy;
      if(abs(mitNormal.y)>.65)mitFace=mitP.xz;
      ${name==='stone'?`
      // Wrap the Great Dome courses around the existing surveyed centre,
      // avoiding a planar seam where the front/side projection changes.
      vec2 mitRadial=vMITWorld.xz-vec2(-1.8490801,-67.1385498);
      if(vMITWorld.y>27.&&length(mitRadial)<20.5)mitFace=vec2(atan(mitRadial.x,mitRadial.y)*18.948387,vMITWorld.y);`:''}
      float mitPixel=max(fwidth(mitFace.x),fwidth(mitFace.y));
      float mitNear=1.-smoothstep(.025,.17,mitPixel);
      mitGrain=(mitNoise(mitFace*vec2(113.7,127.3))-.5)*(1.-smoothstep(.004,.018,mitPixel));
      float mitWash=mitNoise(mitFace*vec2(.17,.31))-.5;
      ${finish==='stone'||finish==='paving'?`
      vec2 mitSize=vec2(${finish==='paving'?(name==='steps'?'2.05,.62':'.92,.76'):'1.25,.55'});
      vec2 mitBond=mitFace;
      mitBond.x+=mod(floor(mitFace.y/mitSize.y),2.)*mitSize.x*.5;
      float mitJoint=mitSeam(mitBond,mitSize,${finish==='paving'?'.007':'.0045'});
      float mitBlock=mitHash(floor(mitBond/mitSize))-.5;
      diffuseColor.rgb*=1.+mitBlock*${finish==='paving'?'.10':'.13'}+mitWash*.065+mitGrain*.035;
      diffuseColor.rgb*=1.-mitJoint*${finish==='paving'?'.25':'.19'};
      mitRelief=-mitJoint*.0016+mitGrain*.0007;
      ${finish==='stone'?`
      // Local dirt follows exposed ledges and the wall foot. It is not a
      // painted light/shadow map, and does not flatten the actual relief.
      float mitFoot=(1.-smoothstep(4.8,6.2,vMITWorld.y))*.16;
      float mitLedge=(1.-smoothstep(.03,.65,abs(vMITWorld.y-20.75)))*.13;
      float mitRun=pow(mitNoise(vec2(mitFace.x*2.1,mitFace.y*.15)),2.);
      diffuseColor.rgb*=1.-(mitFoot+mitLedge)*(.35+mitRun*.65);`:''}
      `:`
      diffuseColor.rgb*=1.+mitWash*.045+mitGrain*.025;
      mitRelief=mitGrain*.00045;
      ${finish==='column'?`
      float mitRing=mitSeam(vec2(0.5,vMITWorld.y-5.485),vec2(1000.,1.84),.003);
      diffuseColor.rgb*=1.-mitRing*.13;mitRelief-=mitRing*.0008;`:''}
      `}`);
    if(stone&&!options.mobile){
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
        // Millimetre-scale joint/grain relief. Architectural flutes, reveals,
        // cornices and nosings remain real geometry and cast their own shadows.
        vec3 mitQ0=dFdx(-vViewPosition),mitQ1=dFdy(-vViewPosition);
        vec3 mitR0=cross(mitQ1,normal),mitR1=cross(normal,mitQ0);
        float mitDet=dot(mitQ0,mitR0);
        normal=normalize(abs(mitDet)*normal-sign(mitDet)*(dFdx(mitRelief)*mitR0+dFdy(mitRelief)*mitR1));`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor+mitGrain*.06,.64,.96);`);
    }
    if(finish==='wood')shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 mitWood=mitAxes(vMITWorld);
      float mitFiber=mitNoise(vec2(mitWood.x*32.,mitWood.y*.48))-.5;
      float mitClose=1.-smoothstep(.025,.12,max(fwidth(mitWood.x),fwidth(mitWood.y)));
      diffuseColor.rgb*=1.+mitFiber*.15*mitClose;`);
    if(glazing)shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      // Desktop uses a cached reflection of the actual scene when attached.
      // Mobile retains this explicitly approximate sky response as its LOD.
      #ifndef USE_ENVMAP
      vec3 mitView=normalize(cameraPosition-vMITWorld);
      vec3 mitReflected=reflect(-mitView,normalize(vMITNormal));
      float mitFresnel=pow(1.-abs(dot(normalize(vMITNormal),mitView)),3.);
      vec3 mitSky=mix(vec3(.12,.18,.16),vec3(.45,.66,.75),smoothstep(-.16,.65,mitReflected.y));
      outgoingLight=mix(outgoingLight,mitSky,.07+mitFresnel*.19);
      #endif
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>`mit-real-detail-${name}-${options.mobile?'mobile':'desktop'}-v2`;
  return material;
}
