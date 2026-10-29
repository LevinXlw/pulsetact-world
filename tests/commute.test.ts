import {describe,expect,it,vi} from 'vitest';
import {BoxGeometry,DoubleSide,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {advanceCommuteMovement,COMMUTE_MODES,getCommuteMode,MAX_COMMUTE_FRAME_DISTANCE,normalizeCommuteMode} from '../src/features/world/commute';

describe('campus commuting',()=>{
  it('keeps the original walking speed and rejects unknown saved modes',()=>{
    expect(getCommuteMode(undefined)).toMatchObject({id:'walk',speed:3.6,sprintSpeed:7.2,clearance:.34});
    for(const value of ['fly',null,{},12])expect(normalizeCommuteMode(value)).toBe('walk');
    expect(COMMUTE_MODES.map(mode=>mode.id)).toEqual(['walk','motorcycle','broom']);
    expect(getCommuteMode('motorcycle').sprintSpeed).toBe(14);
    expect(getCommuteMode('broom').sprintSpeed).toBe(18);
  });

  it('normalizes diagonals and reverse input without giving extra distance',()=>{
    for(const [dx,dz] of [[1,0],[0,1],[1,1],[-3,-4]]){
      let x=0,z=0;const lengths:number[]=[];
      const result=advanceCommuteMovement(dx,dz,.9,(sx,sz)=>{x+=sx;z+=sz;lengths.push(Math.hypot(sx,sz));return true;});
      expect(Math.hypot(x,z)).toBeCloseTo(.9,12);expect(result.distance).toBeCloseTo(.9,12);
      expect(result).toMatchObject({moving:true,blocked:false});expect(Math.max(...lengths)).toBeLessThanOrEqual(.22);
      expect(Math.sign(x)).toBe(Math.sign(dx));expect(Math.sign(z)).toBe(Math.sign(dz));
    }
  });

  for(const mode of ['motorcycle','broom'] as const)it(`sweeps ${mode} motion against a thin real wall at 50 ms per frame`,()=>{
    const config=getCommuteMode(mode),wall=new Mesh(new BoxGeometry(.035,3,8),new MeshBasicMaterial({side:DoubleSide}));
    wall.position.set(1.1,1.5,0);wall.geometry.computeBoundingBox();wall.updateMatrixWorld(true);
    const collision=new CampusCollision();collision.rebuild([],[wall]);
    const position=new Vector3(0,0,0),origin=new Vector3(),ray=new Vector3();let attempts=0;
    const result=advanceCommuteMovement(1,0,config.sprintSpeed*.05,(x,z)=>{
      attempts++;origin.copy(position).y=.9;ray.set(x,0,z).normalize();
      if(collision.distance(origin,ray,Math.hypot(x,z)+config.clearance)!==undefined)return false;
      position.x+=x;position.z+=z;return true;
    });
    expect(attempts).toBeGreaterThan(1);expect(result.blocked).toBe(true);expect(result.moving).toBe(true);
    expect(position.x+config.clearance).toBeLessThan(1.1-.035/2);
    expect(result.distance).toBeCloseTo(position.x,12);
    wall.geometry.dispose();(wall.material as MeshBasicMaterial).dispose();collision.clear();
  });

  it('slides along a blocked facade without spending both diagonal fallback axes',()=>{
    let x=0,z=0;
    const result=advanceCommuteMovement(1,1,.9,(sx,sz)=>{
      if(x+sx>.1)return false;
      x+=sx;z+=sz;return true;
    });
    expect(x).toBe(0);expect(z).toBeCloseTo(.9/Math.sqrt(2),12);
    expect(result.distance).toBeCloseTo(z,12);expect(result).toMatchObject({moving:true,blocked:true});
  });

  it('reports only committed distance so a blocked vehicle makes no footsteps',()=>{
    const tryStep=vi.fn(()=>false),result=advanceCommuteMovement(1,0,.9,tryStep);
    expect(result).toEqual({distance:0,moving:false,blocked:true});expect(tryStep).toHaveBeenCalledOnce();
    let x=0;
    const edge=advanceCommuteMovement(1,0,.9,(sx)=>{
      if(x+sx>.4)return false;x+=sx;return true;
    });
    expect(edge.distance).toBeCloseTo(.36,12);expect(edge.distance).toBeCloseTo(x,12);expect(edge.blocked).toBe(true);
  });

  it('bounds paused-frame catchup and rejects malformed input before calling collision',()=>{
    for(const [dx,dz,distance] of [[NaN,1,.9],[1,Infinity,.9],[1,0,Infinity],[0,0,1],[1,0,-1],[1,0,0]]){
      const tryStep=vi.fn(()=>true);expect(advanceCommuteMovement(dx,dz,distance,tryStep)).toEqual({distance:0,moving:false,blocked:false});expect(tryStep).not.toHaveBeenCalled();
    }
    const lengths:number[]=[];const result=advanceCommuteMovement(2,1,100,(x,z)=>{lengths.push(Math.hypot(x,z));return true;},1000);
    expect(result.distance).toBeCloseTo(MAX_COMMUTE_FRAME_DISTANCE,12);expect(Math.max(...lengths)).toBeLessThanOrEqual(.25);expect(lengths.length).toBe(4);
  });
});
