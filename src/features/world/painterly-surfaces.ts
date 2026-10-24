import {DoubleSide, MeshStandardMaterial, Vector2, type Material} from 'three';

type Surface = 'limestone' | 'concrete' | 'brick' | 'column' | 'trim' | 'paving' | 'lawn' | 'glass' | 'wood' | 'metal' | 'interior' | 'asphalt' | 'water';

const groundNames = new Set(['grass', 'pavement', 'steps', 'porticoFloor', 'courtCurb', 'road', 'arterial', 'bridgeDeck', 'bridgeWalk']);

function surfaceFor(name: string): Surface {
  if (name === 'concrete') return 'concrete';
  if (/brick/i.test(name)) return 'brick';
  if (/glass/i.test(name)) return 'glass';
  if (name === 'grass' || name.includes('orthophotography')) return 'lawn';
  if (['pavement', 'steps', 'porticoFloor', 'bridgeWalk'].includes(name)) return 'paving';
  if (/interior|shade/i.test(name)) return 'interior';
  if (/Door|Panel|benchWood/.test(name)) return 'wood';
  if (/frame|metal|lettering|bronze|hardware|rail/i.test(name)) return 'metal';
  if (['road', 'arterial', 'bridgeDeck'].includes(name)) return 'asphalt';
  if (name === 'water') return 'water';
  if (name === 'columnStone') return 'column';
  if (/trim|curb|nosing/i.test(name) || name === 'roadMarking') return 'trim';
  return 'limestone';
}

const palette: Record<Surface, string> = {
  limestone: '#e0d4b9', concrete: '#c0bbb0', brick: '#a3654c', column: '#e9dfc6', trim: '#ede2c7', paving: '#cfbfa2',
  lawn: '#77965d', glass: '#4c6975', wood: '#79573c', metal: '#65716d',
  interior: '#354b57', asphalt: '#818b87', water: '#6babb6',
};

const painterlyFunctions = /* glsl */ `
  varying vec3 vCampusPosition;
  varying vec3 vCampusNormal;
  uniform vec2 uCampusOrientation;
  varying vec3 vCampusFrame;
  float campusHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float campusNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(campusHash(i), campusHash(i + vec2(1.0, 0.0)), f.x),
               mix(campusHash(i + vec2(0.0, 1.0)), campusHash(i + vec2(1.0)), f.x), f.y);
  }
  // Meter-scale joints, with derivative filtering so distant masonry stays calm.
  float campusJoint(vec2 p, vec2 size, float width) {
    vec2 cell = fract(p / size);
    vec2 distanceToEdge = min(cell, 1.0 - cell) * size;
    vec2 aa = max(fwidth(p) * 0.55, vec2(0.001));
    vec2 lines = 1.0 - smoothstep(vec2(width) - aa, vec2(width) + aa, distanceToEdge);
    return max(lines.x, lines.y) * (1.0 - smoothstep(0.09, 0.48, max(aa.x, aa.y)));
  }
  vec3 campusAxes(vec3 p) {
    return vec3(dot(p.xz, vec2(uCampusOrientation.x, -uCampusOrientation.y)), p.y, dot(p.xz, vec2(uCampusOrientation.y, uCampusOrientation.x)));
  }
  vec2 campusWallUV(vec3 p, vec3 n) {
    return abs(n.x) > abs(n.z) ? vec2(p.z, p.y) : p.xy;
  }
`;

