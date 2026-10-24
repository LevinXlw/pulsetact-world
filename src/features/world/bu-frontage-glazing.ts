import {Color,Mesh,MeshStandardMaterial,ShaderMaterial,type Scene,type Texture} from 'three';

export type BUFrontageGlazingVariant='clear'|'light'|'dark';
type Options={variant?:BUFrontageGlazingVariant;mobile?:boolean;environment?:Texture|null};
type SkyBinding={mesh:Mesh;map:{value:Texture|null};ready:{value:number};time:{value:number}};
const skyBindings=new WeakMap<Scene,{sky:SkyBinding|null;retryAfter:number}>();
function inScene(mesh:Mesh,scene:Scene){for(let p:Mesh['parent']=mesh;p;p=p.parent)if(p===scene)return true;return false;}
function borrowedSky(scene:Scene){
  const now=typeof performance==='undefined'?Date.now():performance.now(),cached=skyBindings.get(scene);
  if(cached?.sky&&inScene(cached.sky.mesh,scene))return cached.sky;
  if(cached&&!cached.sky&&now<cached.retryAfter)return null;
  // Read the actual shared sky, without loading another panorama or changing
  // its filtering, colour space, readiness flag or animation clock.
  const mesh=scene.getObjectByName('Painted cloud sky');let sky:SkyBinding|null=null;
  if(mesh instanceof Mesh&&mesh.material instanceof ShaderMaterial){
    const u=mesh.material.uniforms;
    if(u.uSkyMap&&u.uSkyReady&&u.uSkyTime)sky={mesh,map:u.uSkyMap,ready:u.uSkyReady,time:u.uSkyTime};
  }
  skyBindings.set(scene,{sky,retryAfter:now+2000});return sky;
}

const functions=/* glsl */`
  varying vec3 vBUFrontagePosition;
  uniform sampler2D uBUFrontageSky;
  uniform float uBUFrontageSkyReady;
  uniform float uBUFrontageSkyTime;
  uniform float uBUFrontageHasEnvironment;
  uniform float uBUFrontageReflectance;
  uniform vec3 uBUFrontageSkyTop;
  uniform vec3 uBUFrontageSkyHorizon;
  uniform vec3 uBUFrontageGround;
  float buGlazingHash(vec2 p) {
    vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }
  float buGlazingNoise(vec2 p) {
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(buGlazingHash(i),buGlazingHash(i+vec2(1.,0.)),f.x),
      mix(buGlazingHash(i+vec2(0.,1.)),buGlazingHash(i+vec2(1.)),f.x),f.y);
  }
  vec3 buGlazingSky(vec3 direction) {
    float elevation=max(direction.y,0.);
    vec3 color=mix(uBUFrontageSkyHorizon,uBUFrontageSkyTop,pow(elevation,.48));
    #ifndef BU_FRONTAGE_MOBILE
      if(uBUFrontageSkyReady>.5) {
        // Same longitude overlap, latitude and clock as painterly-sky.ts.
        // This is a borrowed sky reflection, not a screen-space or building
        // reflection. Derivatives avoid a seam at the longitude wrap.
        const float TAU=6.28318530718,OVERLAP=.16,PERIOD=.84;
        float radial2=dot(direction.xz,direction.xz);
        float longitude=radial2>1e-8?atan(direction.z,direction.x)/TAU:0.;
        float phase=fract(longitude+.63+uBUFrontageSkyTime*.000013)*PERIOD;
        float latitude=.43+asin(clamp(direction.y,-1.,1.))/3.14159265*1.14;
        vec3 dx=dFdx(direction),dy=dFdy(direction);
        float sx=PERIOD/(TAU*max(radial2,1e-5));
        float sy=1.14/(3.14159265*sqrt(max(1.-direction.y*direction.y,1e-5)));
        vec2 uvDx=vec2((direction.x*dx.z-direction.z*dx.x)*sx,dx.y*sy);
        vec2 uvDy=vec2((direction.x*dy.z-direction.z*dy.x)*sx,dy.y*sy);
        // Mild broadening keeps this facade glass from becoming a sharp mirror.
        vec2 blur=vec2(.0013,.0018);
        vec3 painted=texture2DGradEXT(uBUFrontageSky,vec2(phase,latitude),uvDx+blur,uvDy+blur).rgb;
        if(phase<OVERLAP) {
          vec3 tail=texture2DGradEXT(uBUFrontageSky,vec2(phase+PERIOD,latitude),uvDx+blur,uvDy+blur).rgb;
          painted=mix(tail,painted,smoothstep(0.,OVERLAP,phase));
        }
        if(direction.y>.90) {
          vec3 zenith=(texture2DGradEXT(uBUFrontageSky,vec2(.125,.995),blur,blur).rgb+
            texture2DGradEXT(uBUFrontageSky,vec2(.375,.995),blur,blur).rgb+
            texture2DGradEXT(uBUFrontageSky,vec2(.625,.995),blur,blur).rgb+
            texture2DGradEXT(uBUFrontageSky,vec2(.875,.995),blur,blur).rgb)*.25;
          painted=mix(painted,zenith,smoothstep(.90,.995,direction.y));
        }
        color=mix(uBUFrontageSkyHorizon,painted,smoothstep(-.06,.10,direction.y));
      }
    #endif
    return mix(uBUFrontageGround,color,smoothstep(-.14,.08,direction.y));
  }
`;

