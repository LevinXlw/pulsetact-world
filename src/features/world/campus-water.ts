import {
  ClampToEdgeWrapping, Color, DataTexture, DoubleSide, LinearFilter, Matrix4,
  MeshStandardMaterial, NoColorSpace, RedFormat, UnsignedByteType, Vector2, Vector3, Vector4,
  type Texture,
} from 'three';

export type CampusWaterQuality = 'mobile' | 'mobile-hd' | 'desktop';
export type CampusWaterBounds = readonly [minX:number, minZ:number, maxX:number, maxZ:number];
type ShorePoint = readonly [number, number];

/** Distance is encoded as R / 255 * maxDistance, in world metres, not water depth. */
export interface CampusWaterShoreField {
  texture: DataTexture;
  bounds: CampusWaterBounds;
  maxDistance: number;
}

export interface CampusWaterPlanarReflection {
  /** Linear scene colour, before tone mapping. Owned/disposed by the renderer. */
  texture: Texture;
  /** bias * reflectedCamera.projectionMatrix * reflectedCamera.matrixWorldInverse. */
  matrix: Matrix4;
  strength?: number;
}

export interface CampusWaterOptions {
  name?: string;
  time?: {value:number};
  quality?: CampusWaterQuality;
  shore?: CampusWaterShoreField;
  deepColor?: string;
  shoreColor?: string;
  /** World-space direction toward the scene's key sun. */
  sunDirection?: Vector3;
}

const declarations = /* glsl */ `
  varying vec3 vCampusWaterWorld;
  varying vec3 vCampusWaterNormal;
  uniform float uCampusWaterTime;
  uniform vec3 uCampusWaterShoreColor;
  uniform vec3 uCampusWaterSunDirection;
  uniform sampler2D uCampusWaterShoreMap;
  uniform vec4 uCampusWaterShoreBounds;
  uniform float uCampusWaterShoreRange;
  uniform float uCampusWaterHasShore;
  #ifdef CAMPUS_WATER_PLANAR
    uniform sampler2D uCampusWaterReflection;
    uniform mat4 uCampusWaterReflectionMatrix;
    uniform float uCampusWaterReflectionStrength;
    uniform vec2 uCampusWaterReflectionTexel;
  #endif

  // No tiled bitmap or sinusoidal stripe field. Quintic value noise has an
  // analytic, continuous gradient; separate rotated scales avoid a shared axis.
  float cwHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * .1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  vec3 cwNoiseGradient(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*f*(f*(f*6.-15.)+10.);
    vec2 du = 30.*f*f*(f*(f-2.)+1.);
    float a = cwHash(i), b = cwHash(i+vec2(1.,0.));
    float c = cwHash(i+vec2(0.,1.)), d = cwHash(i+1.);
    float k = a-b-c+d;
    return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,
      du.x*(b-a+k*u.y), du.y*(c-a+k*u.x));
  }
  vec2 cwWaveGradient(vec2 p, mat2 rotation, float scale, vec2 drift, float weight, float footprint) {
    vec3 n = cwNoiseGradient(rotation*p*scale+drift*uCampusWaterTime);
    // Fade subpixel normals instead of producing white crawling speckles.
    float resolved = 1.-smoothstep(.22, .9, footprint*scale);
    return vec2(dot(n.yz,rotation[0]),dot(n.yz,rotation[1]))*weight*resolved;
  }
  vec2 cwWaterSlope(vec2 p, float footprint) {
    vec3 warp = cwNoiseGradient(p*.027 + vec2(uCampusWaterTime*.006, 18.3));
    p += (warp.yz-.15)*2.6;
    vec2 slope = cwWaveGradient(p,mat2(.92,.392,-.392,.92),.17,vec2(.021,-.015),.036,footprint);
    slope += cwWaveGradient(p+43.7,mat2(.371,.929,-.929,.371),.63,vec2(-.067,.041),.030,footprint);
    slope += cwWaveGradient(p-17.1,mat2(-.743,.669,-.669,-.743),1.79,vec2(.113,.081),.018,footprint);
    #if CAMPUS_WATER_DETAIL > 0
      slope += cwWaveGradient(p+96.4,mat2(.615,-.788,.788,.615),4.31,vec2(-.181,.097),.010,footprint);
    #endif
    #if CAMPUS_WATER_DETAIL > 1
      slope += cwWaveGradient(p-69.3,mat2(-.219,.976,-.976,-.219),8.13,vec2(.173,-.149),.0055,footprint);
    #endif
    return slope;
  }
  float cwShoreDistance(vec2 p) {
    if(uCampusWaterHasShore < .5) return 1000.;
    vec2 uv = (p-uCampusWaterShoreBounds.xy)/(uCampusWaterShoreBounds.zw-uCampusWaterShoreBounds.xy);
    if(any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) return 1000.;
    return texture2D(uCampusWaterShoreMap,uv).r*uCampusWaterShoreRange;
  }
  vec3 cwSkyReflection(vec3 direction) {
    float elevation = clamp(direction.y,0.,1.);
    // Linear radiance: tone mapping/output conversion remain Three's last steps.
    vec3 sky = mix(vec3(.39,.55,.57),vec3(.095,.255,.425),pow(elevation,.42));
    vec2 p = direction.xz/(.35+max(direction.y,0.))*2.1+vec2(7.2,13.4);
    p += vec2(uCampusWaterTime*.001,0.);
    float clouds = cwNoiseGradient(p).x*.68+cwNoiseGradient(p*2.13+31.7).x*.32;
    clouds = smoothstep(.55,.77,clouds)*smoothstep(.025,.18,elevation);
    sky = mix(sky,vec3(.70,.75,.72),clouds*.68);
    // The actual directional light supplies the glints. Only a soft broad halo
    // lives in this fallback sky, avoiding a second hard sun or white brush marks.
    float sun = max(dot(direction,normalize(uCampusWaterSunDirection)),0.);
    return sky+vec3(.25,.21,.14)*pow(sun,48.);
  }
`;