// BU's walls are batched across many surveyed parcels. The optional frame
// follows each piece's original foundation and facade rather than world zero.
// This keeps the close masonry detail and ground weathering on sloping streets.
const buPainting:Partial<Record<Surface,string>>={
  brick: /* glsl */ `
    vec2 face=campusWallUV(campusP,campusN);
    vec2 bond=face+vec2(mod(floor(face.y/.078),2.)*.115,0.);
    float near=1.-smoothstep(.025,.14,max(fwidth(face.x),fwidth(face.y)));
    float mortar=campusJoint(bond,vec2(.23,.078),.0035)*near;
    float brick=campusHash(floor(bond/vec2(.23,.078)));
    float wash=campusNoise(face*vec2(.19,.31))-.5;
    diffuseColor.rgb*=1.+(brick-.5)*.22*near+wash*.11;
    diffuseColor.rgb*=mix(vec3(1.),vec3(1.06,.96,.91),brick*near*.35);
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.63+vec3(.15,.135,.11),mortar*.58);
    float foot=1.-smoothstep(.05,1.8,campusP.y);
    diffuseColor.rgb*=mix(vec3(1.),vec3(.76,.80,.83),foot*.68);
    diffuseColor.rgb*=mix(vec3(1.),vec3(.83,.87,.91),smoothstep(.15,.75,-campusN.y));
  `,
  limestone: /* glsl */ `
    vec2 face=campusWallUV(campusP,campusN);
    float row=floor(face.y/.62);
    vec2 blocks=face+vec2(mod(row,2.)*.64,0.);
    float joint=campusJoint(blocks,vec2(1.28,.62),.008);
    float near=1.-smoothstep(.08,.5,max(fwidth(face.x),fwidth(face.y)));
    float tone=campusHash(floor(blocks/vec2(1.28,.62)))-.5;
    float wash=campusNoise(face*vec2(.15,.27))-.5;
    diffuseColor.rgb*=1.+tone*.12*near+wash*.095;
    diffuseColor.rgb*=1.-joint*.17;
    float foot=1.-smoothstep(.08,2.1,campusP.y);
    diffuseColor.rgb*=mix(vec3(1.),vec3(.78,.83,.88),foot*.60);
    diffuseColor.rgb*=mix(vec3(1.),vec3(.77,.83,.90),smoothstep(.15,.75,-campusN.y));
  `,
  glass: /* glsl */ `
    vec3 eye=normalize(cameraPosition-vCampusPosition);
    vec3 reflected=reflect(-eye,normalize(vCampusNormal));
    float fresnel=pow(1.-abs(dot(normalize(vCampusNormal),eye)),3.);
    float sky=smoothstep(-.12,.68,reflected.y);
    vec2 cloudUV=reflected.xz/(.45+abs(reflected.y))*2.1;
    float cloud=smoothstep(.45,.76,campusNoise(cloudUV+14.2));
    vec3 reflection=mix(vec3(.12,.19,.19),vec3(.40,.61,.72),sky);
    reflection=mix(reflection,vec3(.73,.79,.76),cloud*sky*.42);
    // A quiet view-dependent sky tint complements the modelled recesses;
    // no extra cubemap, render target or pass is allocated.
    diffuseColor.rgb=mix(diffuseColor.rgb,reflection,.28+fresnel*.26);
    totalEmissiveRadiance+=reflection*(.018+fresnel*.04);
  `,
};

type PavingStyle = 'concrete' | 'stone' | 'granite' | 'brick';
// Authored metre-scale finishes, not a survey of individual pavers. Keep the
// street's concrete control joints distinct from plaza stone and entrance brick.
const pavingStyles:Record<PavingStyle,{size:[number,number];stagger:number;joint:number;tone:number}>={
  concrete:{size:[1.5,1.5],stagger:0,joint:.005,tone:.035},
  stone:{size:[.92,.76],stagger:.46,joint:.004,tone:.065},
  granite:{size:[.62,.62],stagger:0,joint:.003,tone:.085},
  brick:{size:[.23,.115],stagger:.115,joint:.003,tone:.12},
};
function pavingPainting(style:PavingStyle){
  const {size,stagger,joint,tone}=pavingStyles[style];
  return /* glsl */ `
    vec2 face=campusP.xz;
    vec2 size=vec2(${size[0].toFixed(4)},${size[1].toFixed(4)});
    vec2 bond=face+vec2(mod(floor(face.y/size.y),2.)*${stagger.toFixed(4)},0.);
    float near=1.-smoothstep(.025,.20,max(fwidth(face.x),fwidth(face.y)));
    float piece=campusHash(floor(bond/size))-.5;
    float seam=campusJoint(bond,size,${joint.toFixed(4)});
    float edge=campusJoint(bond,size,${(joint+.009).toFixed(4)});
    float wash=campusNoise(face*.19)-.5;
    float grain=campusNoise(face*vec2(18.7,21.3))-.5;
    diffuseColor.rgb*=1.+piece*${tone.toFixed(4)}*near+wash*.045+grain*.025*near;
    diffuseColor.rgb*=1.-seam*.23-max(0.,edge-seam)*.025;
  `;
}

