import * as T from 'three';

export type TimeOfDay = 'day' | 'golden' | 'night';

export function createAtmosphere(renderer: T.WebGLRenderer, scene: T.Scene) {
  const material = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    uniforms: { topColor: { value: new T.Color() }, horizon: { value: new T.Color() }, cloudColor: { value: new T.Color() }, sunDirection: { value: new T.Vector3() }, sunColor: { value: new T.Color() }, night: { value: 0 } },
    vertexShader: 'varying vec3 direction; void main(){ direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 topColor, horizon, cloudColor, sunDirection, sunColor;
      uniform float night;
      varying vec3 direction;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      float fbm(vec2 p){float a=.5,v=0.;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.07+vec2(9.2,7.1);a*=.5;}return v;}
      void main(){
        vec3 d=normalize(direction); float h=max(d.y,0.);
        vec3 color=mix(horizon,topColor,pow(h,.48));
        vec2 p=d.xz/(max(d.y,.035)+.22)*2.3;
        float cloud=smoothstep(.51,.78,fbm(p+fbm(p*.7)))*smoothstep(.015,.12,h);
        color=mix(color,cloudColor,cloud*.78*(1.-night*.8));
        float facing=max(dot(d,sunDirection),0.);
        color+=sunColor*(pow(facing,1500.)*.85+pow(facing,20.)*.045)*(1.-night);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geometry = new T.SphereGeometry(4000, 24, 16), sky = new T.Mesh(geometry, material); sky.frustumCulled = false; sky.renderOrder = -100; scene.add(sky);
  const environmentScene = new T.Scene(); environmentScene.add(new T.Mesh(geometry, material));
  const pmrem = new T.PMREMGenerator(renderer);
  let environment: T.WebGLRenderTarget | undefined;
  const ambient = new T.HemisphereLight('#cbdce9', '#6a6154', 1.3); scene.add(ambient);
  const sun = new T.DirectionalLight('#fff0d7', 3.4); scene.add(sun, sun.target); sun.target.position.y = 160;
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -.00005; sun.shadow.normalBias = .08;
  Object.assign(sun.shadow.camera, { left: -240, right: 240, top: 320, bottom: -320, near: 10, far: 1500 });
  scene.fog = new T.FogExp2('#c8d2d4', .00055);
  function setTime(time: TimeOfDay) {
    const night = time === 'night', golden = time === 'golden';
    const top = night ? '#0d1e37' : golden ? '#4b809f' : '#367dad';
    const horizon = night ? '#354a64' : golden ? '#e5be98' : '#bfd1dd';
    material.uniforms.topColor.value.set(top); material.uniforms.horizon.value.set(horizon);
    material.uniforms.cloudColor.value.set(night ? '#65738a' : '#eeece6'); material.uniforms.night.value = night ? 1 : 0;
    const direction = new T.Vector3(-.8, golden ? .28 : .72, 1).normalize(); material.uniforms.sunDirection.value.copy(direction);
    material.uniforms.sunColor.value.set(golden ? '#ffdda8' : '#fff5dc');
    sun.position.copy(direction.multiplyScalar(900)).add(sun.target.position);
    sun.color.set(night ? '#99b9e5' : golden ? '#ffe0ad' : '#fff2da'); sun.intensity = night ? .2 : golden ? 4.8 : 4.4;
    ambient.color.set(night ? '#819abf' : '#cfdfec'); ambient.groundColor.set(night ? '#253044' : '#766a56'); ambient.intensity = night ? .55 : 1.1;
    (scene.fog as T.FogExp2).color.set(horizon); (scene.fog as T.FogExp2).density = night ? .00032 : .0003;
    renderer.toneMappingExposure = night ? .95 : 1.05;
    environment?.dispose(); environment = pmrem.fromScene(environmentScene, .02); scene.environment = environment.texture; scene.environmentIntensity = night ? .27 : .55;
  }
  return { sky, setTime };
}
