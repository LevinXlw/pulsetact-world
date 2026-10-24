import {Mesh,MeshLambertMaterial,type Material,type Object3D} from 'three';
import type {CampusId} from './campus-regions';

type Surface='stone'|'concrete'|'brick'|'paving'|'pavingBrick'|'pavingConcrete'|'lawn'|'desert'|'asphalt'|'glass'|'trim'|'wood'|'leaf'|'roof'|'water';

function surfaceFor(name:string,campus:CampusId):Surface|undefined{
  if(/pavingConcrete/.test(name))return 'pavingConcrete';
  if(/glass/i.test(name))return 'glass';
  // A brick ground finish needs XZ projection, not the facade's height axis.
  if(/pavingBrick|brickPaving/i.test(name))return 'pavingBrick';
  if(/brick/i.test(name))return 'brick';
  if(/concrete/i.test(name))return 'concrete';
  if(/desert/i.test(name)||campus==='arizona'&&/terrain/i.test(name))return 'desert';
  if(/grass|turf|terrain|orthophotography/i.test(name))return 'lawn';
  if(/paving|pavement|steps|porticoFloor/i.test(name))return 'paving';
  if(/asphalt|road|arterial/i.test(name))return 'asphalt';
  if(/water/i.test(name))return 'water';
  if(/leaf/i.test(name))return 'leaf';
  if(/bark|timber|wood/i.test(name))return 'wood';
  if(/roof/i.test(name))return 'roof';
  if(/trim|plinth/i.test(name))return 'trim';
  if(/stone|concrete|granite|wall|buildings/i.test(name))return 'stone';
  return undefined;
}

// All detail is evaluated on the existing world-space vertices. There are no
// bitmap textures, UV buffers, shadow maps, environment maps or extra passes.
const surfaceFunctions=/* glsl */`
  varying vec3 vMobileSurfacePosition;
  varying vec3 vMobileSurfaceNormal;
  float mobileHash(vec2 p){
    vec3 p3=fract(vec3(p.xyx)*.1031);
    p3+=dot(p3,p3.yzx+33.33);
    return fract((p3.x+p3.y)*p3.z);
  }
  float mobileNoise(vec2 p){
    vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mobileHash(cell),mobileHash(cell+vec2(1.,0.)),f.x),
      mix(mobileHash(cell+vec2(0.,1.)),mobileHash(cell+vec2(1.)),f.x),f.y);
  }
  float mobileJoint(vec2 p,vec2 size,float width){
    vec2 edge=min(fract(p/size),1.-fract(p/size))*size;
    vec2 aa=max(fwidth(p)*.6,vec2(.0008));
    vec2 lines=1.-smoothstep(vec2(width)-aa,vec2(width)+aa,edge);
    return max(lines.x,lines.y)*(1.-smoothstep(.035,.20,max(aa.x,aa.y)));
  }
  vec2 mobileWallFace(vec3 p,vec3 n){
    // Each planar facade follows its own normal, including rotated campuses.
    vec2 tangent=vec2(n.z,-n.x);
    float lengthSquared=dot(tangent,tangent);
    tangent=lengthSquared>.01?tangent*inversesqrt(lengthSquared):vec2(1.,0.);
    return vec2(dot(p.xz,tangent),p.y);
  }
`;

