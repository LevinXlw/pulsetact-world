import {BU_COMMONWEALTH_MEDIAN,buSegmentProjection} from './bu-campus-layout';
import {BU_TRANSIT_PLATFORM_DETAILS} from './bu-public-realm';
import type {WorldPoint} from './geo-coordinates';

/** Rail heads already modeled at ±1.015 / ±2.45 m. Right-hand running:
 * inbound eastbound uses the southern track, outbound the northern track. */
export const BU_GREEN_LINE_TRACK_OFFSET=1.7325;
export const BU_GREEN_LINE_GAUGE=1.435;
export const BU_GREEN_LINE_VEHICLE={length:21.7,width:2.64,roofHeight:3.48,railHeight:.192} as const;
export type BUGreenLineDirection='inbound'|'outbound';
export type BUGreenLinePath={points:WorldPoint[];distances:number[];length:number};
const stopIds:Record<string,string>={'Blandford Street':'place-bland','Boston University East':'place-buest','Boston University Central':'place-bucen','Amory Street':'place-amory','Babcock Street':'place-babck'};

export function createBUGreenLinePath(direction:BUGreenLineDirection):BUGreenLinePath{
  const side=direction==='inbound'?1:-1;
  const points:WorldPoint[]=BU_COMMONWEALTH_MEDIAN.map(([x,z],i,list)=>{
    const a=list[Math.max(0,i-1)],b=list[Math.min(list.length-1,i+1)],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    return[x-(b[1]-a[1])/length*side*BU_GREEN_LINE_TRACK_OFFSET,z+(b[0]-a[0])/length*side*BU_GREEN_LINE_TRACK_OFFSET];
  });
  if(direction==='outbound')points.reverse();
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  return{points,distances,length:distances.at(-1)!};
}
export const BU_GREEN_LINE_PATHS={inbound:createBUGreenLinePath('inbound'),outbound:createBUGreenLinePath('outbound')};
export function sampleBUGreenLine(path:BUGreenLinePath,distance:number){
  const d=Math.max(0,Math.min(path.length,Number.isFinite(distance)?distance:0));let lo=1,hi=path.distances.length-1;
  while(lo<hi){const middle=(lo+hi)>>1;if(path.distances[middle]<d)lo=middle+1;else hi=middle;}
  const a=path.points[lo-1],b=path.points[lo],length=path.distances[lo]-path.distances[lo-1],t=(d-path.distances[lo-1])/length;
  return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,dx:(b[0]-a[0])/length,dz:(b[1]-a[1])/length};
}
function projectDistance(path:BUGreenLinePath,point:WorldPoint){
  let nearest=Infinity,distance=0;
  for(let i=1;i<path.points.length;i++){
    const projection=buSegmentProjection(...point,path.points[i-1],path.points[i]);
    if(projection.distance<nearest){nearest=projection.distance;distance=path.distances[i-1]+Math.hypot(projection.point[0]-path.points[i-1][0],projection.point[1]-path.points[i-1][1]);}
  }return distance;
}
/** East-to-west stop order, matching the retained MBTA B-branch geography.
 * This is a representative campus service, not a live timetable. */
export const BU_GREEN_LINE_STATIONS=BU_TRANSIT_PLATFORM_DETAILS.map(stop=>({
  ...stop,id:stopIds[stop.name],distances:{inbound:projectDistance(BU_GREEN_LINE_PATHS.inbound,stop.position),outbound:projectDistance(BU_GREEN_LINE_PATHS.outbound,stop.position)},
}));
export const BU_GREEN_LINE_MAX_SPEED=9.0;
export const BU_GREEN_LINE_ACCELERATION=.85;
export const BU_GREEN_LINE_DWELL=13;
type MotionLeg={start:number;end:number;at:number;duration:number;accelTime:number;cruiseTime:number;speed:number;stopId?:string};
export type BUGreenLineTimetable={direction:BUGreenLineDirection;legs:MotionLeg[];duration:number;runEnd:number;start:number;end:number};
export function createBUGreenLineTimetable(direction:BUGreenLineDirection):BUGreenLineTimetable{
  const path=BU_GREEN_LINE_PATHS[direction],start=16,end=path.length-16;
  const stops=BU_GREEN_LINE_STATIONS.map(stop=>({distance:stop.distances[direction],id:stop.id})).sort((a,b)=>a.distance-b.distance);
  let at=0,from=start;const legs:MotionLeg[]=[];
  for(const target of [...stops,{distance:end,id:undefined}]){
    const length=target.distance-from,speed=Math.min(BU_GREEN_LINE_MAX_SPEED,Math.sqrt(length*BU_GREEN_LINE_ACCELERATION));
    const accelTime=speed/BU_GREEN_LINE_ACCELERATION,cruiseTime=Math.max(0,(length-speed*accelTime)/speed),duration=2*accelTime+cruiseTime;
    legs.push({start:from,end:target.distance,at,duration,accelTime,cruiseTime,speed,stopId:target.id});
    at+=duration+(target.id?BU_GREEN_LINE_DWELL:0);from=target.distance;
  }
  return{direction,legs,duration:at+10,runEnd:at,start,end};
}
export const BU_GREEN_LINE_TIMETABLES={inbound:createBUGreenLineTimetable('inbound'),outbound:createBUGreenLineTimetable('outbound')};
/** Analytic acceleration/braking avoids frame-rate dependent overshooting or
 * skipped stops. The scene crop ends fade out before the offstage reset. */
export function sampleBUGreenLineService(table:BUGreenLineTimetable,seconds:number){
  const elapsed=Number.isFinite(seconds)?Math.max(0,seconds):0,t=elapsed%table.duration;
  for(const leg of table.legs){
    if(t<leg.at)continue;
    const local=t-leg.at;
    if(local<=leg.duration){
      let distance:number,speed:number;
      if(local<leg.accelTime){speed=BU_GREEN_LINE_ACCELERATION*local;distance=leg.start+.5*speed*local;}
      else if(local<leg.accelTime+leg.cruiseTime){speed=leg.speed;distance=leg.start+.5*leg.speed*leg.accelTime+leg.speed*(local-leg.accelTime);}
      else {const remaining=leg.duration-local;speed=BU_GREEN_LINE_ACCELERATION*remaining;distance=leg.end-.5*speed*remaining;}
      const opacity=Math.min(1,Math.max(0,(distance-table.start)/24),Math.max(0,(table.end-distance)/24));
      return{distance,speed,opacity,stationId:undefined as string|undefined,doors:0};
    }
    if(leg.stopId&&local<leg.duration+BU_GREEN_LINE_DWELL){
      const dwell=local-leg.duration,doors=Math.min(1,dwell/.9,(BU_GREEN_LINE_DWELL-dwell)/1.2);
      return{distance:leg.end,speed:0,opacity:1,stationId:leg.stopId,doors};
    }
  }
  return{distance:table.end,speed:0,opacity:0,stationId:undefined as string|undefined,doors:0};
}
