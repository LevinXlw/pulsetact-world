import {Matrix4,Mesh,MeshStandardMaterial} from 'three';
import {loadRefinedBUBuilding} from './bu-refined-building-asset';

export type StataAssetProfile='desktop'|'mobile';
export const MIT_STATA_ASSET_URL='/assets/mit-stata/stata-full.glb';
export const MIT_STATA_MOBILE_ASSET_URL='/assets/mit-stata/stata-mobile.glb';
export const MIT_STATA_BASE_URL='/assets/mit-stata/campus-without-stata.glb';
export const MIT_STATA_MOBILE_BASE_URL='/assets/mit-stata/boston-without-stata.glb';

/** The exported vertices already use the campus east/up/south metre frame.
 * The GIS catalog centroid is metadata, never an additional translation. */
export function stataAssetToWorld(){return new Matrix4();}

export async function loadStataBuilding(signal:AbortSignal,profile:StataAssetProfile='desktop'){
  const mobile=profile==='mobile',url=mobile?MIT_STATA_MOBILE_ASSET_URL:MIT_STATA_ASSET_URL;
  const building=await loadRefinedBUBuilding(signal,{
    id:'stata',label:'Stata Center',url,toWorld:stataAssetToWorld(),
    // Sample at mid-facade height so the entire cladding is not reflecting
    // the green ground immediately beside the former street-level probe.
    probeLocal:[114.246,22,-346],environment:{size:mobile?64:128,keepOnLow:true},
  });
  const ground:Mesh[]=[],walls:Mesh[]=[],exteriorGlass:Mesh[]=[];
  building.group.traverse(object=>{
    if(!(object instanceof Mesh))return;
    // Architectural stainless steel needs the sky/neighborhood energy that
    // the shared legacy building loader deliberately suppresses. Keep this
    // local to Stata; other buildings retain their calibrated materials.
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(material instanceof MeshStandardMaterial){
        material.envMapIntensity=/glass/i.test(material.name)?1.1:/^mirror/i.test(material.name)?1:/^(silver|frame|zinc|gold)/i.test(material.name)?.85:.55;
      }
    }
    if(object.userData.stataGround===true){
      ground.push(object);
      // Legacy MIT paving uses a -2 depth offset. Keep this local replacement
      // just ahead of that layer without changing its surveyed walking height.
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        material.polygonOffset=true;material.polygonOffsetFactor=-3;material.polygonOffsetUnits=-3;
      }
    }
    if(object.userData.stataWall===true)walls.push(object);
    if(object.userData.stataCollisionOnly===true){object.visible=false;object.castShadow=false;}
    else if(!object.userData.stataGround&&(Array.isArray(object.material)?object.material:[object.material]).some(material=>/glass/i.test(material.name)))exteriorGlass.push(object);
  });
  building.group.userData.stataRefined=true;
  building.group.userData.stataProfile=profile;
  const setQuality=(low:boolean)=>{
    building.setQuality(mobile||low);
    // Glazing and shallow closed room cavities preserve the exterior shadow
    // silhouette; these cavities do not introduce a playable interior.
    for(const glass of exteriorGlass)glass.castShadow=!mobile&&!low;
  };
  setQuality(false);
  return {...building,ground,walls,url,setQuality};
}

/** Pair the replacement with its exact source-face removal. A missing asset
 * must leave the original campus available, rather than an empty building lot. */
export async function loadStataCampusReplacement(signal:AbortSignal,profile:StataAssetProfile='desktop'){
  const baseUrl=profile==='mobile'?MIT_STATA_MOBILE_BASE_URL:MIT_STATA_BASE_URL;
  const base=async()=>{
    const response=await fetch(baseUrl,{signal,cache:'no-cache'});
    if(!response.ok)throw new Error(`Stata 校园基底读取失败 (${response.status})`);
    const bytes=await response.arrayBuffer();signal.throwIfAborted();return bytes;
  };
  const [baseResult,buildingResult]=await Promise.allSettled([base(),loadStataBuilding(signal,profile)]);
  if(baseResult.status==='rejected'||buildingResult.status==='rejected'||signal.aborted){
    if(buildingResult.status==='fulfilled')buildingResult.value.dispose();
    signal.throwIfAborted();
    throw baseResult.status==='rejected'?baseResult.reason:(buildingResult as PromiseRejectedResult).reason;
  }
  return {baseBytes:baseResult.value,building:buildingResult.value,baseUrl};
}