const waterNormals = /* glsl */ `
  #include <normal_fragment_maps>
  float cwHorizontal = smoothstep(.65,.96,abs(normalize(vCampusWaterNormal).y));
  float cwFootprint = max(length(dFdx(vCampusWaterWorld.xz)),length(dFdy(vCampusWaterWorld.xz)));
  float cwShore = cwShoreDistance(vCampusWaterWorld.xz);
  float cwNearShore = 1.-smoothstep(1.0,18.,cwShore);
  vec2 cwSlope = cwWaterSlope(vCampusWaterWorld.xz,cwFootprint)*mix(1.,.62,cwNearShore);
  vec3 cwWorldNormal = normalize(vec3(-cwSlope.x,1.,-cwSlope.y));
  // Pools and thin falling-water faces can share a material batch. Vertical
  // faces retain their actual normal and do not become horizontal mirrors.
  normal = normalize(mix(normal,normalize(mat3(viewMatrix)*cwWorldNormal)*faceDirection,cwHorizontal));
  roughnessFactor = mix(roughnessFactor, .19+.055*cwNearShore+.035*smoothstep(.25,2.,cwFootprint),cwHorizontal);
  diffuseColor.rgb = mix(diffuseColor.rgb,uCampusWaterShoreColor,cwNearShore*.58*cwHorizontal);
  float cwBroadTone = cwNoiseGradient(vCampusWaterWorld.xz*.018+vec2(22.,9.)).x;
  diffuseColor.rgb *= .97+cwBroadTone*.06;
`;

