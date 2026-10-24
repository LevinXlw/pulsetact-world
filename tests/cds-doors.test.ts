import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Group,Mesh,Raycaster,Vector3,type Material,type BufferGeometry} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {BU_CDS_SOUTH_DOORS,buCDSPoint} from '../src/features/world/bu-cds-entry-layout';
import {BU_CDS_YAW} from '../src/features/world/bu-landmark-layout';
import {CDS_DOORS,CDS_DOOR_BY_ID,CDS_DOOR_TRIGGER,cdsWorldToLocal,cdsLocalToWorld,cdsDoorExteriorHeight,getNearCDSDoor,createCDSDoorAnimationState} from '../src/features/world/cds-door-layout';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';
import {createMobileGroundSampler} from '../src/features/world/mobile-ground-sampler';
import {createCDSInteriorCollision,type CDSInteriorPhysicsManifest} from '../src/features/world/cds-interior-assets';
import {buNavigationBlocked,BU_FULL_PLACES} from '../src/features/world/bu-campus-layout';
import {walkableCampus} from '../src/features/world/campus-regions';
import {resolveWorldArrival} from '../src/features/world/world-arrival';

const bytes=(path:string)=>{const buffer=readFileSync(path);return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer;};
let outdoor:CampusCollision,indoor:CampusCollision,baked:Group,physics:Group;
let bakedMeshes:Mesh[];
const north=new Vector3(-Math.sin(BU_CDS_YAW),0,-Math.cos(BU_CDS_YAW));
beforeAll(async()=>{
  baked=parseMobileCampus(bytes('public/data/mobile/boston.glb'));baked.updateMatrixWorld(true);
  bakedMeshes=[];baked.traverse(object=>{if(object instanceof Mesh){object.geometry.computeBoundingBox();bakedMeshes.push(object);}});
  const ground=bakedMeshes.filter(mesh=>mesh.userData.mobileGround),walls=bakedMeshes.filter(mesh=>mesh.userData.mobileWall);
  outdoor=new CampusCollision();outdoor.rebuild(ground,walls,createMobileGroundSampler(ground));
  physics=(await new GLTFLoader().parseAsync(bytes('public/assets/bu-cds-interior/physics.glb'),'')).scene;
  const manifest=JSON.parse(readFileSync('public/assets/bu-cds-interior/manifest.json','utf8')) as CDSInteriorPhysicsManifest;
  indoor=createCDSInteriorCollision(physics,manifest);
},20000);
afterAll(()=>{
  outdoor?.clear();indoor?.clear();const geometry=new Set<BufferGeometry>(),materials=new Set<Material>();
  for(const group of [baked,physics])group?.traverse(object=>{if(object instanceof Mesh){geometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
  geometry.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());
});

describe('CDS doors use the actual exterior axes and distinct sides',()=>{
  it('shares stable west/east axes and inverts the exterior rotation without a GLB offset',()=>{
    expect(CDS_DOORS.map(door=>door.id)).toEqual(['west','east']);
    for(const [i,door] of CDS_DOORS.entries()){
      expect(door).toBe(CDS_DOOR_BY_ID[door.id]);expect(door.local).toEqual(BU_CDS_SOUTH_DOORS[i].local);
      expect(door.width).toBe(BU_CDS_SOUTH_DOORS[i].width);
      for(const point of [door.local,[door.local[0]-1.1,door.local[1]+2.3]] as const){
        const world=cdsLocalToWorld(point),local=cdsWorldToLocal(world);
        expect(local[0]).toBeCloseTo(point[0],9);expect(local[1]).toBeCloseTo(point[1],9);
      }
    }
  });

  it('only triggers in a narrow first-floor approach in front of the selected door',()=>{
    for(const door of CDS_DOORS){
      for(const offset of [-1.1,0,1.1])for(const distance of [.36,1.05,1.9,2.75]){
        const local=[door.local[0]+offset,door.local[1]+distance] as const,world=cdsLocalToWorld(local),height=outdoor.groundHeight(...world)!;
        expect(getNearCDSDoor(world,height)?.id).toBe(door.id);
        expect(getNearCDSDoor(world,height+5.6)).toBeUndefined();
        expect(getNearCDSDoor(world,height-1)).toBeUndefined();
      }
      for(const [dx,dz] of [[1.46,1.9],[-1.46,1.9],[0,-1.5],[0,.1],[0,3.1],[6,1.9],[0,50]]){
        const local=[door.local[0]+dx,door.local[1]+dz] as const;
        expect(getNearCDSDoor(cdsLocalToWorld(local),cdsDoorExteriorHeight(door,local))).toBeUndefined();
      }
      expect(getNearCDSDoor(door.exterior.position,Number.NaN)).toBeUndefined();
    }
    const destination=BU_FULL_PLACES.find(place=>place.id==='bu-cds')!;
    expect(getNearCDSDoor(destination.position,outdoor.groundHeight(...destination.position)!)).toBeUndefined();
  });

  it('pairs each internal side and arrival with the same doorway, never the second floor or reverse side',()=>{
    for(const door of CDS_DOORS){
      expect(indoor.groundHeight(...door.interior.position,0)).toBeCloseTo(0,6);
      expect(getNearCDSDoor(door.interior.position,0,true)?.id).toBe(door.id);
      expect(getNearCDSDoor([door.local[0],door.local[1]-.36],0,true)?.id).toBe(door.id);
      expect(getNearCDSDoor(door.interior.position,5.6,true)).toBeUndefined();
      expect(getNearCDSDoor([door.local[0],door.local[1]+1.5],0,true)).toBeUndefined();
      expect(getNearCDSDoor([door.local[0]+1.46,door.local[1]-1],0,true)).toBeUndefined();
      const inward=new Vector3(door.interior.lookAt[0]-door.interior.position[0],0,door.interior.lookAt[1]-door.interior.position[1]).normalize();
      expect(inward.z).toBe(-1);expect(indoor.distance(new Vector3(door.interior.position[0],.9,door.interior.position[1]),inward,.6)).toBeUndefined();
      const returned=resolveWorldArrival('boston',door.exterior.position,(x,z)=>outdoor.groundHeight(x,z));
      expect(returned?.position).toEqual(door.exterior.position);expect(returned?.height).toBeCloseTo(door.exterior.height,2);
      const street=cdsWorldToLocal(door.exterior.lookAt);expect(street[1]).toBeGreaterThan(door.local[1]+4);
    }
  });

  it('keeps both narrow outdoor triggers physically reachable using the complete baked campus collision',()=>{
    for(const door of CDS_DOORS){
      let prior=buCDSPoint(door.local[0],25.5),height=outdoor.groundHeight(...prior)!;
      let triggered=false;
      for(let z=25.4;z>=door.local[1]+.9;z-=.1){
        const position=buCDSPoint(door.local[0],z),nextHeight=outdoor.groundHeight(...position)!;
        expect(walkableCampus('boston',...position)).toBe(true);expect(buNavigationBlocked(...position)).toBe(false);
        expect(Number.isFinite(nextHeight)).toBe(true);expect(Math.abs(nextHeight-height)).toBeLessThan(.1);
        expect(outdoor.distance(new Vector3(prior[0],height+.9,prior[1]),north,.44)).toBeUndefined();
        if(getNearCDSDoor(position,nextHeight)?.id===door.id)triggered=true;
        prior=position;height=nextHeight;
      }
      expect(triggered).toBe(true);
      expect(CDS_DOOR_TRIGGER.halfWidth).toBeLessThan(door.width/2);
    }
  });

  it('keeps real apertures in the baked facade while preserving the closed exterior collision boundary',()=>{
    const visible=bakedMeshes.filter(mesh=>mesh.visible&&mesh.name.startsWith('BU CDS refined'));
    expect(visible.length).toBeGreaterThan(0);
    for(const door of CDS_DOORS){
      // The moving leaves, handles, centre frame and duplicate backing glass
      // are absent from the static asset. Trace through both former glass
      // planes to local z=18, without reaching the normal rear building face.
      const foundation=door.threshold.exteriorHeight-.15;
      for(const dx of [-.95,0,.95])for(const y of [.32,1.4,2.55]){
        const start=buCDSPoint(door.local[0]+dx,26),origin=new Vector3(start[0],foundation+y,start[1]);
        expect(new Raycaster(origin,north,0,8).intersectObjects(visible,false)).toHaveLength(0);
        expect(outdoor.distance(origin,north,8)).toBeCloseTo(26-door.local[1],2);
      }
      // Opening the door must not remove the fixed glazed bays beside it.
      for(const dx of [-1.8,1.8]){
        const start=buCDSPoint(door.local[0]+dx,26),origin=new Vector3(start[0],foundation+1.4,start[1]);
        const glazing=new Raycaster(origin,north,0,8).intersectObjects(visible,false)[0];
        expect(glazing).toBeDefined();expect(glazing.object.name).toContain('glass');
      }
      expect(CDS_DOOR_TRIGGER.exteriorFar).toBeGreaterThan(.34); // available before collision stops the body
      expect(CDS_DOOR_TRIGGER.exteriorNear).toBeLessThan(.34); // remains available at the existing wall clearance
    }
  });

  it('creates independent animation state for each visit rather than sharing mutable globals',()=>{
    const first=createCDSDoorAnimationState(),second=createCDSDoorAnimationState();
    first.doorId='west';first.phase='opening';first.openness=.6;
    expect(second).toEqual({doorId:null,phase:'closed',openness:0});
  });
});
