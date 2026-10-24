import {BU_ROAD_EDGES,buSegmentProjection} from './bu-campus-layout';

type Point=readonly[number,number];
type Front={
  p:{x:number;z:number;yaw:number};width:number;distance:number;setback:number;
  a:Point;b:Point;edge:typeof BU_ROAD_EDGES[number];
};

/** Existing authored brownstone entry rules shared by the facade and its
 * public-footpath connection. This locates a model entrance, not a surveyed
 * historic doorway. GIS envelopes and street centre lines are never moved. */
export function buBrownstoneEntry(footprint:readonly Point[],height:number){
  const ring=footprint.map(p=>[...p] as Point);
  if(ring.length>3&&Math.hypot(ring[0][0]-ring.at(-1)![0],ring[0][1]-ring.at(-1)![1])<.02)ring.pop();
  let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}
  if(area>0)ring.reverse();
  // Match createBUFullCampus's facadeRing exactly: source surveys may split
  // a straight wall into many short segments, but bends beyond 15 mm remain.
  let changed=true;
  while(changed&&ring.length>3){
    changed=false;
    for(let i=0;i<ring.length;i++){
      const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);
      const projection=length?((b[0]-a[0])*dx+(b[1]-a[1])*dz)/(length*length):-1;
      if(length>.01&&projection>=0&&projection<=1&&Math.abs(dx*(a[1]-b[1])-(a[0]-b[0])*dz)/length<.015){ring.splice(i,1);changed=true;break;}
    }
  }
  let front:Front|undefined;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],width=Math.hypot(b[0]-a[0],b[1]-a[1]);if(width<4.5)continue;
    const p={x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(a[1]-b[1],b[0]-a[0])};
    let distance=Infinity,setback=0,edge:typeof BU_ROAD_EDGES[number]|undefined;
    for(const candidate of BU_ROAD_EDGES){
      if(candidate.road.kind==='expressway'||candidate.road.kind==='bridge')continue;
      const projected=buSegmentProjection(p.x,p.z,candidate.a,candidate.b);
      const outward=buSegmentProjection(p.x+Math.sin(p.yaw)*.8,p.z+Math.cos(p.yaw)*.8,candidate.a,candidate.b);
      if(outward.distance<projected.distance-.15&&projected.distance<distance){
        distance=projected.distance;setback=Math.max(0,distance-candidate.road.width/2-candidate.road.sidewalk-.65);edge=candidate;
      }
    }
    if(edge&&distance<(front?.distance??Infinity))front={p,width,distance,setback,a,b,edge};
  }
  if(!front||front.distance>=45)return undefined;
  const stoopDepth=Math.min(2.45,front.setback),rise=Math.min(1.1,stoopDepth*.48);
  const doorX=-Math.min(front.width*.27,2.5),doorWidth=Math.min(1.35,front.width*.22),groundHeight=Math.min(4.05,height*.39);
  return {front,doorX,doorWidth,stoopDepth,rise,groundHeight,doorHeight:Math.min(2.72,groundHeight-rise-.23)};
}
