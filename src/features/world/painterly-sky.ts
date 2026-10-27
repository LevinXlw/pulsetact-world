import {BackSide, ClampToEdgeWrapping, Mesh, ShaderMaterial, SphereGeometry, SRGBColorSpace, TextureLoader} from 'three';

/** Broad cloud banks leave quiet blue space around the campus silhouette. */
export function createPainterlySky(time: {value: number}) {
  const ready = {value: 0};
  // Readiness for a one-shot scene reflection differs from texture readiness:
  // a failed image settles on the procedural sky without sampling that image.
  const loadState = {status: 'loading' as 'loading'|'ready'|'fallback'};
  const panorama = new TextureLoader().load('/assets/environment/mit-painted-sky-v1.png',
    () => {ready.value = 1;loadState.status = 'ready';}, undefined,
    () => {loadState.status = 'fallback'; /* Keep the procedural sky if unavailable. */ });
  panorama.colorSpace = SRGBColorSpace;
  // The painting is a wide composition, not a tileable panorama. The shader
  // overlaps its ends; sampling must never filter across the original hard edge.
  panorama.wrapS = ClampToEdgeWrapping;
  panorama.anisotropy = 4;
  const material = new ShaderMaterial({
    uniforms: {uSkyTime: time, uSkyMap: {value: panorama}, uSkyReady: ready},
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `
      varying vec3 vSkyDirection;
      uniform float uSkyTime;
      uniform sampler2D uSkyMap;
      uniform float uSkyReady;
      float hash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      float paint(vec2 p) {
        float n=0.0, a=.5;
        for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(1.6,-1.2,1.2,1.6)*p+vec2(4.7,8.3);a*=.5;}
        return n;
      }
      vec3 paintedPanorama(vec3 direction) {
        const float TAU=6.28318530718;
        const float OVERLAP=.16;
        const float PERIOD=1.0-OVERLAP;
        float radial2=dot(direction.xz,direction.xz);
        float longitude=radial2>1e-8?atan(direction.z,direction.x)/TAU:0.0;
        float phase=fract(longitude+.63+uSkyTime*.000013)*PERIOD;
        float latitude=.43+asin(clamp(direction.y,-1.0,1.0))/3.14159265*1.14;

        // Differentiate the direction, not atan/fract. Their branch cuts produce
        // a false, very wide texture footprint and a visible mip stripe otherwise.
        vec3 directionDx=dFdx(direction), directionDy=dFdy(direction);
        float longitudeScale=PERIOD/(TAU*max(radial2,1e-5));
        float latitudeScale=1.14/(3.14159265*sqrt(max(1.0-direction.y*direction.y,1e-5)));
        vec2 uvDx=vec2((direction.x*directionDx.z-direction.z*directionDx.x)*longitudeScale,
          directionDx.y*latitudeScale);
        vec2 uvDy=vec2((direction.x*directionDy.z-direction.z*directionDy.x)*longitudeScale,
          directionDy.y*latitudeScale);
        vec3 painted=texture2DGradEXT(uSkyMap,vec2(phase,latitude),uvDx,uvDy).rgb;
        if(phase<OVERLAP) {
          vec3 tail=texture2DGradEXT(uSkyMap,vec2(phase+PERIOD,latitude),uvDx,uvDy).rgb;
          // At either side of the wrap we sample the same source column. Zero
          // slope at both blend ends also keeps moving cloud edges continuous.
          painted=mix(tail,painted,smoothstep(0.0,OVERLAP,phase));
        }

        // An equirectangular image has many longitudes at its pole. Fade only the
        // quiet upper blue band to one azimuth-independent colour, so looking
        // straight up cannot expose a pinched star or a drifting polar seam.
        if(direction.y>.90) {
          vec2 capDx=vec2(.001,0.0), capDy=vec2(0.0,.001);
          vec3 zenith=(texture2DGradEXT(uSkyMap,vec2(.125,.995),capDx,capDy).rgb+
            texture2DGradEXT(uSkyMap,vec2(.375,.995),capDx,capDy).rgb+
            texture2DGradEXT(uSkyMap,vec2(.625,.995),capDx,capDy).rgb+
            texture2DGradEXT(uSkyMap,vec2(.875,.995),capDx,capDy).rgb)*.25;
          painted=mix(painted,zenith,smoothstep(.90,.995,direction.y));
        }
        return painted;
      }
      void main() {
        vec3 d=normalize(vSkyDirection);
        float elevation=clamp(d.y,0.0,1.0);
        vec3 color=mix(vec3(.79,.86,.85),vec3(.24,.51,.74),pow(elevation,.48));
        // A low-frequency mass defines each cloud; edge detail is subordinate.
        vec2 uv=d.xz/(max(d.y,0.0)+.28)*3.0+vec2(13.7,8.4)+vec2(uSkyTime*.002,0.0);
        float masses=paint(uv*.8);
        float edge=noise(uv*5.6)*.05;
        float clouds=smoothstep(.60,.627,masses+edge)*smoothstep(.018,.12,d.y);
        // The inset, sun-facing edge is brighter than the body of the cloud.
        float body=smoothstep(.615,.73,masses+edge);
        float light=clamp(.8+(paint(uv*.8+vec2(-.19,.28))-masses)*3.5,0.0,1.0);
        vec3 cloud=mix(vec3(.65,.77,.84),vec3(.99,.98,.93),light);
        cloud=mix(vec3(.94,.96,.93),cloud,body);
        color=mix(color,cloud,clouds*.96);
        vec3 sunDirection=normalize(vec3(-95.0,115.0,135.0));
        float sun=max(dot(d,sunDirection),0.0);
        color+=vec3(.98,.76,.43)*pow(sun,16.0)*.10;
        color=mix(color,vec3(.95,.94,.83),pow(sun,512.0)*.65);
        if(uSkyReady>.5) {
          // Decode once on upload, then output the painted colour without filmic
          // compression; the clouds already contain their painted highlights.
          color=sRGBTransferOETF(vec4(paintedPanorama(d),1.0)).rgb;
          color=mix(vec3(.77,.86,.87),color,smoothstep(-.06,.10,d.y));
        }
        // The original painted/procedural composition above is in display sRGB
        // (including its horizon blend). Decode once here, then let the renderer
        // choose its output: unchanged sRGB on screen, linear in reflection RTs.
        gl_FragColor=sRGBTransferEOTF(vec4(color,1.0));
        #include <colorspace_fragment>
      }`,
  });
  const sky=new Mesh(new SphereGeometry(1200,32,20),material);
  sky.name='Painted cloud sky';
  sky.userData.painterlySkyLoadState=loadState;
  sky.frustumCulled=false;
  return sky;
}