const paintings:Record<Surface,string>={
  pavingConcrete:/* glsl */`
    vec2 face=p.xz;
    float near=1.-smoothstep(.06,.35,max(fwidth(face.x),fwidth(face.y)));
    float slab=mobileHash(floor(face/1.5))-.5;
    diffuseColor.rgb*=1.+slab*.035*near+(mobileNoise(face*8.)-.5)*.018*near;
    diffuseColor.rgb*=1.-mobileJoint(face,vec2(1.5),.005)*.19;
  `,
  concrete:/* glsl */`
    vec2 face=mobileWallFace(p,n);
    float wash=mobileNoise(face*vec2(.15,.19)+8.3)-.5;
    float near=1.-smoothstep(.035,.18,max(fwidth(face.x),fwidth(face.y)));
    float grain=mobileNoise(face*8.1)-.5;
    diffuseColor.rgb*=1.+wash*.065+grain*.025*near;
    diffuseColor.rgb*=mix(vec3(1.),vec3(.86,.90,.96),smoothstep(.2,.85,-n.y));
  `,
  stone:/* glsl */`
    vec2 face=mobileWallFace(p,n);
    float row=floor(face.y/.74);
    vec2 blocks=face+vec2(mod(row,2.)*.79,0.);
    float tone=mobileHash(floor(blocks/vec2(1.58,.74)))-.5;
    float wash=mobileNoise(face*vec2(.12,.19)+8.3)-.5;
    float detail=1.-smoothstep(.12,.65,max(fwidth(face.x),fwidth(face.y)));
    diffuseColor.rgb*=1.+tone*.052*detail+wash*.08;
    diffuseColor.rgb*=1.-mobileJoint(blocks,vec2(1.58,.74),.008)*.13;
    diffuseColor.rgb*=mix(vec3(1.),vec3(.86,.90,.96),smoothstep(.2,.85,-n.y));
  `,
  brick:/* glsl */`
    vec2 face=mobileWallFace(p,n);
    float row=floor(face.y/.083);
    vec2 bond=face+vec2(mod(row,2.)*.12,0.);
    float near=1.-smoothstep(.018,.095,max(fwidth(face.x),fwidth(face.y)));
    float tone=mobileHash(floor(bond/vec2(.24,.083)))-.5;
    diffuseColor.rgb*=1.+tone*.17*near+(mobileNoise(face*.16)-.5)*.09;
    float mortar=mobileJoint(bond,vec2(.24,.083),.0035)*near;
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.67+vec3(.16,.15,.12),mortar*.68);
  `,
  paving:/* glsl */`
    vec2 face=p.xz;
    vec2 bond=face+vec2(mod(floor(face.y/.68),2.)*.46,0.);
    float near=1.-smoothstep(.08,.42,max(fwidth(face.x),fwidth(face.y)));
    float tile=mobileHash(floor(bond/vec2(.92,.68)))-.5;
    float seam=mobileJoint(bond,vec2(.92,.68),.012);
    float edge=mobileJoint(bond,vec2(.92,.68),.026);
    diffuseColor.rgb*=1.+tile*.10*near+(mobileNoise(face*.22)-.5)*.075;
    diffuseColor.rgb*=1.-seam*.23+max(0.,edge-seam)*.075;
  `,
  pavingBrick:/* glsl */`
    // Match the desktop BU forecourt's metre-scale running bond.
    vec2 face=p.xz;
    vec2 bond=face+vec2(mod(floor(face.y/.115),2.)*.115,0.);
    float near=1.-smoothstep(.018,.095,max(fwidth(face.x),fwidth(face.y)));
    float tone=mobileHash(floor(bond/vec2(.23,.115)))-.5;
    float seam=mobileJoint(bond,vec2(.23,.115),.003);
    diffuseColor.rgb*=1.+tone*.10*near+(mobileNoise(face*.22)-.5)*.065;
    diffuseColor.rgb*=1.-seam*.20;
  `,
  lawn:/* glsl */`
    vec2 face=p.xz;
    float wash=mix(mobileNoise(face*.045+9.2),mobileNoise(face*vec2(.13,.09)),.38);
    diffuseColor.rgb*=mix(vec3(.80,.88,.83),vec3(1.11,1.10,1.00),smoothstep(.15,.86,wash));
    float near=1.-smoothstep(.12,.8,max(fwidth(face.x),fwidth(face.y)));
    diffuseColor.rgb*=1.+(mobileNoise(face*vec2(2.4,.9))-.5)*.12*near;
  `,
  desert:/* glsl */`
    vec2 face=p.xz;
    float wash=mobileNoise(face*.07+5.1);
    diffuseColor.rgb*=mix(vec3(.92,.89,.84),vec3(1.08,1.06,1.01),wash);
    float near=1.-smoothstep(.08,.4,max(fwidth(face.x),fwidth(face.y)));
    diffuseColor.rgb*=1.+(mobileNoise(face*4.)-.5)*.075*near;
  `,
  asphalt:/* glsl */`
    vec2 face=p.xz;
    float near=1.-smoothstep(.025,.15,max(fwidth(face.x),fwidth(face.y)));
    diffuseColor.rgb*=.96+mobileNoise(face*.18)*.075+(mobileNoise(face*10.)-.5)*.045*near;
  `,
  glass:/* glsl */`
    vec2 face=mobileWallFace(p,n);
    vec3 eye=normalize(cameraPosition-p);
    float fresnel=pow(1.-abs(dot(n,eye)),3.);
    float sky=smoothstep(-.18,.80,reflect(-eye,n).y);
    float cloud=smoothstep(.48,.78,mobileNoise(face*vec2(.035,.08)+13.));
    vec3 reflection=mix(vec3(.25,.39,.42),vec3(.62,.79,.84),sky);
    reflection=mix(reflection,vec3(.85,.88,.81),cloud*sky*.24);
    diffuseColor.rgb=mix(diffuseColor.rgb,reflection,.20+fresnel*.22);
    totalEmissiveRadiance+=reflection*(.025+fresnel*.055);
  `,
  trim:/* glsl */`
    diffuseColor.rgb*=1.+(mobileNoise(p.xz*.3+p.y*.09)-.5)*.035;
    diffuseColor.rgb*=mix(vec3(1.),vec3(.82,.88,.95),smoothstep(.18,.8,-n.y));
  `,
  wood:/* glsl */`
    vec2 face=mobileWallFace(p,n);
    float near=1.-smoothstep(.05,.4,max(fwidth(face.x),fwidth(face.y)));
    diffuseColor.rgb*=1.+(mobileNoise(face*vec2(8.,.35))-.5)*.15*near;
  `,
  leaf:/* glsl */`
    float brush=mobileNoise(p.xz*.45+p.y*.2);
    diffuseColor.rgb*=mix(vec3(.84,.91,.86),vec3(1.11,1.10,.97),brush);
  `,
  roof:/* glsl */`
    vec2 face=p.xz;
    float near=1.-smoothstep(.04,.22,max(fwidth(face.x),fwidth(face.y)));
    diffuseColor.rgb*=1.+(mobileHash(floor(face/vec2(.5,.32)))-.5)*.09*near;
    diffuseColor.rgb*=1.-mobileJoint(face,vec2(.5,.32),.006)*.09;
  `,
  water:/* glsl */`
    float wave=sin(p.x*1.1+p.z*1.8+sin(p.x*.13)*1.7);
    float near=1.-smoothstep(.15,.9,max(fwidth(p.x),fwidth(p.z)));
    float glint=pow(max(0.,wave),12.)*.075*near;
    diffuseColor.rgb*=.96+mobileNoise(p.xz*.045)*.10+glint;
    vec3 eye=normalize(cameraPosition-p);
    totalEmissiveRadiance+=vec3(.19,.33,.36)*pow(1.-abs(dot(n,eye)),3.)*.13;
  `,
};

