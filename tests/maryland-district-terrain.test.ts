import {Mesh,MeshBasicMaterial,PlaneGeometry} from 'three';
import {describe,expect,it} from 'vitest';
import {createCampusGroundSampler} from '../src/features/world/campus-ground-sampler';
import {UMD_TERRAIN_DATA} from '../src/features/world/maryland-terrain-data';
import {UMD_DISTRICT_TERRAIN_DATA} from '../src/features/world/maryland-district-terrain-data';
import {UMD_FULL_BUILDINGS} from '../src/features/world/maryland-full-layout';
import {drapeMarylandGeometry,marylandElevation,marylandRawElevation,MARYLAND_DISTRICT_TERRAIN_CELL} from '../src/features/world/maryland-terrain';

describe('Maryland business and engineering district terrain',()=>{
  it('uses measured local samples in the existing geographic frame and vertical datum',()=>{
    expect(UMD_DISTRICT_TERRAIN_DATA.source).toBe(UMD_TERRAIN_DATA.source);
    expect(UMD_DISTRICT_TERRAIN_DATA.transform).toEqual(UMD_TERRAIN_DATA.transform);
    expect(UMD_DISTRICT_TERRAIN_DATA.units).toBe(UMD_TERRAIN_DATA.units);
    expect(UMD_DISTRICT_TERRAIN_DATA.districts.map(d=>d.id)).toEqual(['business','engineering']);
    for(const d of UMD_DISTRICT_TERRAIN_DATA.districts){
      expect(d.grid.step).toBe(6.25);
      expect(d.values).toHaveLength(d.grid.rows*d.grid.columns);
      expect(d.values.every(Number.isFinite)).toBe(true);
      expect(Math.max(...d.values)-Math.min(...d.values)).toBeGreaterThan(10);
      // Coincident values confirm that the denser measurements were not
      // accidentally queried with another map scale or vertical unit.
      const {grid:g,values}=UMD_TERRAIN_DATA;
      let largestDifference=0;
      for(let row=0;row<d.grid.rows;row+=4)for(let col=0;col<d.grid.columns;col+=4){
        const oldRow=(d.grid.minZ+row*d.grid.step-g.minZ)/g.step,oldCol=(d.grid.minX+col*d.grid.step-g.minX)/g.step;
        largestDifference=Math.max(largestDifference,Math.abs(d.values[row*d.grid.columns+col]-values[oldRow*g.columns+oldCol]));
      }
      expect(largestDifference).toBeLessThan(.002);
    }
  });
  it('joins local detail to the surrounding coarse triangles without height seams',()=>{
    for(const {grid:g} of UMD_DISTRICT_TERRAIN_DATA.districts){
      const maxX=g.minX+(g.columns-1)*g.step,maxZ=g.minZ+(g.rows-1)*g.step;
      for(let x=g.minX;x<=maxX;x+=3.125)for(const z of [g.minZ,maxZ])expect(Math.abs(marylandElevation(x,z+.00001)-marylandElevation(x,z-.00001))).toBeLessThan(.0001);
      for(let z=g.minZ;z<=maxZ;z+=3.125)for(const x of [g.minX,maxX])expect(Math.abs(marylandElevation(x+.00001,z)-marylandElevation(x-.00001,z))).toBeLessThan(.0001);
    }
  });
  it('preserves the measured slope in Van Munching’s open southern recess',()=>{
    const building=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId==='039')!;
    const court=marylandElevation(-525,470),foundation=marylandElevation(building.x,building.z);
    expect(foundation-court).toBeGreaterThan(1.4);
    expect(Math.abs(court-marylandRawElevation(-525,470))).toBeLessThan(.08);
    // The prior rectangle pad levelled this point despite it being open ground.
    expect(-525).toBeGreaterThan(Math.min(...building.footprint.map(p=>p[0])));
    expect(470).toBeLessThan(Math.max(...building.footprint.map(p=>p[1])));
  });
  it('keeps the refined walking ground within the controller step allowance',()=>{
    let steepest=0,steepestAt=[0,0];
    for(const {grid:g} of UMD_DISTRICT_TERRAIN_DATA.districts){
      for(let row=0;row<g.rows-1;row++)for(let col=0;col<g.columns-1;col++){
        for(const [u,v] of [[.75,.25],[.25,.75]]){
          const x=g.minX+(col+u)*MARYLAND_DISTRICT_TERRAIN_CELL,z=g.minZ+(row+v)*MARYLAND_DISTRICT_TERRAIN_CELL,h=marylandElevation(x,z);
          const slope=Math.hypot((marylandElevation(x+.1,z)-h)/.1,(marylandElevation(x,z+.1)-h)/.1);
          if(slope>steepest){steepest=slope;steepestAt=[x,z];}
        }
      }
    }
    expect(steepest*.65,`Largest 0.65m rise near ${steepestAt}`).toBeLessThan(.45);
  });
  it('drapes both districts and detail boundaries onto one exact shared height field',()=>{
    const material=new MeshBasicMaterial();
    for(const [x,z] of [[-495,485],[540,-680],[-700,400],[600,-250]]){
      const lawn=drapeMarylandGeometry(new PlaneGeometry(100,30).rotateX(-Math.PI/2).translate(x,0,z),18);
      const road=drapeMarylandGeometry(new PlaneGeometry(100,9,13,2).rotateX(-Math.PI/2).translate(x,.07,z),4);
      const meshes=[new Mesh(lawn,material),new Mesh(road,material)];meshes.forEach(m=>m.updateMatrixWorld());
      const ground=createCampusGroundSampler([meshes[0]]),pavement=createCampusGroundSampler([meshes[1]]);
      for(let dx=-48;dx<48;dx+=2.3)for(const dz of [-3.2,.7,2.7]){
        expect(ground(x+dx,z+dz)).toBeCloseTo(marylandElevation(x+dx,z+dz),4);
        expect(pavement(x+dx,z+dz)!-ground(x+dx,z+dz)!).toBeCloseTo(.07,4);
      }
      lawn.dispose();road.dispose();
    }
    material.dispose();
  });
});
