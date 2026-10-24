import {BoxGeometry,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {afterEach,describe,expect,it} from 'vitest';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {createMobileGroundSampler} from '../src/features/world/mobile-ground-sampler';

const meshes:Mesh[]=[];
function surface(geometry:BufferGeometry){
  const mesh=new Mesh(geometry,new MeshBasicMaterial());meshes.push(mesh);return mesh;
}
function slope(indexed=true){
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([
    -12,0,-12, -12,2,12, 12,5,12, 12,3,-12,
  ],3));
  geometry.setIndex([0,1,2,0,2,3]);
  return surface(indexed?geometry:geometry.toNonIndexed());
}

// The oracle uses Three's Raycaster through the existing walking collision,
// without installing any sampler. It is independent of the packed triangle
// representation and checks both empty space and the first visible surface.
function parity(ground:Mesh[],points:readonly (readonly [number,number])[],tolerance=.001){
  for(const mesh of ground){mesh.updateWorldMatrix(true,false);mesh.geometry.computeBoundingBox();}
  const collision=new CampusCollision();collision.rebuild(ground,[]);
  const sample=createMobileGroundSampler(ground);
  let compared=0;
  for(const [x,z] of points){
    const actual=sample(x,z),expected=collision.groundHeight(x,z);
    if(expected===undefined)expect(actual,`unexpected surface at (${x}, ${z})`).toBeUndefined();
    else{
      expect(actual,`missing surface at (${x}, ${z})`).toBeDefined();
      expect(Math.abs(actual!-expected),`height error at (${x}, ${z})`).toBeLessThan(tolerance);
      compared++;
    }
  }
  expect(compared).toBeGreaterThan(0);
  return sample;
}

afterEach(()=>{
  for(const mesh of meshes){mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();}
  meshes.length=0;
});

describe('mobile walking ground sampler',()=>{
  it('matches independent raycasts on overlapping slopes with nested rotations and nonuniform scales',()=>{
    const parent=new Group();parent.position.set(-19.2,2.3,27.8);parent.rotation.y=.37;parent.scale.set(1.15,.9,.85);
    const lower=slope(),upper=slope(false);
    lower.rotation.y=-.24;lower.position.set(2,-1,-3);
    upper.rotation.set(.07,.19,-.04);upper.scale.set(.7,1.2,.8);upper.position.set(-2,2,1);
    parent.add(lower,upper);parent.updateMatrixWorld(true);
    const points:[number,number][]=[];
    for(let x=-42.13;x<-1;x+=.79)for(let z=6.11;z<48;z+=.83)points.push([x,z]);
    const sample=parity([lower,upper],points);
    const inside=new Vector3(0,2.5,0).applyMatrix4(upper.matrixWorld);
    expect(sample(inside.x,inside.z)).toBeCloseTo(inside.y,3);
  });

  it('keeps the bridge deck above the riverbed and returns to bank height beyond the bridge',()=>{
    const riverbed=surface(new BoxGeometry(100,1,80));riverbed.position.y=-4.5;
    const westBank=surface(new BoxGeometry(22,4,80));westBank.position.set(-39,-2,0);
    const eastBank=surface(new BoxGeometry(22,4,80));eastBank.position.set(39,-2,0);
    const deck=surface(new BoxGeometry(72,.45,5));deck.position.set(0,2.775,0);
    const points:[number,number][]=[];
    for(let x=-49;x<=49;x+=1.5)for(const z of [-3,-2.49,0,2.49,3])points.push([x,z]);
    const sample=parity([riverbed,westBank,eastBank,deck],points);
    expect(sample(0,0)).toBeCloseTo(3,4);
    expect(sample(0,3)).toBeCloseTo(-4,4);
    expect(sample(-40,0)).toBeCloseTo(0,4);
    expect(sample(40,0)).toBeCloseTo(0,4);
  });

  it('does not create gaps or phantom ground around positive and negative grid boundaries',()=>{
    const ground=surface(new BoxGeometry(64,.2,64));ground.position.y=-.1;
    const raised=surface(new BoxGeometry(8,.5,40));raised.position.set(16,.25,0);
    const crossing=surface(new BoxGeometry(40,.75,8));crossing.position.set(0,.375,-16);
    const coordinates=[-32.01,-32,-31.99,-16.01,-16,-15.99,-.01,0,.01,15.99,16,16.01,31.99,32,32.01];
    const points=coordinates.flatMap(x=>coordinates.map(z=>[x,z] as [number,number]));
    const sample=parity([ground,raised,crossing],points);
    for(const x of [15.99,16,16.01])expect(sample(x,-16)).toBeCloseTo(.75,4);
    expect(sample(32.01,0)).toBeUndefined();
    expect(sample(0,-32.01)).toBeUndefined();
  });

  it('retains sub-millimetre walking heights for thin steps and slopes around Boston-scale coordinates',()=>{
    for(const [originX,originZ] of [[1023.875,-1007.625],[-1023.875,1007.625]]){
      const district=new Group();district.position.set(originX,13.217,originZ);district.rotation.y=.431;
      const hillside=slope();hillside.position.set(0,-4,0);district.add(hillside);
      const steps:Mesh[]=[];
      for(let i=0;i<8;i++){
        const step=surface(new BoxGeometry(.28,.18*(i+1),3.1));
        step.position.set(-1.03+i*.28,.09*(i+1),.17);district.add(step);steps.push(step);
      }
      district.updateMatrixWorld(true);
      const points:[number,number][]=[];
      for(let x=-10.13;x<10;x+=.47)for(let z=-10.17;z<10;z+=.61){
        const point=new Vector3(x,0,z).applyMatrix4(district.matrixWorld);points.push([point.x,point.z]);
      }
      for(const step of steps)for(const x of [-.11,0,.11]){
        const point=new Vector3(x,0,.71).applyMatrix4(step.matrixWorld);points.push([point.x,point.z]);
      }
      parity([hillside,...steps],points,.0005);
    }
  });
});