function detailedMaterial(source:MeshLambertMaterial,surface:Surface):MeshLambertMaterial{
  const material=source.clone();material.name=`${source.name} / mobile HD`;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vMobileSurfacePosition;\nvarying vec3 vMobileSurfaceNormal;')
      .replace('#include <project_vertex>',/* glsl */`
        #include <project_vertex>
        vMobileSurfacePosition=(modelMatrix*vec4(transformed,1.)).xyz;
        vMobileSurfaceNormal=inverseTransformDirection(transformedNormal,viewMatrix);
      `);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\n'+surfaceFunctions)
      .replace('#include <emissivemap_fragment>',/* glsl */`
        #include <emissivemap_fragment>
        vec3 p=vMobileSurfacePosition;
        vec3 n=normalize(vMobileSurfaceNormal);
        ${paintings[surface]}
      `);
  };
  material.customProgramCacheKey=()=>`mobile-hd-${surface}-v1`;
  return material;
}

/** Lazily adds a bounded material-only quality tier to the phone campus.
 * Geometry, collision and base materials retain their existing owners. A single
 * HD cache is reused across toggles, then released with this campus.
 */
export function createMobileHdMaterials(model:Object3D,campus:CampusId){
  const bindings:{mesh:Mesh;original:Material|Material[];hd:Material|Material[]}[]=[];
  const cache=new Map<MeshLambertMaterial,MeshLambertMaterial>();
  let prepared=false,disposed=false;
  const prepare=()=>{
    model.traverse(object=>{
      if(!(object instanceof Mesh)||!object.visible)return;
      const original=object.material;
      const convert=(source:Material)=>{
        if(!(source instanceof MeshLambertMaterial))return source;
        const surface=surfaceFor(source.name||object.name,campus);if(!surface)return source;
        let hd=cache.get(source);if(!hd){hd=detailedMaterial(source,surface);cache.set(source,hd);}return hd;
      };
      const hd=Array.isArray(original)?original.map(convert):convert(original);
      if(hd!==original)bindings.push({mesh:object,original,hd});
    });
    prepared=true;
  };
  return{
    setQuality(low:boolean){
      if(disposed)return;if(!low&&!prepared)prepare();
      for(const binding of bindings)binding.mesh.material=low?binding.original:binding.hd;
    },
    dispose(){
      if(disposed)return;disposed=true;
      for(const binding of bindings)binding.mesh.material=binding.original;
      cache.forEach(material=>material.dispose());cache.clear();bindings.length=0;
    },
  };
}
