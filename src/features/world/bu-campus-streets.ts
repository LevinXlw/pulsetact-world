import {BoxGeometry,BufferGeometry,CylinderGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,PlaneGeometry,Quaternion,Shape,ShapeGeometry,Vector2,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {BU_CAMPUS_ROADS,BU_COMMONWEALTH_MEDIAN,BU_EXPRESSWAY_SEGMENTS,BU_FULL_PLACES,BU_ROAD_EDGES,buAvenueOuterSide,buCrossesExpressway,buExpresswayDistance,buExpresswayDrop,buSegmentProjection} from './bu-campus-layout';
import {BU_GROUND_BUILDINGS} from './bu-campus-footprints';
import {BU_TERRAIN_CELL,buElevation,drapeBUGeometry} from './bu-terrain';
import type {WorldPoint} from './geo-coordinates';
import type {LawnFootprint} from './bu-ground-detail';
import {BU_COURTYARD_PUBLIC_SEGMENTS,BU_PUBLIC_FRONTAGES,BU_SIDEWALK_JOIN_PATCHES,BU_TRANSIT_PLATFORM_DETAILS,buClipSidewalkToJunctions,buStreetSidewalk} from './bu-public-realm';
import {configureBUGroundLayer} from './bu-ground-layers';
import {BU_RIVER_FOOTBRIDGES} from './bu-river-core-layout';
import {createBUTransitSurface} from './bu-transit-surfaces';
import {createBUWestTerrace} from './bu-west-terrace';
import {buCASLandscapeReplaces} from './bu-comm-ave-landscape-layout';

type Finish='asphalt'|'paving'|'brickPaving'|'curb'|'joint'|'stripe'|'yellow'|'cycle'|'rail'|'railWeb'|'gravel'|'tactile'|'metal'|'lamp'|'wood'|'mulch'|'steel';
const CELL=180, DATUM=5.2;
const expresswayHeight=(x:number,z:number)=>buElevation(x,z)+buExpresswayDrop(x,z);
const insideRing=(x:number,z:number,ring:WorldPoint[])=>{
  let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if(((a[1]>z)!==(b[1]>z))&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
};
const buildingBounds=BU_GROUND_BUILDINGS.map(b=>({ring:b.footprint,minX:Math.min(...b.footprint.map(p=>p[0])),maxX:Math.max(...b.footprint.map(p=>p[0])),minZ:Math.min(...b.footprint.map(p=>p[1])),maxZ:Math.max(...b.footprint.map(p=>p[1]))}));
function inBuilding(x:number,z:number,padding=0){return buildingBounds.some(b=>x>b.minX-padding&&x<b.maxX+padding&&z>b.minZ-padding&&z<b.maxZ+padding&&(insideRing(x,z,b.ring)||b.ring.some((a,i)=>buSegmentProjection(x,z,a,b.ring[(i+1)%b.ring.length]).distance<padding)));}

/** GIS streets are actual separate carriageways, not a strip offset from the
 * landmark tour. All pedestrian surfaces share BU's terrain triangulation. */
export function createBUCampusStreets(){
  const group=new Group();group.name='BU · Commonwealth Avenue and campus streets';
  const ground:Mesh[]=[],walls:Mesh[]=[],trees:{x:number;z:number;radius:number}[]=[],lawns:LawnFootprint[]=[];
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>();
  const detailMeshes:Mesh[]=[],allMeshes:Mesh[]=[];
  const invisible=new MeshBasicMaterial();
  const materials:Record<Finish,MeshStandardMaterial>={
    asphalt:createCampusSurface('road',{profile:'bu',groundHeight:DATUM}) as MeshStandardMaterial,paving:createCampusSurface('pavement',{profile:'bu',geometryFrame:true,pavingStyle:'concrete'}) as MeshStandardMaterial,brickPaving:createCampusSurface('pavement',{profile:'bu',geometryFrame:true,pavingStyle:'brick'}) as MeshStandardMaterial,
    curb:createCampusSurface('curb',{profile:'bu',groundHeight:DATUM}) as MeshStandardMaterial,joint:new MeshStandardMaterial({color:'#928c7e',roughness:1}),
    stripe:new MeshStandardMaterial({color:'#eee9d8',roughness:1}),yellow:new MeshStandardMaterial({color:'#d9b85e',roughness:.9}),
    cycle:new MeshStandardMaterial({color:'#657d70',roughness:1}),rail:new MeshStandardMaterial({color:'#aeb7b6',roughness:.42,metalness:.68}),
    gravel:createBUTransitSurface('ballast'),tactile:createBUTransitSurface('tactile'),railWeb:new MeshStandardMaterial({color:'#74533f',roughness:.83,metalness:.38}),metal:new MeshStandardMaterial({color:'#475b55',roughness:.75,metalness:.12}),
    lamp:new MeshStandardMaterial({color:'#f0e8c5',emissive:'#bcab70',emissiveIntensity:.16,roughness:.65}),
    wood:createCampusSurface('benchWood',{profile:'bu',groundHeight:DATUM}) as MeshStandardMaterial,mulch:new MeshStandardMaterial({color:'#5c5a40',roughness:1}),
    steel:new MeshStandardMaterial({color:'#657b6b',roughness:.72,metalness:.22}),
  };
  materials.asphalt.color.set('#586662');materials.paving.color.set('#c6bea6');materials.brickPaving.color.set('#9a7663');
  for(const finish of Object.keys(materials) as Finish[])configureBUGroundLayer(materials[finish],['stripe','yellow','joint','cycle','tactile'].includes(finish)?'marking':'surface');
  const append=(finish:Finish,geometry:BufferGeometry,surface:boolean,x:number,z:number,yaw=0)=>{
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    if(finish==='paving'||finish==='brickPaving'){
      const count=part.getAttribute('position').count;
      part.setAttribute('campusYaw',new Float32BufferAttribute(new Float32Array(count).fill(yaw),1));
      part.setAttribute('campusBaseHeight',new Float32BufferAttribute(new Float32Array(count).fill(DATUM),1));
    }
    const key=`${Math.floor(x/CELL)}:${Math.floor(z/CELL)}:${surface?'ground':'detail'}:${finish}`;
    const batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const drape=(geometry:BufferGeometry,elevation=buElevation)=>{const result=drapeBUGeometry(geometry,8,elevation);geometry.dispose();return result;};
  const slab=(finish:Finish,x:number,z:number,width:number,length:number,y:number,yaw=0,elevation=buElevation,surface=true)=>{
    const g=new PlaneGeometry(width,length);g.rotateX(-Math.PI/2);g.rotateY(yaw);g.translate(x,DATUM+y,z);append(finish,drape(g,elevation),surface,x,z,yaw);
  };
  const patch=(finish:Finish,points:WorldPoint[],y:number,yaw=0)=>{
    const geometry=new ShapeGeometry(new Shape(points.map(([x,z])=>new Vector2(x,-z))));geometry.rotateX(-Math.PI/2);geometry.translate(0,DATUM+y,0);
    append(finish,drape(geometry),true,points[0][0],points[0][1],yaw);
  };
  // City-footprint frontage infill joins building doors to the real sidewalk;
  // planted brownstone gardens receive only narrow entrance links. Keep the
  // shared sidewalk overlay a few millimetres above this material transition.
  for(const frontage of BU_PUBLIC_FRONTAGES)patch(frontage.kind==='entrance'?'brickPaving':'paving',frontage.points,.102);
  const box=(finish:Finish,x:number,z:number,width:number,height:number,depth:number,y:number,yaw=0,base=buElevation(x,z))=>{
    const g=new BoxGeometry(width,height,depth);g.rotateY(yaw);g.translate(x,base+y,z);append(finish,g,false,x,z);
  };
  const pole=(finish:Finish,x:number,z:number,r:number,height:number,y:number,base=buElevation(x,z),top=r)=>{
    const g=new CylinderGeometry(top,r,height,8);g.translate(x,base+y,z);append(finish,g,false,x,z);
  };
  const barrier=(x:number,z:number,length:number,yaw:number,base:number,height=1.15)=>{
    const mesh=new Mesh(new BoxGeometry(.24,height,length),invisible);mesh.name=`BU street barrier ${x.toFixed(1)},${z.toFixed(1)}`;mesh.position.set(x,base+height/2,z);mesh.rotation.y=yaw;mesh.visible=false;
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();group.add(mesh);walls.push(mesh);
  };
  function lamp(x:number,z:number,yaw:number){
    pole('metal',x,z,.17,.42,.21);pole('metal',x,z,.075,5.6,2.8,undefined,.047);
    box('metal',x,z,.10,.12,1.5,5.49,yaw);box('lamp',x+Math.sin(yaw)*.7,z+Math.cos(yaw)*.7,.35,.17,.62,5.42,yaw);
  }
  function bench(x:number,z:number,yaw:number){
    for(const side of [-1,1]){const dx=side*.7*Math.cos(yaw),dz=-side*.7*Math.sin(yaw);box('metal',x+dx,z+dz,.09,.47,.58,.235,yaw);}
    for(const offset of [-.2,0,.2])box('wood',x+Math.sin(yaw)*offset,z+Math.cos(yaw)*offset,1.85,.07,.16,.48,yaw);
    for(const h of [.77,1.0])box('wood',x-Math.sin(yaw)*.24,z-Math.cos(yaw)*.24,1.85,.16,.07,h,yaw);
  }
  function bikeRack(x:number,z:number,yaw:number){
    for(const d of [-.38,.38])pole('metal',x+Math.cos(yaw)*d,z-Math.sin(yaw)*d,.035,.78,.39);
    box('metal',x,z,.82,.07,.07,.78,yaw);
  }
  const treeSites=new Set<string>();
  const tree=(x:number,z:number,seed:number)=>{
    if(buCASLandscapeReplaces(x,z))return;
    const key=`${Math.round(x/7)}:${Math.round(z/7)}`;
    if(treeSites.has(key)||inBuilding(x,z,3.8)||buExpresswayDistance(x,z)<6)return;
    if(BU_FULL_PLACES.some(p=>Math.hypot(p.position[0]-x,p.position[1]-z)<3.3))return;
    treeSites.add(key);trees.push({x,z,radius:3.5+(seed%5)*.16});
    slab('mulch',x,z,1.7,1.7,.105);for(const side of [-1,1]){box('curb',x+side*.9,z,.13,.11,1.9,.10);box('curb',x,z+side*.9,1.9,.11,.13,.10);}
  };
  const junction=(x:number,z:number,name:string,pad=1.5)=>BU_ROAD_EDGES.some(({a,b,road})=>road.name!==name&&buSegmentProjection(x,z,a,b).distance<road.width/2+pad);
  // Only the campus landing segment can meet a street kerb. The elevated
  // switchbacks above Storrow must not create openings in unrelated streets.
  const bridgeEntries=BU_RIVER_FOOTBRIDGES.map(bridge=>({a:bridge.points.at(-2)!,b:bridge.points.at(-1)!,halfWidth:bridge.width/2}));
  // A real low kerb has a top and vertical face. At cross streets its top
  // feathers to road level, with no extra collision wall across a crossing.
  // These centimetre details are authored; the underlying GIS edge is unchanged.
  const curb=(x:number,z:number,length:number,yaw:number,name:string)=>{
    const cross=BU_ROAD_EDGES.filter(e=>e.road.name!==name&&buSegmentProjection(x,z,e.a,e.b).distance<length/2+e.road.width/2+4);
    const entries=bridgeEntries.filter(e=>buSegmentProjection(x,z,e.a,e.b).distance<length/2+e.halfWidth+2);
    const steps=cross.length||entries.length?Math.ceil(length/1.5):1,vertices:number[]=[],s=Math.sin(yaw),c=Math.cos(yaw);let raised=false;
    const cuts=new Set<number>(Array.from({length:steps+1},(_,i)=>-length/2+length*i/steps));
    // Cut the slim strip at the shared DEM lattice directly. Sending its
    // vertical sides through polygon clipping needlessly duplicates vertices.
    for(const side of [-1,1]){
      const px=x+c*.11*side,pz=z-s*.11*side;
      for(const [origin,direction] of [[px,s],[pz,c],[px-pz,s-c]]){
        if(Math.abs(direction)<1e-7)continue;
        const lo=origin-direction*length/2,hi=origin+direction*length/2;
        for(let k=Math.ceil(Math.min(lo,hi)/BU_TERRAIN_CELL);k*BU_TERRAIN_CELL<Math.max(lo,hi);k++){
          const d=(k*BU_TERRAIN_CELL-origin)/direction;if(d>-length/2&&d<length/2)cuts.add(d);
        }
      }
    }
    const section=(d:number)=>{
      const px=x+s*d,pz=z+c*d,clearance=Math.min(...cross.map(e=>buSegmentProjection(px,pz,e.a,e.b).distance-e.road.width/2));
      const entryClearance=Math.min(...entries.map(e=>buSegmentProjection(px,pz,e.a,e.b).distance-e.halfWidth));
      const amount=Math.max(0,Math.min(1,(clearance-1.8)/1.2,(entryClearance-.35)/1.2));raised||=amount>0;
      const top=.053+.097*amount,bottom=.025,lx=px-c*.11,lz=pz+s*.11,rx=px+c*.11,rz=pz-s*.11,ly=buElevation(lx,lz),ry=buElevation(rx,rz);
      return [[lx,ly+bottom,lz],[rx,ry+bottom,rz],[lx,ly+top,lz],[rx,ry+top,rz]];
    };
    const quad=(a:number[],b:number[],c:number[],d:number[])=>vertices.push(...a,...b,...c,...a,...c,...d);
    let a=section(-length/2);
    for(const d of [...cuts].sort((a,b)=>a-b).slice(1)){
      const b=section(d);
      quad(a[2],b[2],b[3],a[3]);quad(a[0],b[0],b[2],a[2]);quad(a[3],b[3],b[1],a[1]);a=b;
    }
    if(!raised)return;
    // No invisible underside or repeated end caps between adjacent segments.
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();append('curb',g,false,x,z);
  };
  const bridgeNodeDegree=new Map<string,{point:WorldPoint;degree:number}>();
  for(const {a,b,road} of BU_ROAD_EDGES)if(road.kind==='bridge')for(const point of [a,b]){const key=point.join(':'),node=bridgeNodeDegree.get(key)??{point,degree:0};node.degree++;bridgeNodeDegree.set(key,node);}
  const bridgeForks=[...bridgeNodeDegree.values()].filter(node=>node.degree>2).map(node=>node.point);

  for(const road of BU_CAMPUS_ROADS){
    const route=road.points[0][0]>road.points.at(-1)![0]?[...road.points].reverse():road.points;
    for(let i=1;i<route.length;i++){
      const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.02)continue;
      const nx=-dz/length,nz=dx/length,yaw=Math.atan2(dx,dz),pieces=Math.ceil(length/12),step=length/pieces;
      const avenue=road.kind==='avenue',mall=road.kind==='mall',bridge=road.kind==='bridge',sidewalk=buStreetSidewalk(road);
      for(let j=0;j<pieces;j++){
        const t=(j+.5)/pieces,x=a[0]+dx*t,z=a[1]+dz*t;
        slab('asphalt',x,z,road.width,step+.05,.045,yaw);
        const sides=avenue?[buAvenueOuterSide(x,z)]:[-1,1];
        for(const side of sides){
          const sx=x+nx*side*(road.width/2+sidewalk/2),sz=z+nz*side*(road.width/2+sidewalk/2);
          // Junctions are paved continuously; low curb gaps remain traversable.
          const half=sidewalk/2,along=(step+.06)/2;
          const corners:WorldPoint[]=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([across,forward])=>[sx+nx*across*half+dx/length*forward*along,sz+nz*across*half+dz/length*forward*along]);
          for(const points of buClipSidewalkToJunctions(corners,road.name))patch('paving',points,.105,yaw);
          const curbX=x+nx*side*(road.width/2+.1),curbZ=z+nz*side*(road.width/2+.1);
          if(!bridge){
            // Detailed walking district and its Bay State / Silber approach.
            // Restrict the extension to those source roads and the adjoining
            // Commonwealth crossing, keeping the rest of East Campus light.
            const core=curbX>=-1470&&curbX<=-910&&curbZ>=760&&curbZ<=1080;
            const eastEntry=curbX>=-940&&curbX<=-625&&curbZ>=900&&curbZ<=1130&&(
              road.name==='BAY STATE ROAD'||road.name==='SILBER WAY'||(avenue&&curbX>=-730&&curbX<=-660));
            if(core||eastEntry)curb(curbX,curbZ,step+.03,yaw,road.name);
            else if(!junction(curbX,curbZ,road.name,2.0))slab('curb',curbX,curbZ,.22,step+.03,.15,yaw);
          }
          const vergeX=x+nx*side*(road.width/2+.85),vergeZ=z+nz*side*(road.width/2+.85);
          if(avenue){
            slab('cycle',x+nx*side*(road.width/2-1.0),z+nz*side*(road.width/2-1.0),1.5,step+.02,.052,yaw);
            if(!junction(x,z,road.name,5))slab('stripe',x+nx*side*(road.width/2-1.85),z+nz*side*(road.width/2-1.85),.10,step+.02,.058,yaw);
            // The 2019 Phase 2 corridor west of BU Bridge places the cycle
            // track between parking and sidewalk. The protected buffer stops
            // at intersections; east of the bridge remains the older layout.
            if(x<-1550&&!junction(x,z,road.name,8)){
              slab('curb',x+nx*side*(road.width/2-2.1),z+nz*side*(road.width/2-2.1),.38,step*.68,.13,yaw);
              slab('stripe',x+nx*side*(road.width/2-2.48),z+nz*side*(road.width/2-2.48),.10,step+.02,.06,yaw);
            }
          }
          if(j%3===1&&length>24&&!junction(vergeX,vergeZ,road.name,8)&&!bridge&&!inBuilding(vergeX,vergeZ,4))tree(vergeX,vergeZ,j+i);
          if(j%5===2&&length>35&&!junction(vergeX,vergeZ,road.name,5)&&!bridge&&!inBuilding(vergeX,vergeZ,1.5))lamp(vergeX,vergeZ,yaw);
          if(j%9===4&&length>90&&road.name==='BAY STATE ROAD'&&!inBuilding(sx,sz,2)&&!junction(sx,sz,road.name,8))bench(sx+nx*side*.85,sz+nz*side*.85,yaw);
          if(mall&&j%5===2&&!junction(sx,sz,road.name,5)&&!inBuilding(sx,sz,1.2))bikeRack(sx+nx*side*.5,sz+nz*side*.5,yaw);
          // Concrete control joints are shaded in metre coordinates, aligned
          // with this street, rather than a second set of floating dark strips.
        }
        if(!mall&&!junction(x,z,road.name,4))slab(avenue?'stripe':'yellow',x,z,.10,Math.min(3.1,step/2),.058,yaw);
      }
      if(bridge){
        for(const side of [-1,1]){
          const ox=nx*side*(road.width/2+road.sidewalk+.2),oz=nz*side*(road.width/2+road.sidewalk+.2),count=Math.ceil(length/7);
          for(let j=0;j<count;j++){
            const t=(j+.5)/count,x=a[0]+dx*t+ox,z=a[1]+dz*t+oz,y=buElevation(x,z),len=length/count;
            // A named ramp and bridge meet at the same surveyed fork. Their
            // inner guardrails must stop before the joined pedestrian deck.
            if(junction(x,z,road.name,8)||bridgeForks.some(p=>Math.hypot(x-p[0],z-p[1])<20))continue;
            box('steel',x,z,.16,.18,len+.05,.6,yaw);box('steel',x,z,.1,.1,len+.05,1.13,yaw);
            box('steel',x,z,.13,1.18,.13,.59);barrier(x,z,len,yaw,y);
          }
        }
        // The bridge deck has visible thickness, even from the riverbank.
        const g=new BoxGeometry(road.width+road.sidewalk*2,.65,length+.1);g.rotateY(yaw);g.translate((a[0]+b[0])/2,DATUM-.32,(a[1]+b[1])/2);append('steel',drape(g),false,(a[0]+b[0])/2,(a[1]+b[1])/2);
      }
    }
  }

  // Rectangular road strips leave wedges between their outer sidewalks at a
  // bend. On land the terrain masks those gaps; over the Charles they would
  // drop the player through the bridge. Bevel joins use the two adjacent
  // surveyed directions, including a junction split into separate GIS records.
  const bridgeJoints=new Map<string,{point:WorldPoint;directions:{dx:number;dz:number;road:number;outer:number}[]}>();
  for(const road of BU_CAMPUS_ROADS.filter(road=>road.kind==='bridge'))for(let i=0;i<road.points.length;i++){
    const point=road.points[i],key=point.join(':'),joint=bridgeJoints.get(key)??{point,directions:[]};
    for(const other of [road.points[i-1],road.points[i+1]])if(other){const dx=other[0]-point[0],dz=other[1]-point[1],length=Math.hypot(dx,dz);if(length>.001)joint.directions.push({dx:dx/length,dz:dz/length,road:road.width/2,outer:road.width/2+road.sidewalk});}
    bridgeJoints.set(key,joint);
  }
  const bridgePatch=(finish:Finish,points:WorldPoint[],y:number)=>{
    const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0);if(Math.abs(area)<1e-7)return;
    const g=new ShapeGeometry(new Shape(points.map(([x,z])=>new Vector2(x,-z))));g.rotateX(-Math.PI/2);g.translate(0,DATUM+y,0);
    append(finish,drape(g),true,points[0][0],points[0][1]);
  };
  for(const {point:[x,z],directions} of bridgeJoints.values())for(let i=0;i<directions.length;i++)for(let j=i+1;j<directions.length;j++){
    const a=directions[i],b=directions[j];if(a.dx*b.dx+a.dz*b.dz>-.3)continue;
    for(const side of [-1,1]){
      const innerA:WorldPoint=[x-a.dz*a.road*side,z+a.dx*a.road*side],outerA:WorldPoint=[x-a.dz*a.outer*side,z+a.dx*a.outer*side];
      const innerB:WorldPoint=[x+b.dz*b.road*side,z-b.dx*b.road*side],outerB:WorldPoint=[x+b.dz*b.outer*side,z-b.dx*b.outer*side];
      bridgePatch('asphalt',[[x,z],innerA,innerB],.045);bridgePatch('paving',[innerA,outerA,outerB,innerB],.105);
    }
  }

  // Shared GIS-node bevels already used by the mobile bake also close
  // desktop sidewalk cracks. They are clipped outside crossing carriageways.
  for(const points of BU_SIDEWALK_JOIN_PATCHES)patch('paving',points,.105);

  // Walking routes through a field do not mean a concrete path crosses it.
  for(const [a,b] of BU_COURTYARD_PUBLIC_SEGMENTS){
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz),count=Math.ceil(length/10);
    for(let j=0;j<count;j++){const t=(j+.5)/count;slab('paving',a[0]+dx*t,a[1]+dz*t,3.2,length/count+.05,.11,yaw);}
  }

  // The current B branch has four rails and a separate median right of way.
  // Platforms use the post-2021 Amory / Babcock stops, not the retired stops.
  for(let i=1;i<BU_COMMONWEALTH_MEDIAN.length;i++){
    const a=BU_COMMONWEALTH_MEDIAN[i-1],b=BU_COMMONWEALTH_MEDIAN[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,yaw=Math.atan2(dx,dz);
    const gradeCrossing=junction(x,z,'COMMONWEALTH AVENUE',2.1);
    slab(gradeCrossing?'asphalt':'gravel',x,z,10.2,length+.03,.073,yaw);
    // Four standard-gauge rail heads sit above the sleepers, not below them.
    // Vertical sides give the track depth without adding one mesh per sleeper.
    for(const offset of [-2.45,-1.015,1.015,2.45]){
      const rx=x+nx*offset,rz=z+nz*offset;
      slab('rail',rx,rz,.09,length+.05,.192,yaw,buElevation,false);
      // Polished head, thin oxidised web and broad foot remain on the SAME
      // rail axes. The upper head stays exactly +.192m; no gauge or grade edit.
      const railSection=(finish:'rail'|'railWeb',sections:readonly (readonly [number,number,number,number])[])=>{
        const vertices:number[]=[],point=(along:number,across:number,h:number)=>{const px=rx+dx/length*along+nx*across,pz=rz+dz/length*along+nz*across;return[px,buElevation(px,pz)+h,pz];};
        // Only exposed cross-section faces: no buried bottoms/end caps, and
        // no expensive terrain clipping of six box faces per rail segment.
        for(const [u0,h0,u1,h1] of sections){const p=point(-length/2,u0,h0),q=point(length/2,u0,h0),r=point(length/2,u1,h1),s=point(-length/2,u1,h1);vertices.push(...p,...r,...q,...p,...s,...r);}
        const profile=new BufferGeometry();profile.setAttribute('position',new Float32BufferAttribute(vertices,3));profile.computeVertexNormals();append(finish,profile,false,rx,rz);
      };
      railSection('rail',[[-.0375,.168,-.0375,.192],[.0375,.192,.0375,.168]]);
      railSection('railWeb',[[-.0135,.123,-.0135,.168],[.0135,.168,.0135,.123],[-.0675,.123,-.0135,.123],[.0135,.123,.0675,.123],[-.0675,.107,-.0675,.123],[.0675,.123,.0675,.107]]);
    }
    if(!gradeCrossing)for(let d=.4;d<length;d+=.85)for(const offset of [-1.73,1.73])box('wood',a[0]+dx*d/length+nx*offset,a[1]+dz*d/length+nz*offset,2.35,.08,.22,.067,yaw);
    if(i%5===0){pole('metal',x,z,.09,6.4,3.2);box('metal',x,z,8.4,.10,.12,6.15,yaw);}
  }
  for(const station of BU_TRANSIT_PLATFORM_DETAILS){
    const {position:nearest,dx,dz,nx,nz,width,platformLength}=station,yaw=Math.atan2(dx,dz);
    for(const side of [-1,1]){
      const x=nearest[0]+nx*side*station.platformOffset,z=nearest[1]+nz*side*station.platformOffset,edge=width/2-.305;
      slab('paving',x,z,width,platformLength,.19,yaw);slab('tactile',x-nx*side*edge,z-nz*side*edge,.55,platformLength,.199,yaw);
      // Canopies, glazing, benches and signs have one runtime owner in
      // createBUTransitDetail; mobile must not overlay the former slab shelter.
      const px=x-nx*side*(width/2-.025),pz=z-nz*side*(width/2-.025);
      const fascia=new BoxGeometry(.05,.15,platformLength);fascia.rotateY(yaw);fascia.translate(px,DATUM+.115,pz);append('curb',drape(fascia),false,px,pz);
      // The platform ends taper to the median access walk. This avoids a hard
      // step and does not add collision fences to existing pedestrian routes.
      for(const end of [-1,1]){
        const ex=x+dx*end*(platformLength/2+2.5),ez=z+dz*end*(platformLength/2+2.5);
        slab('paving',ex,ez,width,5,.105,yaw,(px,pz)=>buElevation(px,pz)+.085*Math.max(0,Math.min(1,1-((px-x)*dx+(pz-z)*dz)*end/5+platformLength/10)));
      }
    }
  }

  // Crosswalks terminate at the actual carriageway sidewalks, including lowered
  // curb sections. Cross-street centres come from MassGIS, not guessed plazas.
  const crossings=new Set<string>();
  for(const {a,b,road} of BU_ROAD_EDGES){
    if(road.kind==='avenue'||road.kind==='bridge'||road.name==='BAY STATE ROAD')continue;
    for(const p of [a,b]){
      const avenue=BU_ROAD_EDGES.filter(e=>e.road.kind==='avenue').map(e=>({...e,...buSegmentProjection(p[0],p[1],e.a,e.b)})).sort((a,b)=>a.distance-b.distance)[0];
      if(!avenue||avenue.distance>12)continue;
      const key=`${Math.round(p[0]/14)}:${Math.round(p[1]/14)}`;if(crossings.has(key))continue;crossings.add(key);
      const dx=avenue.b[0]-avenue.a[0],dz=avenue.b[1]-avenue.a[1],length=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz);
      for(let k=-5;k<=5;k++){const x=avenue.point[0]+avenue.nx*k*.85,z=avenue.point[1]+avenue.nz*k*.85;slab('stripe',x,z,.44,4.2,.064,yaw);}
    }
  }

  // Mass Pike remains a depressed, fenced traffic corridor. Only the actual
  // street bridges above it belong to the walkable network.
  for(const road of BU_EXPRESSWAY_SEGMENTS)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length,yaw=Math.atan2(dx,dz),count=Math.ceil(length/10);
    for(let j=0;j<count;j++){
      const t=(j+.5)/count,x=a[0]+dx*t,z=a[1]+dz*t;
      slab('asphalt',x,z,road.width,length/count+.08,.04,yaw,expresswayHeight,false);
      for(const offset of [-2,2])slab('stripe',x+nx*offset,z+nz*offset,.11,3,.055,yaw,expresswayHeight,false);
      for(const side of [-1,1]){
        const gx=x+nx*side*(road.width/2+3.8),gz=z+nz*side*(road.width/2+3.8);
        // Include the half-length of this barrier, so a diagonally oriented
        // guardrail end cannot intrude into the St Mary's bridge sidewalk.
        if(buCrossesExpressway(gx,gz,7)||inBuilding(gx,gz,1)||buExpresswayDistance(gx,gz)<.8)continue;
        const base=buElevation(gx,gz);box('curb',gx,gz,.38,3.4,length/count+.04,-1.65,yaw,base);box('metal',gx,gz,.12,.15,length/count+.04,.83,yaw,base);
        box('metal',gx,gz,.10,1.0,.10,.5,0,base);barrier(gx,gz,length/count,yaw,base);
      }
    }
  }

  // Steel truss side frames make the BU crossing legible from both banks.
  const bridges=BU_ROAD_EDGES.filter(e=>e.road.kind==='bridge');
  const bridgePoint=(z:number)=>{
    const edge=bridges.find(({a,b})=>z>=Math.min(a[1],b[1])&&z<=Math.max(a[1],b[1]));if(!edge)return null;
    const t=(z-edge.a[1])/(edge.b[1]-edge.a[1]);return[edge.a[0]+(edge.b[0]-edge.a[0])*t,z] as WorldPoint;
  };
  const up=new Vector3(0,1,0),rotation=new Quaternion(),matrix=new Matrix4();
  const beam=(a:Vector3,b:Vector3,width:number)=>{const delta=b.clone().sub(a),g=new BoxGeometry(width,delta.length(),width);rotation.setFromUnitVectors(up,delta.normalize());matrix.compose(a.clone().add(b).multiplyScalar(.5),rotation,new Vector3(1,1,1));g.applyMatrix4(matrix);append('steel',g,false,(a.x+b.x)/2,(a.z+b.z)/2);};
  for(const side of [-1,1])for(let z=625;z<835;z+=15){
    const a=bridgePoint(z),b=bridgePoint(z+15);if(!a||!b)continue;
    const xa=a[0]+side*10.1,xb=b[0]+side*10.1,ya=buElevation(...a),yb=buElevation(...b),height=4.6;
    beam(new Vector3(xa,ya+.3,z),new Vector3(xa,ya+height,z),.25);
    beam(new Vector3(xa,ya+height,z),new Vector3(xb,yb+height,z+15),.30);
    beam(new Vector3(xa,ya+.3,z),new Vector3(xb,yb+height,z+15),.19);
    if(z%45===40)box('curb',a[0],z,20,4.4,3.2,-2.2,0,ya);
  }

  for(const batch of batches.values()){
    const geometry=mergeGeometries(batch.parts);batch.parts.forEach(p=>p.dispose());if(!geometry)throw new Error(`Cannot merge BU street ${batch.finish}`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();const mesh=new Mesh(geometry,materials[batch.finish]);mesh.name=`BU street ${batch.surface?'ground':'detail'} ${batch.finish}`;mesh.receiveShadow=true;
    mesh.castShadow=['metal','steel','wood'].includes(batch.finish)&&!batch.surface;group.add(mesh);allMeshes.push(mesh);if(batch.surface)ground.push(mesh);else detailMeshes.push(mesh);
  }
  const westTerrace=createBUWestTerrace();group.add(westTerrace.group);ground.push(...westTerrace.ground);walls.push(...westTerrace.walls);
  group.updateMatrixWorld(true);group.userData.stats={roadSegments:BU_CAMPUS_ROADS.length,walkRoutes:BU_CAMPUS_ROADS.length,trees:trees.length,streetMeshes:allMeshes.length,frontagePatches:BU_PUBLIC_FRONTAGES.length,frontageArea:Math.round(BU_PUBLIC_FRONTAGES.reduce((sum,p)=>sum+p.area,0)),transitPlatforms:BU_TRANSIT_PLATFORM_DETAILS.length*2};
  return {group,ground,walls,trees,lawns,setQuality:(low:boolean)=>{westTerrace.setQuality(low);for(const mesh of allMeshes){mesh.receiveShadow=!low;if(['metal','wood'].some(name=>mesh.name.endsWith(name)))mesh.castShadow=!low;}for(const mesh of detailMeshes)if(mesh.name.endsWith('joint'))mesh.visible=!low;}};
}
