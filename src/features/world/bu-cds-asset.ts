import {Matrix4} from 'three';
import {BU_CDS_MAP_FEATURE,BU_CDS_YAW} from './bu-landmark-layout';
import {buElevation} from './bu-terrain';
import {loadRefinedBUBuilding} from './bu-refined-building-asset';

export const BU_CDS_ASSET_URL='/assets/bu-cds/cds-full.glb';
/** The complete building keeps the reviewed ground-sample local frame. */
export function cdsAssetToWorld(){
 const {x,z}=BU_CDS_MAP_FEATURE;
 return new Matrix4().makeTranslation(x,buElevation(x,z),z)
  .multiply(new Matrix4().makeRotationY(BU_CDS_YAW))
  .multiply(new Matrix4().makeTranslation(35.75,0,21.15));
}
export function loadCDSBuilding(signal:AbortSignal){
 return loadRefinedBUBuilding(signal,{id:'cds',label:'CDS',url:BU_CDS_ASSET_URL,toWorld:cdsAssetToWorld(),probeLocal:[-5.55,7,12]});
}
