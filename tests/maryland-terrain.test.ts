import {BoxGeometry,Mesh,MeshBasicMaterial,PlaneGeometry} from 'three';
import {describe,expect,it} from 'vitest';
import {createCampusGroundSampler} from '../src/features/world/campus-ground-sampler';
import {UMD_TERRAIN_DATA} from '../src/features/world/maryland-terrain-data';
import {UMD_FULL_BUILDINGS} from '../src/features/world/maryland-full-layout';
import {drapeMarylandGeometry,marylandElevation} from '../src/features/world/maryland-terrain';

describe('Maryland LiDAR-derived terrain',()=>{
  it('retains the source, datum and complete measured height grid',()=>{
    expect(UMD_TERRAIN_DATA.source).toContain('mdgeodata.md.gov/lidar/');
    expect(UMD_TERRAIN_DATA.values).toHaveLength(UMD_TERRAIN_DATA.grid.rows*UMD_TERRAIN_DATA.grid.columns);
    expect(UMD_TERRAIN_DATA.values.every(Number.isFinite)).toBe(true);
    expect(UMD_TERRAIN_DATA.anchors.find(a=>a.buildingId==='163')!.elevationMeters).toBeGreaterThan(UMD_TERRAIN_DATA.anchors.find(a=>a.buildingId==='077')!.elevationMeters+10);
  });
  it('restores the walk uphill from the east Campus Drive approach to STAMP',()=>{
    const east=marylandElevation(190,-165),stamp=marylandElevation(-185,-182);
    expect(stamp-east).toBeGreaterThan(8);
    let largest=0;
    for(let x=-370;x<282;x+=.65)largest=Math.max(largest,Math.abs(marylandElevation(x+.65,-165)-marylandElevation(x,-165)));
    expect(largest).toBeLessThan(.45);
  });
  it('keeps every shared terrain cell below the walking step limit',()=>{
    let largestGradient=0;
    for(let x=-1380;x<1170;x+=12.5)for(let z=-1790;z<830;z+=12.5){
      const h=marylandElevation(x,z),dx=(marylandElevation(x+.65,z)-h)/.65,dz=(marylandElevation(x,z+.65)-h)/.65;
      largestGradient=Math.max(largestGradient,Math.hypot(dx,dz));
    }
    expect(largestGradient*.65).toBeLessThan(.45);
  });
  it('keeps library, administration, STAMP and fountain foundations level',()=>{
    for(const [x,z,w,d] of [[-160,0,64,92],[160,0,48,82],[-185,-236,86,60],[5,0,78,7.1]]){
      const h=marylandElevation(x,z);
      for(const dx of [-w/2,0,w/2])for(const dz of [-d/2,0,d/2])expect(Math.abs(marylandElevation(x+dx,z+dz)-h)).toBeLessThan(.08);
    }
  });
  it('does not raise terrain into the open garage ground decks',()=>{
    for(const b of UMD_FULL_BUILDINGS.filter(b=>b.kind==='garage')){
      const base=marylandElevation(b.x,b.z);
      for(const [x,z] of b.footprint)expect(marylandElevation(x,z),`${b.name} at ${x},${z}`).toBeLessThan(base+.18);
    }
  });
  it('drapes independently subdivided lawn and road onto the identical height field',()=>{
    const material=new MeshBasicMaterial();
    const lawn=new PlaneGeometry(340,100).rotateX(-Math.PI/2).translate(-10,0,-165);
    const road=new PlaneGeometry(340,10,7,1).rotateX(-Math.PI/2).translate(-10,.07,-165);
    const ground=[new Mesh(drapeMarylandGeometry(lawn,24),material),new Mesh(drapeMarylandGeometry(road,5),material)];
    ground.forEach(mesh=>mesh.updateMatrixWorld());
    const low=createCampusGroundSampler([ground[0]]),high=createCampusGroundSampler([ground[1]]);
    for(let x=-175;x<155;x+=2.7){
      expect(high(x,-165)!-low(x,-165)!).toBeCloseTo(.07,4);
      expect(low(x,-165)).toBeCloseTo(marylandElevation(x,-165),4);
    }
    expect(lawn.getAttribute('position').count).toBe(4);
  });
  it('preserves UVs and vertical curb faces while omitting hidden undersides',()=>{
    const source=new BoxGeometry(20,.2,8).translate(-185,.1,-165),result=drapeMarylandGeometry(source,6);
    expect(result.getAttribute('uv').count).toBe(result.getAttribute('position').count);
    const normals=result.getAttribute('normal'),uv=result.getAttribute('uv');let side=false,top=false;
    for(let i=0;i<normals.count;i++){
      expect(normals.getY(i)).toBeGreaterThanOrEqual(-.01);
      side ||= Math.abs(normals.getY(i))<.1;top ||=normals.getY(i)>.8;
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-5);expect(uv.getX(i)).toBeLessThanOrEqual(1.00001);
    }
    expect(side&&top).toBe(true);expect(result.boundingBox).not.toBeNull();
  });
});
