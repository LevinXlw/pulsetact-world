import {BackSide,BufferGeometry,Color,Float32BufferAttribute,InstancedMesh,Mesh,MeshBasicMaterial,SphereGeometry,Texture,type Material} from 'three';
import {CampusCollision} from '../real-campus/campus-collision';
import {createMobileGroundSampler} from './mobile-ground-sampler';
import {parseMobileCampus} from './mobile-campus-glb';
import {createMobileHdMaterials} from './mobile-hd-materials';
import {createMITPoeticSurface,isMITPoeticSurface} from './mit-poetic-materials';
import {createMITPoeticAtmosphere} from './mit-poetic-atmosphere';
import {createMITMainBuildingDetail} from './mit-main-building-detail';
import {createCharlesWaterMaterial} from './charles-water';
import {createBUGreenLine} from './bu-green-line';
import {createBUCommAveLandscape} from './bu-comm-ave-landscape';
import {createBUFrontageGlazing,buFrontageGlazingVariant} from './bu-frontage-glazing';
import {createBULinkCourtDetail} from './bu-link-court-detail';
import {createBUSertFacadeDetail} from './bu-sert-facade-detail';
import {createPainterlyVegetation} from './painterly-vegetation';
import {loadStataCampusReplacement,MIT_STATA_MOBILE_ASSET_URL,MIT_STATA_MOBILE_BASE_URL} from './mit-stata-asset';
import {loadMITCampusReplacement} from './mit-residences-asset';
import {createMITResidenceStreets} from './mit-residence-streets';
import {finishMITUnderpass} from './mit-underpass-finish';
import {createMITResidenceLandscape} from './mit-residence-landscape';
import {replaceBakerSurveyPlanters} from './mit-baker-site-cleanup';
import type {CampusWaterMaterial} from './campus-water';
import type {CampusId} from './campus-regions';
import type {WorldAssets} from './scene-assets';

/** Generated offline by prepare-mobile-campus.mjs. The playable phone branch
 * decodes only bounded, indexed geometry: no source geometry factory runs. */
