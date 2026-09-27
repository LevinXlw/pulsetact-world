export type CampusEnvironment={cellSize:number;waterRuns:[number,number,number][];greenRuns:[number,number,number][];roadRuns?:[number,number,number][];placedTrees?:number;waterArea:number;greenArea:number;roadArea?:number;bridge?:{start:[number,number];end:[number,number];width:number;deckHeight?:number}};
export function onCampusBridge(environment:CampusEnvironment|undefined,x:number,z:number){
 const b=environment?.bridge;if(!b)return false;const dx=b.end[0]-b.start[0],dz=b.end[1]-b.start[1],length=Math.hypot(dx,dz),t=((x-b.start[0])*dx+(z-b.start[1])*dz)/(length*length);
 return t>=0&&t<=1&&Math.abs((x-b.start[0])*dz-(z-b.start[1])*dx)/length<b.width/2;
}
export function isCampusWater(environment:CampusEnvironment|undefined,x:number,z:number){
 if(!environment)return false;
 if(onCampusBridge(environment,x,z))return false;
 const row=Math.floor((z+420)/environment.cellSize)*environment.cellSize-420;
 return environment.waterRuns.some(([start,r,length])=>r===row&&x>=start&&x<start+length);
}
