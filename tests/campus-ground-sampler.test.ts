import {BoxGeometry,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {describe,expect,it} from 'vitest';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {createCampusGroundSampler} from '../src/features/world/campus-ground-sampler';
import {createMarylandCampus} from '../src/features/world/maryland-campus';
import {createMarylandExpansion} from '../src/features/world/maryland-expansion';
import {createMarylandFullCampus} from '../src/features/world/maryland-full-campus';
import {createMarylandCampusPaving} from '../src/features/world/maryland-campus-paving';
import {createMarylandStreetscape} from '../src/features/world/maryland-streetscape';
import {MARYLAND_LAYOUT} from '../src/features/world/maryland-layout';

function expectParity(ground:Mesh[],samples:[number,number][]){
  for(const mesh of ground){mesh.geometry.computeBoundingBox();mesh.updateWorldMatrix(true,false);}
  const collision=new CampusCollision();collision.rebuild(ground,[]);
  const sample=createCampusGroundSampler(ground);
  for(const [x,z] of samples){
    const actual=sample(x,z),expected=collision.groundHeight(x,z);
    if(expected===undefined)expect(actual,`unexpected ground at ${x}, ${z}`).toBeUndefined();
    else expect(actual,`ground height at ${x}, ${z}`).toBeCloseTo(expected,7);
  }
  return sample;
}

describe('temporary planting ground index',()=>{
  it('matches raycast heights for rotated, sloped and parent-transformed meshes',()=>{
    const parent=new Group();parent.position.set(-18,1.5,23);parent.rotation.y=.37;
    const slope=new Mesh(new BufferGeometry(),new MeshBasicMaterial());
    slope.geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,0,4,10,10,2,0],3));
    slope.rotation.y=-.6;slope.position.set(4,.3,-2);parent.add(slope);
    const platform=new Mesh(new BoxGeometry(4,1,5),new MeshBasicMaterial());
    platform.position.set(4,2.1,1);platform.rotation.y=.25;platform.scale.set(1.2,.8,.9);parent.add(platform);
    parent.updateMatrixWorld(true);
    const samples:[number,number][]=[];
    for(let x=-27;x<=-4;x+=.7)for(let z=12;z<=38;z+=.7)samples.push([x,z]);
    expectParity([slope,platform],samples);
    const known=new Vector3(2,1.6,3).applyMatrix4(slope.matrixWorld);
    expect(createCampusGroundSampler([slope])(known.x,known.z)).toBeCloseTo(known.y,7);
  });
  it('uses the highest walkable surface across paving overlays and cell borders',()=>{
    const turf=new Mesh(new BoxGeometry(96,.2,96),new MeshBasicMaterial());turf.position.y=-.1;
    const path=new Mesh(new BoxGeometry(4,.05,96),new MeshBasicMaterial());path.position.set(16,.025,0);
    const raised=new Mesh(new BoxGeometry(10,.5,10),new MeshBasicMaterial());raised.position.set(-16,.25,-16);
    const coordinates=[-48,-32,-16,0,16,32,48,49],samples=coordinates.flatMap(x=>coordinates.map(z=>[x,z] as [number,number]));
    const sample=expectParity([turf,path,raised],samples);
    expect(sample(16,0)).toBeCloseTo(.05);expect(sample(-16,-16)).toBeCloseTo(.5);expect(sample(49,0)).toBeUndefined();
  });
  it('preserves actual Maryland lawn, route and arrival heights after batching',()=>{
    const core=createMarylandCampus({value:0}),extra=createMarylandExpansion({value:0}),full=createMarylandFullCampus({value:0}),paving=createMarylandCampusPaving(),streets=createMarylandStreetscape();
    core.group.add(extra.group,full.group,paving.group,streets.group);core.group.updateMatrixWorld(true);
    const samples:[number,number][]=MARYLAND_LAYOUT.points.map(point=>[...point.position]);
    for(let x=-279;x<280;x+=37)for(let z=-301;z<300;z+=41)samples.push([x,z]);
    for(const path of MARYLAND_LAYOUT.paths)for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(let d=0;d<=distance;d+=23)samples.push([a[0]+(b[0]-a[0])*d/distance,a[1]+(b[1]-a[1])*d/distance]);
    }
    expectParity([...core.ground,...extra.ground,...full.ground,...paving.ground,...streets.ground],samples);
  },20000);
});
