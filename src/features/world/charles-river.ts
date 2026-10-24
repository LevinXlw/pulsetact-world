import {BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Shape, ShapeGeometry, Vector2, Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {CampusCollision} from '../real-campus/campus-collision';
import {createCampusSurface} from './painterly-surfaces';
import {createCharlesWaterMaterial} from './charles-water';
import {BU_TERRAIN_BOUNDS,buElevation,drapeBUGeometry} from './bu-terrain';
import {buExpresswayDrop} from './bu-campus-layout';
import {configureBUGroundLayer} from './bu-ground-layers';
import {BU_FOOTBRIDGE, HARVARD_BRIDGE, NORTH_BANK, SOUTH_BANK, SOUTH_RIVER_WALK, RIVER_WALK_ROUTE, WORLD_BOUNDS, distanceToSegment, type WorldPoint} from './charles-geography';
import {BU_CORE_STORROW_ROADS,BU_RIVER_FOOTBRIDGES,BU_SILBER_RIVER_LINK,buFootbridgeHeights,buRiverWalkHeight,buStorrowContains} from './bu-river-core-layout';

const WATER_Y=.24, SOUTH_Y=5.2;
type Category='paving'|'asphalt'|'grass'|'stone'|'rail'|'timber'|'sail'|'boat'|'stripe'|'bridgeSteel'|'wetStone'|'lampGlass';
type Piece={geometry:BufferGeometry; category:Category; ground?:boolean};
const UP=new Vector3(0,1,0);
const distance=(a:WorldPoint,b:WorldPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

function flatPolygon(points:WorldPoint[], y:number) {
  const shape=new Shape(points.map(([x,z])=>new Vector2(x,-z)));
  const geometry=new ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);geometry.translate(0,y,0);
  return geometry;
}

// Clip a flat land polygon outside the original 840 m MIT terrain tile.
// This keeps the surveyed courtyard terrain and riverfront elevations intact.
function clip(points:WorldPoint[], axis:0|1, value:number, lower:boolean):WorldPoint[] {
  const result:WorldPoint[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],insideA=lower?a[axis]>=value:a[axis]<=value,insideB=lower?b[axis]>=value:b[axis]<=value;
    if(insideA)result.push(a);
    if(insideA!==insideB){const t=(value-a[axis])/(b[axis]-a[axis]);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
  }
  return result;
}

/** A continuous Charles River, full Harvard Bridge and the south-bank walk.
 * Banks are simplified from geographic references, not a new elevation survey. */
export function createCharlesRiver(collision:CampusCollision, wind:{value:number}) {
  const group=new Group();group.name='Charles River · Cambridge to Boston';
  const ground:Mesh[]=[],walls:Mesh[]=[],pieces:Piece[]=[],trees:{x:number;z:number;radius:number}[]=[];
  const matrix=new Matrix4(),rotation=new Quaternion();
  const put=(geometry:BufferGeometry,category:Category,isGround=false)=>pieces.push({geometry,category,ground:isGround});
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,category:Category,yaw=0,isGround=false)=>{
    const geometry=new BoxGeometry(w,h,d);geometry.rotateY(yaw);geometry.translate(x,y,z);put(geometry,category,isGround);
  };
  const beam=(a:Vector3,b:Vector3,width:number,depth:number,category:Category)=>{
    const delta=b.clone().sub(a),geometry=new BoxGeometry(width,delta.length(),depth);
    rotation.setFromUnitVectors(UP,delta.normalize());matrix.compose(a.clone().add(b).multiplyScalar(.5),rotation,new Vector3(1,1,1));
    geometry.applyMatrix4(matrix);put(geometry,category);
  };
  const cylinder=(x:number,y:number,z:number,radius:number,height:number,category:Category,top=radius)=>{
    const geometry=new CylinderGeometry(top,radius,height,8);geometry.translate(x,y,z);put(geometry,category);
  };
  // Vertical faces below existing walking surfaces add thickness without
  // changing the ground mesh or the tested movement/collision contract.
  const skirt=(points:WorldPoint[],height:(x:number,z:number)=>number,depth:number,category:Category)=>{
    const p:number[]=[];
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],count=Math.ceil(distance(a,b)/5);
      for(let j=0;j<count;j++){
        const t0=j/count,t1=(j+1)/count;
        const x0=a[0]+(b[0]-a[0])*t0,z0=a[1]+(b[1]-a[1])*t0,y0=height(x0,z0);
        const x1=a[0]+(b[0]-a[0])*t1,z1=a[1]+(b[1]-a[1])*t1,y1=height(x1,z1);
        p.push(x0,y0,z0,x1,y1,z1,x0,y0-depth,z0,x0,y0-depth,z0,x1,y1,z1,x1,y1-depth,z1);
      }
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(p,3));geometry.computeVertexNormals();put(geometry,category);
  };
  const lamp=(x:number,y:number,z:number,height=4.2)=>{
    cylinder(x,y+.14,z,.18,.28,'rail',.14);
    cylinder(x,y+height/2,z,.065,height,'rail',.045);
    cylinder(x,y+height+.19,z,.18,.38,'lampGlass',.21);
    cylinder(x,y+height+.41,z,.29,.10,'rail',.06);
    cylinder(x,y+height-.025,z,.23,.09,'rail');
  };
  const collider=(a:WorldPoint,b:WorldPoint,y:number,height=1.35,width=.3)=>{
    const length=distance(a,b),mesh=new Mesh(new BoxGeometry(width,height,length),new MeshBasicMaterial());
    mesh.position.set((a[0]+b[0])/2,y+height/2,(a[1]+b[1])/2);mesh.rotation.y=Math.atan2(b[0]-a[0],b[1]-a[1]);
    mesh.visible=false;mesh.name='River edge guard';mesh.geometry.computeBoundingBox();group.add(mesh);walls.push(mesh);
  };
  const ribbon=(points:WorldPoint[],width:number,height:(x:number,z:number)=>number,category:Category,isGround=true)=>{
    const p:number[]=[],uv:number[]=[];
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],length=distance(a,b),nx=(b[1]-a[1])/length,nz=-(b[0]-a[0])/length;
      const count=Math.ceil(length/5);
      for(let j=0;j<count;j++)for(const [t,side] of [[j/count,-1],[(j+1)/count,-1],[j/count,1],[j/count,1],[(j+1)/count,-1],[(j+1)/count,1]]){
        const x=a[0]+(b[0]-a[0])*t+nx*side*width/2,z=a[1]+(b[1]-a[1])*t+nz*side*width/2;
        p.push(x,height(x,z),z);uv.push(x/4,z/4);
      }
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(p,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeVertexNormals();put(geometry,category,isGround);
  };
  const northLand=[...NORTH_BANK,[WORLD_BOUNDS.maxX,WORLD_BOUNDS.minZ],[WORLD_BOUNDS.minX,WORLD_BOUNDS.minZ]] as WorldPoint[];
  const outside=[clip(northLand,0,-420,false),clip(northLand,0,420,true),
    clip(clip(clip(northLand,0,-420,true),0,420,false),1,-420,false),clip(clip(clip(northLand,0,-420,true),0,420,false),1,420,true)];
  for(const polygon of outside)if(polygon.length>2)put(flatPolygon(polygon,2.8),'grass',true);
  const southOutline:WorldPoint[]=[...SOUTH_BANK,[WORLD_BOUNDS.maxX,WORLD_BOUNDS.maxZ],[WORLD_BOUNDS.minX,WORLD_BOUNDS.maxZ],[WORLD_BOUNDS.minX,WORLD_BOUNDS.minZ]];
  // Tile before clipping to the terrain lattice. A kilometre-wide concave
  // polygon creates long, thin triangles and wastes millions of grid clips.
  for(let x=WORLD_BOUNDS.minX;x<WORLD_BOUNDS.maxX;x+=240)for(let z=WORLD_BOUNDS.minZ;z<WORLD_BOUNDS.maxZ;z+=240){
    const polygon=clip(clip(clip(clip(southOutline,0,x,true),0,Math.min(x+240,WORLD_BOUNDS.maxX),false),1,z,true),1,Math.min(z+240,WORLD_BOUNDS.maxZ),false);
    if(polygon.length<3)continue;const flat=flatPolygon(polygon,SOUTH_Y);
    if(x+240>=BU_TERRAIN_BOUNDS.minX&&x<BU_TERRAIN_BOUNDS.maxX&&z+240>=BU_TERRAIN_BOUNDS.minZ){put(drapeBUGeometry(flat,24,(px,pz)=>buElevation(px,pz)+buExpresswayDrop(px,pz)),'grass',true);flat.dispose();}
    else put(flat,'grass',true);
  }

  const waterMaterial=createCharlesWaterMaterial(wind);
  const water=new Mesh(flatPolygon([...NORTH_BANK,...[...SOUTH_BANK].reverse()],WATER_Y),waterMaterial);
  water.name='Charles River water';water.receiveShadow=true;water.renderOrder=0;group.add(water);

  // Embankments give the water a continuous edge rather than a floating plane.
  for(const [bank,south] of [[NORTH_BANK,false],[SOUTH_BANK,true]] as const){
    for(let i=0;i<bank.length-1;i++){
      const a=bank[i],b=bank[i+1],length=distance(a,b),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
      if(south&&a[0]>=-1593&&b[0]<=-600){
        // The measured bank/DEM replaces the former continuous 5.2 m sea wall.
        // Short wall panels retain the actual shore elevation along the bend.
        const count=Math.ceil(length/8);
        for(let j=0;j<count;j++){
          const p:WorldPoint=[a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count],q:WorldPoint=[a[0]+(b[0]-a[0])*(j+1)/count,a[1]+(b[1]-a[1])*(j+1)/count];
          const h=(x:number,z:number)=>Math.max(.55,buElevation(x,z));
          skirt([p,q],h,Math.max(h(...p),h(...q))+.2,'wetStone');
          ribbon([p,q],.48,(x,z)=>h(x,z)+.035,'stone',false);
        }continue;
      }
      const top=south?SOUTH_Y:Math.max(2.8,Math.min(4.3,collision.groundHeight((a[0]+b[0])/2,(a[1]+b[1])/2)??2.8));
      box((a[0]+b[0])/2,top/2,(a[1]+b[1])/2,1.1,top,length,'stone',yaw);
      box((a[0]+b[0])/2,top+.04,(a[1]+b[1])/2,1.3,.15,length,'stone',yaw);
      // A dark wet course and a projecting waterline footing ground the wall.
      box((a[0]+b[0])/2,.56,(a[1]+b[1])/2,1.46,.65,length,'wetStone',yaw);
      box((a[0]+b[0])/2,top-.24,(a[1]+b[1])/2,1.20,.20,length,'stone',yaw);
      if(south&&a[0]>-1510&&b[0]<400){
        const nx=-(b[1]-a[1])/length,nz=(b[0]-a[0])/length;
        // Low-poly riprap only at the water's edge, with irregular spacing;
        // no walkable ground or wall proxies are added for these submerged rocks.
        for(let d=11;d<length;d+=27){
          const t=d/length,phase=i*5.13+d*.21;
          for(let k=0;k<2;k++){
            const offset=1.0+k*.78+.22*Math.sin(phase);
            const rock=new IcosahedronGeometry(.55+.16*Math.sin(phase+k*2.1),0);
            rock.scale(1.3,.56,1.0);rock.rotateY(phase+k);
            rock.translate(a[0]+(b[0]-a[0])*t-nx*offset+k*.7,.35,a[1]+(b[1]-a[1])*t-nz*offset);
            put(rock,'wetStone');
          }
        }
      }
    }
  }
  const [north,south]=HARVARD_BRIDGE,bridgeLength=distance(north,south);
  const bx=(south[0]-north[0])/bridgeLength,bz=(south[1]-north[1])/bridgeLength;
  const bridgeProgress=(x:number,z:number)=>Math.max(0,Math.min(1,((x-north[0])*bx+(z-north[1])*bz)/bridgeLength));
  const bridgeHeight=(x:number,z:number)=>{const t=bridgeProgress(x,z);return 4.23+(SOUTH_Y-4.23)*t+3.4*Math.sin(t*Math.PI);};
  const bridgeSide=(t:number,side:number):WorldPoint=>[north[0]+(south[0]-north[0])*t+bz*side,north[1]+(south[1]-north[1])*t-bx*side];
  ribbon([north,south],18.4,bridgeHeight,'asphalt');
  // The roadway is carried by a visible steel deck, not a floating ribbon.
  ribbon([north,south],18.4,(x,z)=>bridgeHeight(x,z)-.78,'bridgeSteel',false);
  for(const side of [-1,1]){
    const edge=[bridgeSide(0,side*9.2),bridgeSide(1,side*9.2)];
    skirt(edge,(x,z)=>bridgeHeight(x,z)+.07,.88,'bridgeSteel');
    ribbon(edge,.30,(x,z)=>bridgeHeight(x,z)+.075,'stone',false);
    const girder=[bridgeSide(0,side*6.2),bridgeSide(1,side*6.2)];
    skirt(girder,(x,z)=>bridgeHeight(x,z)-.74,.75,'bridgeSteel');
    ribbon(girder,.32,(x,z)=>bridgeHeight(x,z)-1.49,'bridgeSteel',false);
  }
  for(const side of [-1,1]){
    const path=[bridgeSide(0,side*7.55),bridgeSide(1,side*7.55)];ribbon(path,3.0,(x,z)=>bridgeHeight(x,z)+.08,'paving');
    for(let d=0;d<bridgeLength;d+=8){
      const a=bridgeSide(d/bridgeLength,side*9),b=bridgeSide(Math.min(1,(d+8)/bridgeLength),side*9),ya=bridgeHeight(...a),yb=bridgeHeight(...b);
      // Open the west railing only at the authored south-bank access ramp.
      // Otherwise the relocated promenade would end behind an unbroken rail.
      if(side===-1&&distance([(a[0]+b[0])/2,(a[1]+b[1])/2],SOUTH_RIVER_WALK[2])<8)continue;
      for(const h of [.58,1.15])beam(new Vector3(a[0],ya+h,a[1]),new Vector3(b[0],yb+h,b[1]),.07,.07,'rail');
      box(a[0],ya+.6,a[1],.085,1.2,.085,'rail');collider(a,b,Math.min(ya,yb),1.35);
      for(let inset=1.6;inset<8&&d+inset<bridgeLength;inset+=1.6){
        const p=bridgeSide((d+inset)/bridgeLength,side*9);box(p[0],bridgeHeight(...p)+.6,p[1],.035,1.08,.035,'rail');
      }
    }
    for(let d=28;d<bridgeLength-20;d+=65){const p=bridgeSide(d/bridgeLength,side*8.7);lamp(p[0],bridgeHeight(...p)+.08,p[1],5.0);}
  }
  for(let d=35;d<bridgeLength-20;d+=72){
    const p=bridgeSide(d/bridgeLength,0),h=bridgeHeight(...p),yaw=Math.atan2(bx,bz);
    box(p[0],.55,p[1],16.2,.90,4.5,'wetStone',yaw);
    box(p[0],(h-.75)/2,p[1],14.4,h-.75,3.1,'stone',yaw);
    box(p[0],h-1.08,p[1],16.0,.62,4.0,'stone',yaw);
    // Rounded cutwaters soften the support silhouette against the water.
    for(const side of [-1,1]){
      const end=bridgeSide(d/bridgeLength,side*6.8);
      cylinder(end[0],(h-.85)/2,end[1],1.58,h-.85,'stone',1.45);
    }
  }
  for(let d=18;d<bridgeLength-8;d+=24){
    const a=bridgeSide(d/bridgeLength,-8.9),b=bridgeSide(d/bridgeLength,8.9),h=bridgeHeight(...a)-1.08;
    beam(new Vector3(a[0],h,a[1]),new Vector3(b[0],h,b[1]),.16,.34,'bridgeSteel');
  }
  for(let d=8;d<bridgeLength-8;d+=12){const p=bridgeSide(d/bridgeLength,0);box(p[0],bridgeHeight(...p)+.025,p[1],.12,.018,4,'stripe',Math.atan2(bx,bz));}
  // The new river-side turn crosses the exact terminal edge of the bridge.
  // Overlap both walking strips so Float32 edge rounding cannot expose the
  // lower Boston terrain between the asphalt deck and the west sidewalk.
  ribbon([south,SOUTH_RIVER_WALK[1]],3.0,(x,z)=>bridgeHeight(x,z)+.08,'paving');
  for(const p of [south,SOUTH_RIVER_WALK[1]])box(p[0],bridgeHeight(...p)+.04,p[1],3,.08,3,'paving',0,true);

  const nearBridge=(p:WorldPoint)=>{
    const t=((p[0]-north[0])*bx+(p[1]-north[1])*bz)/bridgeLength;
    return t>=-.015&&t<=1.015&&Math.abs((p[0]-north[0])*bz-(p[1]-north[1])*bx)<12;
  };
  // Use the surveyed ground along MIT's waterfront, then bridge across the
  // old road underpass with a continuous ramp to the Harvard Bridge landing.
  // Sampling that lower road directly would send walkers beneath the bridge.
  const routeHeight=(x:number,z:number)=>{
    if(nearBridge([x,z]))return bridgeHeight(x,z)+.095;
    if(x<-430||z>=700)return buRiverWalkHeight(x,z,buElevation);
    return (collision.groundHeight(x,z)??4.23)+.035;
  };
  for(let i=0;i<RIVER_WALK_ROUTE.length-1;i++){
    let a=RIVER_WALK_ROUTE[i];const b=RIVER_WALK_ROUTE[i+1];
    if(nearBridge(a)&&nearBridge(b))continue;
    if(BU_FOOTBRIDGE.some((p,j)=>j<BU_FOOTBRIDGE.length-1&&distance(p,a)<.01&&distance(BU_FOOTBRIDGE[j+1],b)<.01))continue;
    // Inside Killian Court the existing paths are the authoritative surface.
    if(Math.max(a[1],b[1])<120)continue;
    if(a[1]<120){const t=(120-a[1])/(b[1]-a[1]);a=[a[0]+(b[0]-a[0])*t,120];}
    if(nearBridge(a)&&!nearBridge(b)&&a[1]>600){
      const start=bridgeHeight(...a)+.095,end=buRiverWalkHeight(...b,buElevation),length=distance(a,b);
      ribbon([a,b],6.2,(x,z)=>{
        const t=Math.max(0,Math.min(1,((x-a[0])*(b[0]-a[0])+(z-a[1])*(b[1]-a[1]))/(length*length)));
        return start+(end-start)*t;
      },'paving');
    }else if(i===3||i===4){
      const start=i===3?routeHeight(...a):4.325,end=4.325,length=distance(a,b);
      ribbon([a,b],6.2,(x,z)=>{
        const t=Math.max(0,Math.min(1,((x-a[0])*(b[0]-a[0])+(z-a[1])*(b[1]-a[1]))/(length*length)));
        return start+(end-start)*t;
      },'paving');
    }else ribbon([a,b],6.2,routeHeight,'paving');
  }

  // Both BU-published river access points cross above Storrow. Ramp stations
  // are authored; endpoints follow DEM and the central deck stays independent.
  ribbon(BU_SILBER_RIVER_LINK,3.0,(x,z)=>buRiverWalkHeight(x,z,buElevation),'paving');
  for(const footbridge of BU_RIVER_FOOTBRIDGES){
  const points=footbridge.points,width=footbridge.width,footHeights=buFootbridgeHeights(points,buElevation);
  // Small draped end landings overlap the adjoining route, avoiding floating-
  // point cracks at the terminal cross-section of a narrow ribbon.
  for(const p of [points[0],points.at(-1)!]){
    const half=width/2,flat=flatPolygon([[p[0]-half,p[1]-half],[p[0]+half,p[1]-half],[p[0]+half,p[1]+half],[p[0]-half,p[1]+half]],SOUTH_Y);
    put(drapeBUGeometry(flat,3,(x,z)=>buRiverWalkHeight(x,z,buElevation)),'paving',true);flat.dispose();
  }
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],length=distance(a,b),nx=(b[1]-a[1])/length,nz=-(b[0]-a[0])/length;
    const h=(x:number,z:number)=>{const t=Math.max(0,Math.min(1,((x-a[0])*(b[0]-a[0])+(z-a[1])*(b[1]-a[1]))/(length*length)));return footHeights[i]+(footHeights[i+1]-footHeights[i])*t;};
    // Only the first three legs are raised ramps/deck. The last legs follow
    // ground continuously; straight interpolation would float over new slopes.
    const surface=i>=3?(x:number,z:number)=>buRiverWalkHeight(x,z,buElevation):h;
    ribbon([a,b],width,surface,'paving');
    if(i>0&&i<4)box(a[0],footHeights[i]-.04,a[1],width,.08,width,'paving',0,true);
    if(i>=3)continue;
    for(const side of [-1,1]){
      const edge:WorldPoint[]=[[a[0]+nx*width/2*side,a[1]+nz*width/2*side],[b[0]+nx*width/2*side,b[1]+nz*width/2*side]];
      skirt(edge,h,.32,'bridgeSteel');
    }
    ribbon([a,b],width,(x,z)=>h(x,z)-.32,'bridgeSteel',false);
    for(const side of [-1,1])for(let d=0;d<length;d+=3){
      const t=d/length,end=Math.min(1,(d+3)/length);
      const start:WorldPoint=[a[0]+(b[0]-a[0])*t+nx*(width/2-.05)*side,a[1]+(b[1]-a[1])*t+nz*(width/2-.05)*side];
      const finish:WorldPoint=[a[0]+(b[0]-a[0])*end+nx*(width/2-.05)*side,a[1]+(b[1]-a[1])*end+nz*(width/2-.05)*side];
      const y0=h(...start),y1=h(...finish);
      beam(new Vector3(start[0],y0+1.1,start[1]),new Vector3(finish[0],y1+1.1,finish[1]),.07,.07,'rail');
      box(start[0],y0+.55,start[1],.07,1.1,.07,'rail');
      // Leave the final two metres clear at turns to connect ramp landings.
      if(d>2&&d+3<length-2)collider(start,finish,Math.min(y0,y1),1.3,.12);
    }
    if(i>0){const base=buElevation(...a);box(a[0],(footHeights[i]+base)/2,a[1],.65,footHeights[i]-base,.65,'stone');}
  }
  }

  // Independent GIS carriageways retain real separation and the Bay State exit.
  // Asphalt and safety barriers follow DEM; neither can flatten bridge decks.
  for(const road of BU_CORE_STORROW_ROADS){
    const height=(x:number,z:number)=>buElevation(x,z)+.045;
    ribbon(road.points,road.width,height,'asphalt');
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],length=distance(a,b),tx=(b[0]-a[0])/length,tz=(b[1]-a[1])/length;
      if(road.lanes>1)for(let d=2;d<length-2;d+=12){
        const p:WorldPoint=[a[0]+tx*d,a[1]+tz*d],q:WorldPoint=[a[0]+tx*Math.min(d+4,length),a[1]+tz*Math.min(d+4,length)];
        ribbon([p,q],.12,(x,z)=>height(x,z)+.016,'stripe',false);
      }
      for(const side of [-1,1]){
        const offset=side*(road.width/2-.2),edge:WorldPoint[]=[[a[0]-tz*offset,a[1]+tx*offset],[b[0]-tz*offset,b[1]+tx*offset]];
        ribbon(edge,.12,(x,z)=>height(x,z)+.016,'stripe',false);
        // The eastern continuation retains GIS asphalt/paint only. Repeating
        // hundreds of rail/post/collision boxes here would inflate mobile GLB.
        if(road.ramp||Math.min(a[0],b[0])>=-600)continue;
        for(let d=0;d<length;d+=8){
          const out=side*(road.width/2+.25),p:WorldPoint=[a[0]+tx*d-tz*out,a[1]+tz*d+tx*out],q:WorldPoint=[a[0]+tx*Math.min(d+8,length)-tz*out,a[1]+tz*Math.min(d+8,length)+tx*out];
          if(Math.max(p[0],q[0])>-600)continue;
          const y0=height(...p),y1=height(...q);
          beam(new Vector3(p[0],y0+.62,p[1]),new Vector3(q[0],y1+.62,q[1]),.15,.22,'rail');
          box(p[0],y0+.34,p[1],.07,.68,.07,'rail');
          // Raised bridge traffic passes above; avoid a collider under its low
          // ramp foot where a terrain-following walker legitimately enters.
          if(!BU_RIVER_FOOTBRIDGES.some(f=>f.points.some((v,j)=>j>0&&distanceToSegment(...p,f.points[j-1],v)<2.8)))collider(p,q,Math.min(y0,y1),.85,.16);
        }
      }
    }
  }

  // A narrow border gives the promenade a readable edge at eye level. Both
  // edges remain visual-only and flush with the current 6.2 m route surface.
  for(let i=3;i<SOUTH_RIVER_WALK.length-1;i++){
    const a=SOUTH_RIVER_WALK[i],b=SOUTH_RIVER_WALK[i+1],length=distance(a,b),tx=(b[0]-a[0])/length,tz=(b[1]-a[1])/length;
    for(const side of [-1,1]){
      const edge:WorldPoint[]=[[a[0]-tz*3.12*side,a[1]+tx*3.12*side],[b[0]-tz*3.12*side,b[1]+tx*3.12*side]];
      ribbon(edge,.22,(x,z)=>routeHeight(x,z)+.003,'stone',false);
    }
    if(b[0]<-990)continue;
    for(let d=62;d<length-28;d+=112){
      const t=d/length,x=a[0]+(b[0]-a[0])*t-tz*8.6,z=a[1]+(b[1]-a[1])*t+tx*8.6;
      // Furniture stays beyond every walking corridor, including bends.
      if(RIVER_WALK_ROUTE.some((p,j)=>j>0&&distanceToSegment(x,z,RIVER_WALK_ROUTE[j-1],p)<8.0))continue;
      if(buStorrowContains(x,z,3))continue;
      const yaw=-Math.atan2(tz,tx),y=routeHeight(x,z);
      const localBox=(along:number,up:number,across:number,w:number,h:number,depth:number,category:Category)=>
        box(x+tx*along-tz*across,y+up,z+tz*along+tx*across,w,h,depth,category,yaw);
      for(const across of [-.20,-.065,.065,.20])localBox(0,.48,across,2.3,.07,.10,'timber');
      for(const up of [.70,.87])localBox(0,up,-.28,2.3,.12,.065,'timber');
      for(const along of [-.82,.82]){
        localBox(along,.26,0,.07,.46,.48,'rail');
        localBox(along,.69,-.28,.055,.55,.055,'rail');
        localBox(along,.69,0,.055,.045,.59,'rail');
      }
      lamp(x+tx*3.1,y,z+tz*3.1);
    }
  }

  // Landward trees on the promenade, spaced clear of the playable walking line.
  const southTrees=SOUTH_BANK.filter(p=>p[0]>-1510&&p[0]<80);
  for(let i=0;i<southTrees.length-1;i++){
    const a=southTrees[i],b=southTrees[i+1],count=Math.max(1,Math.floor(distance(a,b)/32));
    for(let j=0;j<count;j++){
      const t=(j+.5)/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t+26;
      if(!buStorrowContains(x,z,4)&&[RIVER_WALK_ROUTE,BU_SILBER_RIVER_LINK,...BU_RIVER_FOOTBRIDGES.map(f=>f.points)].every(route=>route.every((p,j)=>!j||distanceToSegment(x,z,route[j-1],p)>4)))trees.push({x,z,radius:.42});
    }
  }
  for(const [x,z] of [[-1208,892],[-1203,913],[-1140,892],[-1136,913],[-1255,915],[-1084,906],[-1060,925],[-1274,889]])trees.push({x,z,radius:.42});

  // Small sailing silhouettes provide scale for this broad river. They remain
  // scenery; swimming and boating are not introduced by this extension.
  const boats:WorldPoint[]=[[-235,510],[-490,590],[-710,639],[-925,685],[-50,640],[225,410]];
  boats.forEach(([x,z],i)=>{
    const yaw=.3+i*.8,length=4.6+(i%2)*1.2;
    const hull=new CylinderGeometry(1,1,1,6,1);hull.scale(.82,.28,length/2);hull.rotateY(yaw);hull.translate(x,.63,z);put(hull,'boat');
    box(x,3.65,z,.055,6.1,.055,'timber');
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([0,1,0,0,6.8,0,2.7,1.2,0],3));g.computeVertexNormals();g.rotateY(yaw);g.translate(x,.65,z);put(g,'sail');
  });

  const materials:Record<Category,MeshStandardMaterial>={
    paving:createCampusSurface('pavement',{profile:'bu',groundHeight:SOUTH_Y}) as MeshStandardMaterial,
    asphalt:createCampusSurface('road',{profile:'bu',groundHeight:SOUTH_Y}) as MeshStandardMaterial,
    grass:createCampusSurface('grass',{profile:'bu',groundHeight:SOUTH_Y}) as MeshStandardMaterial,
    stone:createCampusSurface('courtyardPlinth') as MeshStandardMaterial,
    rail:new MeshStandardMaterial({color:'#3f5b56',roughness:.7,metalness:.25}),
    timber:new MeshStandardMaterial({color:'#927650',roughness:1}),
    sail:new MeshStandardMaterial({color:'#f0ead2',roughness:1,side:DoubleSide}),
    boat:new MeshStandardMaterial({color:'#c7d8cf',roughness:.7}),
    stripe:new MeshStandardMaterial({color:'#e5d6a4',roughness:1}),
    bridgeSteel:new MeshStandardMaterial({color:'#718279',roughness:.86,metalness:.15,side:DoubleSide}),
    wetStone:new MeshStandardMaterial({color:'#687d75',roughness:.94}),
    lampGlass:new MeshStandardMaterial({color:'#e6e2c6',roughness:.65,emissive:'#d9cba2',emissiveIntensity:.12}),
  };
  for(const category of Object.keys(materials) as Category[])configureBUGroundLayer(materials[category],category==='grass'?'terrain':category==='stripe'?'marking':'surface');
  // The surface shader reads vertex colours on grass; all land begins white.
  for(const piece of pieces){
    const g=piece.geometry.index?piece.geometry.toNonIndexed():piece.geometry;
    if(g!==piece.geometry){piece.geometry.dispose();piece.geometry=g;}
    if(!g.getAttribute('uv'))g.setAttribute('uv',new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2));
    if(piece.category==='grass')g.setAttribute('color',new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count*3).fill(1),3));
  }
  const visible:Mesh[]=[];
  for(const category of Object.keys(materials) as Category[])for(const walkable of [false,true]){
    const matches=pieces.filter(p=>p.category===category&&!!p.ground===walkable);if(!matches.length)continue;
    const geometry=mergeGeometries(matches.map(p=>p.geometry));if(!geometry)throw new Error(`Unable to build ${category} river geometry`);
    matches.forEach(p=>p.geometry.dispose());geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,materials[category]);mesh.name=`Charles ${category}${walkable?' ground':''}`;
    mesh.castShadow=!walkable;mesh.receiveShadow=true;group.add(mesh);visible.push(mesh);if(walkable)ground.push(mesh);
  }
  group.updateMatrixWorld(true);
  const setQuality=(low:boolean)=>{visible.forEach(mesh=>{mesh.castShadow=!low&&!ground.includes(mesh);});water.receiveShadow=!low;};
  return {group,ground,walls,trees,water,setQuality};
}
