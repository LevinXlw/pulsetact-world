export type CommuteMode='walk'|'motorcycle'|'broom';

export type CommuteDefinition={
  id:CommuteMode;
  title:string;
  subtitle:string;
  /** Ground travel speed in metres per second. */
  speed:number;
  sprintSpeed:number;
  /** Swept body clearance, not the visual model's full length. */
  clearance:number;
};

export const COMMUTE_MODES:readonly CommuteDefinition[]=[
  {id:'walk',title:'步行',subtitle:'放慢脚步，随时停下来探索。',speed:3.6,sprintSpeed:7.2,clearance:.34},
  {id:'motorcycle',title:'城市摩托',subtitle:'沿道路与校园步道骑行，更快抵达下一站。',speed:10,sprintSpeed:14,clearance:.65},
  {id:'broom',title:'魔法扫帚',subtitle:'贴地悬浮，沿现有通路移动；不能越过建筑或水面。',speed:13,sprintSpeed:18,clearance:.5},
];

export function normalizeCommuteMode(value:unknown):CommuteMode{
  return value==='motorcycle'||value==='broom'?value:'walk';
}

export function getCommuteMode(value:unknown):CommuteDefinition{
  const mode=normalizeCommuteMode(value);
  return COMMUTE_MODES.find(item=>item.id===mode)!;
}

export const MAX_COMMUTE_FRAME_DISTANCE=1;
export type CommuteMovement={distance:number;moving:boolean;blocked:boolean};

/** Try a short displacement from the current position. A true result means
 * the callback committed the full displacement. It must reject without
 * changing position on false, and check the swept segment against walls as
 * well as the next ground/water/height boundary. Small steps keep terrain
 * sampling useful at vehicle speed; they do not replace swept collision. */
export type TryCommuteStep=(x:number,z:number)=>boolean;

export function advanceCommuteMovement(
  directionX:number,directionZ:number,distance:number,tryStep:TryCommuteStep,maxStep=.22,
):CommuteMovement{
  const stopped:CommuteMovement={distance:0,moving:false,blocked:false};
  if(!Number.isFinite(directionX)||!Number.isFinite(directionZ)||!Number.isFinite(distance)||distance<=0)return stopped;
  const length=Math.hypot(directionX,directionZ);
  if(!Number.isFinite(length)||length<1e-8)return stopped;
  const travel=Math.min(distance,MAX_COMMUTE_FRAME_DISTANCE);
  const limit=Number.isFinite(maxStep)?Math.max(.03,Math.min(.25,maxStep)):.22;
  const steps=Math.ceil(travel/limit),stride=travel/steps;
  const x=directionX/length*stride,z=directionZ/length*stride;
  let travelled=0,blocked=false;
  for(let i=0;i<steps;i++){
    if(tryStep(x,z)){travelled+=stride;continue;}
    blocked=true;
    // Commit at most one axis fallback. Committing both independently would
    // exceed the diagonal distance and could cut through a blocked corner.
    if(Math.abs(x)>1e-8&&Math.abs(z)>1e-8){
      if(tryStep(x,0)){travelled+=Math.abs(x);continue;}
      if(tryStep(0,z)){travelled+=Math.abs(z);continue;}
    }
    break;
  }
  return{distance:travelled,moving:travelled>1e-8,blocked};
}