const waterReflection = /* glsl */ `
  // Keep direct/indirect scene lighting and its shadowed specular response.
  // The added term is the environment reflection of a water/air interface.
  vec3 cwView = normalize(cameraPosition-vCampusWaterWorld);
  float cwFacing = clamp(dot(cwWorldNormal,cwView),0.,1.);
  float cwFresnel = .0204+.9796*pow(1.-cwFacing,5.);
  vec3 cwReflectedDirection = reflect(-cwView,cwWorldNormal);
  vec3 cwReflection = cwSkyReflection(cwReflectedDirection);
  #ifdef CAMPUS_WATER_PLANAR
    vec4 cwProjected = uCampusWaterReflectionMatrix*vec4(vCampusWaterWorld,1.);
    if(cwProjected.w > 0.) {
      vec2 cwUV = cwProjected.xy/cwProjected.w;
      // Small, distance-filtered displacement keeps buildings legible. This
      // distorts reflection sampling only; the river mesh is never displaced.
      float cwDist = length(cameraPosition-vCampusWaterWorld);
      vec2 cwDistortion = cwSlope*.045/(1.+cwDist*.025);
      vec2 cwSampleUV = cwUV+cwDistortion;
      vec2 cwBorder = min(cwSampleUV,1.-cwSampleUV);
      float cwInside = smoothstep(0.,.025,min(cwBorder.x,cwBorder.y));
      // Five compact bilinear taps soften a sub-resolution railing/shore edge
      // without turning its reflection into a broad blur. Radius follows the
      // real render-target texel size, so a resized RT does not change softness.
      vec2 cwBlur = uCampusWaterReflectionTexel;
      vec2 cwMargin = max(cwBlur*1.5,vec2(.00001));
      vec2 cwSafeUV = clamp(cwSampleUV,cwMargin,1.-cwMargin);
      vec3 cwPlanar = texture2D(uCampusWaterReflection,cwSafeUV).rgb*.4;
      cwPlanar += texture2D(uCampusWaterReflection,cwSafeUV+cwBlur).rgb*.15;
      cwPlanar += texture2D(uCampusWaterReflection,cwSafeUV-cwBlur).rgb*.15;
      cwPlanar += texture2D(uCampusWaterReflection,cwSafeUV+vec2(cwBlur.x,-cwBlur.y)).rgb*.15;
      cwPlanar += texture2D(uCampusWaterReflection,cwSafeUV+vec2(-cwBlur.x,cwBlur.y)).rgb*.15;
      cwReflection = mix(cwReflection,cwPlanar,cwInside*uCampusWaterReflectionStrength);
    }
  #endif
  vec3 cwWaterLight = totalDiffuse*(1.-cwFresnel)+totalSpecular*.72+cwReflection*cwFresnel+totalEmissiveRadiance;
  outgoingLight = mix(outgoingLight,cwWaterLight,cwHorizontal);
`;

/**
 * Shared water for procedural scenes and runtime-replaced GLB water meshes.
 * No vertex subdivision, transmission buffer, normal map or reflection target
 * is allocated. Planar reflections are an optional desktop renderer concern.
 */
export class CampusWaterMaterial extends MeshStandardMaterial {
  private waterQuality: CampusWaterQuality;
  private planar: CampusWaterPlanarReflection | null = null;
  private readonly waterUniforms;

