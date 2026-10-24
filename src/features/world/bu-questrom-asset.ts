import {BackSide,FrontSide,Matrix4,Mesh} from 'three';
import {BU_BUILDING_ANCHORS} from './charles-geography';
import {buElevation} from './bu-terrain';
import {loadRefinedBUBuilding} from './bu-refined-building-asset';

export const BU_QUESTROM_ASSET_URL='/assets/bu-questrom/questrom-full.glb';
export function questromAssetToWorld(){
 const [x,z]=BU_BUILDING_ANCHORS.questrom;
 return new Matrix4().makeTranslation(x,buElevation(x,z),z).multiply(new Matrix4().makeRotationY(-.145));
}
export async function loadQuestromBuilding(signal:AbortSignal){
 const building=await loadRefinedBUBuilding(signal,{id:'questrom',label:'Questrom',url:BU_QUESTROM_ASSET_URL,toWorld:questromAssetToWorld(),probeLocal:[7,5,30]});
 // Restore the source's front-face rendering and back-face shadow casting;
 // Blender exports double-sided materials even for this closed exterior.
 building.group.traverse(object=>{
  if(!(object instanceof Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){material.side=FrontSide;material.shadowSide=BackSide;}
 });
 return building;
}