export async function loadMobileCampus(signal:AbortSignal,campus:CampusId):Promise<WorldAssets>{
  // Bakes retain stable URLs. Revalidate their ETags so a newly deployed street
  // layout cannot be paired with an hour-old, browser-cached collision mesh.
  const load=async(path:string)=>{const response=await fetch(path,{signal,cache:'no-cache'});if(!response.ok)throw new Error('移动端校园读取失败');return response;};
  let stata:Awaited<ReturnType<typeof loadStataCampusReplacement>>['building']|undefined;
  let residences:Awaited<ReturnType<typeof loadMITCampusReplacement>>['residences'];
  let mitBaseUrl=MIT_STATA_MOBILE_BASE_URL;
  let loadedBaseUrl='/data/mobile/'+campus+'.glb';
  const loadBaseBytes=async()=>{
    if(campus==='boston')try{const replacement=await loadMITCampusReplacement(signal,'mobile');stata=replacement.building;residences=replacement.residences;mitBaseUrl=replacement.baseUrl;loadedBaseUrl=replacement.baseUrl;return replacement.baseBytes;}
    catch(error){signal.throwIfAborted();console.warn('Stata mobile exterior unavailable; retaining original building.',error);}
    return load(`/data/mobile/${campus}.glb`).then(r=>r.arrayBuffer());
  };
  const [baseData,metaData,heightData]=await Promise.allSettled([
    loadBaseBytes(),
    load(`/data/mobile/${campus}.json`).then(r=>r.json()) as Promise<{grid?:{minX:number;minZ:number;columns:number;rows:number;cell:number}}>,
    campus==='boston'?Promise.resolve(null):load(`/data/mobile/${campus}.ground.bin`).then(r=>r.arrayBuffer()),
  ]);
  if(baseData.status==='rejected'||metaData.status==='rejected'||heightData.status==='rejected'||signal.aborted){
    stata?.dispose();residences?.dispose();signal.throwIfAborted();
    throw [baseData,metaData,heightData].find(result=>result.status==='rejected')!.reason;
  }
  const meta=metaData.value,heightBytes=heightData.value;
  let model:ReturnType<typeof parseMobileCampus>;
  let loadedBaseBytes=baseData.value.byteLength;
  try{model=parseMobileCampus(baseData.value);}
  catch(error){
    if(!stata)throw error;
    stata.dispose();stata=undefined;residences?.dispose();residences=undefined;
    console.warn('Stata mobile campus replacement is invalid; retaining original building.',error);
    loadedBaseUrl='/data/mobile/'+campus+'.glb';
    const fallbackBytes=await load(loadedBaseUrl).then(r=>r.arrayBuffer());loadedBaseBytes=fallbackBytes.byteLength;
    model=parseMobileCampus(fallbackBytes);
  }
  model.userData.mobileBaseAsset={url:loadedBaseUrl,bytes:loadedBaseBytes};
  if(stata){
    model.add(stata.group);
    model.userData.stataReplacement={status:'loaded',url:MIT_STATA_MOBILE_ASSET_URL,baseUrl:mitBaseUrl,bytes:stata.bytes};
  }else if(campus==='boston')model.userData.stataReplacement={status:'fallback',url:MIT_STATA_MOBILE_ASSET_URL};
  if(residences){model.add(residences.group);model.userData.mitResidenceReplacement={status:'loaded',buildings:['baker','maseeh'],bytes:residences.bytes};}
  else if(campus==='boston')model.userData.mitResidenceReplacement={status:'fallback'};
  const collision=new CampusCollision(),wind={value:0};
  const waterMaterials:CampusWaterMaterial[]=[],replaced=new Set<Material>();
  // Keep the baked geometry and collision flags. Shared water shaders bypass
  // the optional Lambert HD conversions, including subsequent quality toggles.
  model.traverse(object=>{if(object instanceof Mesh&&object.name==='Charles River water'){
    for(const material of Array.isArray(object.material)?object.material:[object.material])replaced.add(material);
    const material=createCharlesWaterMaterial(wind,'mobile');object.material=material;waterMaterials.push(material);
  }});
  // Reinstall only the explicitly named facade finishes. Keep these Standard
  // materials out of the optional Lambert HD conversion and share per variant.
  if(campus==='boston'){
    const glazing=new Map<string,ReturnType<typeof createBUFrontageGlazing>>();
    model.traverse(object=>{if(!(object instanceof Mesh))return;
      const replace=(source:Material)=>{const variant=buFrontageGlazingVariant(source.name);if(!variant)return source;
        let material=glazing.get(variant);if(!material){material=createBUFrontageGlazing({variant,mobile:true});glazing.set(variant,material);}replaced.add(source);return material;};
      object.material=Array.isArray(object.material)?object.material.map(replace):replace(object.material);
    });
  }
  model.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])replaced.delete(material);});
  replaced.forEach(material=>material.dispose());
  const ground:Mesh[]=[],walls:Mesh[]=[],materials=new Set<Material>(),geometries=new Set<BufferGeometry>(),textures=new Set<Texture>();
  if(campus==='boston'){replaceBakerSurveyPlanters(model,residences?.group);finishMITUnderpass(model);}
  // The dedicated MIT finishes retain the baked geometry and collision. They
  // stay outside the Lambert-only optional HD conversion on both quality tiers.
  const poeticAtmosphere=campus==='boston'?createMITPoeticAtmosphere(wind,true):undefined;
  const mainBuildingDetail=campus==='boston'?createMITMainBuildingDetail():undefined;
  if(campus==='boston'){
    const poeticPalette=new Map<Material,Material>();
    model.traverse(object=>{if(!(object instanceof Mesh))return;
      const convert=(source:Material)=>{
        if(!isMITPoeticSurface(source.name))return source;
        let material=poeticPalette.get(source);
        if(!material){material=createMITPoeticSurface(source.name,{mobile:true});material.side=source.side;poeticPalette.set(source,material);}
        return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
    });
    poeticPalette.forEach((_,source)=>source.dispose());
    model.add(poeticAtmosphere!.group);
    model.add(mainBuildingDetail!);
    model.userData.mitMainBuildingDetail=mainBuildingDetail!.stats;
    model.userData.mitArtDirection={version:'poetic-campus-real-detail-v2',palette:'existing warm stone / green landscape; photo-informed warm-grey muntins',quality:'baked mobile geometry; retained stone courses; opaque approximate glazing; 24 motes; no shadow maps or reflection probe'};
  }
  let disposed=false;const hdMaterials=createMobileHdMaterials(model,campus);
  let transit:ReturnType<typeof createBUGreenLine>|undefined;
  let residenceLandscape:ReturnType<typeof createMITResidenceLandscape>|undefined;
  let commTrees:ReturnType<typeof createPainterlyVegetation>|undefined;
  let linkTrees:ReturnType<typeof createPainterlyVegetation>|undefined;
  const dispose=()=>{if(disposed)return;disposed=true;transit?.dispose();stata?.disposeEnvironment();residences?.disposeEnvironment();hdMaterials.dispose();collision.clear();model.traverse(o=>{if(o instanceof InstancedMesh)o.dispose();if(o instanceof Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value instanceof Texture)textures.add(value);}}});materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());model.clear();materials.clear();geometries.clear();textures.clear();ground.length=0;walls.length=0;};
  try{
    if(campus==='boston'){
      // The historic phone bake omitted the actual columns, frames and doors.
      // Restore just these source components: retaining the capital alone would
      // leave it floating and would let a player pass through the column line.
      const porticoBytes=await load('/data/killian/mobile-portico.glb').then(r=>r.arrayBuffer());
      const portico=parseMobileCampus(porticoBytes),porticoPalette=new Map<Material,Material>();
      portico.traverse(object=>{if(!(object instanceof Mesh))return;
        const convert=(source:Material)=>{
          if(!isMITPoeticSurface(source.name))return source;
          let material=porticoPalette.get(source);
          if(!material){material=createMITPoeticSurface(source.name,{mobile:true});material.side=source.side;porticoPalette.set(source,material);}
          return material;
        };
        object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
      });
      porticoPalette.forEach((_,source)=>source.dispose());
      model.add(portico);model.userData.mitMobilePortico={bytes:porticoBytes.byteLength,url:'/data/killian/mobile-portico.glb',status:'loaded'};
      const sourceGround:Mesh[]=[];model.updateMatrixWorld(true);model.traverse(o=>{if(o instanceof Mesh&&(o.userData.mobileGround||o.userData.stataGround||o.userData.mitResidenceGround))sourceGround.push(o);});
      const streets=createMITResidenceStreets(createMobileGroundSampler(sourceGround),sourceGround);model.add(streets.group);
      const commLandscape=createBUCommAveLandscape({mobile:true});model.add(commLandscape.group);sourceGround.push(...commLandscape.ground);
      const linkCourt=createBULinkCourtDetail({mobile:true});model.add(linkCourt.group);sourceGround.push(...linkCourt.ground);
      // Same projecting screen as desktop, after HD material discovery so
      // toggling quality cannot replace its purpose-built glazing shader.
      model.add(createBUSertFacadeDetail({mobile:true}).group);
      linkCourt.walls.forEach(mesh=>{mesh.userData.mobileWall=true;});
      // Temporary sampler for rooting just this small court before the final
      // collision index is assembled with the new trunks and boundary fence.
      collision.rebuild(sourceGround,[],createMobileGroundSampler(sourceGround));
      residenceLandscape=createMITResidenceLandscape(collision,wind,true,model.userData.bakerNorthCourtReady===true);model.add(residenceLandscape.group);
      commTrees=createPainterlyVegetation(commLandscape.trees,collision,null,wind,true,'avenue');commTrees.group.name='BU CAS · branching street trees';commTrees.setQuality(true);model.add(commTrees.group);
      commTrees.group.traverse(o=>{if(o instanceof Mesh&&o.userData.treeTrunk){o.userData.mobileWall=true;o.userData.mobileHidden=true;o.geometry.computeBoundingBox();}});
      linkTrees=createPainterlyVegetation(linkCourt.trees,collision,null,wind,true,'avenue');linkTrees.group.name='BU Link · courtyard tree';linkTrees.setQuality(true);model.add(linkTrees.group);
      linkTrees.group.traverse(o=>{if(o instanceof Mesh&&o.userData.treeTrunk){o.userData.mobileWall=true;o.userData.mobileHidden=true;o.geometry.computeBoundingBox();}});
    }
    model.traverse(object=>{if(!(object instanceof Mesh))return;const material=Array.isArray(object.material)?object.material[0]:object.material;
      if(object.userData.mobileGround){
        // Explicit BU terrain/surface/marking layers survive the bake. Resetting
        // every layer to the same bias lets grass cover nearby paved surfaces.
        if(material.userData.buGroundLayer===undefined){material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-2;}
        ground.push(object);
      }
      else if(object.userData.stataGround===true||object.userData.mitResidenceGround===true)ground.push(object);
      if(object.userData.mobileWall||object.userData.stataWall===true||object.userData.mitResidenceWall===true)walls.push(object);
      object.visible=object.userData.mobileHidden!==true&&object.userData.stataCollisionOnly!==true&&object.userData.mitResidenceCollisionOnly!==true;
      for(const owned of Array.isArray(object.material)?object.material:[object.material]){
        materials.add(owned);for(const value of Object.values(owned))if(value instanceof Texture)textures.add(value);
      }
      for(const extra of [object.customDepthMaterial,object.customDistanceMaterial])if(extra){materials.add(extra);for(const value of Object.values(extra))if(value instanceof Texture)textures.add(value);}
      geometries.add(object.geometry);
    });
    // Apply after the common source-visibility pass so the low tier does not
    // accidentally re-enable tiny high-level ornaments at first arrival.
    mainBuildingDetail?.setQuality(true);
    let sampler:((x:number,z:number)=>number|undefined)|undefined;
    if(meta.grid&&heightBytes){
      const grid=meta.grid,values=new Float32Array(heightBytes);
      sampler=(x,z)=>{const gx=(x-grid.minX)/grid.cell,gz=(z-grid.minZ)/grid.cell,ix=Math.max(0,Math.min(grid.columns-2,Math.floor(gx))),iz=Math.max(0,Math.min(grid.rows-2,Math.floor(gz))),tx=Math.max(0,Math.min(1,gx-ix)),tz=Math.max(0,Math.min(1,gz-iz)),a=values[iz*grid.columns+ix],b=values[iz*grid.columns+ix+1],c=values[(iz+1)*grid.columns+ix],d=values[(iz+1)*grid.columns+ix+1];return tx>=tz?a+(b-a)*tx+(d-b)*tz:a+(d-c)*tx+(c-a)*tz;};
    }
    model.updateMatrixWorld(true);collision.rebuild(ground,walls,sampler??createMobileGroundSampler(ground));
    const geometry=new SphereGeometry(3900,24,12),p=geometry.getAttribute('position'),colors=new Float32Array(p.count*3),top=new Color('#80b9d0'),bottom=new Color(campus==='arizona'?'#d6d9be':'#d3dfc6'),color=new Color();
    for(let i=0;i<p.count;i++){color.copy(bottom).lerp(top,Math.max(0,Math.min(1,p.getY(i)/3200)));colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;}
    geometry.setAttribute('color',new Float32BufferAttribute(colors,3));const material=new MeshBasicMaterial({vertexColors:true,side:BackSide,depthWrite:false}),sky=new Mesh(geometry,material);sky.renderOrder=-1;sky.frustumCulled=false;model.add(sky);materials.add(material);geometries.add(geometry);
    if(campus==='boston'){transit=createBUGreenLine({quality:'mobile'});model.add(transit.group);}
    signal.throwIfAborted();return{model,collision,wind,setQuality:low=>{hdMaterials.setQuality(low);mainBuildingDetail?.setQuality(low);poeticAtmosphere?.setQuality(low);stata?.setQuality(low);residences?.setQuality(low);residenceLandscape?.setQuality(low);commTrees?.setQuality(low);linkTrees?.setQuality(low);waterMaterials.forEach(m=>m.setQuality(low?'mobile':'mobile-hd'));},update:(camera,deltaSeconds=0)=>{sky.position.copy(camera);if(poeticAtmosphere)poeticAtmosphere.group.visible=Math.hypot(camera.x-34,camera.z-5)<220;transit?.update(deltaSeconds);residenceLandscape?.update(camera);commTrees?.update(camera);linkTrees?.update(camera);},dispose};
  }catch(error){dispose();throw error;}
}