const surfacePainting: Record<Surface, string> = {
  concrete: /* glsl */ `
    vec2 face=campusWallUV(campusP,campusN);
    float wash=campusNoise(face*vec2(.14,.27))-.5;
    float near=1.-smoothstep(.04,.25,max(fwidth(face.x),fwidth(face.y)));
    float grain=campusNoise(face*vec2(8.7,10.3))-.5;
    diffuseColor.rgb*=1.+wash*.07+grain*.025*near;
    float foot=1.-smoothstep(.08,1.4,campusP.y);
    diffuseColor.rgb*=1.-foot*.075;
    diffuseColor.rgb*=mix(vec3(1.),vec3(.80,.84,.88),smoothstep(.15,.75,-campusN.y));
  `,
  brick: /* glsl */ `
    vec2 face=campusWallUV(campusP,campusN);
    float row=floor(face.y/.078);
    vec2 bond=face+vec2(mod(row,2.0)*.115,0.0);
    float mortar=campusJoint(bond,vec2(.23,.078),.0035);
    float aa=max(fwidth(face.x),fwidth(face.y));
    float close=1.-smoothstep(.025,.14,aa);
    float brickTone=campusHash(floor(bond/vec2(.23,.078)))-.5;
    float wash=campusNoise(face*vec2(.17,.23))-.5;
    diffuseColor.rgb*=1.+brickTone*.10*close+wash*.07;
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.65+vec3(.18,.16,.13),mortar*.42*close);
  `,
  limestone: /* glsl */ `
    vec2 face = campusWallUV(campusP, campusN);
    float row = floor(face.y / 0.82);
    vec2 block = vec2(face.x + campusHash(vec2(row, 5.0)) * 1.78, face.y);
    float joint = campusJoint(block, vec2(1.78, 0.82), 0.007);
    float blockTone = campusHash(floor(block / vec2(1.78, 0.82))) - 0.5;
    // Broad washes carry the colour at a distance; mortar becomes a close detail.
    float wash = campusNoise(face * vec2(0.11, 0.19) + 8.3) - 0.5;
    float grain = campusNoise(face * vec2(0.85, 2.3)) - 0.5;
    diffuseColor.rgb *= 1.0 + blockTone * 0.025 + wash * 0.048 + grain * 0.014;
    diffuseColor.rgb *= 1.0 - joint * 0.075;
    float foot = 1.0 - smoothstep(0.5, 3.2, campusP.y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.85, 0.89, 0.94), foot);
    // Projecting cornices retain their cool underside even in very soft light.
    float underside = smoothstep(0.25, 0.8, -campusN.y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.80, 0.85, 0.92), underside);
  `,
  column: /* glsl */ `
    float edge = min(fract(campusP.y / 1.84), 1.0 - fract(campusP.y / 1.84)) * 1.84;
    float aa = max(fwidth(campusP.y) * 0.6, 0.001);
    float ring = (1.0 - smoothstep(0.004 - aa, 0.004 + aa, edge)) * (1.0 - smoothstep(0.07, 0.25, aa));
    float wash = campusNoise(campusP.xz * 0.28 + campusP.y * 0.09) - 0.5;
    diffuseColor.rgb *= 1.0 + wash * 0.025 - ring * 0.065;
    diffuseColor.rgb *= mix(vec3(0.90, 0.93, 0.97), vec3(1.0), smoothstep(1.0, 4.2, campusP.y));
  `,
  trim: /* glsl */ `
    float wash = campusNoise(campusP.xz * 0.24 + campusP.y * 0.12) - 0.5;
    diffuseColor.rgb *= 1.0 + wash * 0.022;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.84, 0.91), smoothstep(0.15, 0.75, -campusN.y));
  `,
  paving: /* glsl */ `
    vec2 face = campusP.xz;
    float row = floor(face.y / 0.76);
    vec2 paving = face + vec2(mod(row, 2.0) * 0.46, 0.0);
    vec2 tile = floor(paving / vec2(0.92, 0.76));
    float stone = campusHash(tile) - 0.5;
    float seam = campusJoint(paving, vec2(0.92, 0.76), 0.015);
    float wash = campusNoise(face * 0.21) - 0.5;
    float grain = campusNoise(face * vec2(2.7, 5.1)) - 0.5;
    diffuseColor.rgb *= 1.0 + stone * 0.052 + wash * 0.045 + grain * 0.012;
    diffuseColor.rgb *= 1.0 - seam * 0.17;
    // A lighter worn stone edge gives joints depth without a shiny PBR finish.
    float wideSeam = campusJoint(paving, vec2(0.92, 0.76), 0.031);
    diffuseColor.rgb *= 1.0 + max(0.0, wideSeam - seam) * 0.045;
  `,
  lawn: /* glsl */ `
    vec2 field = campusP.xz;
    float patches = campusNoise(field * 0.05 + vec2(13.2, 4.8));
    float wash = campusNoise(field * vec2(0.12, 0.09) + vec2(5.7, 18.9));
    float fieldTone = smoothstep(0.18, 0.82, mix(patches, wash, 0.32));
    // Broad cooler hollows and warmer meadow patches remain readable at a distance.
    diffuseColor.rgb *= mix(vec3(0.79, 0.85, 0.80), vec3(1.11, 1.09, 0.99), fieldTone);
    float brush = campusNoise(field * vec2(1.55, 0.82) + vec2(2.8, 9.6)) - 0.5;
    float nearBrush = 1.0 - smoothstep(8.0, 34.0, length(vCampusPosition.xz - cameraPosition.xz));
    diffuseColor.rgb *= 1.0 + brush * 0.07 * nearBrush;
  `,
  glass: /* glsl */ `
    vec2 face = campusWallUV(campusP, campusN);
    float reflection = campusNoise(vec2(face.x * 0.07, face.y * 0.13) + 14.2);
    float reflectedSky = smoothstep(3.0, 22.0, face.y);
    // The model already contains mullions. A second grid flattened the recesses.
    vec3 reflectionTint = mix(vec3(0.66, 0.77, 0.82), vec3(0.94, 1.03, 1.08), reflectedSky);
    diffuseColor.rgb *= reflectionTint * (0.95 + reflection * 0.08);
    totalEmissiveRadiance *= 0.65 + reflectedSky * 0.35;
  `,
  wood: /* glsl */ `
    vec2 face = campusWallUV(campusP, campusN);
    float grain = campusNoise(face * vec2(9.0, 0.3));
    diffuseColor.rgb *= 0.96 + grain * 0.07;
  `,
  metal: '',
  interior: '',
  asphalt: /* glsl */ `
    diffuseColor.rgb *= 0.97 + campusNoise(campusP.xz * 0.2) * 0.055 + (campusNoise(campusP.xz * 11.0) - 0.5) * 0.016;
  `,
  water: /* glsl */ `
    float ripples = sin(campusP.x * 1.1 + campusP.z * 1.9 + sin(campusP.x * 0.12) * 1.8);
    diffuseColor.rgb *= 1.0 + pow(max(0.0, ripples), 16.0) * 0.08;
  `,
};

