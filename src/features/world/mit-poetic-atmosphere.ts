import {Color,DoubleSide,Group,InstancedMesh,Matrix4,PlaneGeometry,ShaderMaterial,UniformsLib,UniformsUtils,Vector3} from 'three';

/** A few sunlit seed/leaf motes over the actual lawn. They are atmosphere,
 * never ground, collision, snow cover or a replacement for campus vegetation. */
export function createMITPoeticAtmosphere(time:{value:number},mobile=false){
  const group=new Group();group.name='MIT · sunlit garden motes';group.userData.collision='none';
  const max=mobile?24:72;
  const material=new ShaderMaterial({transparent:true,depthWrite:false,side:DoubleSide,
    uniforms:{...UniformsUtils.clone(UniformsLib.fog),uTime:time,uTint:{value:new Color('#fff3d9')},uMotion:{value:typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches?0:1}},
    vertexShader:`
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;uniform float uMotion;
      varying vec2 vMoteUV;varying float vMoteAlpha;
      void main(){
        vMoteUV=uv;
        float phase=instanceMatrix[3].x*.73+instanceMatrix[3].z*.37;
        float t=uTime*uMotion;
        vec3 p=position;
        p.x*=.45+.45*sin(t*.72+phase);
        vec4 world=instanceMatrix*vec4(p,1.);
        world.xyz+=vec3(sin(t*.22+phase)*1.4,sin(t*.34+phase)*.55,cos(t*.19+phase)*.9);
        vec4 mvPosition=modelViewMatrix*world;
        vMoteAlpha=(.3+.25*sin(t*.6+phase))*(1.-smoothstep(45.,90.,length(mvPosition.xyz)));
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uTint;varying vec2 vMoteUV;varying float vMoteAlpha;
      void main(){
        vec2 p=vMoteUV*2.-1.;
        float leaf=1.-smoothstep(.68,1.,abs(p.x)*1.5+p.y*p.y);
        if(leaf<.01)discard;
        gl_FragColor=vec4(uTint,leaf*vMoteAlpha);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,fog:true,
  });
  const mesh=new InstancedMesh(new PlaneGeometry(1,1),material,max);
  mesh.name='sunlit-seed-motes';mesh.frustumCulled=false;mesh.userData.collision='none';
  const matrix=new Matrix4(),scale=new Vector3();let seed=1916;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<max;i++){
    const u=(random()-.5)*84,s=10+random()*95;
    const size=.08+random()*.13;
    matrix.makeRotationY(random()*Math.PI);matrix.scale(scale.set(size,size*1.8,size));
    matrix.setPosition(12.904+.908*u+.419*s,5.8+random()*8,-34.579-.419*u+.908*s);
    mesh.setMatrixAt(i,matrix);
  }
  group.add(mesh);group.userData.maxMotes=max;
  return{group,setQuality(low:boolean){mesh.count=low?Math.min(24,max):max;}};
}
