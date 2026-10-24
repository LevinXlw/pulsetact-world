import {Matrix4,Mesh,Group} from 'three';
import {loadRefinedBUBuilding} from './bu-refined-building-asset';
import {loadStataBuilding,MIT_STATA_BASE_URL,MIT_STATA_MOBILE_BASE_URL,type StataAssetProfile} from './mit-stata-asset';

export const MIT_RESIDENCE_IDS=['baker','maseeh'] as const;
export const residenceBaseURL=(profile:StataAssetProfile)=>`/assets/mit-residences/${profile==='mobile'?'boston':'campus'}-without-residences.glb`;
export const residenceAssetURL=(id:typeof MIT_RESIDENCE_IDS[number],profile:StataAssetProfile)=>`/assets/mit-residences/${id}-${profile==='mobile'?'mobile':'full'}.glb`;

export async function loadMITResidences(signal:AbortSignal,profile:StataAssetProfile='desktop'){
 const mobile=profile==='mobile';
 const results=await Promise.allSettled(MIT_RESIDENCE_IDS.map(id=>loadRefinedBUBuilding(signal,{
  id,label:id==='baker'?'Baker House':'Maseeh Hall',url:residenceAssetURL(id,profile),toWorld:new Matrix4(),
  probeLocal:id==='baker'?[-302,14,330]:[-100,17,219],environment:{size:mobile?64:128,keepOnLow:true},
 })));
 if(results.some(r=>r.status==='rejected')||signal.aborted){
  results.forEach(r=>{if(r.status==='fulfilled')r.value.dispose();});signal.throwIfAborted();throw (results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason;
 }
 const buildings=results.map(r=>(r as PromiseFulfilledResult<Awaited<ReturnType<typeof loadRefinedBUBuilding>>>).value);
 const group=new Group();group.name='MIT · Memorial Drive residences';group.add(...buildings.map(b=>b.group));
 const ground:Mesh[]=[],walls:Mesh[]=[],glass:Mesh[]=[];
 group.traverse(o=>{if(!(o instanceof Mesh))return;
  if(o.userData.mitResidenceGround){ground.push(o);for(const m of Array.isArray(o.material)?o.material:[o.material]){m.polygonOffset=true;m.polygonOffsetFactor=-3;m.polygonOffsetUnits=-3;}}
  if(o.userData.mitResidenceWall)walls.push(o);
  if(o.userData.mitResidenceCollisionOnly){o.visible=false;o.castShadow=false;}
  else if(!o.userData.mitResidenceGround&&(Array.isArray(o.material)?o.material:[o.material]).some(m=>/glass/i.test(m.name)))glass.push(o);
 });
 const setQuality=(low:boolean)=>{buildings.forEach(b=>b.setQuality(mobile||low));glass.forEach(o=>o.castShadow=!mobile&&!low);group.traverse(o=>{if(o instanceof Mesh&&(o.userData.mitResidenceCollisionOnly||o.userData.mitResidenceGround))o.castShadow=false;});};
 setQuality(false);
 return{group,ground,walls,setQuality,bytes:buildings.reduce((n,b)=>n+b.bytes,0),disposeEnvironment:()=>buildings.forEach(b=>b.disposeEnvironment()),dispose:()=>{buildings.forEach(b=>b.dispose());group.clear();}};
}

/** Each source removal and complete replacement commits together. On failure,
 * retain the already working Stata pair, including both original dorm shells. */
export async function loadMITCampusReplacement(signal:AbortSignal,profile:StataAssetProfile='desktop'){
 const baseURL=residenceBaseURL(profile);
 const fetchBase=async(url:string)=>{const r=await fetch(url,{signal,cache:'no-cache'});if(!r.ok)throw Error(`MIT campus base (${r.status})`);return r.arrayBuffer();};
 // Only one campus base downloads on success, especially important on phones.
 const [stata,base,models]=await Promise.allSettled([
  loadStataBuilding(signal,profile),fetchBase(baseURL),
  loadMITResidences(signal,profile),
 ]);
 if(stata.status==='rejected'||signal.aborted){
  if(models.status==='fulfilled')models.value.dispose();
  if(stata.status==='fulfilled')stata.value.dispose();signal.throwIfAborted();throw (stata as PromiseRejectedResult).reason;
 }
 if(base.status==='rejected'||models.status==='rejected'){
  if(models.status==='fulfilled')models.value.dispose();
  console.warn('MIT residences unavailable; preserving original dorms.',base.status==='rejected'?base.reason:(models as PromiseRejectedResult).reason);
  const baseUrl=profile==='mobile'?MIT_STATA_MOBILE_BASE_URL:MIT_STATA_BASE_URL;
  try{const baseBytes=await fetchBase(baseUrl);signal.throwIfAborted();return {baseBytes,baseUrl,building:stata.value,residences:undefined};}
  catch(error){stata.value.dispose();throw error;}
 }
 return {building:stata.value,baseBytes:base.value,baseUrl:baseURL,residences:models.value};
}
