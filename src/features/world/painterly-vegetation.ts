import {
  BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedMesh, Matrix4,
  Mesh, MeshDepthMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion,
  RepeatWrapping, RGBADepthPacking, SphereGeometry, SRGBColorSpace, Vector3,
} from 'three';
import type {CampusCollision} from '../real-campus/campus-collision';
import {lawnEdgeDistance} from '../real-campus/courtyard-ground-detail';
import {partitionVegetation} from './vegetation-batches';

type Tree = {x:number; z:number; radius:number; /** Optional residence crown height above its root, in metres. */height?:number; /** Absolute world Y of a planter's soil surface. */rootY?:number};
type Wind = {value:number};
type Branch = {a:Vector3; b:Vector3; radius:number};
type Crown = {center:Vector3; width:number; height:number; depth:number; yaw:number; tilt:number};
type TreeStructure = {branches:Branch[];crowns:Crown[];h:number;radius:number;detailScale?:number;collisionHeight?:number};
const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;
function seeded(seed:number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function shuffledOrder(count:number, seed:number) {
  const random = seeded(seed), order = Uint32Array.from({length:count}, (_, index) => index);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function paintedTexture(width:number, height:number, paint:(ctx:CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to paint campus foliage');
  paint(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

/** Sparse, broad leaves finish the silhouette; solid shaded foliage beneath
 * them carries the crown at a distance instead of thousands of alpha flecks. */
function leafSpray(fine=false) {
  return paintedTexture(512, 512, ctx => {
    const random = seeded(9072);
    if(fine){
      // A branching sprig, not a filled radial rosette. The transparent space
      // between leaflets survives at walking distance and in the shadow map.
      const stem=(ax:number,ay:number,bx:number,by:number,width:number)=>{
        ctx.strokeStyle='#655f49';ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
      };
      stem(218,458,276,58,2.3);
      for(let branch=0;branch<12;branch++){
        const t=(branch+.5)/12,side=branch%2?-1:1;
        const ax=218+58*t,ay=458-400*t;
        const bx=ax+side*(75+random()*95)*(1-t*.45),by=ay-24-random()*58;
        stem(ax,ay,bx,by,1.1);
        for(let leaf=0;leaf<9;leaf++){
          const along=(leaf+.6)/9,px=ax+(bx-ax)*along,py=ay+(by-ay)*along;
          const direction=Math.atan2(by-ay,bx-ax)+(leaf%2?1:-1)*(.55+random()*.35);
          const length=25+random()*13,width=9+random()*5;
          ctx.save();ctx.translate(px,py);ctx.rotate(direction);
          ctx.fillStyle=['#879653','#718747','#93a45e','#647c40','#a1af68'][leaf%5];
          ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(length*.45,-width,length,0);ctx.quadraticCurveTo(length*.45,width,0,0);ctx.fill();
          ctx.strokeStyle='rgba(193,205,132,.35)';ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(1,0);ctx.lineTo(length*.85,0);ctx.stroke();ctx.restore();
        }
      }return;
    }
    // A connected spray has a quiet centre and separate leaves at its edge.
    // The centre covers the small opaque core while overlapping sprays retain
    // broad colour masses instead of a forest of bright pinholes.
    ctx.fillStyle = '#9cb582'; ctx.beginPath();
    for (let point = 0; point < 24; point++) {
      const angle = point / 24 * TAU, radius = point % 2 ? 133 : 163;
      const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius * .82;
      if (point === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    for (let leaf = 0; leaf < 38; leaf++) {
      const theta = leaf * 2.39996, reach = Math.sqrt((leaf + .5) / 38) * 160;
      const x = 256 + Math.cos(theta) * reach, y = 256 + Math.sin(theta) * reach * .82;
      const angle = theta + (random() - .5) * 1.2;
      const length = 75 + random() * 45, width = 27 + random() * 17;
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      const shades = ['#a1b982', '#96b080', '#adbf88', '#a6b983', '#94ae7c'];
      ctx.fillStyle = shades[Math.floor(random() * shades.length)];
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(length * .28, -width, length * .69, -width * .77, length, 0);
      ctx.bezierCurveTo(length * .65, width * .72, length * .26, width * .88, 0, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(228,235,171,.12)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length, 0);
      ctx.quadraticCurveTo(length * .5, -width * .85, 0, 0); ctx.fill();
      ctx.restore();
    }
  });
}

function canopyPaint(fine=false) {
  const texture = paintedTexture(256, 256, ctx => {
    const random = seeded(3261);
    if(!fine){ctx.fillStyle = '#d3ddb9'; ctx.fillRect(0, 0, 256, 256);}
    // Residence cores are small perforated leaf clusters. Leaving the canvas
    // clear avoids an opaque ball behind the near silhouette cards.
    for (let i = 0; i < (fine?2400:55); i++) {
      const x = random() * 256, y = random() * 256, r = fine?2.4+random()*4.2:10+random()*27;
      ctx.fillStyle = ['#c7d4ad', '#dbe2bf', '#cdd9b2', '#d2ddb7'][i % 4];
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
        ctx.beginPath();
        for (let p = 0; p < 12; p++) {
          const angle = p / 12 * TAU, radius = r * (p % 2 ? .79 : 1);
          const px = x + dx + Math.cos(angle) * radius, py = y + dy + Math.sin(angle) * radius * .65;
          if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
    }
    if(fine){
      // A few branch-sized gaps among dense leaf groups, rather than uniform
      // pinholes. Coverage stays high enough to survive the distance mipmaps.
      ctx.globalCompositeOperation='destination-out';
      for(let gap=0;gap<9;gap++){
        const x=random()*256,y=random()*256,r=7+random()*8,ry=r*(.4+random()*.3),angle=random()*TAU;
        for(const dx of [-256,0,256])for(const dy of [-256,0,256]){
          ctx.beginPath();ctx.ellipse(x+dx,y+dy,r,ry,angle,0,TAU);ctx.fill();
        }
      }
      ctx.globalCompositeOperation='source-over';
    }
  });
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

function crownContour(x:number, y:number, z:number,soft=false) {
  const angle = Math.atan2(z, x), ring = Math.hypot(x, z);
  const scallop = 1 + (soft?.085:.16) * Math.sin(angle * 3 + y * 4) + (soft?.035:.08) * Math.cos(angle * 7 - y * 5)
    + (soft?.012:.035) * Math.sin(angle * 13 + y * 9);
  const shoulder = .94 + y * .12;
  return new Vector3(x * scallop * shoulder + y * y * .13,
    y * (y < 0 ? .61 : 1) + Math.sin(angle * 3 + y * 5) * ring * .14,
    z * scallop * shoulder + Math.sin(y * 3) * .08);
}

function canopyGeometry(distant:boolean,soft=false,fine=false) {
  const geometry = new SphereGeometry(1,fine?(distant?8:10):soft?20:distant ? 10 : 14,fine?(distant?5:7):soft?14:distant ? 7 : 10);
  const vertices = geometry.getAttribute('position');
  const colors = new Float32Array(vertices.count * 3);
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    // Uneven broad shoulders, a flatter hanging underside and a broken edge.
    const contour = crownContour(x, y, z,soft);
    vertices.setXYZ(i, contour.x, contour.y, contour.z);
    const upper = Math.max(0, Math.min(1, (y + .65) / 1.65));
    const patch = .035 * Math.sin(x * 5 + z * 3) * Math.cos(y * 6);
    colors[i * 3] = .76 + upper * .24 + patch;
    colors[i * 3 + 1] = .86 + upper * .14 + patch;
    colors[i * 3 + 2] = .88 + upper * .09 + patch;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function barkPaint() {
  const texture = paintedTexture(128, 512, ctx => {
    const random = seeded(4013);
    ctx.fillStyle = '#8f8b72'; ctx.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 95; i++) {
      const x = random() * 128, y = random() * 512, h = 13 + random() * 120;
      ctx.strokeStyle = i % 3 ? 'rgba(70,76,61,.16)' : 'rgba(224,218,192,.15)';
      ctx.lineWidth = .7 + random() * 2.7;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + 3, y + h * .3, x - 3, y + h * .7, x + random() * 4, y + h); ctx.stroke();
    }
  });
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(2, 2);
  return texture;
}

function grassGeometry() {
  const positions:number[] = [], colors:number[] = [], random = seeded(2371);
  for (let blade = 0; blade < 6; blade++) {
    const angle = blade * 2.39, dx = Math.cos(angle), dz = Math.sin(angle);
    const x = (random() - .5) * .56, z = (random() - .5) * .56;
    const height = .72 + random() * .28, width = .013 + random() * .007, bend = .034 + random() * .04;
    const points = [[x - dx * width, 0, z - dz * width], [x + dx * width, 0, z + dz * width],
      [x + dx * width * .72 - dz * bend * .32, height * .61, z + dz * width * .72 + dx * bend * .32],
      [x - dx * width * .72 - dz * bend * .32, height * .61, z - dz * width * .72 + dx * bend * .32],
      [x - dz * bend, height, z + dx * bend]];
    for (const point of [0, 1, 2, 0, 2, 3, 3, 2, 4]) {
      positions.push(...points[point]);
      const tone = point < 2 ? .93 : point === 4 ? 1.07 : 1;
      colors.push(tone, tone, tone);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function sway(material:MeshStandardMaterial | MeshDepthMaterial, wind:Wind, kind:'grass'|'leaf'|'crown',soft=false,fine=false) {
  const grass = kind === 'grass', leaf = kind === 'leaf';
  material.onBeforeCompile = shader => {
    shader.uniforms.paintedWind = wind;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float paintedWind;
      ${leaf ? 'attribute vec3 crownNormal; varying vec3 vCrownNormal;' : ''}
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 root = instanceMatrix[3].xyz;
      float breeze = sin(paintedWind*.8+root.x*.16+root.z*.11);
      float flutter = sin(paintedWind*1.7+root.x*.84+root.z*.59);
      float weight = ${grass ? 'clamp(position.y,0.,1.)' : 'clamp(position.y*.5+.5,0.,1.)'};
      transformed.x += (breeze*${grass ? '.027' : leaf ? '.05' : '.018'}+flutter*${grass ? '.008' : '.01'})*weight*weight;
      transformed.z += breeze*${grass ? '.008' : '.025'}*weight;
      ${grass ? 'transformed.y*=1.-smoothstep(12.,38.,length(root-cameraPosition));' : ''}
      ${leaf ? 'vCrownNormal=normalize(mat3(viewMatrix)*crownNormal);' : ''}
    `);
    if (material instanceof MeshStandardMaterial) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        ${leaf ? 'varying vec3 vCrownNormal;' : ''}
      `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${grass ? 'normal=normalize(normal*.1+mat3(viewMatrix)*vec3(0.,1.,0.));' : leaf ? fine?'normal=normalize(normal*.42+vCrownNormal*.65);':'normal=normalize(normal*.15+vCrownNormal);' : soft?'normal=normalize(normal*.72+mat3(viewMatrix)*vec3(0.,.28,0.));':''}
      `).replace('#include <opaque_fragment>', `
        ${grass ? '' : fine?'outgoingLight=max(outgoingLight,diffuseColor.rgb*vec3(.12,.17,.10));':'outgoingLight=max(outgoingLight,diffuseColor.rgb*vec3(.23,.30,.29));'}
        #include <opaque_fragment>
      `);
    }
  };
  material.customProgramCacheKey = () => `painted-campus-${kind}-wind-v4-${soft}${fine?'-residence-open-crown':''}`;
}

function structure(index:number):TreeStructure {
  const random = seeded(263 + index * 1987), hero = index < 22;
  const h = (index < 10 ? 16.3 : hero ? 14.6 : 10.8) + random() * 2.5;
  const radius = hero ? .41 + random() * .12 : .29 + random() * .1;
  const bias = random() * TAU;
  const lean = new Vector3(Math.cos(bias) * (.65 + random() * .8), 0, Math.sin(bias) * (.65 + random() * .8));
  const branches:Branch[] = [], crowns:Crown[] = [];
  // A slightly crooked bole continues through staggered forks. Branches do
  // not all begin at one radial hub, so each avenue tree has its own silhouette.
  const trunk = [new Vector3(0, -.03, 0), new Vector3(lean.x * .18, h * .17, lean.z * .18),
    new Vector3(lean.x * .63 + .18 * Math.sin(bias), h * .34, lean.z * .63),
    new Vector3(lean.x, h * .51, lean.z)];
  for (let i = 0; i < trunk.length - 1; i++) {
    branches.push({a:trunk[i], b:trunk[i + 1], radius:radius * Math.pow(.72, i)});
  }
  const trunkAt = (height:number) => {
    const section = Math.min(2, Math.floor(height / .17));
    return trunk[section].clone().lerp(trunk[section + 1], (height - section * .17) / .17);
  };
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI * .5 + random();
    branches.push({a:new Vector3(Math.cos(angle) * .17, .3, Math.sin(angle) * .17),
      b:new Vector3(Math.cos(angle) * .9, -.055, Math.sin(angle) * .9), radius:radius * .4});
  }
  const limbs = 3 + (hero && index % 3 !== 1 ? 1 : 0);
  for (let i = 0; i < limbs; i++) {
    const angle = bias + i / limbs * TAU + (random() - .5) * .75;
    const reach = (hero ? 3.5 : 2.65) + random() * 1.9;
    const a = trunkAt(.23 + i / limbs * .21 + random() * .035);
    const tip = new Vector3(Math.cos(angle) * reach + lean.x, h * (.68 + random() * .13), Math.sin(angle) * reach + lean.z);
    const bend = a.clone().lerp(tip, .39);
    bend.add(new Vector3(-Math.sin(angle) * .35, h * .06, Math.cos(angle) * .35));
    const elbow = bend.clone().lerp(tip, .57); elbow.y += .42;
    branches.push({a, b:bend, radius:radius * (.48 + random() * .11)},
      {a:bend, b:elbow, radius:radius * .30}, {a:elbow, b:tip, radius:radius * .17});
    crowns.push({center:tip.clone(), width:(hero ? 2.65 : 2) + random() * .55,
      height:h * (.145 + random() * .035), depth:(hero ? 2.3 : 1.8) + random() * .55,
      yaw:Math.PI * .5 - angle, tilt:(random() - .5) * .24});
    // Smaller, hanging growth follows one lateral fork instead of filling the
    // entire centre with a single ball. Unequal forks leave readable sky gaps.
    const side = i % 2 ? -1 : 1, offAngle = angle + side * (.65 + random() * .35);
    const twigStart = bend.clone().lerp(elbow, .6);
    const end = tip.clone().add(new Vector3(Math.cos(offAngle) * 1.5, -1.1 - random() * .7, Math.sin(offAngle) * 1.5));
    branches.push({a:twigStart, b:end, radius:radius * .13});
    crowns.push({center:end, width:(hero ? 1.85 : 1.5) + random() * .45,
      height:h * (.10 + random() * .025), depth:(hero ? 1.55 : 1.25) + random() * .35,
      yaw:Math.PI * .5 - offAngle, tilt:side * .25});
  }
  const top = new Vector3(lean.x * 1.75 + Math.cos(bias) * .7, h * .86, lean.z * 1.75 + Math.sin(bias) * .7);
  const topBend = trunk[3].clone().lerp(top, .52); topBend.x += .32;
  branches.push({a:trunk[3], b:topBend, radius:radius * .30}, {a:topBend, b:top, radius:radius * .16});
  crowns.push({center:top, width:hero ? 2.5 : 1.9, height:h * .155,
    depth:hero ? 2.2 : 1.7, yaw:bias, tilt:.12});
  return {branches, crowns, h, radius};
}

/** Broad, interlocking deciduous crowns for BU's planted streets. Leaf cards
 * soften the outline; the opaque crown remains continuous at reduced detail. */
function buStreetStructure(tree:Tree,index:number):TreeStructure {
  const random=seeded(8173+Math.round(tree.x*11+tree.z*37)+index*17);
  const upright=index%5===1,spread=Math.max(3.5,Math.min(6.4,tree.radius*(upright?.9:1.18)));
  const h=(upright?12.5:10.8)+random()*3.1,radius=.24+spread*.027;
  const bias=random()*TAU,lean=new Vector3(Math.cos(bias)*.55,0,Math.sin(bias)*.55);
  const branches:Branch[]=[],crowns:Crown[]=[];
  const fork=new Vector3(lean.x*.6,h*.40,lean.z*.6),top=new Vector3(lean.x,h*.76,lean.z);
  branches.push({a:new Vector3(0,0,0),b:fork,radius},{a:fork,b:top,radius:radius*.61});
  for(let i=0;i<4;i++){
    const angle=bias+i*Math.PI/2+(random()-.5)*.35;
    const end=new Vector3(Math.cos(angle)*spread*.47+lean.x,h*(.63+random()*.10),Math.sin(angle)*spread*.47+lean.z);
    const bend=fork.clone().lerp(end,.55);bend.y+=.45;
    branches.push({a:fork,b:bend,radius:radius*.48},{a:bend,b:end,radius:radius*.25});
    crowns.push({center:end,width:spread*(.60+random()*.08),height:h*(upright?.25:.22),depth:spread*(.54+random()*.10),yaw:angle,tilt:(random()-.5)*.15});
    const lower=end.clone().add(new Vector3(Math.cos(angle)*.7,-1.05,Math.sin(angle)*.7));
    crowns.push({center:lower,width:spread*.43,height:h*.15,depth:spread*.43,yaw:angle+.35,tilt:.10});
  }
  crowns.push({center:top,width:spread*.69,height:h*.23,depth:spread*.65,yaw:bias,tilt:.04});
  for(let i=0;i<3;i++){
    const angle=bias+i*TAU/3;
    branches.push({a:new Vector3(0,.25,0),b:new Vector3(Math.cos(angle)*.65,-.025,Math.sin(angle)*.65),radius:radius*.42});
  }
  return {branches,crowns,h,radius};
}

/** Photo-led branching habit for the residence courts (baker-mit-guide.jpg).
 * Tree species and individual limb dimensions are authored estimates. Staggered
 * forks, small terminal leaf clusters and open inter-limb gaps replace the BU
 * avenue's interlocking crown masses; surveyed tree anchors remain untouched. */
function residenceStructure(tree:Tree,index:number):TreeStructure {
  const random=seeded(17621+Math.round(tree.x*19+tree.z*43)+index*211);
  const upright=index%4===1,spread=Math.max(3.6,Math.min(6.4,tree.radius*(upright?.94:1.12)));
  const h=(upright?12.2:10.9)+random()*2.6,radius=.19+spread*.024;
  const bias=random()*TAU,lean=new Vector3(Math.cos(bias)*.7,0,Math.sin(bias)*.7);
  const branches:Branch[]=[],crowns:Crown[]=[];
  const trunk=Array.from({length:6},(_,i)=>{
    const t=i/5;
    return new Vector3(lean.x*t+Math.sin(t*5)*.13,h*t*.83,lean.z*t+Math.sin(t*4+bias)*t*.15);
  });
  for(let i=0;i<5;i++)branches.push({a:trunk[i],b:trunk[i+1],radius:radius*Math.pow(.72,i)});
  const trunkAt=(t:number)=>{
    const segment=Math.min(4,Math.floor(t/.83*5)),along=t/.83*5-segment;
    return trunk[segment].clone().lerp(trunk[segment+1],along);
  };
  const cluster=(center:Vector3,angle:number,size:number)=>crowns.push({center,
    width:size*(.91+random()*.18),height:size*(upright?.98:.76)*( .88+random()*.24),
    depth:size*(.72+random()*.21),yaw:angle,tilt:(random()-.5)*.5});
  for(let limb=0;limb<5;limb++){
    const angle=bias+limb*2.399963+(random()-.5)*.4;
    const start=trunkAt(.27+limb*.052),reach=spread*(.57+random()*.24);
    const tip=new Vector3(lean.x+Math.cos(angle)*reach,h*(.62+limb*.038+random()*.055),lean.z+Math.sin(angle)*reach);
    const bend=start.clone().lerp(tip,.48);bend.y+=h*.075;
    bend.x-=Math.sin(angle)*.24;bend.z+=Math.cos(angle)*.24;
    const limbPoints=Array.from({length:5},(_,i)=>{
      const t=i/4;
      return start.clone().multiplyScalar((1-t)*(1-t)).addScaledVector(bend,2*t*(1-t)).addScaledVector(tip,t*t);
    });
    // Each cylinder's .72 upper radius meets the next cylinder's base. Four
    // shorter segments describe an upward curve without abrupt thick elbows.
    for(let segment=0;segment<4;segment++)branches.push({a:limbPoints[segment],b:limbPoints[segment+1],radius:radius*(.38-limb*.024)*Math.pow(.72,segment)});
    cluster(tip,angle,spread*(.23+random()*.05));
    for(let fork=0;fork<3;fork++){
      const side=fork%2?-1:1,forkAngle=angle+side*(.55+random()*.48);
      const t=.43+fork*.22,segment=Math.min(3,Math.floor(t*4));
      const joint=limbPoints[segment].clone().lerp(limbPoints[segment+1],t*4-segment);
      const end=joint.clone().add(new Vector3(Math.cos(forkAngle)*spread*(.27+random()*.14),
        h*(fork===0?-.025:.045)+random()*.4,Math.sin(forkAngle)*spread*(.27+random()*.14)));
      const knuckle=joint.clone().lerp(end,.55);knuckle.y+=.16;
      branches.push({a:joint,b:knuckle,radius:radius*.075},{a:knuckle,b:end,radius:radius*.054});
      cluster(end,forkAngle,spread*(.17+random()*.06));
    }
  }
  cluster(trunk[5].clone(),bias,spread*.26);
  for(let i=0;i<2;i++){
    const angle=bias+i*Math.PI+.6,start=trunkAt(.68+i*.055);
    const tip=new Vector3(lean.x+Math.cos(angle)*spread*.25,h*(.88+random()*.05),lean.z+Math.sin(angle)*spread*.25);
    const bend=start.clone().lerp(tip,.58);
    branches.push({a:start,b:bend,radius:radius*.10},{a:bend,b:tip,radius:radius*.072});
    cluster(tip,angle,spread*.22);
  }
  for(let i=0;i<3;i++){
    const angle=bias+i*TAU/3;
    branches.push({a:new Vector3(0,.22,0),b:new Vector3(Math.cos(angle)*.63,-.025,Math.sin(angle)*.63),radius:radius*.35});
  }
  if(tree.height!==undefined&&Number.isFinite(tree.height)&&tree.height>0){
    // Explicit dimensions support saplings and planter shrubs without the
    // mature-tree minimum spread. Scale shared branch/cluster junctions once;
    // leaf-card size and the separate trunk collider follow the same habit.
    const horizontal=Number.isFinite(tree.radius)&&tree.radius>0?tree.radius/spread:1;
    const vertical=tree.height/h,thickness=Math.min(horizontal,vertical);
    const proportions=new Vector3(horizontal,vertical,horizontal);
    const points=new Set([...branches.flatMap(branch=>[branch.a,branch.b]),...crowns.map(crown=>crown.center)]);
    for(const point of points)point.multiply(proportions);
    for(const branch of branches)branch.radius*=thickness;
    for(const crown of crowns){crown.width*=horizontal;crown.depth*=horizontal;crown.height*=vertical;}
    if(tree.height<=2.5){
      // A broad planter shrub is not a miniature street tree. Low branching
      // and fuller leaf clusters hide the bare single-stem / flat tier habit.
      for(const point of points)point.y*=.70;
      for(const crown of crowns){crown.width*=1.3;crown.depth*=1.3;crown.height=Math.max(crown.height,tree.height*(.24+random()*.08));}
    }
    return {branches,crowns,h:tree.height,radius:radius*thickness,detailScale:thickness,collisionHeight:2.4*vertical};
  }
  return {branches,crowns,h,radius};
}

export function createPainterlyGrass(lawn:Mesh, wind:Wind, options:{edgeDistance?:(x:number,z:number)=>number;rootAllowed?:(x:number,y:number,z:number)=>boolean;maxTufts?:number;upwardOnly?:boolean}={}) {
  const edgeDistance=options.edgeDistance??lawnEdgeDistance;
  const random = seeded(28763), roots:Vector3[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const spacing = .62;
  const gridNoise = (x:number, z:number, salt:number) => {
    let value = Math.imul(x ^ salt, 374761393) + Math.imul(z, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  lawn.updateWorldMatrix(true, false);
  const position = lawn.geometry.getAttribute('position'), indices = lawn.geometry.index;
  const count = indices?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(position, indices ? indices.getX(i) : i).applyMatrix4(lawn.matrixWorld);
    b.fromBufferAttribute(position, indices ? indices.getX(i + 1) : i + 1).applyMatrix4(lawn.matrixWorld);
    c.fromBufferAttribute(position, indices ? indices.getX(i + 2) : i + 2).applyMatrix4(lawn.matrixWorld);
    // Reject distant city lawns before sampling their triangles.
    if (edgeDistance((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3) < 0) continue;
    // Raised lawn boxes have underside triangles as well as a top surface.
    // Those underside roots would grow through the turf and duplicate density.
    if(options.upwardOnly&&((b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z))<=0)continue;
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(denominator) < .00001) continue;
    const minX = Math.floor(Math.min(a.x, b.x, c.x) / spacing), maxX = Math.ceil(Math.max(a.x, b.x, c.x) / spacing);
    const minZ = Math.floor(Math.min(a.z, b.z, c.z) / spacing), maxZ = Math.ceil(Math.max(a.z, b.z, c.z) / spacing);
    // One independently jittered root per ground cell avoids the accidental
    // bare triangles and tight clumps of uniform random sampling.
    for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
      const x = (gx + .13 + gridNoise(gx, gz, 991) * .74) * spacing;
      const z = (gz + .13 + gridNoise(gx, gz, 173) * .74) * spacing;
      const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator, wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      if (edgeDistance(x, z) < .065) continue;
      // Broad patches remain quiet from a distance; density is independent of
      // the spawn point, so walking across the lawn never reveals a bare zone.
      const wash = Math.sin(x * .071 + z * .024) * Math.cos(z * .063 - x * .019);
      const density = .72 + wash * .19;
      if (gridNoise(gx, gz, 2631) > density) continue;
      const y=a.y*wa+b.y*wb+c.y*wc;
      if(options.rootAllowed&&!options.rootAllowed(x,y,z))continue;
      roots.push(new Vector3(x, y + .012, z));
    }
  }
  // A shuffled prefix keeps the whole lawn populated in low quality mode.
  for (let i = roots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [roots[i], roots[j]] = [roots[j], roots[i]];
  }
  roots.length = Math.min(roots.length, options.maxTufts??22000);
  const material = new MeshStandardMaterial({name:'Soft mown meadow blades',
    color:'#77965d', side:DoubleSide, vertexColors:true, roughness:1});
  sway(material, wind, 'grass');
  const group = new Group(); group.name = 'Spatially culled meadow';
  const geometry = grassGeometry(), cellSize = 16;
  const cells = new Map<string, {x:number; z:number; indices:number[]}>();
  const matrices = new Float32Array(roots.length * 16), tints = new Float32Array(roots.length * 3);
  const dummy = new Matrix4(), q = new Quaternion(), scale = new Vector3(), color = new Color();
  roots.forEach((root, i) => {
    const x = Math.floor(root.x / cellSize), z = Math.floor(root.z / cellSize), key = `${x}:${z}`;
    let cell = cells.get(key);
    if (!cell) { cell = {x, z, indices:[]}; cells.set(key, cell); }
    cell.indices.push(i);
    const edge = edgeDistance(root.x, root.z);
    // Tufts near a mown path read as individual blades; the central lawn stays low.
    const h = (edge < 1.1 ? .20 : .17) + random() * .11;
    q.setFromAxisAngle(UP, random() * TAU); scale.set(.8 + random() * .25, h, .8 + random() * .25);
    dummy.compose(root, q, scale).toArray(matrices, i * 16);
    const wash = Math.sin(root.x * .043 + root.z * .031) * Math.cos(root.z * .056);
    color.setRGB(.98 + wash * .035, 1 + wash * .025, .98 + wash * .02);
    color.toArray(tints, i * 3);
  });
  const chunks = [...cells.values()].map(cell => {
    const mesh = new InstancedMesh(geometry, material, cell.indices.length);
    mesh.name = `Rooted meadow ${cell.x}:${cell.z}`; mesh.receiveShadow = true;
    cell.indices.forEach((sourceIndex, index) => {
      mesh.setMatrixAt(index, dummy.fromArray(matrices, sourceIndex * 16));
      mesh.setColorAt(index, color.fromArray(tints, sourceIndex * 3));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.computeBoundingBox(); group.add(mesh);
    return {mesh, count:cell.indices.length, x:(cell.x + .5) * cellSize, z:(cell.z + .5) * cellSize};
  });
  const setQuality = (low:boolean) => {
    // Roots were shuffled before partitioning, so every cell has a stable,
    // evenly distributed low-quality prefix. Bounds retain the complete cell.
    for (const chunk of chunks) chunk.mesh.count = low ? Math.max(1, Math.round(chunk.count * .30)) : chunk.count;
  };
  const update = (cameraPosition:Vector3) => {
    for (const chunk of chunks) {
      const dx = Math.max(Math.abs(cameraPosition.x - chunk.x) - cellSize * .5, 0);
      const dz = Math.max(Math.abs(cameraPosition.z - chunk.z) - cellSize * .5, 0);
      // The vertex fade ends at 38m. One extra metre covers wind-bent tips;
      // distant cells submit neither vertices nor fragments to the renderer.
      chunk.mesh.visible = dx * dx + dz * dz < 39 * 39;
    }
  };
  update(new Vector3(53.5, 0, 58));
  return {group, count:roots.length, chunks:chunks.length, setQuality, update};
}

/** Real tree anchors and terrain triangles. Opaque irregular crowns establish
 * volume; sparse leaf silhouettes and near grass provide the small detail. */
export function createPainterlyVegetation(trees:Tree[], collision:CampusCollision, lawn:Mesh|null, wind:Wind,spatialBatches=false,profile?:'bu'|'residence'|'avenue') {
  const fine=profile==='residence'||profile==='avenue';
  const group = new Group(); group.name = 'Painterly MIT canopy and living lawn';
  const structures = trees.map((tree, index) => {
    const shape=fine?residenceStructure(tree,index):profile?buStreetStructure(tree,index):structure(index);
    if(profile==='avenue'){
      // CAS's mature avenue trees form a continuous, overlapping leaf canopy.
      // Residence saplings' separated terminal tufts read as pollarded balls
      // here. Broaden the leaf groups while retaining the branching skeleton,
      // root positions and trunk proxies; no opaque sphere is introduced.
      for(const crown of shape.crowns){crown.width*=1.65;crown.depth*=1.65;crown.height*=1.40;}
    }
    if(spatialBatches&&!profile){
      // Campus avenues mix mature spreading trees and smaller upright crowns.
      // Reuse the same geometry budget, varying actual branch/crown proportions.
      const broad=index%4!==1;
      const spread=(broad?1.13:.78)*Math.max(.82,Math.min(1.18,tree.radius/4.4));
      const height=broad?1.08:1.28;
      const proportions=new Vector3(spread,height,spread);
      // Adjacent limbs share their junction vector: transform each junction
      // once so branches stay connected to the crown at a consistent height.
      const joints=new Set(shape.branches.flatMap(branch=>[branch.a,branch.b]));
      for(const joint of joints)joint.multiply(proportions);
      for(const crown of shape.crowns){crown.center.multiply(new Vector3(spread,height,spread));crown.width*=spread;crown.depth*=spread;crown.height*=broad?.92:1.22;}
    }
    return shape;
  });
  const twigTexture = leafSpray(fine);
  const leafMaterial = new MeshStandardMaterial({name:'Canopy silhouette leaves', map:twigTexture,
    color:'#ffffff', side:DoubleSide, alphaTest:fine?.33:.4, roughness:1});
  leafMaterial.alphaToCoverage = true; sway(leafMaterial, wind, 'leaf',false,fine);
  const depth = new MeshDepthMaterial({map:twigTexture, alphaTest:fine?.33:.4, side:DoubleSide, depthPacking:RGBADepthPacking});
  sway(depth, wind, 'leaf');
  const crownMaterial = new MeshStandardMaterial({name:'Painted canopy volume', map:canopyPaint(fine),
    color:'#ffffff', roughness:1, vertexColors:true});
  if(fine){crownMaterial.name='Residence perforated terminal foliage';crownMaterial.alphaTest=.4;crownMaterial.side=DoubleSide;crownMaterial.alphaToCoverage=true;}
  if(profile==='bu'){crownMaterial.emissive.set('#60805a');crownMaterial.emissiveIntensity=.12;}
  sway(crownMaterial, wind, 'crown',profile==='bu',fine);
  const crownDepth = new MeshDepthMaterial({depthPacking:RGBADepthPacking});
  if(fine){crownDepth.map=crownMaterial.map;crownDepth.alphaTest=.4;crownDepth.side=DoubleSide;}
  sway(crownDepth, wind, 'crown');
  const barkMaterial = new MeshStandardMaterial({name:'Painted branching bark', map:barkPaint(), color:fine?'#c6c0aa':'#e1dec7', roughness:1});
  const branchCount = structures.reduce((total, item) => total + item.branches.length, 0);
  const branchSides=fine?11:profile==='bu'?9:7;
  const branches = new InstancedMesh(new CylinderGeometry(.72, 1, 1, branchSides, 1, true), barkMaterial, branchCount);
  branches.name = 'Tapered branches and roots'; branches.castShadow = true; branches.receiveShadow = true;
  const collisionGeometry = new CylinderGeometry(.43, .5, 2.4, 8);
  const matrix = new Matrix4(), rotation = new Quaternion(), scale = new Vector3(), position = new Vector3(), color = new Color();
  const cardsFor=(index:number)=>fine?960:index<10?520:index<22?360:profile==='bu'?280:120;
  const coreCount = trees.slice(0, 22).reduce((n, _, i) => n + cardsFor(i), 0);
  const distantCount = Math.max(0, trees.length - 22) * cardsFor(22);
  const batch = (count:number, name:string, shadows:boolean) => {
    const geometry = new PlaneGeometry(1, 1);
    geometry.setAttribute('crownNormal', new InstancedBufferAttribute(new Float32Array(count * 3), 3));
    const mesh = new InstancedMesh(geometry, leafMaterial, count);
    mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.customDepthMaterial = depth;
    group.add(mesh); return mesh;
  };
  const near = batch(coreCount, 'Courtyard leaf sprays', true);
  const far = batch(distantCount, 'Distant leaf sprays', false);
  const volumeBatch = (start:number, end:number, distant:boolean) => {
    const count = structures.slice(start, end).reduce((total, item) => total + item.crowns.length, 0);
    const mesh = new InstancedMesh(canopyGeometry(distant,profile==='bu',fine), crownMaterial, count);
    mesh.name = distant ? 'Distant crown masses' : 'Courtyard crown masses';
    mesh.castShadow = !distant; mesh.receiveShadow = true; mesh.customDepthMaterial = crownDepth;
    group.add(mesh); return mesh;
  };
  const nearVolume = volumeBatch(0, 22, false), farVolume = volumeBatch(22, trees.length, true);
  const nearOrder = shuffledOrder(coreCount, 1703), farOrder = shuffledOrder(distantCount, 4109);
  const greens = fine?['#566a3c','#637844','#5b703e','#71834b']:profile==='bu'?['#829e70','#91a978','#7b986c','#a0ae79','#88a378','#96ad80']:spatialBatches?['#86a268','#799767','#9bb175','#84a476','#718e5f','#a3b77d']:['#98af7a', '#91aa78', '#9bb17e', '#95ac76', '#94ab77', '#9aae7b'];
  let branchIndex = 0, nearIndex = 0, farIndex = 0, nearVolumeIndex = 0, farVolumeIndex = 0;
  trees.forEach((tree, index) => {
    const random = seeded(7927 + index * 8123), structure = structures[index];
    const y = (tree.rootY!==undefined&&Number.isFinite(tree.rootY)?tree.rootY:collision.groundHeight(tree.x, tree.z)) ?? 2;
    const offset = new Vector3(tree.x, y + .018, tree.z);
    for (const branch of structure.branches) {
      const direction = branch.b.clone().sub(branch.a);
      rotation.setFromUnitVectors(UP, direction.clone().normalize());
      position.copy(branch.a).add(branch.b).multiplyScalar(.5).add(offset);
      scale.set(branch.radius, direction.length(), branch.radius);
      branches.setMatrixAt(branchIndex, matrix.compose(position, rotation, scale));
      color.set(index % 3 ? '#f1efdf' : '#dce0d1'); branches.setColorAt(branchIndex++, color);
    }
    // Invisible collision proxies are intentionally separate from the single
    // branch draw call, so ray queries never traverse thousands of leaf cards.
    const trunk = new Mesh(collisionGeometry, barkMaterial);
    trunk.position.set(tree.x, y + 1.2, tree.z); trunk.visible = false;
    trunk.scale.setScalar(structure.radius / .43); trunk.userData.treeTrunk = true;
    if(structure.collisionHeight!==undefined){trunk.scale.y=structure.collisionHeight/2.4;trunk.position.y=y+.018+structure.collisionHeight/2;}
    group.add(trunk);
    const volume = index < 22 ? nearVolume : farVolume;
    const lobeTransforms:{matrix:Matrix4; rotation:Quaternion; scale:Vector3}[] = [];
    for (const [lobeIndex, lobe] of structure.crowns.entries()) {
      position.copy(lobe.center).add(offset);
      rotation.setFromAxisAngle(UP, lobe.yaw);
      rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), lobe.tilt));
      scale.set(lobe.width, lobe.height, lobe.depth);
      lobeTransforms.push({matrix:new Matrix4().compose(position, rotation, scale), rotation:rotation.clone(), scale:scale.clone()});
      const id = index < 22 ? nearVolumeIndex++ : farVolumeIndex++;
      // Keep the near solid core recessed behind the tangential leaf sprays.
      // Far crowns retain their fuller mass when detailed leaves are reduced.
      volume.setMatrixAt(id, matrix.compose(position, rotation, scale.clone().multiplyScalar(fine?.78:profile==='bu'?.79:index < 22 ? .68 : .76)));
      color.set(greens[index % greens.length]).multiplyScalar(lobeIndex % 2 ? .97 : 1.03);
      volume.setColorAt(id, color);
    }
    const cardCount = cardsFor(index);
    const crown = index < 22 ? near : far;
    const normals = crown.geometry.getAttribute('crownNormal') as InstancedBufferAttribute;
    // Allocate the same leaf budget by lobe surface area. A stratified spiral
    // covers the shell without random bald patches or extra transparent cards.
    const areas = lobeTransforms.map(({scale:s}) => s.x*s.y+s.y*s.z+s.x*s.z);
    const totalArea = areas.reduce((sum, area) => sum+area, 0);
    let areaSoFar = 0, lobeStart = 0, lobeIndex = 0;
    const lobeEnds = areas.map((area, i) => {
      areaSoFar += area;
      return i === areas.length-1 ? cardCount : Math.round(cardCount*areaSoFar/totalArea);
    });
    for (let card = 0; card < cardCount; card++) {
      while (card >= lobeEnds[lobeIndex]) lobeStart = lobeEnds[lobeIndex++];
      const lobe = lobeTransforms[lobeIndex], sample = card-lobeStart, samples = lobeEnds[lobeIndex]-lobeStart;
      const angle = sample*2.39996323+lobeIndex*1.7+index*.71+(random()-.5)*.18;
      const vertical = 1-2*(sample+.5+(random()-.5)*.18)/samples, radius = fine?.46+Math.cbrt(random())*.60:.91+random()*.08;
      const ring = Math.sqrt(1 - vertical * vertical);
      const dx = Math.cos(angle) * ring, dz = Math.sin(angle) * ring;
      position.copy(crownContour(dx, vertical, dz,profile==='bu')).multiplyScalar(radius).applyMatrix4(lobe.matrix);
      const outward = new Vector3(dx, vertical, dz).divide(lobe.scale).applyQuaternion(lobe.rotation).normalize();
      rotation.setFromUnitVectors(new Vector3(0, 0, 1), outward);
      rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), random() * TAU));
      rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (random() - .5) * .85));
      const size = (fine?.95+random()*.40:profile==='bu'?1.55+random()*.4:(index < 22 ? 1.6 : 1.9) + random() * .65)*(structure.detailScale??1);
      scale.set(size * (.86 + random() * .16), size, size);
      const id = index < 22 ? nearOrder[nearIndex++] : farOrder[farIndex++];
      crown.setMatrixAt(id, matrix.compose(position, rotation, scale));
      color.set(spatialBatches?greens[index%greens.length]:'#d5dfbf'); if(spatialBatches)color.lerp(new Color('#e2e8ce'),.57); color.multiplyScalar(.96 + random() * .07);
      if(fine)color.setRGB(.81+random()*.16,.89+random()*.10,.74+random()*.12);
      if (vertical < -.25) color.multiplyScalar(.92);
      crown.setColorAt(id, color);
      const normal = outward.clone().multiplyScalar(.65).addScaledVector(UP, .58).normalize();
      normals.setXYZ(id, normal.x, normal.y, normal.z);
    }
  });
  for (const mesh of [near, far, nearVolume, farVolume, branches]) {
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  group.add(branches);
  const grass = lawn ? createPainterlyGrass(lawn, wind) : null;
  if (grass) group.add(grass.group);
  const grassCount = grass?.count ?? 0;
  group.userData.stats = {trees:trees.length, leafCards:coreCount + distantCount, grassTufts:grassCount,
    crownMasses:nearVolume.count + farVolume.count, grassChunks:grass?.chunks ?? 0,
    triangles:(coreCount + distantCount) * 2 + branchCount * branchSides*2 + grassCount * 18 +
      nearVolume.count * (nearVolume.geometry.index!.count / 3) + farVolume.count * (farVolume.geometry.index!.count / 3)};
  const groves=spatialBatches?[near,far,nearVolume,farVolume,branches].map(source=>{
    const chunks=partitionVegetation(source);
    group.remove(source);chunks.forEach(chunk=>group.add(chunk.mesh));
    // Only these geometries belonged to the original batches. Materials/textures
    // are shared by the new groves and remain owned by the scene disposer.
    source.dispose();source.geometry.dispose();
    return {source,chunks,count:source.count};
  }):[];
  let lowQuality=false;
  const setQuality = (low:boolean) => {
    lowQuality=low;
    near.count = low ? Math.round(coreCount * (fine?.42:.5)) : coreCount;
    far.count = low ? fine?Math.round(distantCount*.42):0 : distantCount;
    near.castShadow = !low; nearVolume.castShadow = !low; branches.castShadow = !low;
    for(const {source,chunks,count} of groves)for(const chunk of chunks){
      chunk.mesh.count=count?Math.round(chunk.count*source.count/count):0;
      chunk.mesh.castShadow=source.castShadow;
    }
    grass?.setQuality(low);
  };
  const update = (cameraPosition:Vector3) => {
    grass?.update(cameraPosition);
    // Fine leaf sprays and twigs are subpixel at this range. Keep the opaque
    // canopy volumes as the distant silhouette across the large UMD campus.
    for(const {source,chunks} of groves){
      const volume=source===nearVolume||source===farVolume;
      const reach=source===branches?520:320;
      for(const {mesh} of chunks){
        const bounds=mesh.boundingBox!;
        const dx=Math.max(bounds.min.x-cameraPosition.x,0,cameraPosition.x-bounds.max.x);
        const dz=Math.max(bounds.min.z-cameraPosition.z,0,cameraPosition.z-bounds.max.z);
        const distanceSquared=dx*dx+dz*dz;
        if(!volume)mesh.visible=distanceSquared<reach*reach;
        // All nearby groves cast shade, not only the first 22 core trees.
        mesh.castShadow=!lowQuality&&distanceSquared<150*150&&(volume||source===branches);
      }
    }
  };
  return {group, setQuality, update};
}
