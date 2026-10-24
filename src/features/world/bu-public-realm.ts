import {BU_COMMONWEALTH_MEDIAN,BU_COURTYARD_PATHS,BU_ROAD_EDGES,BU_TRANSIT_STOPS,buAvenueOuterSide,buSegmentProjection,type BUCampusRoad} from './bu-campus-layout';
import {BU_FULL_SPACES} from './bu-full-layout';
import {BU_GROUND_BUILDINGS} from './bu-campus-footprints';
import type {WorldPoint} from './geo-coordinates';
import {buBrownstoneEntry} from './bu-brownstone-entry';

export type BUPublicFrontage={buildingId:string;roadName:string;kind:'frontage'|'entrance';points:WorldPoint[];area:number};

/** The three university-owned malls retain delivery/garage access. BU's 2024
 * review explicitly says that a permanent pedestrian-paving conversion has
 * not taken place. Keep a separate sidewalk beside their service carriageway. */
export const buStreetSidewalk=(road:BUCampusRoad)=>road.kind==='mall'?2.2:road.sidewalk;

/** Touring routes are walking permissions, not necessarily paved paths. Clip
 * their visible ribbon outside sports turf, including half the path width.
 * The route itself remains traversable across the field. Shared with mobile. */
export const BU_COURTYARD_PUBLIC_SEGMENTS:[WorldPoint,WorldPoint][]=[];
for(const path of BU_COURTYARD_PATHS)for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1];let ranges:[number,number][]=[[0,1]];
  for(const space of BU_FULL_SPACES){
    const c=Math.cos(space.yaw),s=Math.sin(space.yaw),ax=(a[0]-space.x)*c-(a[1]-space.z)*s,az=(a[0]-space.x)*s+(a[1]-space.z)*c;
    const vx=dx*c-dz*s,vz=dx*s+dz*c,wx=space.width/2+2,wz=space.depth/2+2;let lo=0,hi=1;
    for(const [p,q] of [[-vx,ax+wx],[vx,wx-ax],[-vz,az+wz],[vz,wz-az]]){
      if(Math.abs(p)<1e-9){if(q<0){lo=1;hi=0;}continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    }
    if(lo>hi)continue;
    ranges=ranges.flatMap(([start,end])=>{if(hi<=start||lo>=end)return[[start,end] as [number,number]];const parts:[number,number][]=[];if(lo>start)parts.push([start,lo]);if(hi<end)parts.push([hi,end]);return parts;});
  }
  for(const [start,end] of ranges)if((end-start)*Math.hypot(dx,dz)>.1)BU_COURTYARD_PUBLIC_SEGMENTS.push([[a[0]+dx*start,a[1]+dz*start],[a[0]+dx*end,a[1]+dz*end]]);
}

const clipHalfPlane=(points:WorldPoint[],distance:(p:WorldPoint)=>number):WorldPoint[]=>{
  const result:WorldPoint[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b),ia=da>=0,ib=db>=0;
    if(ia)result.push(a);if(ia!==ib){const t=da/(da-db);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
  }return result;
};
const junctionMasks=BU_ROAD_EDGES.map(edge=>{
  const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz),width=edge.road.width/2+.025;
  return{...edge,dx:dx/length,dz:dz/length,length,width,minX:Math.min(edge.a[0],edge.b[0])-width,maxX:Math.max(edge.a[0],edge.b[0])+width,minZ:Math.min(edge.a[1],edge.b[1])-width,maxZ:Math.max(edge.a[1],edge.b[1])+width};
});

/** Remove only the intersecting street's carriageway from sidewalk ribbons.
 * Otherwise their +0.105 m paving draws over the +0.045 m road at junctions,
 * hiding the road hierarchy and making painted crossings appear incomplete. */
export function buClipSidewalkToJunctions(points:WorldPoint[],roadName:string|readonly string[]):WorldPoint[][]{
  const ownRoads=typeof roadName==='string'?[roadName]:roadName;
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minZ=Math.min(...points.map(p=>p[1])),maxZ=Math.max(...points.map(p=>p[1]));
  let parts=[points];
  for(const mask of junctionMasks){
    if(ownRoads.includes(mask.road.name)||mask.maxX<minX||mask.minX>maxX||mask.maxZ<minZ||mask.minZ>maxZ)continue;
    const along=(p:WorldPoint)=>(p[0]-mask.a[0])*mask.dx+(p[1]-mask.a[1])*mask.dz;
    const across=(p:WorldPoint)=>-(p[0]-mask.a[0])*mask.dz+(p[1]-mask.a[1])*mask.dx;
    const planes=[(p:WorldPoint)=>along(p)+.025,(p:WorldPoint)=>mask.length+.025-along(p),(p:WorldPoint)=>across(p)+mask.width,(p:WorldPoint)=>mask.width-across(p)];
    const result:WorldPoint[][]=[];
    for(const part of parts){
      let remaining=part;
      for(const plane of planes){
        const outside=clipHalfPlane(remaining,p=>-plane(p));if(outside.length>2)result.push(outside);
        remaining=clipHalfPlane(remaining,plane);if(remaining.length<3)break;
      }
    }
    parts=result;
  }
  return parts.filter(part=>Math.abs(part.reduce((sum,p,i)=>{const q=part[(i+1)%part.length];return sum+p[0]*q[1]-p[1]*q[0];},0))>.001);
}