/** Painterly architectural finishes in the surveyed campus's meter coordinates. */
export function createCampusSurface(name: string, options:{yaw?:number;profile?:'bu';groundHeight?:number;geometryFrame?:boolean;pavingStyle?:PavingStyle}={}): Material {
  const surface = surfaceFor(name);
  const material = new MeshStandardMaterial({
    name,
    color: palette[surface],
    roughness: surface === 'glass' ? 0.58 : surface === 'metal' ? 0.76 : 0.96,
    metalness: surface === 'glass' ? 0.05 : surface === 'metal' ? 0.12 : 0,
  });
  if (surface === 'glass') {
    material.emissive.set('#698797');
    material.emissiveIntensity = 0.075;
  }
  if (surface === 'interior') {
    material.emissive.set('#526778');
    material.emissiveIntensity = 0.045;
  }
  if (surface === 'water') {
    material.side = DoubleSide;
    material.roughness = 0.6;
  }
  if (groundNames.has(name)) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
  }
  material.onBeforeCompile = shader => {
    shader.uniforms.uCampusOrientation={value:options.yaw===undefined?new Vector2(.908,.419):new Vector2(Math.cos(options.yaw),Math.sin(options.yaw))};
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCampusPosition; varying vec3 vCampusNormal; varying vec3 vCampusFrame;
        ${options.geometryFrame?'attribute float campusBaseHeight; attribute float campusYaw;':''}`)
      .replace('#include <project_vertex>', /* glsl */ `
        #include <project_vertex>
        vec4 campusWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          campusWorld = instanceMatrix * campusWorld;
        #endif
        vCampusPosition = (modelMatrix * campusWorld).xyz;
        vCampusNormal = inverseTransformDirection(transformedNormal, viewMatrix);
        vCampusFrame=${options.geometryFrame?'vec3(cos(campusYaw),sin(campusYaw),campusBaseHeight)':`vec3(0.,0.,${(options.groundHeight??0).toFixed(5)})`};
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + painterlyFunctions)
      .replace('#include <emissivemap_fragment>', /* glsl */ `
        #include <emissivemap_fragment>
        ${options.geometryFrame?`
          vec3 campusP=vec3(dot(vCampusPosition.xz,vec2(vCampusFrame.x,-vCampusFrame.y)),vCampusPosition.y-vCampusFrame.z,dot(vCampusPosition.xz,vCampusFrame.yx));
          vec3 worldN=normalize(vCampusNormal);
          vec3 campusN=vec3(dot(worldN.xz,vec2(vCampusFrame.x,-vCampusFrame.y)),worldN.y,dot(worldN.xz,vCampusFrame.yx));
        `:`vec3 campusP = campusAxes(vCampusPosition)-vec3(0.,vCampusFrame.z,0.);
        vec3 campusN = campusAxes(normalize(vCampusNormal));`}
        ${surface==='paving'&&options.pavingStyle?pavingPainting(options.pavingStyle):options.profile==='bu'?(buPainting[surface]??surfacePainting[surface]):surfacePainting[surface]}
      `);
  };
  material.customProgramCacheKey = () => `campus-painted-surface-${surface}-${options.profile??'default'}-${options.geometryFrame?'frame':options.groundHeight??0}-${options.pavingStyle??'default'}-v6`;
  return material;
}