  constructor(options:CampusWaterOptions = {}) {
    super({name:options.name??'Campus natural water',color:options.deepColor??'#35666c',
      roughness:.22,metalness:0,side:DoubleSide,envMapIntensity:0});
    this.waterQuality = options.quality??'desktop';
    this.userData.campusWater = true;
    this.userData.campusWaterVersion = 1;
    this.waterUniforms = {
      uCampusWaterTime:options.time??{value:0},
      uCampusWaterShoreColor:{value:new Color(options.shoreColor??'#557d72')},
      uCampusWaterSunDirection:{value:(options.sunDirection??new Vector3(-95,115,135)).clone().normalize()},
      uCampusWaterShoreMap:{value:options.shore?.texture??null},
      uCampusWaterShoreBounds:{value:new Vector4(...(options.shore?.bounds??[0,0,1,1] as const))},
      uCampusWaterShoreRange:{value:options.shore?.maxDistance??24},
      uCampusWaterHasShore:{value:options.shore?1:0},
      uCampusWaterReflection:{value:null as Texture|null},
      uCampusWaterReflectionMatrix:{value:new Matrix4()},
      uCampusWaterReflectionStrength:{value:1},
      uCampusWaterReflectionTexel:{value:new Vector2()},
    };
    this.updateWaterDefines();
    this.onBeforeCompile = shader => {
      Object.assign(shader.uniforms,this.waterUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',`#include <common>\nvarying vec3 vCampusWaterWorld; varying vec3 vCampusWaterNormal;`)
        .replace('#include <project_vertex>', /* glsl */ `
          #include <project_vertex>
          vec4 cwWorldPosition = vec4(transformed,1.);
          #ifdef USE_BATCHING
            cwWorldPosition = batchingMatrix*cwWorldPosition;
          #endif
          #ifdef USE_INSTANCING
            cwWorldPosition = instanceMatrix*cwWorldPosition;
          #endif
          vCampusWaterWorld = (modelMatrix*cwWorldPosition).xyz;
          vCampusWaterNormal = inverseTransformDirection(transformedNormal,viewMatrix);
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>','#include <common>\n'+declarations)
        .replace('#include <normal_fragment_maps>',waterNormals)
        .replace('#include <opaque_fragment>',waterReflection+'\n#include <opaque_fragment>');
    };
    this.customProgramCacheKey = () => `campus-water-v1-${this.waterQuality}-${this.planar && this.waterQuality==='desktop'?'planar':'sky'}`;
  }

  get quality() { return this.waterQuality; }

  setQuality(quality:CampusWaterQuality) {
    if(this.waterQuality===quality)return;
    this.waterQuality=quality;
    this.updateWaterDefines();
  }

  /** The caller retains ownership of the render target and its live matrix. */
  setPlanarReflection(reflection:CampusWaterPlanarReflection|null) {
    const hadPlanar = !!this.planar;
    this.planar=reflection;
    this.waterUniforms.uCampusWaterReflection.value=reflection?.texture??null;
    if(reflection)this.waterUniforms.uCampusWaterReflectionMatrix.value=reflection.matrix;
    const image=reflection?.texture.image as {width?:number;height?:number}|undefined;
    const width=image?.width??0,height=image?.height??0;
    this.waterUniforms.uCampusWaterReflectionTexel.value.set(
      Number.isFinite(width)&&width>0?1/width:0,Number.isFinite(height)&&height>0?1/height:0);
    this.waterUniforms.uCampusWaterReflectionStrength.value=Math.max(0,Math.min(1,reflection?.strength??1));
    if(hadPlanar!==!!reflection)this.updateWaterDefines();
  }

  private updateWaterDefines() {
    this.defines = {...this.defines,CAMPUS_WATER_DETAIL:this.waterQuality==='desktop'?2:this.waterQuality==='mobile-hd'?1:0};
    if(this.planar && this.waterQuality==='desktop')this.defines.CAMPUS_WATER_PLANAR=1;
    else delete this.defines.CAMPUS_WATER_PLANAR;
    this.userData.campusWaterQuality=this.waterQuality;
    this.needsUpdate=true;
  }
}

export function createCampusWaterMaterial(options:CampusWaterOptions = {}) {
  return new CampusWaterMaterial(options);
}

/**
 * Optional tiny shoreline distance field for sparse river polygons. Banks are
 * open polylines: the helper never invents closing segments across the water.
 * Default 256x128 R8 = 32 KiB, shared between every material using this field.
 * Dispose field.texture when the owning scene is disposed (not per material).
 */
export function createCampusWaterShoreField(
  banks:readonly (readonly ShorePoint[])[],
  bounds:CampusWaterBounds,
  options:{resolution?:readonly [number,number];maxDistance?:number} = {},
):CampusWaterShoreField {
  if(!bounds.every(Number.isFinite)||bounds[2]<=bounds[0]||bounds[3]<=bounds[1])throw new Error('Water shore bounds must have finite, positive area');
  const resolution=options.resolution??[256,128];
  if(!resolution.every(v=>Number.isInteger(v)&&v>=2&&v<=512))throw new Error('Water shore resolution must be 2–512 texels per axis');
  const maxDistance=options.maxDistance??24;
  if(!Number.isFinite(maxDistance)||maxDistance<=0)throw new Error('Water shore distance must be positive');
  const segments:{x:number;z:number;dx:number;dz:number;length2:number}[]=[];
  for(const bank of banks) {
    for(const p of bank)if(!p.every(Number.isFinite))throw new Error('Water shore coordinates must be finite');
    for(let i=1;i<bank.length;i++) {
      const a=bank[i-1],b=bank[i],dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
      if(length2>0)segments.push({x:a[0],z:a[1],dx,dz,length2});
    }
  }
  const [width,height]=resolution,data=new Uint8Array(width*height);
  for(let row=0;row<height;row++)for(let col=0;col<width;col++) {
    const x=bounds[0]+(col+.5)/width*(bounds[2]-bounds[0]);
    const z=bounds[1]+(row+.5)/height*(bounds[3]-bounds[1]);
    let d2=maxDistance*maxDistance;
    for(const s of segments) {
      const t=Math.max(0,Math.min(1,((x-s.x)*s.dx+(z-s.z)*s.dz)/s.length2));
      d2=Math.min(d2,(x-s.x-t*s.dx)**2+(z-s.z-t*s.dz)**2);
    }
    data[row*width+col]=Math.round(Math.sqrt(d2)/maxDistance*255);
  }
  const texture=new DataTexture(data,width,height,RedFormat,UnsignedByteType);
  texture.name='Campus water shoreline distance (metres)';
  texture.minFilter=texture.magFilter=LinearFilter;
  texture.wrapS=texture.wrapT=ClampToEdgeWrapping;
  texture.colorSpace=NoColorSpace;
  texture.generateMipmaps=false;
  texture.needsUpdate=true;
  return {texture,bounds,maxDistance};
}