/** Exact bevels between the sideband edges at shared GIS nodes. Even a small
 * angle between separate Commonwealth records leaves a centimetre-wide hole
 * if each rectangular strip stops exactly at its endpoint; over the Pike that
 * exposes the depressed base terrain. Match only the sidewalks actually used
 * by each arm, so no inner-avenue paving is introduced into the rail median. */
export const BU_SIDEWALK_JOIN_PATCHES:WorldPoint[][]=[];
{
  type Arm={dx:number;dz:number;inner:number;outer:number;sides:number[];name:string};
  const nodes=new Map<string,{point:WorldPoint;arms:Arm[]}>();
  for(const edge of BU_ROAD_EDGES){
    const width=buStreetSidewalk(edge.road);if(width<=0)continue;
    const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz);if(length<.001)continue;
    const canonicalSign=dx<0?-1:1,outerSide=buAvenueOuterSide((edge.a[0]+edge.b[0])/2,(edge.a[1]+edge.b[1])/2);
    for(const [point,sign] of [[edge.a,1],[edge.b,-1]] as const){
      const key=point.join(':'),node=nodes.get(key)??{point,arms:[]};
      node.arms.push({dx:dx/length*sign,dz:dz/length*sign,inner:edge.road.width/2,outer:edge.road.width/2+width,sides:edge.road.kind==='avenue'?[outerSide*canonicalSign*sign]:[-1,1],name:edge.road.name});nodes.set(key,node);
    }
  }
  const seen=new Set<string>();
  for(const {point:[x,z],arms} of nodes.values())for(let i=0;i<arms.length;i++)for(let j=i+1;j<arms.length;j++){
    const a=arms[i],b=arms[j];if(a.dx*b.dx+a.dz*b.dz>-.3)continue;
    for(const side of a.sides){
      if(!b.sides.includes(-side))continue;
      const innerA:WorldPoint=[x-a.dz*a.inner*side,z+a.dx*a.inner*side],outerA:WorldPoint=[x-a.dz*a.outer*side,z+a.dx*a.outer*side];
      const innerB:WorldPoint=[x+b.dz*b.inner*side,z-b.dx*b.inner*side],outerB:WorldPoint=[x+b.dz*b.outer*side,z-b.dx*b.outer*side];
      for(const points of buClipSidewalkToJunctions([innerA,outerA,outerB,innerB],[a.name,b.name])){
        const key=points.map(p=>p.map(v=>v.toFixed(4)).join(',')).sort().join(':');if(seen.has(key))continue;seen.add(key);BU_SIDEWALK_JOIN_PATCHES.push(points);
      }
    }
  }
}

/** Position follows the closest point on the surveyed median, avoiding the old
 * 8 m station snapping. Shelter length follows BU's published 150-foot design
 * for the two rebuilt stations; remaining dimensions are model approximations. */
export const BU_TRANSIT_PLATFORM_DETAILS=BU_TRANSIT_STOPS.map(stop=>{
  const segments=BU_COMMONWEALTH_MEDIAN.slice(1).map((b,i)=>({a:BU_COMMONWEALTH_MEDIAN[i],b,...buSegmentProjection(...stop.position,BU_COMMONWEALTH_MEDIAN[i],b)}));
  const segment=segments.sort((a,b)=>a.distance-b.distance)[0],length=Math.hypot(segment.b[0]-segment.a[0],segment.b[1]-segment.a[1]);
  const modern=stop.name==='Amory Street'||stop.name==='Babcock Street';
  return{name:stop.name,position:segment.point,dx:(segment.b[0]-segment.a[0])/length,dz:(segment.b[1]-segment.a[1])/length,nx:segment.nx,nz:segment.nz,modern,platformLength:modern?68.58:40,canopyLength:modern?45.72:8,width:modern?2.3:1.9,platformOffset:modern?4.4:4.2};
});

