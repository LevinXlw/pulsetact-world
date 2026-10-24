import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Group,Mesh,Vector3,type Material,type BufferGeometry} from 'three';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';
import {createMobileGroundSampler} from '../src/features/world/mobile-ground-sampler';
import {BU_CDS_DOOR_WALK_ROUTES,buNavigationBlocked} from '../src/features/world/bu-campus-layout';
import {CDS_DOORS,getNearCDSDoor} from '../src/features/world/cds-door-layout';
import {WORLD_DESTINATIONS,navigationGuide} from '../src/features/world/world-destinations';
import type {WorldPoint} from '../src/features/world/geo-coordinates';

let model:Group,collision:CampusCollision;
beforeAll(()=>{
  const buffer=readFileSync('public/data/mobile/boston.glb');
  model=parseMobileCampus(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));model.updateMatrixWorld(true);
  const meshes:Mesh[]=[];model.traverse(o=>{if(o instanceof Mesh){o.geometry.computeBoundingBox();meshes.push(o);}});
  const ground=meshes.filter(m=>m.userData.mobileGround),walls=meshes.filter(m=>m.userData.mobileWall);
  collision=new CampusCollision();collision.rebuild(ground,walls,createMobileGroundSampler(ground));
},20000);
afterAll(()=>{collision?.clear();const geometries=new Set<BufferGeometry>(),materials=new Set<Material>();model?.traverse(o=>{if(o instanceof Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());});

function follow(start:WorldPoint,end:WorldPoint){
  let current:WorldPoint=[...start],travel=0,steps=0;
  const origin=new Vector3(),direction=new Vector3();
  while(Math.hypot(current[0]-end[0],current[1]-end[1])>.3&&steps++<6000){
    const guide=navigationGuide(current,end),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],length=Math.hypot(dx,dz),stride=Math.min(.3,length);
    expect(Number.isFinite(guide.distance)).toBe(true);expect(length).toBeGreaterThan(.00001);
    const next:WorldPoint=[current[0]+dx/length*stride,current[1]+dz/length*stride];
    const y=collision.groundHeight(...current),ny=collision.groundHeight(...next);
    expect(y).toBeDefined();expect(ny).toBeDefined();expect(Math.abs(ny!-y!)).toBeLessThan(.55);
    origin.set(current[0],y!+.9,current[1]);direction.set(dx,0,dz).normalize();
    expect(collision.distance(origin,direction,stride+.3),`blocked at ${current}`).toBeUndefined();
    travel+=stride;current=next;
  }
  expect(steps).toBeLessThan(6000);expect(Math.hypot(current[0]-end[0],current[1]-end[1])).toBeLessThanOrEqual(.3);
  return {current,travel};
}

describe('real CDS doors are connected to the outdoor navigation graph',()=>{
  it('connects both actual door arrivals across the existing unobstructed public apron',()=>{
    expect(BU_CDS_DOOR_WALK_ROUTES).toHaveLength(2);
    for(const [i,path] of BU_CDS_DOOR_WALK_ROUTES.entries()){
      expect(path[0]).toEqual(CDS_DOORS[i].exterior.position);
      for(let segment=1;segment<path.length;segment++){
        const a=path[segment-1],b=path[segment],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.3);
        for(let j=0;j<=steps;j++)expect(buNavigationBlocked(a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps)).toBe(false);
      }
    }
  });
  it.each(['bu-marsh','bu-gsu','bu-warren'])('guides %s to and from each true doorway without off-path oscillation or collision',id=>{
    const start=WORLD_DESTINATIONS.find(p=>p.id===id)!.position;
    for(const door of CDS_DOORS){
      const reached=follow(start,door.exterior.position);
      expect(getNearCDSDoor(reached.current,collision.groundHeight(...reached.current)!)?.id).toBe(door.id);
      follow(door.exterior.position,start);
    }
  },20000);
  it('escapes the previously oscillating sidewalk point and reaches the mapped east door',()=>{
    const destination=WORLD_DESTINATIONS.find(p=>p.id==='bu-cds')!;
    expect(destination.position).toEqual(CDS_DOORS[1].exterior.position);
    const result=follow([-867.6509,1053.7502],destination.position);
    expect(result.travel).toBeLessThan(25);
    expect(getNearCDSDoor(result.current,collision.groundHeight(...result.current)!)?.id).toBe('east');
  });
});
