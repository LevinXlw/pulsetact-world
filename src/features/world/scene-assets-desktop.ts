import {BufferGeometry, DataTexture, Group, InstancedMesh, Material, Mesh, NearestFilter, RedFormat, ShaderMaterial, Texture, type Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {localBinary} from '../real-campus/local-assets';
import {openPortico, type PorticoOpening} from '../real-campus/portico';
import {CampusCollision} from '../real-campus/campus-collision';
import {createPainterlyVegetation} from './painterly-vegetation';
import {createCampusSurface} from './painterly-surfaces';
import {createMITPoeticSurface,isMITPoeticSurface} from './mit-poetic-materials';
import {createMITPoeticAtmosphere} from './mit-poetic-atmosphere';
import {createMITMainBuildingDetail} from './mit-main-building-detail';
import {attachMITGlassReflection} from './mit-glass-reflection';
import {createPainterlySky} from './painterly-sky';
import {createPainterlyGroundDetail} from './painterly-ground-detail';
import {createPainterlyCampusProps} from './painterly-campus-props';
import {createCharlesRiver} from './charles-river';
import {createBostonUniversity, BU_LAWNS, BU_TREE_POSITIONS} from './boston-university';
import {createBULawnDetail} from './bu-ground-detail';
import {createBUCampusStreets} from './bu-campus-streets';
import {createBUFullCampus} from './bu-full-campus';
import {createBUGreenLine} from './bu-green-line';
import {createBUCommAveLandscape,buCASLandscapeReplaces} from './bu-comm-ave-landscape';
import {createBUWarrenStreetscape} from './bu-warren-streetscape';
import {createBULinkCourtDetail} from './bu-link-court-detail';
import {createBUSertFacadeDetail} from './bu-sert-facade-detail';
import {BU_CDS_ASSET_URL,loadCDSBuilding} from './bu-cds-asset';
import {BU_QUESTROM_ASSET_URL,loadQuestromBuilding} from './bu-questrom-asset';
import {loadStataCampusReplacement,MIT_STATA_ASSET_URL,MIT_STATA_BASE_URL} from './mit-stata-asset';
import {loadMITCampusReplacement} from './mit-residences-asset';
import {createMITResidenceStreets} from './mit-residence-streets';
import {finishMITUnderpass} from './mit-underpass-finish';
import {createMITResidenceLandscape} from './mit-residence-landscape';
import {replaceBakerSurveyPlanters} from './mit-baker-site-cleanup';
import {attachCampusWaterReflection} from './campus-water-reflection';
import {createCampusGroundSampler} from './campus-ground-sampler';
import type {CampusId,RemoteCampusId} from './campus-regions';

export type WorldAssets = {
  model: Group;
  collision: CampusCollision;
  wind: {value: number};
  setQuality: (low: boolean) => void;
  update: (cameraPosition: Vector3, deltaSeconds?:number) => void;
  dispose: () => void;
};
type DetailManifest = {
  porticoOpening: PorticoOpening;
  courtyardFacades: PorticoOpening[];
  dome: {center: number[]; base: number; radius: number};
  trees: {x: number; z: number; radius: number}[];
};

export function toonGradient() {
  const texture = new DataTexture(new Uint8Array([86, 154, 215, 255]), 4, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const floorNames = new Set(['grass', 'pavement', 'steps', 'porticoFloor', 'courtCurb', 'road', 'arterial', 'bridgeDeck', 'bridgeWalk']);
const wallNames = new Set(['Cambridge buildings (untextured)', 'columnStone', 'porticoStone', 'porticoWall', 'courtyardWall', 'courtyardPlinth', 'entranceDoor', 'entrancePanel']);

/** Desktop geometry. Imported only after the device's resource profile is chosen. */
export async function loadWorldAssets(signal: AbortSignal,campus:CampusId='boston'): Promise<WorldAssets> {
  if(campus!=='boston')return loadRegionalAssets(signal,campus);
  const loader = new GLTFLoader();
  let stata:Awaited<ReturnType<typeof loadStataCampusReplacement>>['building']|undefined;
  let residences:Awaited<ReturnType<typeof loadMITCampusReplacement>>['residences'];
  let mitBaseUrl=MIT_STATA_BASE_URL;
  const loadBaseBytes=async()=>{
    try{const replacement=await loadMITCampusReplacement(signal);stata=replacement.building;residences=replacement.residences;mitBaseUrl=replacement.baseUrl;return replacement.baseBytes;}
    catch(error){signal.throwIfAborted();console.warn('Stata refined exterior unavailable; retaining original building.',error);return localBinary('/data/campuses/mit/campus.glb',undefined,signal);}
  };
  const [baseData, detailData, manifestData] = await Promise.allSettled([
    loadBaseBytes(),
    localBinary('/data/killian/detail.glb', '/data/killian/detail.glb.gz', signal),
    fetch('/data/killian/detail-manifest.json', {signal}).then(async r => {
      if (!r.ok) throw new Error('校园场景配置读取失败');
      return await r.json() as DetailManifest;
    }),
  ]);
  if(baseData.status==='rejected'||detailData.status==='rejected'||manifestData.status==='rejected'){
    stata?.dispose();residences?.dispose();
    throw [baseData,detailData,manifestData].find(result=>result.status==='rejected')!.reason;
  }
  const manifest=manifestData.value;
  const parseBase=async()=>{
    try{return await loader.parseAsync(baseData.value,'');}
    catch(error){
      if(!stata||signal.aborted)throw error;
      stata.dispose();stata=undefined;residences?.dispose();residences=undefined;
      console.warn('Stata campus replacement is invalid; retaining original building.',error);
      return loader.parseAsync(await localBinary('/data/campuses/mit/campus.glb',undefined,signal),'');
    }
  };
  const [baseResult,detailResult]=await Promise.allSettled([parseBase(),loader.parseAsync(detailData.value,'')]);
  if(baseResult.status==='rejected'||detailResult.status==='rejected'){
    if(baseResult.status==='fulfilled')disposeWorld(baseResult.value.scene);
    if(detailResult.status==='fulfilled')disposeWorld(detailResult.value.scene);
    stata?.dispose();residences?.dispose();
    throw (baseResult.status==='rejected'?baseResult:detailResult as PromiseRejectedResult).reason;
  }
  const base=baseResult.value,detail=detailResult.value;
  const model = new Group();
  model.name = 'MIT · painted campus';
  model.add(base.scene, detail.scene);
  const wind = {value: 0};
  const collision = new CampusCollision();
  const cleanups:(()=>void)[]=[];
  let disposed=false;
  const dispose = () => {if(disposed)return;disposed=true;cleanups.forEach(cleanup=>cleanup());disposeWorld(model);collision.clear();};
  if (signal.aborted) { stata?.dispose();residences?.dispose();dispose(); signal.throwIfAborted(); }
  openPortico(base.scene, manifest.porticoOpening, manifest.dome, manifest.courtyardFacades);

  const originals = new Set<Material>();
  const originalTextures = new Set<Texture>();
  const palette = new Map<string, Material>();
  const ground: Mesh[] = [], walls: Mesh[] = [];
  let lawn: Mesh | null = null;
  const materialFor = (name: string) => {
    if (palette.has(name)) return palette.get(name)!;
    const material = isMITPoeticSurface(name)?createMITPoeticSurface(name):createCampusSurface(name);
    palette.set(name, material);
    return material;
  };
  model.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
    oldMaterials.forEach(material => {
      originals.add(material);
      Object.values(material).forEach(value => {if (value instanceof Texture) originalTextures.add(value);});
    });
    const name = oldMaterials[0].name;
    // Fresh canopies and trunks share light, geometry and wind treatment.
    if (name === 'bark' || name.startsWith('leaf') || name === 'pavingJoint' || name === 'benchWood' || name === 'benchMetal'
      || ['water','bridgeDeck','bridgeWalk','bridgeRail','bridgeSupport'].includes(name)) {
      object.visible = false;
      return;
    }
    object.material = Array.isArray(object.material) ? oldMaterials.map(m => materialFor(m.name)) : materialFor(name);
    object.castShadow = !floorNames.has(name) && !name.includes('orthophotography') && !['water', 'glass', 'courtyardGlass', 'porticoGlass', 'doorGlass'].includes(name);
    object.receiveShadow = true;
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    if (floorNames.has(name) || name.includes('orthophotography')) ground.push(object);
    else if (wallNames.has(name)) walls.push(object);
    if (name === 'grass') lawn = object;
  });
  // Removed source materials may own large aerial textures; release them now.
  originals.forEach(material => material.dispose());
  originalTextures.forEach(texture => texture.dispose());
  const mainBuildingDetail=createMITMainBuildingDetail();
  model.add(mainBuildingDetail);
  model.userData.mitMainBuildingDetail=mainBuildingDetail.stats;
  model.userData.bakerReplacedSurveyPlanterTriangles=replaceBakerSurveyPlanters(base.scene,residences?.group);
  finishMITUnderpass(model);
  // The source-face removal and the replacement are committed together. Add
  // authored PBR only after the legacy campus palette conversion has finished.
  if(stata){
    model.add(stata.group);ground.push(...stata.ground);walls.push(...stata.walls);
    cleanups.push(stata.disposeEnvironment);
    model.userData.stataReplacement={status:'loaded',url:MIT_STATA_ASSET_URL,baseUrl:mitBaseUrl,bytes:stata.bytes};
  }else model.userData.stataReplacement={status:'fallback',url:MIT_STATA_ASSET_URL};
  if(residences){
    model.add(residences.group);ground.push(...residences.ground);walls.push(...residences.walls);
    cleanups.push(residences.disposeEnvironment);
    model.userData.mitResidenceReplacement={status:'loaded',buildings:['baker','maseeh'],bytes:residences.bytes};
  }else model.userData.mitResidenceReplacement={status:'fallback'};
  model.updateMatrixWorld(true);
  collision.rebuild(ground, walls);
  const river = createCharlesRiver(collision, wind);
  const reflection=attachCampusWaterReflection(river.water,river.water.material,.24);
  const transit=createBUGreenLine();
  cleanups.push(reflection.dispose,transit.dispose);
  const boston = createBostonUniversity({wind});
  const streets = createBUCampusStreets(),fullBU=createBUFullCampus(),commLandscape=createBUCommAveLandscape(),warrenForecourt=createBUWarrenStreetscape(),linkCourt=createBULinkCourtDetail();
  model.add(river.group, boston.group,streets.group,fullBU.group,transit.group,commLandscape.group,warrenForecourt.group,linkCourt.group);
  // Bounded photo-led Mugar lower screen; existing shell and collision stay.
  model.add(createBUSertFacadeDetail().group);
  let cds:Awaited<ReturnType<typeof loadCDSBuilding>>|undefined;
  try {
    cds=await loadCDSBuilding(signal);
    model.add(cds.group);
    // Keep the independently owned original ground/wall proxies, and only
    // remove the old appearance after the complete replacement is ready.
    boston.cds.visual.visible=false;
    cleanups.push(cds.disposeEnvironment);
    model.userData.cdsReplacement={status:'loaded',url:BU_CDS_ASSET_URL,bytes:cds.bytes};
  } catch(error) {
    if(signal.aborted){dispose();signal.throwIfAborted();}
    model.userData.cdsReplacement={status:'fallback',url:BU_CDS_ASSET_URL};
    console.warn('CDS refined exterior unavailable; retaining original building.',error);
  }
  let questrom:Awaited<ReturnType<typeof loadQuestromBuilding>>|undefined;
  try {
    questrom=await loadQuestromBuilding(signal);
    model.add(questrom.group);
    // Keep campus paving in its original world-coordinate buffers. Round-tripping
    // these nearly coplanar road junctions through a local GLB changes depth ties.
    const retainedGround=boston.questrom.visual.children.filter(object=>object instanceof Mesh&&object.userData.buGround);
    boston.group.add(...retainedGround);
    questrom.group.traverse(object=>{if(object instanceof Mesh&&(object.userData.ground||object.userData.buGround))object.visible=false;});
    // Canvas lettering and the original physical ground/walls are independent
    // of the exterior skin, so the entrance remains labelled and traversable.
    boston.questrom.visual.visible=false;
    cleanups.push(questrom.disposeEnvironment);
    model.userData.questromReplacement={status:'loaded',url:BU_QUESTROM_ASSET_URL,bytes:questrom.bytes,retainedGroundMeshes:retainedGround.length};
  } catch(error) {
    if(signal.aborted){dispose();signal.throwIfAborted();}
    model.userData.questromReplacement={status:'fallback',url:BU_QUESTROM_ASSET_URL};
    console.warn('Questrom refined exterior unavailable; retaining original building.',error);
  }
  ground.push(...river.ground, ...boston.ground,...streets.ground,...fullBU.ground,...commLandscape.ground,...warrenForecourt.ground,...linkCourt.ground);
  walls.push(...river.walls, ...boston.walls,...streets.walls,...fullBU.walls,...linkCourt.walls);
  model.updateMatrixWorld(true);
  const mitStreets=createMITResidenceStreets(createCampusGroundSampler(ground),ground);model.add(mitStreets.group);ground.push(...mitStreets.ground);
  model.updateMatrixWorld(true);
  const bostonGround=createCampusGroundSampler(ground);
  collision.rebuild(ground, walls,bostonGround);
  const residenceLandscape=createMITResidenceLandscape(collision,wind,false,base.scene.userData.bakerNorthCourtReady===true);model.add(residenceLandscape.group);walls.push(...residenceLandscape.walls);
  const campusProps = createPainterlyCampusProps(collision);
  model.add(campusProps.group);
  walls.push(...campusProps.colliders);
  const groundDetail = createPainterlyGroundDetail({trees:manifest.trees, collision, lawn, wind});
  model.add(groundDetail.group);
  const vegetation = createPainterlyVegetation(manifest.trees, collision, lawn, wind);
  const buLawn = createBULawnDetail(boston.ground.filter(mesh=>mesh.name.endsWith('grass')),BU_LAWNS,wind,(x,z)=>collision.groundHeight(x,z));
  model.add(buLawn.group);
  const riversideTrees = createPainterlyVegetation([
    ...BU_TREE_POSITIONS.map(([x,z])=>({x,z,radius:.42})), ...river.trees,
  ], collision, null, wind);
  const buTrees=createPainterlyVegetation([...fullBU.trees,...streets.trees].filter(t=>!buCASLandscapeReplaces(t.x,t.z)),collision,null,wind,true,'bu');
  model.add(buTrees.group);buTrees.group.updateMatrixWorld(true);
  buTrees.group.traverse(object=>{if(object instanceof Mesh&&object.userData.treeTrunk){object.geometry.computeBoundingBox();walls.push(object);}});
  const commTrees=createPainterlyVegetation(commLandscape.trees,collision,null,wind,true,'avenue');
  commTrees.group.name='BU CAS · branching street trees';model.add(commTrees.group);commTrees.group.updateMatrixWorld(true);
  commTrees.group.traverse(object=>{if(object instanceof Mesh&&object.userData.treeTrunk){object.geometry.computeBoundingBox();walls.push(object);}});
  const linkTrees=createPainterlyVegetation(linkCourt.trees,collision,null,wind,true,'avenue');
  linkTrees.group.name='BU Link · courtyard tree';model.add(linkTrees.group);linkTrees.group.updateMatrixWorld(true);
  linkTrees.group.traverse(object=>{if(object instanceof Mesh&&object.userData.treeTrunk){object.geometry.computeBoundingBox();walls.push(object);}});
  const forest = vegetation.group;
  model.add(forest);
  model.add(riversideTrees.group);
  forest.updateMatrixWorld(true);
  forest.traverse(object => {
    if (object instanceof Mesh && object.userData.treeTrunk) {
      object.geometry.computeBoundingBox();
      walls.push(object);
    }
  });
  riversideTrees.group.updateMatrixWorld(true);
  riversideTrees.group.traverse(object=>{
    if(object instanceof Mesh&&object.userData.treeTrunk){object.geometry.computeBoundingBox();walls.push(object);}
  });
  collision.rebuild(ground, walls,bostonGround);
  model.add(createPainterlySky(wind));
  const mitGlassReflection=attachMITGlassReflection(model);
  cleanups.push(mitGlassReflection.dispose);
  model.userData.mitGlassReflection=mitGlassReflection.stats;
  const poeticAtmosphere=createMITPoeticAtmosphere(wind);
  model.add(poeticAtmosphere.group);
  model.userData.mitArtDirection={version:'poetic-campus-real-detail-v2',palette:'existing warm stone / green landscape; photo-informed warm-grey muntins',scope:'Building 10 and courtyard-facing architectural surfaces; real detail takes precedence',sourceGeometry:'public/data/killian/detail.glb'};
  const setQuality = (low:boolean) => {
    mitGlassReflection.setQuality(low);
    poeticAtmosphere.setQuality(low);
    mainBuildingDetail.setQuality(low);
    vegetation.setQuality(low); groundDetail.setQuality(low); campusProps.setQuality(low);
    river.setQuality(low); boston.setQuality(low); riversideTrees.setQuality(low);
    river.water.material.setQuality(low?'mobile-hd':'desktop');reflection.setQuality(low);
    buLawn.setQuality(low);streets.setQuality(low);fullBU.setQuality(low);buTrees.setQuality(low);
    commTrees.setQuality(low);linkTrees.setQuality(low);
    cds?.setQuality(low);
    questrom?.setQuality(low);
    stata?.setQuality(low);
    residences?.setQuality(low);
    residenceLandscape.setQuality(low);
  };
  const update = (cameraPosition:Vector3,deltaSeconds=0) => {
    transit.update(deltaSeconds);
    const mitDistance=Math.hypot(cameraPosition.x-34,cameraPosition.z-5);
    poeticAtmosphere.group.visible=mitDistance<220;
    // Keep the base skyline across the river; courtyard window recesses,
    // furniture and ground blades cannot be resolved from West Campus.
    detail.scene.visible=mitDistance<850;
    campusProps.group.visible=mitDistance<550;
    groundDetail.group.visible=mitDistance<420;
    vegetation.group.visible=mitDistance<700;
    vegetation.update(cameraPosition); groundDetail.update(cameraPosition);
    riversideTrees.update(cameraPosition);
    buLawn.update(cameraPosition);
    buTrees.update(cameraPosition);
    commTrees.update(cameraPosition);linkTrees.update(cameraPosition);
    residenceLandscape.update(cameraPosition);
  };
  return {model, collision, wind, setQuality, update, dispose};
}

async function loadRegionalAssets(signal:AbortSignal,campus:RemoteCampusId):Promise<WorldAssets>{
  const factory=campus==='umd'?(await import('./maryland-campus')).createMarylandCampus:campus==='arizona'?(await import('./arizona-campus')).createArizonaCampus:(await import('./penn-campus')).createPennCampus;
  signal.throwIfAborted();
  const wind={value:0},built=factory(wind),model=built.group,collision=new CampusCollision();
  const dispose=()=>disposeWorld(model);
  // Maryland's surrounding districts share the core's terrain/collision query,
  // tree batches and grass budget, so walking never crosses a scene boundary.
  let expansion:ReturnType<typeof import('./maryland-expansion').createMarylandExpansion>|undefined;
  let fullCampus:ReturnType<typeof import('./maryland-full-campus').createMarylandFullCampus>|undefined;
  let streetscape:ReturnType<typeof import('./maryland-streetscape').createMarylandStreetscape>|undefined;
  if(campus==='umd'){
    try {
      const [{createMarylandExpansion},{createMarylandFullCampus},{createMarylandCampusPaving},{createMarylandStreetscape}]=await Promise.all([
        import('./maryland-expansion'),import('./maryland-full-campus'),import('./maryland-campus-paving'),import('./maryland-streetscape'),
      ]);
      signal.throwIfAborted();
      expansion=createMarylandExpansion(wind);
      model.add(expansion.group);
      built.ground.push(...expansion.ground);built.walls.push(...expansion.walls);
      built.trees.push(...expansion.trees);built.lawns.push(...expansion.lawns);
      fullCampus=createMarylandFullCampus(wind);
      model.add(fullCampus.group);
      built.ground.push(...fullCampus.ground);built.walls.push(...fullCampus.walls);
      built.trees.push(...fullCampus.trees);built.lawns.push(...fullCampus.lawns);
      const paving=createMarylandCampusPaving();model.add(paving.group);built.ground.push(...paving.ground);
      streetscape=createMarylandStreetscape();model.add(streetscape.group);
      built.ground.push(...streetscape.ground);built.walls.push(...streetscape.walls);
      built.trees.push(...streetscape.trees);built.lawns.push(...streetscape.lawns);
      const streetHeight=createCampusGroundSampler([...paving.ground,...streetscape.pavedGround]);
      built.trees=built.trees.filter(tree=>streetHeight(tree.x,tree.z)===undefined);
    } catch(error) {dispose();throw error;}
  }
  model.updateMatrixWorld(true);
  // Reuse the exact triangle index for trees, grass and per-frame walking.
  // Camera obstruction still raycasts actual surfaces and building walls.
  const terrainHeight=campus!=='upenn'?createCampusGroundSampler(built.ground):undefined;
  collision.rebuild(built.ground,built.walls,terrainHeight);
  const vegetation=createPainterlyVegetation(built.trees,collision,null,wind,campus==='umd');
  model.add(vegetation.group);vegetation.group.updateMatrixWorld(true);
  const walls=[...built.walls];
  vegetation.group.traverse(object=>{if(object instanceof Mesh&&object.userData.treeTrunk){object.geometry.computeBoundingBox();walls.push(object);}});
  const plantingHeight=terrainHeight??createCampusGroundSampler(built.ground);
  const fields=(built.lawns??[]).map(lawn=>{
    const area=lawn.footprints.reduce((sum,patch)=>sum+patch.width*patch.depth,0);
    const budget=Math.min(22000,Math.max(7000,Math.round(area*1.1)));
    return createBULawnDetail([lawn.mesh],lawn.footprints,wind,plantingHeight,budget);
  });
  fields.forEach(field=>model.add(field.group));
  model.add(createPainterlySky(wind));model.updateMatrixWorld(true);collision.rebuild(built.ground,walls,terrainHeight);
  if(signal.aborted){dispose();signal.throwIfAborted();}
  return {model,collision,wind,dispose,
    setQuality:(low:boolean)=>{built.setQuality(low);expansion?.setQuality(low);fullCampus?.setQuality(low);streetscape?.setQuality(low);vegetation.setQuality(low);fields.forEach(field=>field.setQuality(low));},
    update:(camera:Vector3)=>{if('update' in built&&typeof built.update==='function')built.update(camera);fullCampus?.update(camera);streetscape?.update(camera);vegetation.update(camera);fields.forEach(field=>field.update(camera));},
  };
}

function disposeWorld(group: Group) {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (object instanceof InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
    if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  materials.forEach(material => {
    Object.values(material).forEach(value => {if (value instanceof Texture) textures.add(value);});
    if (material instanceof ShaderMaterial) {
      Object.values(material.uniforms).forEach(uniform => {if (uniform.value instanceof Texture) textures.add(uniform.value);});
    }
    material.dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  textures.forEach(texture => texture.dispose());
}
