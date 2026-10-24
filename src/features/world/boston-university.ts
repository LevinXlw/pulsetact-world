import {BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, Shape, ShapeGeometry, SRGBColorSpace, Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {configureBUGroundLayer} from './bu-ground-layers';
import {BU_BUILDING_ANCHORS, LANDMARKS} from './charles-geography';
import {BU_FULL_BUILDINGS} from './bu-full-layout';
import {BU_CDS_MODULE,BU_CDS_PLATE,BU_CDS_HEIGHT,BU_CDS_STACK,BU_CDS_PODIUM,BU_MARSH_ASSEMBLY} from './bu-landmark-layout';
import {BU_CDS_GROUND_TOWER,BU_CDS_GROUND_PODIUM,BU_CDS_SOUTH_DOORS,BU_CDS_ENTRY_PAVING,buCDSPoint} from './bu-cds-entry-layout';
import {buElevation,drapeBUGeometry} from './bu-terrain';
import type {WorldPoint} from './geo-coordinates';
export {BU_CDS_MODULE,BU_CDS_PLATE,BU_CDS_HEIGHT,BU_CDS_STACK} from './bu-landmark-layout';

// Hand-modelled landmark silhouettes at georeferenced anchors, not a surveyed
// architectural model. Dimensions and references: assets-source/charles-bu/bu-landmarks.json.
// Input-coordinate baseline only. Runtime foundations come from buElevation;
// retaining this constant avoids rewriting every authored local height.
const DATUM = 5.2;
const YAW = -.145;
const UP = new Vector3(0, 1, 0);
const anchors = {
  chapel: BU_BUILDING_ANCHORS.marsh, beach: LANDMARKS.buBeach,
  cds: BU_BUILDING_ANCHORS.cds, castle: BU_BUILDING_ANCHORS.castle,
  questrom: BU_BUILDING_ANCHORS.questrom,
} as const;

type Finish = 'stone' | 'trim' | 'brick' | 'brickLight' | 'roof' | 'glass' | 'glassLight' | 'glassShade' | 'glassStained' | 'frame' | 'bronze' | 'granite' | 'wood' | 'paving' | 'grass' | 'inset';
type Placement = {x:number; z:number; yaw?:number};
type LandmarkScope = 'landmarks' | 'cds' | 'questrom';

// Documented structural module, not six arbitrarily sized glass boxes. The
// offsets/terrace sequence follow BU/KPMB's 2019 sheets; vertical intervals and
// the simplified open crown remain authored approximations of the exterior.
// See assets-source/charles-bu/landmark-realism-2026.json for evidence/limits.

/** Exact rendered lawn footprints, shared with terrain detail generation. */
export const BU_LAWNS = [-23,32].map(offset=>({
  x:LANDMARKS.buBeach[0]+offset*Math.cos(YAW),
  z:LANDMARKS.buBeach[1]-offset*Math.sin(YAW),
  width:49,depth:32,yaw:YAW,
}));

// The scene integrator renders these through the same canopy system as MIT.
export const BU_TREE_POSITIONS = [
  [-1221,897],[-1216,917],[-1196,893],[-1141,902],[-1120,906],[-1120,922],[-1204,975],[-1145,977],
] as const;

/** Walkable BU central campus, in the same east/up/south metre frame as MIT. */
export function createBostonUniversity(_options: {wind:{value:number}}) {
  const group = new Group();
  group.name = 'Boston University · Charles River Campus';
  const ground:Mesh[] = [], walls:Mesh[] = [];
  // Explicit construction ownership, never a geographic crop: the complete
  // CDS skin can be swapped while independent collision remains in the campus.
  const cdsVisual=new Group();
  cdsVisual.name='BU CDS · replaceable visual';
  cdsVisual.userData.buLandmarkScope='cds';
  group.add(cdsVisual);
  const cdsGround:Mesh[]=[],cdsWalls:Mesh[]=[];
  const questromVisual=new Group(),questromExtras=new Group();
  questromVisual.name='BU Questrom · replaceable visual';questromExtras.name='BU Questrom · runtime inscription';
  questromVisual.userData.buLandmarkScope='questrom';questromExtras.userData.buLandmarkScope='questrom';
  group.add(questromVisual,questromExtras);
  const questromGround:Mesh[]=[],questromWalls:Mesh[]=[];
  const batches = new Map<Finish, BufferGeometry[]>();
  const groundBatches = new Map<Finish, BufferGeometry[]>();
  const shadowMeshes:Mesh[] = [];
  const rotation = new Quaternion(), transform = new Matrix4();
  const material = new MeshBasicMaterial();
  material.name = 'BU invisible collision';
  let activeFoundation=buElevation(...BU_MARSH_ASSEMBLY.foundationAnchor);
  let activeScope:LandmarkScope='landmarks';

  const put = (finish:Finish, source:BufferGeometry, x:number, y:number, z:number, yaw=0, surface=false,followTerrain=true) => {
    rotation.setFromAxisAngle(UP, yaw);
    // Buildings remain rigid. Only paving is draped after batching; warping
    // every architectural vertex would bend walls, window heads and roofs.
    transform.compose(new Vector3(x,y+(!surface||!followTerrain?activeFoundation-DATUM:0),z), rotation, new Vector3(1,1,1));
    source.applyMatrix4(transform);
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    const count=g.getAttribute('position').count;
    g.setAttribute('campusBaseHeight',new Float32BufferAttribute(new Float32Array(count).fill(activeFoundation),1));
    g.setAttribute('campusYaw',new Float32BufferAttribute(new Float32Array(count).fill(yaw),1));
    g.userData.buLandmarkScope=activeScope;
    if(surface&&!followTerrain)g.userData.buFixedFoundation=true;
    const map = surface ? groundBatches : batches;
    const list=map.get(finish) ?? []; list.push(g); map.set(finish,list);
  };
  const box = (finish:Finish, p:Placement, lx:number, y:number, lz:number, w:number, h:number, d:number, surface=false,followTerrain=true) => {
    const yaw=p.yaw ?? YAW, c=Math.cos(yaw),s=Math.sin(yaw);
    put(finish,new BoxGeometry(w,h,d),p.x+lx*c+lz*s,DATUM+y,p.z-lx*s+lz*c,yaw,surface,followTerrain);
  };
  const collider = (name:string,p:Placement,lx:number,lz:number,w:number,h:number,d:number) => {
    const yaw=p.yaw ?? YAW,c=Math.cos(yaw),s=Math.sin(yaw);
    const geometry=new BoxGeometry(w,h,d);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,material);
    mesh.name=name; mesh.position.set(p.x+lx*c+lz*s,activeFoundation+h/2,p.z-lx*s+lz*c); mesh.rotation.y=yaw;
    mesh.userData.foundationRing=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
    mesh.userData.foundationLocalY=-h/2;
    mesh.userData.buLandmarkScope=activeScope;
    mesh.visible=false; group.add(mesh); walls.push(mesh);
    if(activeScope==='cds')cdsWalls.push(mesh);
    if(activeScope==='questrom')questromWalls.push(mesh);
  };
  const block = (finish:Finish,p:Placement,lx:number,lz:number,w:number,h:number,d:number,name:string) => {
    box(finish,p,lx,h/2,lz,w,h,d); collider(name,p,lx,lz,w,h,d);
  };
  const at = (p:Placement,x:number,z:number,turn=0):Placement => {
    const yaw=p.yaw ?? YAW,c=Math.cos(yaw),s=Math.sin(yaw);
    return {x:p.x+x*c+z*s,z:p.z-x*s+z*c,yaw:yaw+turn};
  };
  const panel = (finish:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number) => {
    const point=at(p,x,z);
    put(finish,new PlaneGeometry(w,h),point.x,DATUM+y,point.z,point.yaw);
  };
  const bar = (finish:Finish,p:Placement,a:readonly number[],b:readonly number[],width:number,depth:number) => {
    const direction=new Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    const geometry=new BoxGeometry(width,direction.length(),depth);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP,direction.normalize()));
    geometry.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
    put(finish,geometry,p.x,DATUM,p.z,p.yaw??YAW);
  };
  const roof = (p:Placement,x:number,z:number,w:number,d:number,eave:number,rise:number,frontGable=true,soffitFrontInset=0) => {
    const soffitFront=d/2-soffitFrontInset;
    const v=[-w/2,0,-d/2,w/2,0,-d/2,0,rise,-d/2,-w/2,0,d/2,0,rise,d/2,w/2,0,d/2,
      -w/2,0,-d/2,0,rise,-d/2,0,rise,d/2,-w/2,0,-d/2,0,rise,d/2,-w/2,0,d/2,
      0,rise,-d/2,w/2,0,-d/2,w/2,0,d/2,0,rise,-d/2,w/2,0,d/2,0,rise,d/2,
      -w/2,0,-d/2,-w/2,0,soffitFront,w/2,0,soffitFront,-w/2,0,-d/2,w/2,0,soffitFront,w/2,0,-d/2];
    // Reverse each triangle to point the pitched-roof normals outwards.
    for(let i=0;i<v.length;i+=9) for(let axis=0;axis<3;axis++) {
      const first=v[i+3+axis];v[i+3+axis]=v[i+6+axis];v[i+6+axis]=first;
    }
    const yaw=p.yaw ?? YAW,c=Math.cos(yaw),s=Math.sin(yaw);
    // Masonry closes the triangular ends; the roof includes a downward-facing
    // soffit. Without that underside, a low camera could see sky through the
    // gap between the overhanging roof and the vertical wall.
    for(const [finish,vertices] of [['stone',v.slice(0,frontGable?18:9)],['roof',v.slice(18)]] as const) {
      const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();
      g.setAttribute('uv',new Float32BufferAttribute(new Float32Array(vertices.length/3*2),2));
      put(finish,g,p.x+x*c+z*s,DATUM+eave,p.z-x*s+z*c,yaw);
    }
  };
  const pointedShape = (w:number,h:number,x=0,y=0) => {
    const shape=new Shape();
    shape.moveTo(x-w/2,y);shape.lineTo(x+w/2,y);shape.lineTo(x+w/2,y+h*.63);
    shape.quadraticCurveTo(x+w*.40,y+h*.84,x,y+h);shape.quadraticCurveTo(x-w*.40,y+h*.84,x-w/2,y+h*.63);shape.closePath();
    return shape;
  };
  const arch = (p:Placement,x:number,bottom:number,z:number,w:number,h:number,back=false,finish:Finish='glass') => {
    const shape=pointedShape(w,h);
    const yaw=(p.yaw ?? YAW)+(back?Math.PI:0),g=new ShapeGeometry(shape,5);
    const heading=p.yaw ?? YAW,c=Math.cos(heading),s=Math.sin(heading);
    put(finish,g,p.x+x*c+z*s,DATUM+bottom,p.z-x*s+z*c,yaw);
  };
  const archRing = (p:Placement,x:number,bottom:number,z:number,w:number,h:number,rim:number,depth=.12) => {
    const outline=pointedShape(w,h);outline.holes.push(pointedShape(w-rim*2,h-rim*2,0,rim));
    const g=new ExtrudeGeometry(outline,{depth,bevelEnabled:false,steps:1,curveSegments:6});
    const point=at(p,x,z);put('trim',g,point.x,DATUM+bottom,point.z,point.yaw);
  };
  const roundTracery = (p:Placement,x:number,y:number,z:number,radius:number,rim=.085) => {
    const outline=new Shape();outline.absarc(0,0,radius,0,Math.PI*2,false);
    const opening=new Shape();opening.absarc(0,0,radius-rim,0,Math.PI*2,true);outline.holes.push(opening);
    const point=at(p,x,z);put('trim',new ShapeGeometry(outline,8),point.x,DATUM+y,point.z,point.yaw);
  };
  const windows = (p:Placement,w:number,d:number,h:number,storeys:number,spacing=4.5) => {
    // Narrow Bay State houses still have two windows per floor. The former
    // width-minus-seven calculation silently produced zero for all ten houses.
    const columns=Math.max(2,Math.floor((w-5)/spacing)),dy=(h-4)/storeys;
    for(const side of [-1,1]) for(let floor=0;floor<storeys;floor++) for(let i=0;i<columns;i++) {
      const x=(i-(columns-1)/2)*spacing,y=3.1+floor*dy,z=side*(d/2+.025);
      recess(p,x,y,z,side,1.45,2.2,(i+floor)%7===0?'glassLight':'glass');
    }
    if(w>20&&d>18) for(const side of [-1,1]) {
      const yaw=p.yaw ?? YAW;
      const end={x:p.x+side*w/2*Math.cos(yaw),z:p.z-side*w/2*Math.sin(yaw),yaw:yaw+side*Math.PI/2};
      const count=Math.max(2,Math.floor((d-5)/spacing));
      for(let floor=0;floor<storeys;floor++) for(let i=0;i<count;i++) {
        recess(end,(i-(count-1)/2)*spacing,3.1+floor*dy,.025,1,1.45,2.2);
      }
    }
  };
  const recess = (p:Placement,x:number,y:number,z:number,side:number,w:number,h:number,glass:Finish='glass',reveal=0) => {
    // A dark pocket sits behind the glazing; separate jambs project farther
    // than the pane, catching light and making depth readable at walking range.
    box('inset',p,x,y,z+side*(.025-reveal),w+.36,h+.34,.075);
    box(glass,p,x,y,z+side*(.073-reveal),w,h,.055);
    for(const dx of [-1,1]) box('trim',p,x+dx*(w/2+.12),y,z+side*.16,.18,h+.35,.31);
    box('trim',p,x,y+h/2+.12,z+side*.16,w+.42,.18,.31);
    box('trim',p,x,y-h/2-.14,z+side*.21,w+.50,.23,.53);
    box('frame',p,x,y,z+side*(.13-reveal),.075,h,.075);
    box('frame',p,x,y+.12,z+side*(.13-reveal),w,.075,.075);
  };
  const outlineGeometry=(ring:readonly WorldPoint[],height:number)=>{
    const shape=new Shape();
    for(const [i,[x,z]] of ring.entries()){if(i===0)shape.moveTo(x,-z);else shape.lineTo(x,-z);}
    shape.closePath();const geometry=new ExtrudeGeometry(shape,{depth:height,steps:1,bevelEnabled:false});geometry.rotateX(-Math.PI/2);return geometry;
  };

  // BU Beach is lawn, not a sandy river beach. North is left open to the
  // pedestrian crossing over Storrow Drive; the chapel stands to its south.
  const beach={x:anchors.beach[0],z:anchors.beach[1],yaw:YAW};
  box('paving',beach,0,.009,0,126,.038,42,true);
  box('grass',beach,-23,.033,0,49,.018,32,true);
  box('grass',beach,32,.033,0,49,.018,32,true);
  // The middle and two perimeter paths remain clear, including the northern
  // arrival at [-1165,895]. The ground does not change player height abruptly.
  const plaza={x:anchors.chapel[0],z:anchors.chapel[1],yaw:YAW};
  put('paving',outlineGeometry(BU_MARSH_ASSEMBLY.plazaFootprint,.04),0,DATUM-.008,0,0,true);
  // The south doors open onto paving rather than the former narrow grass gap.
  box('paving',plaza,0,.012,24.5,20,.04,7,true);
  box('paving',plaza,-19,.012,10,8,.04,54,true);
  box('paving',plaza,19,.012,10,8,.04,54,true);
  // The 2001 plaza is rose granite, not a single beige concrete rectangle.
  // These flush bands give the gathering space its scale without curbs across
  // the through route; no University seal artwork is copied into the texture.
  put('granite',outlineGeometry(BU_MARSH_ASSEMBLY.plazaFootprint,.016),0,DATUM+.029,0,0,true);
  for(const x of [-18,-12,-6,0,6,12,18])box('stone',plaza,x,.049,42,.13,.012,30.5,true);
  for(const z of [30,36,42,48,54])box('stone',plaza,0,.049,z,47.5,.012,.13,true);
  // Free at Last (Sergio Castillo): a compact, original low-poly reading of
  // the documented fifty rising doves. The silhouette is interpretive, not a
  // scan or a fabrication model. Its base is clear of the existing arrival.
  const memorial=at(plaza,BU_MARSH_ASSEMBLY.memorial.x,BU_MARSH_ASSEMBLY.memorial.z);
  activeFoundation=buElevation(memorial.x,memorial.z);
  block('granite',memorial,0,0,4.4,.86,4.4,'Free at Last memorial base');
  box('inset',memorial,0,.94,0,3.9,.16,3.9);
  box('granite',memorial,0,1.08,0,4.0,.14,4.0);
  for(let row=0;row<10;row++)for(let col=0;col<5;col++) {
    const t=row/9,spread=.35+Math.sin(t*Math.PI)*1.20;
    const x=Math.sin(t*1.35)*2.65+(col-2)*spread*.46;
    const y=1.35+t*7.5+(col%2)*.20,z=(col-2)*.24;
    const dove=new Shape();
    for(const [i,[dx,dy]] of [[-.12,-.22],[-.52,.0],[-.98,.88],[-.30,.52],[0,.18],[.36,.56],[.87,.70],[.40,.02],[.12,-.22]].entries()) {
      if(i===0)dove.moveTo(dx,dy);else dove.lineTo(dx,dy);
    }
    dove.closePath();
    const geometry=new ExtrudeGeometry(dove,{depth:.065,bevelEnabled:false,steps:1});
    geometry.scale(.65,.65,.65);geometry.rotateY((col-2)*.17);geometry.rotateZ(-.17+t*.38);geometry.translate(x,y,z);
    put('inset',geometry,memorial.x,DATUM,memorial.z,memorial.yaw);
  }

  // Marsh Chapel: pale collegiate Gothic nave, gable and slender pinnacles.
  // There is deliberately no Alexander Graham Bell tower: it was never built.
  activeFoundation=buElevation(...BU_MARSH_ASSEMBLY.foundationAnchor);
  const chapelParts=new Map([...batches].map(([finish,parts])=>[finish,parts.length]));
  const chapelGroundParts=new Map([...groundBatches].map(([finish,parts])=>[finish,parts.length]));
  const chapel=plaza;
  // South facade is now an actual pierced wall. The former solid box hid all
  // recesses and the three invented doors did not match the two real portals.
  box('stone',chapel,0,9.6,-.4,18,19.2,41.2);
  const chapelFront=new Shape();
  chapelFront.moveTo(-9,0);chapelFront.lineTo(9,0);chapelFront.lineTo(9,19.2);chapelFront.lineTo(0,25.3);chapelFront.lineTo(-9,19.2);chapelFront.closePath();
  chapelFront.holes.push(pointedShape(8.4,14.4,0,7.6));
  for(const x of [-1.75,1.75])chapelFront.holes.push(pointedShape(3.15,5.3,x,1.18));
  const facade=new ExtrudeGeometry(chapelFront,{depth:.8,bevelEnabled:false,steps:1,curveSegments:8});
  const chapelFrontPoint=at(chapel,0,20.2);put('stone',facade,chapelFrontPoint.x,DATUM,chapelFrontPoint.z,YAW);
  // Gables meet the nave end walls exactly, leaving the arched glazing on the
  // outside of the masonry instead of hidden behind an overhanging end cap.
  // The independent pierced front wall starts at z=20.2. Keep the horizontal
  // underside behind it; extending that plane to the eave at z=21 slices
  // through the recessed niche/window and draws a dark line across the arch.
  roof(chapel,0,0,18.8,42,19.2,6.1,false,.8);
  // Small projecting courses and sills give the close masonry readable depth;
  // they remain inside the walking collision margin around the nave/aisles.
  box('trim',chapel,0,.28,0,18.4,.55,42.4);
  box('stone',chapel,0,1.12,0,18.3,.28,42.3);
  box('trim',chapel,0,7.55,0,18.22,.20,42.22);
  for(const side of [-1,1]) {
    box('trim',chapel,side*9.2,19.25,0,.8,.5,43.4);
    for(const z of [-18,-11,-4,3,10,18]) {
      box('stone',chapel,side*10.0,8.4,z,1.8,16.8,1.9);
      box('trim',chapel,side*10.0,16.8,z,2.0,.45,2.1);
      box('stone',chapel,side*9.5,18.0,z,1.05,3,1.1);
      const p={x:chapel.x+side*9.5*Math.cos(YAW)+z*Math.sin(YAW),z:chapel.z-side*9.5*Math.sin(YAW)+z*Math.cos(YAW)};
      put('trim',new ConeGeometry(.7,2.1,4),p.x,DATUM+20.3,p.z,YAW+Math.PI/4);
    }
    // High side windows are narrow recessed lancets between the buttresses.
    for(const z of [-14.5,-7.5,-.5,6.5,13.5]) {
      const sideP={x:chapel.x+side*9.08*Math.cos(YAW)+z*Math.sin(YAW),z:chapel.z-side*9.08*Math.sin(YAW)+z*Math.cos(YAW),yaw:YAW+side*Math.PI/2};
      arch(sideP,0,12.2,0,2.7,5.6);
      box('trim',chapel,side*9.12,14.5,z,.14,4.6,.13);
    }
  }
  for(const end of [-1,1]) {
    // Recessed large traceried windows remain legible from the lawn and plaza.
    if(end<0){
    arch(chapel,0,8,end*21.035,8.4,13.1,true,'trim');
    arch(chapel,0,8.25,end*21.10,7.5,11.9,true);
    box('trim',chapel,0,7.97,end*21.2,8.65,.30,.55);
    // Restrained translucent-looking pale panes break up the broad blue field
    // without using external stained-glass imagery or extra render materials.
    for(const x of [-1.88,.63]) for(const y of [9.75,13.1]) {
      box('glassLight',chapel,x,y,end*21.155,1.03,2.45,.035);
    }
    for(const x of [-2.5,-1.25,0,1.25,2.5]) box('trim',chapel,x,12.55,end*21.16,.16,8.6,.12);
    for(const y of [11.2,15.1]) box('trim',chapel,0,y,end*21.16,7.2,.20,.12);
    }
    for(const x of [-7.8,7.8]) {
      box('stone',chapel,x,12.3,end*21.55,1.6,24.6,2.1);
      box('trim',chapel,x,23.8,end*21.55,1.95,.55,2.4);
      const c=Math.cos(YAW),s=Math.sin(YAW);
      if(end<0)put('trim',new ConeGeometry(.9,3.8,4),chapel.x+x*c+end*21.55*s,DATUM+26.5,chapel.z-x*s+end*21.55*c,YAW+Math.PI/4);
      else {
        // The photographed front finials are stepped stonework, not smooth
        // four-metre cones. Their small relief is an authored simplification.
        box('stone',chapel,x,24.95,21.55,1.05,.70,1.12);
        put('trim',new ConeGeometry(.72,1.70,4),chapel.x+x*c+21.55*s,DATUM+26.15,chapel.z-x*s+21.55*c,YAW+Math.PI/4);
        for(const [y,w] of [[26.60,.78],[27.10,.58],[27.55,.40]])box('trim',chapel,x,y,21.55,w,.13,w);
        box('stone',chapel,x,27.02,21.55,.42,.85,.42);
        put('trim',new ConeGeometry(.29,.75,4),chapel.x+x*c+21.55*s,DATUM+27.72,chapel.z-x*s+21.55*c,YAW+Math.PI/4);
      }
    }
  }
  // BU Photography 2025: the large enclosing arch is a STONE niche, with a
  // much narrower three-light window recessed within it. The former full-width
  // black backing and broad blue lancets made this read as modern curtain wall.
  // Relative proportions below are photo-interpreted, not measured elevations.
  const niche=pointedShape(8.4,14.4);
  niche.holes.push(pointedShape(5.15,11.7,0,.55));
  const nichePoint=at(chapel,0,20.37);
  put('stone',new ExtrudeGeometry(niche,{depth:.12,bevelEnabled:false,steps:1,curveSegments:8}),nichePoint.x,DATUM+7.6,nichePoint.z,YAW);
  arch(chapel,0,8.15,20.29,5.15,11.7,false,'glassStained');
  archRing(chapel,0,7.34,20.93,8.92,14.92,.22,.18);
  archRing(chapel,0,7.10,21.12,9.42,15.42,.16,.13);
  for(const x of [-1.62,0,1.62]) {
    arch(chapel,x,10.15,20.33,1.32,7.35,false,'glassStained');
    archRing(chapel,x,9.99,20.46,1.64,7.67,.16,.11);
    box('trim',chapel,x,9.90,20.59,1.67,.24,.33);
    for(const y of [10.7,11.9,13.1,14.3,15.5,16.4]) {
      box('inset',chapel,x,y,20.38,1.23,.032,.035);
      for(const dx of [-.34,.34])bar('inset',chapel,[x+dx-.16,y-.32,20.38],[x+dx+.16,y+.32,20.38],.025,.025);
    }
    for(const dx of [-.41,0,.41])box('inset',chapel,x+dx,13.6,20.38,.027,6.7,.035);
    // Three small lower lights below the tall lancets are visible in the
    // reference. They are separated by stone spandrels and projecting sills.
    arch(chapel,x,8.23,20.34,1.32,1.35,false,'glassStained');
    archRing(chapel,x,8.09,20.47,1.60,1.63,.14,.10);
    box('trim',chapel,x,8.05,20.59,1.70,.19,.34);
    box('frame',chapel,x,8.73,20.41,1.25,.065,.045);
  }
  for(const [x,y,radius,lobes] of [[0,18.70,.72,6],[-1.60,17.85,.38,3],[1.60,17.85,.38,3]]) {
    roundTracery(chapel,x,y,20.54,radius,.105);
    for(let i=0;i<lobes;i++){const theta=i*Math.PI*2/lobes;roundTracery(chapel,x+Math.sin(theta)*radius*.48,y+Math.cos(theta)*radius*.48,20.57,radius*.37,.065);}
  }
  for(const x of [-1.75,1.75]) {
    arch(chapel,x,1.18,20.29,3.15,5.3,false,'inset');
    archRing(chapel,x,1.08,20.91,3.42,5.62,.14,.14);
    archRing(chapel,x,.98,21.08,3.72,5.92,.12,.12);
    arch(chapel,x,4.3,20.48,2.83,2.03,false,'stone');
    roundTracery(chapel,x,5.15,20.56,.32,.10);
    box('inset',chapel,x,2.78,20.48,2.76,3.18,.16);
    box('bronze',chapel,x,2.78,20.60,.09,3.18,.075);
    for(const edge of [-1,1])box('bronze',chapel,x+edge*1.35,2.78,20.62,.07,3.18,.07);
    for(const edge of [-1,1])box('bronze',chapel,x,2.78+edge*1.56,20.62,2.76,.07,.07);
    for(const dx of [-.67,.67]) {
      for(const y of [1.78,2.75,3.70]) {
        box('glassStained',chapel,x+dx,y,20.58,.94,.70,.035);
        for(const edge of [-1,1])box('bronze',chapel,x+dx+edge*.49,y,20.63,.065,.84,.045);
        for(const edge of [-1,1])box('bronze',chapel,x+dx,y+edge*.38,20.63,1.04,.065,.045);
        box('bronze',chapel,x+dx,y,20.64,.035,.67,.035);
      }
      box('bronze',chapel,x+Math.sign(dx)*.18,2.47,20.72,.045,.65,.07);
    }
  }
  // A short real stair approach, with uninterrupted ground-level routes on
  // both sides. Each 15 cm riser is a ground mesh, not an invisible obstacle.
  for(let step=0;step<8;step++) {
    const top=(step+1)*.15,z=24.55-step*.44;
    box('stone',chapel,0,top/2,z,7.6,top,.45,true,false);
    // A solid front nosing, flush with the existing tested tread height. It
    // projects only 3 cm and does not put a floating slab above the collision.
    box('stone',chapel,0,top-.025,z+.225,7.6,.05,.06);
  }
  const rail=(a:readonly number[],b:readonly number[])=>{
    const direction=new Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]),geometry=new CylinderGeometry(.024,.024,direction.length(),6);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP,direction.normalize()));
    geometry.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
    put('frame',geometry,chapel.x,DATUM,chapel.z,YAW);
  };
  for(const side of [-1,1]) {
    rail([side*.10,1.00,24.6],[side*.10,2.04,21.5]);
    for(const z of [24.45,23.0,21.6]) {
      const top=1.00+(24.6-z)/3.1*1.04;
      rail([side*.10,top-1,z],[side*.10,top,z]);
    }
    bar('trim',chapel,[side*3.95,.74,24.7],[side*3.95,1.90,21.2],.28,.34);
    // Stone end piers and the solid sloping cheek below the existing coping,
    // visible in the real entrance photo. The clear central stair stays 7.6 m.
    box('stone',chapel,side*3.98,.38,24.64,.40,.76,.54);
    const section=new Shape();section.moveTo(21.22,0);section.lineTo(24.68,0);section.lineTo(24.68,.65);section.lineTo(21.22,1.80);section.closePath();
    const cheek=new ExtrudeGeometry(section,{depth:.26,bevelEnabled:false,steps:1});
    // Shape X is stair-local Z; rotate into its longitudinal vertical plane.
    cheek.rotateY(-Math.PI/2);cheek.translate(side*3.95+.13,0,0);
    put('stone',cheek,chapel.x,DATUM,chapel.z,YAW);
  }
  // Profiled coping and shield panels carry the gable outline at a distance.
  for(const side of [-1,1]) {
    bar('trim',chapel,[side*.10,25.48,21.17],[side*8.7,19.61,21.17],.22,.45);
    bar('stone',chapel,[side*.10,24.96,21.045],[side*8.7,19.11,21.045],.60,.055);
    for(let i=1;i<=5;i++) {
      const x=side*i*1.40,y=25.3-Math.abs(x)*6.1/9-.58;
      const shield=new Shape();shield.moveTo(-.34,.30);shield.lineTo(.34,.30);shield.lineTo(.29,-.12);shield.lineTo(0,-.40);shield.lineTo(-.29,-.12);shield.closePath();
      const point=at(chapel,x,21.21);put('stone',new ExtrudeGeometry(shield,{depth:.065,bevelEnabled:false,steps:1}),point.x,DATUM+y,point.z,YAW);
    }
  }
  box('trim',chapel,0,26.6,21.4,.30,2.7,.30);
  box('trim',chapel,0,27.1,21.4,1.4,.25,.30);

  // Fit the retained facade and roof to the GIS central projection, rather
  // than enlarging the surveyed ring to accommodate the old invented aisles.
  // Height is retained: the footprint supplies plan geometry, not roof levels.
  const fit=BU_MARSH_ASSEMBLY.chapelFit;
  const chapelFit=new Matrix4().makeTranslation(chapel.x,0,chapel.z)
    .multiply(new Matrix4().makeRotationY(YAW))
    .multiply(new Matrix4().makeTranslation(fit.x,0,fit.z))
    .multiply(new Matrix4().makeScale(fit.scaleX,1,fit.scaleZ))
    .multiply(new Matrix4().makeRotationY(-YAW))
    .multiply(new Matrix4().makeTranslation(-chapel.x,0,-chapel.z));
  for(const [finish,parts] of batches)for(let i=chapelParts.get(finish)??0;i<parts.length;i++)parts[i].applyMatrix4(chapelFit);
  for(const [finish,parts] of groundBatches)for(let i=chapelGroundParts.get(finish)??0;i<parts.length;i++)parts[i].applyMatrix4(chapelFit);

  // A short sloping apron joins the new terrain to the rigid entrance stair.
  // The stair itself retains level 15 cm treads and the building threshold.
  const approach:number[]=[];
  const stairFront=fit.z+24.80*fit.scaleZ,halfWidth=4.0*fit.scaleX;
  const apronCorners=[[-halfWidth,stairFront],[-halfWidth,stairFront+4],[halfWidth,stairFront+4],[halfWidth,stairFront]];
  const apronPoints=apronCorners.map(([x,z],i)=>{const p=at(chapel,fit.x+x,z);return [p.x,(i===0||i===3?activeFoundation:buElevation(p.x,p.z))+.035-activeFoundation,p.z];});
  for(const i of [0,1,2,0,2,3])approach.push(...apronPoints[i]);
  const apron=new BufferGeometry();apron.setAttribute('position',new Float32BufferAttribute(approach,3));apron.computeVertexNormals();
  apron.setAttribute('uv',new Float32BufferAttribute(new Float32Array(12),2));
  put('paving',apron,0,DATUM,0,0,true,false);

  const outlineCollider=(name:string,ring:readonly WorldPoint[],height:number)=>{
    const geometry=outlineGeometry(ring,height);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,material);mesh.position.y=activeFoundation;mesh.name=name;mesh.visible=false;
    mesh.userData.foundationRing=ring;mesh.userData.foundationLocalY=0;mesh.userData.buLandmarkScope=activeScope;group.add(mesh);walls.push(mesh);
    if(activeScope==='cds')cdsWalls.push(mesh);
    if(activeScope==='questrom')questromWalls.push(mesh);
  };
  outlineCollider('Marsh Chapel · surveyed nave footprint',BU_MARSH_ASSEMBLY.chapelFootprint,19.2);
  // STH, the two low connecting wings and western CAS all belong to city9741.
  // They were lost when custom=true suppressed the generic compound. Exact
  // concave plans keep the plaza recesses open and meet city1842 without a gap.
  const onSurveyBoundary=(x:number,z:number)=>BU_MARSH_ASSEMBLY.footprint.some((a,i)=>{
    const b=BU_MARSH_ASSEMBLY.footprint[(i+1)%BU_MARSH_ASSEMBLY.footprint.length],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz;
    const t=l2?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l2)):0;
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<.015;
  });
  for(const wing of BU_MARSH_ASSEMBLY.wings){
    // Frontage follows each actual exterior segment. Internal partition seams
    // receive neither window skins nor coping; the two blocks remain attached.
    let signedArea=0;for(let i=0;i<wing.footprint.length;i++){const a=wing.footprint[i],b=wing.footprint[(i+1)%wing.footprint.length];signedArea+=a[0]*b[1]-b[0]*a[1];}
    const fronts:{a:WorldPoint;b:WorldPoint;width:number;p:Placement;deep:boolean}[]=[];
    for(let edge=0;edge<wing.footprint.length;edge++){
      let a=wing.footprint[edge],b=wing.footprint[(edge+1)%wing.footprint.length];
      if(signedArea>0)[a,b]=[b,a];
      const width=Math.hypot(b[0]-a[0],b[1]-a[1]),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
      if(width<2.4||!onSurveyBoundary(x,z))continue;
      // Do not cap or decorate the attachment to the district CAS block.
      if(Math.abs(a[0]+1120.444)<.02&&Math.abs(b[0]+1120.444)<.02)continue;
      const p={x,z,yaw:Math.atan2(-(b[1]-a[1]),b[0]-a[0])};
      // Spend reveal geometry on the cloister fronts facing Marsh Plaza. Other
      // elevations retain their existing authored window positions/LOD; they
      // are not a measured architectural reconstruction of STH or CAS.
      const deep=wing.id.endsWith('-link')&&Math.cos(p.yaw-YAW)>.5;
      fronts.push({a,b,width,p,deep});
    }
    const shell=outlineGeometry(wing.footprint,wing.height),position=shell.getAttribute('position'),normal=shell.getAttribute('normal');
    const retained:number[]=[];
    for(let i=0;i<position.count;i+=3){
      const x=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3,z=(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3;
      const exterior=Math.abs(normal.getY(i))<.1&&fronts.some(({a,b,width,deep})=>{
        if(!deep)return false;
        const dx=b[0]-a[0],dz=b[1]-a[1],t=((x-a[0])*dx+(z-a[1])*dz)/(width*width);
        return t>=-.0001&&t<=1.0001&&Math.abs((x-a[0])*dz-(z-a[1])*dx)/width<.003;
      });
      if(!exterior)retained.push(i,i+1,i+2);
    }
    // Remove only the external wall triangles being replaced below. Keeping
    // the old solid wall behind an inset pane would conceal the actual recess.
    // The source ring/collision, horizontal caps and shared CAS seam are intact.
    shell.setIndex(retained);put('stone',shell,0,DATUM,0);
    put('roof',outlineGeometry(wing.footprint,.14),0,DATUM+wing.height,0);
    outlineCollider(wing.name,wing.footprint,wing.height);
    for(const {width,p,deep} of fronts){
      const low=wing.id.endsWith('-link');
      const facade=new Shape();facade.moveTo(-width/2,0);facade.lineTo(width/2,0);facade.lineTo(width/2,wing.height);facade.lineTo(-width/2,wing.height);facade.closePath();
      box('trim',p,0,.55,.06,width,1.1,.20);
      box('trim',p,0,wing.height-.24,.09,width,.42,.28);
      box('inset',p,0,wing.height-.56,.035,width,.08,.10);
      const count=Math.max(1,Math.floor((width-.8)/(low?3.7:4.5))),spacing=(width-.8)/count;
      for(let col=0;col<count;col++){
        const wx=(col-(count-1)/2)*spacing;
        if(low){
          facade.holes.push(pointedShape(Math.min(2.6,spacing-.7),5.2,wx,1.45));
          arch(p,wx,1.45,deep?-.26:.045,Math.min(2.6,spacing-.7),5.2,false,'glassShade');
          archRing(p,wx,1.28,.11,Math.min(2.94,spacing-.36),5.54,.17,.14);
          box('trim',p,wx,3.9,deep?-.13:.19,.11,4.8,.15);
        }else{
          // Restrained tall Gothic bays continue the adjacent limestone block;
          // no invented roof towers on the School of Theology street wall.
          const w=Math.min(2.20,spacing-.70);
          facade.holes.push(pointedShape(w,9.3,wx,1.80));
          arch(p,wx,1.80,deep?-.26:.035,w,9.3,false,'glassShade');
          archRing(p,wx,1.64,.10,w+.32,9.62,.16,.10);
          for(const y of [4.7,7.6])box('trim',p,wx,y,deep?-.10:.22,w,.18,.22);
          box('trim',p,wx,6.25,deep?-.09:.23,.12,8.65,.18);
          for(const y of [13.35,18.2]) {
            const opening=new Shape(),half=w/2+.18;
            opening.moveTo(wx-half,y-1.67);opening.lineTo(wx+half,y-1.67);opening.lineTo(wx+half,y+1.67);opening.lineTo(wx-half,y+1.67);opening.closePath();facade.holes.push(opening);
            recess(p,wx,y,.025,1,w,3.0,'glassShade',deep?.32:0);
          }
        }
      }
      if(deep){
        const point=at(p,0,-.32),wall=new ExtrudeGeometry(facade,{depth:.32,bevelEnabled:false,steps:1,curveSegments:6});
        // No back-facing duplicate wall cap behind the opaque recess backs.
        const normals=wall.getAttribute('normal'),indices:number[]=[];
        for(let i=0;i<normals.count;i+=3)if(normals.getZ(i)>-.5)indices.push(i,i+1,i+2);
        wall.setIndex(indices);put('stone',wall,point.x,DATUM,point.z,p.yaw);
      }
    }
  }

  // CDS has a slender western tower and a long, five-storey eastern podium.
  // The real one-bay shifts leave terraces facing west, north, east and south.
  // Exposed bronze shading blades are part of its identity, not applied lines.
  activeScope='cds';
  const cds={x:anchors.cds[0],z:anchors.cds[1],yaw:YAW};
  activeFoundation=buElevation(cds.x,cds.z);
  const towerGround=BU_CDS_GROUND_TOWER,podiumGround=BU_CDS_GROUND_PODIUM;
  for(const [body,name] of [[towerGround,'CDS western entrance block'],[podiumGround,'CDS eastern entrance podium']] as const){
    collider(name,cds,body.x,body.z,body.w,body.top,body.d);
    // A recessed dark backing closes the exterior without masking the new
    // glazing/door reveals. The old full-sized box made every reveal invisible.
    box('glassShade',cds,body.x,body.top/2,body.z,body.w-.90,body.top,body.d-.90);
  }
  // 70 x 170 ft east podium (long axis along Comm Ave). Recessed glazing
  // leaves a covered public edge without fabricating an enterable interior.
  const podium=BU_CDS_PODIUM;
  box('glass',cds,podium.x,(5.6+podium.top)/2,podium.z,podium.w,podium.top-5.6,podium.d);
  box('bronze',cds,podium.x,5.61,podium.z,podium.w+.28,.18,podium.d+.28);
  const curtain=(face:Placement,width:number,bottom:number,top:number,floors:number,slant:boolean)=>{
    const h=top-bottom,n=Math.max(1,Math.round(width/2.34));
    for(let k=0;k<=n;k++)box('frame',face,-width/2+k*width/n,(bottom+top)/2,.055,.065,h,.10);
    for(let floor=0;floor<floors;floor++) {
      const y=bottom+floor*h/floors;
      box('frame',face,0,y+.14,.065,width,.28,.14);
      // Double-bay facade diagonal fins are clipped within each storey panel;
      // the opposite shallow face uses the documented vertical sawtooth fins.
      for(let k=0;k<n;k++) {
        const x=-width/2+(k+.5)*width/n,dy=h/floors;
        if(slant)bar('bronze',face,[x-.52,y+.40,.29],[x+.52,y+dy-.18,.29],.15,.40);
        else {
          const fin=new BoxGeometry(.14,dy-.42,.58);fin.rotateY(.44);fin.translate(x,y+dy/2,.28);
          put('bronze',fin,face.x,DATUM,face.z,face.yaw);
        }
      }
    }
  };
  for(const side of [-1,1]) {
    curtain(at(cds,podium.x,podium.z+side*podium.d/2,side<0?Math.PI:0),podium.w,5.6,podium.top,3,side>0);
    curtain(at(cds,podium.x+side*podium.w/2,podium.z,side*Math.PI/2),podium.d,5.6,podium.top,3,false);
  }
  box('roof',cds,podium.x,podium.top+.06,podium.z,podium.w,.12,podium.d);
  box('grass',cds,35,podium.top+.15,14.7,35,.12,5.2);
  box('frame',cds,35,podium.top+.75,18.0,35,.065,.065);
  for(let x=18;x<53;x+=3.5)box('frame',cds,x,podium.top+.42,18,.055,.70,.055);
  BU_CDS_STACK.forEach((level,i)=>{
    const {x,z,bottom,top,floors}=level,h=top-bottom,w=BU_CDS_PLATE;
    box('glass',cds,x,(bottom+top)/2,z,w,h,w);
    box('roof',cds,x,bottom+.10,z,w+.22,.20,w+.22);
    box('frame',cds,x,top-.16,z,w+.28,.32,w+.28);
    for(const side of [-1,1]) {
      curtain(at(cds,x,z+side*w/2,side<0?Math.PI:0),w,bottom,top,floors,(i+Number(side>0))%2===0);
      curtain(at(cds,x+side*w/2,z,side*Math.PI/2),w,bottom,top,floors,(i+Number(side>0))%2!==0);
    }
    const next=BU_CDS_STACK[i+1];
    if(!next)return;
    const dx=next.x-x,dz=next.z-z;
    // The exposed strip belongs to the lower volume, opposite the next shift.
    const tx=x-Math.sign(dx)*(w-BU_CDS_MODULE)/2,tz=z-Math.sign(dz)*(w-BU_CDS_MODULE)/2;
    const tw=dx?BU_CDS_MODULE:w,td=dz?BU_CDS_MODULE:w;
    box('paving',cds,tx,top+.035,tz,tw,.07,td);
    box('grass',cds,tx,top+.14,tz,tw-.65,.16,td-.65);
    for(const side of [-1,1]) {
      box('frame',cds,tx,top+.83,tz+side*td/2,tw,.08,.08);
      box('frame',cds,tx+side*tw/2,top+.83,tz,.08,.08,td);
    }
  });
  // A genuine void at the upper sky court replaces the former solid glass lid.
  const crown=BU_CDS_STACK[BU_CDS_STACK.length-1],crownHeight=BU_CDS_HEIGHT-crown.top;
  box('glassShade',cds,crown.x-4.2,crown.top+crownHeight/2,crown.z,BU_CDS_PLATE-8.4,crownHeight,BU_CDS_PLATE);
  box('paving',cds,crown.x+13.4,crown.top+.10,crown.z,8.0,.20,BU_CDS_PLATE);
  for(const z of [-1,1]) {
    curtain(at(cds,crown.x-4.2,crown.z+z*BU_CDS_PLATE/2,z<0?Math.PI:0),BU_CDS_PLATE-8.4,crown.top,BU_CDS_HEIGHT,3,false);
    box('frame',cds,crown.x+BU_CDS_PLATE/2-.20,crown.top+crownHeight/2,crown.z+z*(BU_CDS_PLATE/2-.20),.40,crownHeight,.40);
  }
  curtain(at(cds,crown.x-BU_CDS_PLATE/2,crown.z,-Math.PI/2),BU_CDS_PLATE,crown.top,BU_CDS_HEIGHT,3,true);
  box('roof',cds,crown.x,BU_CDS_HEIGHT-.15,crown.z,BU_CDS_PLATE,.30,BU_CDS_PLATE);
  box('frame',cds,crown.x+BU_CDS_PLATE/2-.20,crown.top+.85,crown.z,.08,.08,BU_CDS_PLATE);
  // Street-level public glazing: retain the existing ground union and its
  // opaque, closed collision; only the visible skin is recessed and articulated.
  const tx0=towerGround.x-towerGround.w/2,tx1=towerGround.x+towerGround.w/2;
  const tz0=towerGround.z-towerGround.d/2,tz1=towerGround.z+towerGround.d/2;
  const px0=podiumGround.x-podiumGround.w/2,px1=podiumGround.x+podiumGround.w/2;
  const pz0=podiumGround.z-podiumGround.d/2,pz1=podiumGround.z+podiumGround.d/2;
  const publicRing=[[tx0,tz0],[tx1,tz0],[tx1,pz0],[px1,pz0],[px1,pz1],[px0,pz1],[px0,tz1],[tx0,tz1]];
  for(let edge=0;edge<publicRing.length;edge++){
    const a=publicRing[edge],b=publicRing[(edge+1)%publicRing.length];
    // The ring above is clockwise in east/south coordinates. Reverse its edge
    // to orient every plane towards the public exterior.
    const width=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const face=at(cds,(a[0]+b[0])/2,(a[1]+b[1])/2,Math.atan2(b[1]-a[1],a[0]-b[0]));
    const doors=edge===4?BU_CDS_SOUTH_DOORS.map(door=>({door,x:door.local[0]-(a[0]+b[0])/2})):[];
    const head=2.85;
    let cursor=-width/2;
    for(const {door,x} of doors){
      const left=x-door.width/2,right=x+door.width/2;
      panel('glass',face,(cursor+left)/2,2.8,-.04,left-cursor,5.6);
      panel('glass',face,x,(head+5.6)/2,-.04,door.width,5.6-head);
      for(const side of [-1,1]){
        box('frame',face,x+side*door.width/2,(door.floor+head)/2,-.08,.075,head-door.floor,.40);
        panel('glassShade',face,x+side*door.width/4,door.floor+1.375,-.22,door.width/2-.08,2.65);
        box('frame',face,x+side*.17,door.floor+1.05,-.10,.035,.56,.08);
      }
      box('frame',face,x,(door.floor+head)/2,-.18,.065,head-door.floor,.10);
      box('frame',face,x,head-.045,-.08,door.width,.09,.40);
      box('frame',face,x,door.floor+.025,-.08,door.width,.05,.40);
      cursor=right;
    }
    panel('glass',face,(cursor+width/2)/2,2.8,-.04,width/2-cursor,5.6);
    const columns=Math.max(1,Math.round(width/3.5));
    for(let i=1;i<columns;i++){
      const x=-width/2+i*width/columns,start=doors.some(d=>Math.abs(x-d.x)<d.door.width/2+.10)?head:0;
      panel('frame',face,x,(start+5.6)/2,.045,.075,5.6-start);
    }
    box('frame',face,-width/2,2.8,.005,.10,5.6,.20);
    for(const y of [head,5.53])box('frame',face,0,y,.005,width,.09,.18);
  }
  // The covered edge has slim columns; these remain in their previous places.
  for(const x of [14,28,42,53])box('trim',cds,x,2.76,20.45,.34,5.52,.34);
  box('paving',cds,15,.014,28,87,.05,11,true);
  // The old apron began 8.48 m beyond the tower face. Fill only that L-shaped
  // frontage gap at the same +.039 m pavement offset, draped onto source DEM.
  const frontage=outlineGeometry(BU_CDS_ENTRY_PAVING,.012);
  put('paving',frontage,0,DATUM+.027,0,0,true);
  for(const door of BU_CDS_SOUTH_DOORS){
    const vertices:number[]=[],halfWidth=door.width/2+.15;
    for(let i=0;i<4;i++){
      const x0=door.local[0]-halfWidth+2*halfWidth*i/4,x1=door.local[0]-halfWidth+2*halfWidth*(i+1)/4;
      const a=buCDSPoint(x0,door.local[1]-.26),b=buCDSPoint(x1,door.local[1]-.26);
      const e=buCDSPoint(x0,door.local[1]+.16),f=buCDSPoint(x1,door.local[1]+.16),c=buCDSPoint(x0,22.5),d=buCDSPoint(x1,22.5);
      // A short level threshold meets the door sill; only the exterior
      // approach descends to the DEM apron. No suspended 5 cm sill lip.
      const front=door.floor+.05,cy=buElevation(...c)+.041-activeFoundation,dy=buElevation(...d)+.041-activeFoundation;
      vertices.push(a[0],front,a[1],e[0],front,e[1],b[0],front,b[1],b[0],front,b[1],e[0],front,e[1],f[0],front,f[1]);
      vertices.push(e[0],front,e[1],c[0],cy,c[1],f[0],front,f[1],f[0],front,f[1],c[0],cy,c[1],d[0],dy,d[1]);
    }
    const landing=new BufferGeometry();landing.setAttribute('position',new Float32BufferAttribute(vertices,3));landing.computeVertexNormals();
    landing.setAttribute('uv',new Float32BufferAttribute(new Float32Array(vertices.length/3*2),2));
    put('paving',landing,0,DATUM,0,0,true,false);
  }

  activeScope='questrom';
  // Questrom's Rafik B. Hariri Building, 595 Commonwealth Avenue. This is the
  // red-brick business school east of CDS, not the Hariri Institute in CDS.
  // The stepped massing follows BU's exterior photographs and the 1993 plan:
  // a tall rear block, two lower fronts, pale bands and a glazed entrance slot.
  const questrom={x:anchors.questrom[0],z:anchors.questrom[1],yaw:YAW};
  activeFoundation=buElevation(questrom.x,questrom.z);
  collider('Questrom · Rafik B. Hariri Building',questrom,0,0,94,43.5,40);
  // The legacy collision proxy is rectangular, but the visible foundation
  // must follow the actual union of its stepped ground-level tiers.
  walls[walls.length-1].userData.foundationRing=[[-47,-20],[47,-20],[47,15],[37,15],[37,20],[-23,20],[-23,15],[-33,15],[-33,8],[-47,8]];
  const tiers=[{x:0,z:-6,w:94,d:28,h:43.5},{x:7,z:1,w:80,d:28,h:34.5},{x:7,z:13,w:60,d:14,h:26.5}];
  const officeRows=Array.from({length:9},(_,floor)=>({
    y:floor===0?3.25:floor===8?40.40:9.1+(floor-1)*4.31,h:floor===0?3.8:floor===8?2.90:2.1,
  }));
  // Stringcourses sit below complete window openings, never at a separately
  // rounded storey height that can cut through the glass.
  const officeBands=officeRows.filter((_,floor)=>floor%2===1).map(row=>row.y-row.h/2-.35);
  // The photograph has quiet, thin metal window frames, not projecting white
  // boxes. These panes sit 32 cm behind a masonry skin with real openings.
  const officeWindow=(p:Placement,x:number,y:number,w:number,h:number,seed:number)=>{
    panel('glassShade',p,x,y,-.32,w,h);
    panel(seed%5===0?'glassLight':'glass',p,x,y+h*.27,-.315,w-.10,h*.38);
    const outline=new Shape();
    outline.moveTo(-w/2,-h/2);outline.lineTo(w/2,-h/2);outline.lineTo(w/2,h/2);outline.lineTo(-w/2,h/2);outline.closePath();
    const opening=new Shape();
    opening.moveTo(-w/2+.065,-h/2+.065);opening.lineTo(-w/2+.065,h/2-.065);opening.lineTo(w/2-.065,h/2-.065);opening.lineTo(w/2-.065,-h/2+.065);opening.closePath();
    outline.holes.push(opening);
    const point=at(p,x,-.24);
    put('frame',new ShapeGeometry(outline),point.x,DATUM+y,point.z,point.yaw);
    box('frame',p,x,y,-.23,.055,h,.055);
    box('frame',p,x,y-h*.12,-.23,w,.055,.055);
    box('trim',p,x,y-h/2-.07,-.025,w+.30,.14,.31);
    box('stone',p,x,y+h/2+.055,-.10,w+.24,.11,.22);
  };
  // Fill only the masonry between apertures. The inset solid core closes each
  // shallow recess; no room meshes, transparency or extra lights are required.
  const officeFacade=(p:Placement,left:number,right:number,bottom:number,top:number,centers:number[],salt=0)=>{
    const fill=(x0:number,x1:number,y0:number,y1:number)=>{
      if(x1-x0>.001&&y1-y0>.001)box('brick',p,(x0+x1)/2,(y0+y1)/2,-.20,x1-x0,y1-y0,.40);
    };
    let previous=bottom;
    officeRows.forEach((row,floor)=>{
      const y0=row.y-row.h/2,y1=row.y+row.h/2;
      // A stepped roof must not clip an aperture into a narrow half-window.
      // Leave room for the lower wing's coping and this wing's own parapet.
      if(y0<bottom+.32||y1>top-.75)return;
      const holes=centers.filter(x=>x-1.115>left+.08&&x+1.115<right-.08);
      if(!holes.length)return;
      fill(left,right,previous,y0);
      let edge=left;
      holes.forEach((x,i)=>{
        fill(edge,x-1.115,y0,y1);
        officeWindow(p,x,(y0+y1)/2,2.23,y1-y0,salt+floor*5+i);
        edge=x+1.115;
      });
      fill(edge,right,y0,y1);previous=y1;
    });
    fill(left,right,previous,top);
  };
  const officeCenters=(width:number,center=0)=>{
    // BU's exterior photograph shows paired windows separated by broad brick
    // piers. Equal spacing made the building look like a generic office grid.
    if(width<8)return[center];
    const pairs=Math.max(1,Math.floor((width-2.4)/7.45));
    return Array.from({length:pairs},(_,i)=>[-1.42,1.42].map(dx=>center+(i-(pairs-1)/2)*7.45+dx)).flat();
  };
  tiers.forEach((tier,tierIndex)=>{
    box('brick',questrom,tier.x,tier.h/2,tier.z,tier.w-.90,tier.h,tier.d-.90);
    const front=tier.z+tier.d/2,face=at(questrom,0,front),centers=officeCenters(tier.w,tier.x);
    // Do not spend vertices on windows hidden behind the next stepped mass.
    const zones=tierIndex===0?[[-47,-33,0],[-33,47,34.5]]:
      tierIndex===1?[[-33,-23,0],[-23,37,26.5],[37,47,0]]:[[-23,2.3,0],[11.7,37,0]];
    zones.forEach(([left,right,bottom])=>officeFacade(face,left,right,bottom,tier.h,centers,tierIndex));
    // The side returns make the staggered facade read as connected wings.
    const returnBack=tierIndex===0?-20:tiers[tierIndex-1].z+tiers[tierIndex-1].d/2;
    for(const side of [-1,1]) {
      const p=at(questrom,tier.x+side*tier.w/2,(returnBack+front)/2,side*Math.PI/2);
      const width=front-returnBack;
      officeFacade(p,-width/2,width/2,0,tier.h,officeCenters(width),tierIndex+side+4);
      for(const y of officeBands)if(y<tier.h-.7) {
        box('trim',p,0,y,.04,width,.18,.22);
        box('inset',p,0,y-.16,.015,width,.055,.06);
      }
    }
    // Dark roof trays and narrow perimeter copings replace solid pale lids.
    box('roof',questrom,tier.x,tier.h+.04,tier.z,tier.w-.48,.12,tier.d-.48);
    for(const side of [-1,1]) {
      const z=tier.z+side*tier.d/2;
      box('inset',questrom,tier.x,tier.h-.51,z,tier.w+.08,.12,.15);
      box('stone',questrom,tier.x,tier.h-.27,z,tier.w+.28,.30,.42);
      box('trim',questrom,tier.x,tier.h+.18,z,tier.w+.56,.25,.64);
      const x=tier.x+side*tier.w/2;
      box('stone',questrom,x,tier.h-.27,tier.z,.42,.30,tier.d);
      box('trim',questrom,x,tier.h+.18,tier.z,.64,.25,tier.d+.56);
    }
    for(const [left,right,bottom] of zones)for(const y of officeBands)if(y>bottom+.32&&y<tier.h-.7) {
      // Stop at masonry edges, including both sides of the glazed centre slot.
      box('trim',questrom,(left+right)/2,y,front+.035,right-left,.16,.22);
      box('inset',questrom,(left+right)/2,y-.14,front+.015,right-left,.045,.05);
    }
    // The restrained upper stone course sits above glazing, with an actual
    // underside shadow; it does not slice the tallest ninth-floor windows.
    box('stone',questrom,tier.x,tier.h-.95,front+.10,tier.w+.20,.22,.38);
    box('inset',questrom,tier.x,tier.h-1.10,front+.04,tier.w,.055,.11);
  });
  // Ground-floor stonework and storefront glass run around the three steps.
  tiers.forEach((tier,tierIndex)=>{
    const z=tier.z+tier.d/2;
    if(tierIndex===2) {
      // Keep the entrance threshold open instead of running a stone plinth
      // across the lower metre of the glazed doors.
      box('stone',questrom,-11.75,.54,z+.06,22.5,1.08,.38);
      box('stone',questrom,25.75,.54,z+.06,22.5,1.08,.38);
    } else box('stone',questrom,tier.x,.54,z+.06,tier.w,1.08,.38);
    box('trim',questrom,tier.x,6.7,z+.13,tier.w+.30,.56,.50);
    const columns=Math.floor(tier.w/8.5);
    for(let i=0;i<=columns;i++) {
      const x=tier.x-tier.w/2+.65+i*(tier.w-1.3)/columns;
      if(tierIndex===2&&Math.abs(x-7)<7.9)continue;
      box('stone',questrom,x,3.7,z+.20,1.12,6.15,.67);
      for(const y of [1.6,3.1,4.6])box('inset',questrom,x,y,z+.55,1.14,.045,.035);
    }
  });
  officeFacade(at(questrom,0,-20,Math.PI),-47,47,0,43.5,officeCenters(94),12);
  // Shallow setbacks and a modest mechanical penthouse close the roofline.
  box('stone',questrom,0,45.2,-6,79,3.0,23);
  box('trim',questrom,0,46.7,-6,80,.35,24);
  box('roof',questrom,0,46.93,-6,78,.18,22);
  for(const side of [-1,1])for(let x=-33;x<=33;x+=6) {
    panel('inset',at(questrom,0,-6+side*11.52,side<0?Math.PI:0),x,45.3,.015,3.9,1.45);
    for(const y of [44.85,45.25,45.65])box('stone',questrom,x,y,-6+side*11.58,4.1,.12,.12);
  }
  box('glassLight',questrom,7,48.7,-7,17,3.35,9);
  for(let x=-1.5;x<=15.5;x+=1.7) box('frame',questrom,x,48.7,-2.43,.10,3.4,.12);
  box('frame',questrom,7,50.43,-7,17.4,.16,9.4);
  // Central glazed entrance, large stone canopy and restrained raised sign.
  panel('glassShade',questrom,7,13.1,19.70,9.4,25.6);
  for(let y=7.9;y<26;y+=4.31)panel('glass',questrom,7,y,19.715,9.2,1.25);
  for(const x of [2.35,4.7,7,9.3,11.65])box('frame',questrom,x,13.1,19.83,.075,25.6,.12);
  for(let y=1.3;y<26;y+=2.15)box('frame',questrom,7,y,19.83,9.4,.085,.12);
  for(const x of [2.25,11.75])box('brick',questrom,x,16.5,19.88,.18,19.9,.26);
  for(const x of [-.65,14.65]) {
    box('stone',questrom,x,3.5,21.0,1.40,7,2);
    box('trim',questrom,x,6.6,21.0,1.70,.38,2.3);
    box('roof',questrom,x,.45,21.03,1.40,.90,2.04);
    for(const y of [1.55,2.65,3.75,4.85])box('inset',questrom,x,y,22.012,1.4,.028,.028);
    // Rock-faced stone band photographed at the entrance; five broad facets
    // describe a dressed block, not noisy tessellation across the whole pier.
    for(let i=0;i<5;i++) {
      const face=new BoxGeometry(.25,.68,.085);face.rotateY((i%2?1:-1)*.16);
      face.translate(x-.53+i*.265,5.30,22.025);put('stone',face,questrom.x,DATUM,questrom.z,YAW);
    }
    for(const y of [4.89,5.71])box('trim',questrom,x,y,22.08,1.48,.12,.14);
    box('wood',questrom,x,2.05,22.06,.78,1.14,.065);
    collider('Questrom entrance pier',questrom,x,21.0,1.4,7,2);
  }
  box('stone',questrom,7,6.00,22.10,16.7,1.60,4.65);
  box('trim',questrom,7,6.88,22.10,17.1,.24,4.95);
  box('inset',questrom,7,5.17,22.10,16.2,.08,4.4);
  box('stone',questrom,7,5.105,22.15,15.3,.065,4.25);
  for(const x of [-.1,3.45,7,10.55,14.1])box('inset',questrom,x,6.0,24.442,.028,1.60,.025);
  for(const x of [1.1,5.0,9.0,12.9])for(const z of [21.0,23.3]) {
    const point=at(questrom,x,z);
    put('inset',new CylinderGeometry(.105,.105,.02,8),point.x,DATUM+5.064,point.z);
  }
  for(const x of [1.7,4.35,7,9.65,12.3]) {
    panel('glassShade',questrom,x,2.45,20.025,2.45,4.65);
    panel('glass',questrom,x,3.65,20.035,2.32,.72);
    box('frame',questrom,x-1.23,2.45,20.10,.075,4.7,.11);
    box('frame',questrom,x,.25,20.10,2.45,.13,.11);
    box('frame',questrom,x,1.20,20.10,2.45,.075,.11);
    box('frame',questrom,x,4.75,20.10,2.45,.08,.11);
    box('frame',questrom,x+.78,1.55,20.18,.055,.55,.08);
  }
  box('paving',questrom,4,.014,28.5,104,.05,17,true);
  // A narrow warm-brick apron recalls the real street entrance. It stays level
  // with the connecting walk instead of adding unwalkable decorative steps.
  box('brickLight',questrom,7,.046,27.0,24,.012,8,true);
  // Flush stone borders and a threshold give the entry a human-scale forecourt
  // without decorative stairs or raised curbs across the accessible route.
  for(const z of [22.82,31.18])box('stone',questrom,7,.047,z,24.72,.018,.36,true);
  for(const x of [-5.18,19.18])box('stone',questrom,x,.047,27,.36,.018,8,true);
  box('paving',questrom,7,.052,21.25,13.6,.022,2.30,true);
  box('inset',questrom,7,.065,22.25,9.5,.012,.58,true);
  if(typeof document!=='undefined') {
    const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=288;
    const ctx=canvas.getContext('2d');
    if(ctx) {
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle='#666658';ctx.font='600 62px Georgia, serif';ctx.fillText('QUESTROM',768,62);
      ctx.font='600 48px Georgia, serif';ctx.fillText('SCHOOL OF BUSINESS',768,132);
      ctx.font='28px Georgia, serif';ctx.fillText('RAFIK B. HARIRI BUILDING',768,218);
      const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=4;
      const sign=new Mesh(new PlaneGeometry(14.9,2.79),new MeshStandardMaterial({map:texture,transparent:true,alphaTest:.05,roughness:1,depthWrite:false}));
      // Written text lives slightly in front of the solid stone canopy face.
      sign.position.set(questrom.x+7*Math.cos(YAW)+24.45*Math.sin(YAW),activeFoundation+6.0,questrom.z-7*Math.sin(YAW)+24.45*Math.cos(YAW));
      sign.rotation.y=YAW;sign.scale.y=.52;sign.name='Questrom entrance inscription';questromExtras.add(sign);
    }
  }

  activeScope='landmarks';
  // The Castle is a small Tudor Revival house, not a medieval fortress.
  const castleParts=new Map([...batches].map(([finish,parts])=>[finish,parts.length]));
  const castleWallStart=walls.length;
  const castle={x:anchors.castle[0],z:anchors.castle[1],yaw:YAW};
  const castleSurvey=BU_FULL_BUILDINGS.find(b=>b.id==='castle')!;
  activeFoundation=buElevation(castleSurvey.x,castleSurvey.z);
  block('stone',castle,0,0,24,10.5,18,'BU Castle');
  // A truncated hipped slate roof with two cross gables follows the overall
  // roof character in BU's aerial photograph. Close every slope and soffit.
  const lower=[[-12.7,10.5,-9.7],[12.7,10.5,-9.7],[12.7,10.5,9.7],[-12.7,10.5,9.7]];
  const upper=[[-8,15.8,-3.2],[8,15.8,-3.2],[8,15.8,3.2],[-8,15.8,3.2]];
  const roofVertices:number[]=[];
  const roofQuad=(a:number[],b:number[],c:number[],d:number[])=>roofVertices.push(...a,...b,...c,...a,...c,...d);
  for(let i=0;i<4;i++){const j=(i+1)%4;roofQuad(lower[i],upper[i],upper[j],lower[j]);}
  roofQuad(upper[0],upper[3],upper[2],upper[1]);roofQuad(lower[0],lower[1],lower[2],lower[3]);
  const hip=new BufferGeometry();hip.setAttribute('position',new Float32BufferAttribute(roofVertices,3));hip.computeVertexNormals();
  hip.setAttribute('uv',new Float32BufferAttribute(new Float32Array(roofVertices.length/3*2),2));
  put('roof',hip,castle.x,DATUM,castle.z,YAW);
  box('roof',castle,0,15.85,0,16.25,.18,6.6);
  box('stone',castle,0,10.40,0,24.55,.38,18.55);
  for(const side of [-1,1]) {
    box('frame',castle,side*12.45,10.65,0,.19,.19,19.05);
    box('frame',castle,0,10.65,side*9.40,25.1,.19,.19);
    box('stone',castle,0,5.75,side*9.04,24.16,.22,.20);
  }
  windows(castle,24,18,10,2,5.1);
  // Canted corners give the projecting bay three distinct window faces while
  // remaining completely inside its existing 7 x 8 m collision proxy.
  const bayOutline=new Shape();
  for(const [i,[x,z]] of [[-13.5,2],[-6.5,2],[-6.5,8.9],[-7.6,10],[-12.4,10],[-13.5,8.9]].entries()) {
    if(i===0)bayOutline.moveTo(x,-z);else bayOutline.lineTo(x,-z);
  }
  bayOutline.closePath();
  const bayBody=new ExtrudeGeometry(bayOutline,{depth:12,bevelEnabled:false,steps:1});bayBody.rotateX(-Math.PI/2);
  put('stone',bayBody,castle.x,DATUM,castle.z,YAW);
  collider('BU Castle bay',castle,-10,6,7,12,8);
  roof(castle,-10,6,8,9,12,4);
  roof(castle,7.5,5.8,7.7,6.4,10.5,5.8);
  const bayFaces=[{p:at(castle,-10,10.035),columns:[-1.52,0,1.52],width:4.8},
    {p:at(castle,-12.96,9.46,-Math.PI/4),columns:[0],width:1.54},
    {p:at(castle,-7.04,9.46,Math.PI/4),columns:[0],width:1.54}];
  for(const face of bayFaces) {
    for(const bottom of [1.4,6.65])for(const x of face.columns) {
      arch(face.p,x,bottom,.015,1.34,3.95,false,'trim');
      arch(face.p,x,bottom+.13,.06,1.08,3.57,false,'glassShade');
      box('trim',face.p,x,bottom+1.8,.105,.075,3.25,.12);
      box('frame',face.p,x,bottom+1.5,.115,1.05,.045,.06);
    }
    for(const y of [1.27,5.63,6.52,10.88])box('trim',face.p,0,y,.10,face.width,.18,.30);
    box('stone',face.p,0,11.52,.10,face.width,.40,.38);
    box('trim',face.p,0,11.82,.15,face.width+.12,.18,.46);
  }
  for(const [x,z,eave,w,rise,depth] of [[-10,6,12,8,4,9],[7.5,5.8,10.5,7.7,5.8,6.4]]) {
    for(const side of [-1,1]) {
      const angle=-side*Math.atan2(rise,w/2),length=Math.hypot(w/2,rise);
      const coping=new BoxGeometry(length+.12,.18,.34);coping.rotateZ(angle);coping.translate(x+side*w/4,eave+rise/2,z+depth/2+.045);
      put('trim',coping,castle.x,DATUM,castle.z,YAW);
    }
  }
  for(const [x,z,w,d,height] of [[0,4.7,2.7,2.25,18.15],[-7.2,-5.8,1.75,1.65,17.5]]) {
    box('stone',castle,x,(height+9)/2,z,w,height-9,d);
    box('inset',castle,x,height-.40,z,w+.05,.13,d+.05);
    box('trim',castle,x,height-.20,z,w+.38,.24,d+.38);
    box('stone',castle,x,height+.02,z,w+.20,.20,d+.20);
    for(const dx of [-.43,.43])for(const dz of [-.38,.38]) {
      const point=at(castle,x+dx,z+dz);
      put('stone',new CylinderGeometry(.19,.23,.63,8),point.x,DATUM+height+.40,point.z);
      put('inset',new CylinderGeometry(.13,.13,.022,8),point.x,DATUM+height+.725,point.z);
    }
  }
  for(const x of [-3.4,3.4]) {
    box('stone',castle,x,14.1,6.75,2.9,3.0,2.8);
    roof(castle,x,6.75,3.4,3.25,15.6,1.35);
    for(const dx of [-.57,.57]) {
      arch(castle,x+dx,13.1,8.18,1.05,2.1,false,'trim');
      arch(castle,x+dx,13.23,8.23,.80,1.78,false,'glassShade');
    }
    box('trim',castle,x,13.0,8.24,3.0,.20,.42);
  }

  // Fit the authored heritage silhouette to the surveyed centre/orientation.
  // Keep its west bay inside the parcel instead of intersecting Leventhal.
  const castleFit=new Matrix4().makeTranslation(castleSurvey.x,0,castleSurvey.z)
    .multiply(new Matrix4().makeRotationY(castleSurvey.yaw))
    .multiply(new Matrix4().makeScale(.9,1,1))
    .multiply(new Matrix4().makeRotationY(-YAW))
    .multiply(new Matrix4().makeTranslation(-castle.x,0,-castle.z));
  for(const [finish,parts] of batches)for(let i=castleParts.get(finish)??0;i<parts.length;i++)parts[i].applyMatrix4(castleFit);
  for(const wall of walls.slice(castleWallStart))wall.applyMatrix4(castleFit);

  // Bare-earth terrain falls toward the Charles. Fill only below each rigid
  // building's actual footprint, never a large rectangular landscape pad.
  // These walls continue both visible masonry and collision down into the
  // terrain, so the north side cannot float or be entered under its floor.
  group.updateMatrixWorld(true);
  for(const wall of [...walls]){
    // Skirts are generated later than their building. Recover the original
    // ownership instead of inheriting whichever landmark was built last.
    activeScope=wall.userData.buLandmarkScope as LandmarkScope;
    const local=wall.userData.foundationRing as WorldPoint[]|undefined;if(!local)continue;
    const localY=wall.userData.foundationLocalY as number;
    const points=local.map(([x,z])=>new Vector3(x,localY,z).applyMatrix4(wall.matrixWorld));
    const foundation=points[0].y,vertices:number[]=[];
    let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.z-b.x*a.z;}
    for(let edge=0;edge<points.length;edge++){
      let a=points[edge],b=points[(edge+1)%points.length];if(area<0)[a,b]=[b,a];
      const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/2));
      for(let i=0;i<steps;i++){
        const p=a.clone().lerp(b,i/steps),q=a.clone().lerp(b,(i+1)/steps);
        const py=buElevation(p.x,p.z),qy=buElevation(q.x,q.z);
        if(Math.min(py,qy)>=foundation-.015)continue;
        const top=.035,pBottom=Math.min(top,py-foundation-.20),qBottom=Math.min(top,qy-foundation-.20);
        vertices.push(p.x,top,p.z,q.x,top,q.z,p.x,pBottom,p.z,q.x,top,q.z,q.x,qBottom,q.z,p.x,pBottom,p.z);
      }
    }
    if(!vertices.length)continue;
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
    geometry.userData.buFoundationSkirt=true;
    geometry.setAttribute('uv',new Float32BufferAttribute(new Float32Array(vertices.length/3*2),2));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const collision=new Mesh(geometry.clone(),material);collision.position.y=foundation;
    collision.name=`${wall.name} · terrain foundation`;collision.visible=false;collision.userData.foundationSkirt=true;
    collision.userData.buLandmarkScope=activeScope;
    group.add(collision);walls.push(collision);
    if(activeScope==='cds')cdsWalls.push(collision);
    if(activeScope==='questrom')questromWalls.push(collision);
    activeFoundation=foundation;
    put(wall.name.startsWith('Free at Last')?'granite':'stone',geometry,0,DATUM,0);
  }

  // Bay State houses now use the city's individual footprints in bu-full-campus.

  const finishes = new Map<Finish, MeshStandardMaterial>();
  const getMaterial=(finish:Finish)=>{
    if(finishes.has(finish))return finishes.get(finish)!;
    const source:Record<Finish,string>={stone:'limestone',trim:'trim',brick:'brick',brickLight:'brick',roof:'roof',glass:'glass',glassLight:'glass',glassShade:'glass',glassStained:'interiorShade',frame:'frame',bronze:'bronze',granite:'pavement',wood:'entranceDoor',paving:'pavement',grass:'grass',inset:'interiorShade'};
    const m=createCampusSurface(source[finish],{profile:'bu',geometryFrame:true,pavingStyle:finish==='granite'?'granite':undefined}) as MeshStandardMaterial;
    if(finish==='paving'||finish==='granite'||finish==='grass')configureBUGroundLayer(m,'surface');
    m.name=`BU ${finish}`;
    const colors:Partial<Record<Finish,string>>={stone:'#c9bdab',trim:'#e2d7bf',brick:'#a3654c',brickLight:'#b77d62',roof:'#56676a',glass:'#628b8e',glassLight:'#86a5a6',glassShade:'#344f55',glassStained:'#293239',frame:'#989b8d',bronze:'#9a7b64',granite:'#b99d91',wood:'#72523e',grass:'#7a985d',inset:'#39494b'};
    if(colors[finish])m.color=new Color(colors[finish]);
    if(finish.startsWith('glass')){m.roughness=.52;m.metalness=.12;}
    if(finish==='glassStained'){m.roughness=.83;m.metalness=0;m.emissive.set(0);m.emissiveIntensity=0;}
    finishes.set(finish,m);return m;
  };
  for(const [surface,map] of [[false,batches],[true,groundBatches]] as const) for(const [finish,parts] of map){
    const scopes=new Map<LandmarkScope,BufferGeometry[]>();
    for(const part of parts){
      const scope=part.userData.buLandmarkScope as LandmarkScope;
      const list=scopes.get(scope)??[];list.push(part);scopes.set(scope,list);
    }
    for(const [scope,scopedParts] of scopes){
      const foundationTriangles=scopedParts.filter(part=>part.userData.buFoundationSkirt).reduce((sum,part)=>sum+part.getAttribute('position').count/3,0);
      const prepared=surface?scopedParts.map(part=>part.userData.buFixedFoundation?part:drapeBUGeometry(part)):scopedParts;
      const geometry=mergeGeometries(prepared,false);
      prepared.forEach((part,i)=>{if(part!==scopedParts[i])part.dispose();});
      scopedParts.forEach(part=>part.dispose());
      if(!geometry)throw new Error(`Unable to merge BU ${finish}`);
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const mesh=new Mesh(geometry,getMaterial(finish));
      mesh.name=`BU ${surface?'ground':'architecture'} · ${finish}`;
      mesh.userData.buLandmarkScope=scope;mesh.userData.buGround=surface;
      mesh.userData.buFoundationSkirtTriangles=foundationTriangles;
      mesh.castShadow=!surface&&!finish.startsWith('glass');mesh.receiveShadow=true;
      (scope==='cds'?cdsVisual:scope==='questrom'?questromVisual:group).add(mesh);shadowMeshes.push(mesh);
      if(surface){
        if(scope==='cds'||scope==='questrom'){
          // The visible paving may be hidden/replaced. Keep its exact draped
          // geometry as an independent, invisible ground collider outside it.
          const collision=new Mesh(geometry,material);
          collision.name=mesh.name;collision.visible=false;
          collision.userData.buLandmarkScope=scope;collision.userData.buGround=true;
          collision.userData.buCollisionOnly=true;
          group.add(collision);ground.push(collision);(scope==='cds'?cdsGround:questromGround).push(collision);
        }else ground.push(mesh);
      }
    }
  }
  group.updateMatrixWorld(true);
  return {group,ground,walls,cds:{visual:cdsVisual,ground:cdsGround,walls:cdsWalls},questrom:{visual:questromVisual,ground:questromGround,walls:questromWalls,extras:questromExtras},setQuality:(low:boolean)=>{
    shadowMeshes.forEach(mesh=>{mesh.castShadow=!low&&!mesh.userData.buGround&&!mesh.name.includes('glass');});
  }};
}