/** GSU/Mugar/Warren-only material factory. Reuse the real modeled reveals and
 * panes: no procedural mullions, window grids, fake rooms or transmission.
 * Direct/hemi lighting remains Standard PBR. The small added lobe samples the
 * already displayed desktop sky; the phone matches its actual gradient sky.
 * No texture, probe, render target or additional scene pass is allocated.
 * A supplied IBL texture is borrowed, and disables the added sky lobe.
 * Owners dispose this material normally; borrowed textures remain theirs. */
export function createBUFrontageGlazing({variant='clear',mobile=false,environment=null}:Options={}){
  const settings={clear:{color:'#4d5957',roughness:.28,reflectance:.12},light:{color:'#626c65',roughness:.30,reflectance:.15},dark:{color:'#2f3835',roughness:.25,reflectance:.10}}[variant];
  const material=new MeshStandardMaterial({name:`BU frontage glass · ${variant}`,color:settings.color,roughness:settings.roughness,metalness:.035,envMap:environment,envMapIntensity:.65});
  material.userData.buFrontageGlazing={variant,mobile,reflection:'borrowed displayed sky, or caller-provided IBL; no scene capture',version:1};
  if(mobile)material.defines={BU_FRONTAGE_MOBILE:1};
  const uniforms={
    uBUFrontageSky:{value:null as Texture|null},uBUFrontageSkyReady:{value:0},uBUFrontageSkyTime:{value:0},
    uBUFrontageHasEnvironment:{value:environment?1:0},uBUFrontageReflectance:{value:settings.reflectance},
    uBUFrontageSkyTop:{value:new Color(mobile?'#80b9d0':'#3d82bd')},
    uBUFrontageSkyHorizon:{value:new Color(mobile?'#d3dfc6':'#c4dbde')},uBUFrontageGround:{value:new Color('#72766b')},
  };
  let disposed=false;
  material.onBeforeRender=(_renderer,scene)=>{
    if(disposed)return;
    uniforms.uBUFrontageHasEnvironment.value=material.envMap||scene.environment?1:0;
    const sky=mobile?null:borrowedSky(scene);
    uniforms.uBUFrontageSky.value=sky?.map.value??null;
    uniforms.uBUFrontageSkyReady.value=sky?.ready.value??0;
    uniforms.uBUFrontageSkyTime.value=sky?.time.value??0;
  };
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vBUFrontagePosition;')
      .replace('#include <project_vertex>',/* glsl */`
        #include <project_vertex>
        vec4 buGlazingWorld=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          buGlazingWorld=instanceMatrix*buGlazingWorld;
        #endif
        vBUFrontagePosition=(modelMatrix*buGlazingWorld).xyz;
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+functions)
      .replace('#include <roughnessmap_fragment>',/* glsl */`
        #include <roughnessmap_fragment>
        // Broad, low amplitude variation: no invented pane subdivisions.
        float buGlassWash=buGlazingNoise(vBUFrontagePosition.xy*.31+vBUFrontagePosition.zz*.17)-.5;
        roughnessFactor=clamp(roughnessFactor+buGlassWash*.035,.20,.36);
        diffuseColor.rgb*=1.+buGlassWash*.08;
      `)
      .replace('#include <normal_fragment_maps>',/* glsl */`
        #include <normal_fragment_maps>
        vec3 buGlassNormal=inverseTransformDirection(normal,viewMatrix);
        vec3 buGlassRipple=vec3(sin(vBUFrontagePosition.y*1.71+vBUFrontagePosition.z*.43),
          sin(vBUFrontagePosition.x*.62+vBUFrontagePosition.y*.37),cos(vBUFrontagePosition.y*1.39+vBUFrontagePosition.x*.51))*.0014;
        buGlassNormal=normalize(buGlassNormal+buGlassRipple-buGlassNormal*dot(buGlassNormal,buGlassRipple));
        normal=normalize((viewMatrix*vec4(buGlassNormal,0.)).xyz);
      `)
      .replace('#include <opaque_fragment>',/* glsl */`
        vec3 buGlassEye=normalize(cameraPosition-vBUFrontagePosition);
        float buGlassFresnel=pow(1.-clamp(abs(dot(buGlassNormal,buGlassEye)),0.,1.),5.);
        vec3 buGlassReflection=buGlazingSky(reflect(-buGlassEye,buGlassNormal));
        float buGlassAmount=(uBUFrontageReflectance+.34*buGlassFresnel)*(1.-uBUFrontageHasEnvironment);
        // The reflection replaces a small portion of lit surface response;
        // no emissive cyan is added and normal scene exposure/fog still apply.
        outgoingLight=mix(outgoingLight,buGlassReflection,buGlassAmount);
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey=()=>`bu-frontage-glass-v1-${mobile?'mobile':'desktop'}`;
  material.addEventListener('dispose',()=>{
    if(disposed)return;disposed=true;
    uniforms.uBUFrontageSky.value=null;uniforms.uBUFrontageSkyReady.value=0;
    material.envMap=null;material.onBeforeRender=()=>{};material.onBeforeCompile=()=>{};
  });
  return material;
}

/** Exact-name recognition for reinstalling this shader after a mobile bake.
 * A generic glass-name match would unintentionally alter other buildings. */
export function buFrontageGlazingVariant(name:string):BUFrontageGlazingVariant|undefined{
  const match=/^BU frontage glass · (clear|light|dark)$/.exec(name);
  return match?.[1] as BUFrontageGlazingVariant|undefined;
}