function contains(x:number,z:number,ring:WorldPoint[]){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
const envelopes=BU_GROUND_BUILDINGS.map(b=>({id:b.id,ring:b.footprint,holes:b.holes??[],minX:Math.min(...b.footprint.map(p=>p[0])),maxX:Math.max(...b.footprint.map(p=>p[0])),minZ:Math.min(...b.footprint.map(p=>p[1])),maxZ:Math.max(...b.footprint.map(p=>p[1]))}));
const spatial=new Map<string,typeof envelopes>();
for(const envelope of envelopes)for(let ix=Math.floor(envelope.minX/80);ix<=Math.floor(envelope.maxX/80);ix++)for(let iz=Math.floor(envelope.minZ/80);iz<=Math.floor(envelope.maxZ/80);iz++){
  const key=`${ix}:${iz}`,list=spatial.get(key)??[];list.push(envelope);spatial.set(key,list);
}
function occupied(x:number,z:number){
  return (spatial.get(`${Math.floor(x/80)}:${Math.floor(z/80)}`)??[]).some(b=>x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ&&contains(x,z,b.ring)&&!b.holes.some(h=>contains(x,z,h)));
}
function protectedOpenSpace(x:number,z:number){
  // Sports turf, BU Beach and the Marsh forecourt retain their existing authored
  // landscape. Never blanket-fill an entire parcel or a building's rear yard.
  if(x>-1375&&x<-1040&&z<970)return true;
  return BU_FULL_SPACES.some(s=>{const dx=x-s.x,dz=z-s.z,c=Math.cos(s.yaw),sin=Math.sin(s.yaw);return Math.abs(dx*c-dz*sin)<s.width/2+3&&Math.abs(dx*sin+dz*c)<s.depth/2+3;});
}
const streetEdges=BU_ROAD_EDGES.filter(e=>e.road.kind!=='bridge');
const carriageways=streetEdges.map(e=>({...e,minX:Math.min(e.a[0],e.b[0])-e.road.width/2,maxX:Math.max(e.a[0],e.b[0])+e.road.width/2,minZ:Math.min(e.a[1],e.b[1])-e.road.width/2,maxZ:Math.max(e.a[1],e.b[1])+e.road.width/2}));
function inCarriageway(x:number,z:number){return carriageways.some(e=>x>e.minX&&x<e.maxX&&z>e.minZ&&z<e.maxZ&&buSegmentProjection(x,z,e.a,e.b).distance<e.road.width/2+.05);}
const area=(ring:WorldPoint[])=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;

/** Small infill polygons are derived from actual facade edges and the recorded
 * street's sidewalk edge. They are an authored material interpretation, not a
 * cadastral paving survey. Brownstones keep their planted front gardens and
 * receive only a narrow entrance link. No new walls/obstacles are generated.
 * Pure data is shared by desktop streets and the offline mobile bake. */
export const BU_PUBLIC_FRONTAGES:BUPublicFrontage[]=[];
for(const building of BU_GROUND_BUILDINGS){
  if(building.custom)continue;
  const residential=building.kind==='brownstone'||/BAY STATE/.test(building.address);
  const candidates:{a:WorldPoint;b:WorldPoint;edge:typeof streetEdges[number];distance:number;length:number}[]=[];
  for(let i=0;i<building.footprint.length;i++){
    const a=building.footprint[i],b=building.footprint[(i+1)%building.footprint.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    if(length<2.2)continue;
    const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    let selected:typeof candidates[number]|undefined;
    for(const edge of streetEdges){
      const p=buSegmentProjection(x,z,edge.a,edge.b),gap=p.distance-edge.road.width/2-buStreetSidewalk(edge.road);
      if(gap<.2||gap>(residential?13:19))continue;
      // A frontage faces its street, rather than stretching a side-wall wedge
      // across a corner or selecting the avenue carriageway on the far side.
      const cross=Math.abs(dx*p.nx+dz*p.nz)/length;
      if(cross>.40)continue;
      const tx=(p.point[0]-x)/p.distance,tz=(p.point[1]-z)/p.distance;
      if(occupied(x+tx*.35,z+tz*.35))continue;
      if(!selected||gap<selected.distance)selected={a,b,edge,distance:gap,length};
    }
    if(selected)candidates.push(selected);
  }
  const faces=residential?candidates.sort((a,b)=>a.distance-b.distance||b.length-a.length).slice(0,1):candidates;
  for(const face of faces){
    const dx=face.b[0]-face.a[0],dz=face.b[1]-face.a[1],count=residential?1:Math.ceil(face.length/7);
    for(let i=0;i<count;i++){
      const centre=(i+.5)/count,half=residential?Math.min(.8/face.length,.42):.5/count;
      const a:WorldPoint=[face.a[0]+dx*(centre-half),face.a[1]+dz*(centre-half)],b:WorldPoint=[face.a[0]+dx*(centre+half),face.a[1]+dz*(centre+half)];
      const project=(p:WorldPoint):WorldPoint=>{
        const q=buSegmentProjection(...p,face.edge.a,face.edge.b),sign=(p[0]-q.point[0])*q.nx+(p[1]-q.point[1])*q.nz>=0?1:-1;
        const offset=face.edge.road.width/2+buStreetSidewalk(face.edge.road)-.06;
        return[q.point[0]+q.nx*offset*sign,q.point[1]+q.nz*offset*sign];
      };
      const c=project(b),d=project(a),points:WorldPoint[]=[a,b,c,d];
      let clear=true;
      // Reject a patch that crosses another building, the same facade's bay,
      // an existing playfield, or a protected planted central-campus space.
      for(const along of [.08,.5,.92])for(const across of [.1,.5,.9]){
        const p:WorldPoint=[a[0]+(b[0]-a[0])*along,a[1]+(b[1]-a[1])*along],q:WorldPoint=[d[0]+(c[0]-d[0])*along,d[1]+(c[1]-d[1])*along];
        const x=p[0]+(q[0]-p[0])*across,z=p[1]+(q[1]-p[1])*across;
        if(occupied(x,z)||protectedOpenSpace(x,z)||inCarriageway(x,z))clear=false;
      }
      const footprintArea=area(points);
      if(clear&&footprintArea>.15&&footprintArea<145)BU_PUBLIC_FRONTAGES.push({buildingId:building.id,roadName:face.edge.road.name,kind:residential?'entrance':'frontage',points,area:footprintArea});
    }
  }
}

// Replace only an already accepted residential connection. The previous
// facade-midpoint path could miss an offset brownstone stoop by several metres.
// The same entry definition now drives the door, stairs and this narrow path;
// rejected replacements retain their original patch and cannot add a parcel.
for(const frontage of BU_PUBLIC_FRONTAGES){
  if(frontage.kind!=='entrance')continue;
  const building=BU_GROUND_BUILDINGS.find(b=>b.id===frontage.buildingId);
  if(!building||building.kind!=='brownstone')continue;
  const entry=buBrownstoneEntry(building.footprint,building.height);if(!entry)continue;
  const {front,doorX}=entry,{p,edge}=front,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
  const boundaryPoint=(offset:number):WorldPoint=>{
    const x=p.x+(doorX+offset)*c,z=p.z-(doorX+offset)*s;
    // The shared facade coalesces only sub-15 mm survey kinks. Snap the first
    // edge back to the real outline so no sliver crosses the occupied volume.
    return building.footprint.map((a,i)=>buSegmentProjection(x,z,a,building.footprint[(i+1)%building.footprint.length])).sort((a,b)=>a.distance-b.distance)[0].point;
  };
  const a=boundaryPoint(-.8),b=boundaryPoint(.8);
  const project=(point:WorldPoint):WorldPoint|undefined=>{
    const q=buSegmentProjection(...point,edge.a,edge.b),sign=(point[0]-q.point[0])*q.nx+(point[1]-q.point[1])*q.nz>=0?1:-1;
    const offset=edge.road.width/2+buStreetSidewalk(edge.road)-.06;
    const direction=s*q.nx+c*q.nz,signed=(point[0]-edge.a[0])*q.nx+(point[1]-edge.a[1])*q.nz;
    if(Math.abs(direction)<.1)return undefined;
    const travel=(offset*sign-signed)/direction;if(travel<=0||travel>14)return undefined;
    const end:WorldPoint=[point[0]+s*travel,point[1]+c*travel];
    // A nearby finite road endpoint is not permission to extend paving past
    // it. Preserve the previous patch when the forward entry axis misses it.
    if(Math.abs(buSegmentProjection(...end,edge.a,edge.b).distance-offset)>.001)return undefined;
    return end;
  };
  const d=project(a),end=project(b);if(!d||!end)continue;
  const points:WorldPoint[]=[a,b,end,d],footprintArea=area(points);
  const gap=buSegmentProjection(p.x+doorX*c,p.z-doorX*s,edge.a,edge.b).distance-edge.road.width/2-buStreetSidewalk(edge.road);
  if(gap<.2||gap>13||footprintArea<=.15||footprintArea>=145||Math.hypot(b[0]-a[0],b[1]-a[1])>1.601)continue;
  let clear=true;
  for(const along of [.08,.5,.92])for(const across of [.1,.5,.9]){
    const x0=a[0]+(b[0]-a[0])*along,z0=a[1]+(b[1]-a[1])*along,x1=d[0]+(end[0]-d[0])*along,z1=d[1]+(end[1]-d[1])*along;
    const x=x0+(x1-x0)*across,z=z0+(z1-z0)*across;
    if(occupied(x,z)||protectedOpenSpace(x,z)||inCarriageway(x,z))clear=false;
  }
  if(clear){frontage.points=points;frontage.area=footprintArea;frontage.roadName=edge.road.name;}
}

export function buPublicRealmContains(x:number,z:number){return BU_PUBLIC_FRONTAGES.some(p=>contains(x,z,p.points));}
