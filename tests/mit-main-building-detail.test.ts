import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Box3,InstancedMesh,Matrix4,Vector3} from 'three';
import {createMITMainBuildingDetail,MIT_MAIN_BUILDING_ANCHORS} from '../src/features/world/mit-main-building-detail';

const manifest=JSON.parse(readFileSync('public/data/killian/detail-manifest.json','utf8'));

describe('MIT main building supplemental components',()=>{
  it('shares the current source anchors without a fetch and preserves the capital silhouettes in low quality',()=>{
    expect(MIT_MAIN_BUILDING_ANCHORS.porticoOpening.center).toEqual(manifest.porticoOpening.center);
    expect(MIT_MAIN_BUILDING_ANCHORS.porticoOpening.normal).toEqual(manifest.porticoOpening.normal);
    expect(MIT_MAIN_BUILDING_ANCHORS.dome.center).toEqual(manifest.dome.center);
    expect(MIT_MAIN_BUILDING_ANCHORS.dome.profile[0]).toEqual(manifest.dome.profile[0]);
    const group=createMITMainBuildingDetail();
    const full=group.stats.visibleTriangles;
    group.setQuality(true);
    expect(group.getObjectByName('MIT-Ionic-solid-bolsters')!.visible).toBe(true);
    expect(group.getObjectByName('MIT-drum-paired-ribs')!.visible).toBe(true);
    expect(group.getObjectByName('MIT-drum-guttae')!.visible).toBe(false);
    expect(group.stats.visibleTriangles).toBeLessThan(full);
    group.setQuality(false);
    expect(group.stats.visibleTriangles).toBe(full);
  });

  it('anchors solid capital backs to the original ten columns and leaves the original scroll faces exposed',()=>{
    const group=createMITMainBuildingDetail(manifest);
    const mesh=group.getObjectByName('MIT-Ionic-solid-bolsters') as InstancedMesh;
    expect(mesh.count).toBe(10);
    const {center,normal:[nx,,nz]}=manifest.porticoOpening;
    const matrix=new Matrix4(),position=new Vector3();
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
      const x=(i-4.5)*4.10,z=1.15+.4*(1-(x/19)**2);
      expect(position.x).toBeCloseTo(center[0]+nz*x+nx*z,4);
      expect(position.z).toBeCloseTo(center[2]-nx*x+nz*z,4);
      expect(position.y).toBeCloseTo(18.92,4);
    }
    mesh.geometry.computeBoundingBox();
    const bounds=mesh.geometry.boundingBox!;
    expect(bounds.max.z).toBeCloseTo(.745,4);
    expect(bounds.min.z).toBeCloseTo(-.745,4);
    // Existing scroll tubes are centred at +/-0.78, radius .036. Backing
    // meets their inner edge instead of covering their outward-facing relief.
    expect(bounds.max.z).toBeLessThan(.78);
    expect(bounds.min.y+18.92).toBeGreaterThan(18.85);
  });

  it('keeps drum embellishments outside the measured barrel and all additions out of walk collisions',()=>{
    const group=createMITMainBuildingDetail(manifest);
    const matrix=new Matrix4(),position=new Vector3();
    const radius=manifest.dome.profile[0][0];
    for(const child of group.children){
      const mesh=child as InstancedMesh;
      expect(mesh.userData.collision).toBe('none');
      expect(mesh.geometry.getAttribute('position').array.every(Number.isFinite)).toBe(true);
      if(!mesh.name.startsWith('MIT-drum'))continue;
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
        expect(Math.hypot(position.x-manifest.dome.center[0],position.z-manifest.dome.center[1])).toBeGreaterThan(radius);
      }
    }
    const bounds=new Box3().setFromObject(group);
    expect(bounds.min.y).toBeGreaterThan(4.86498924701769+3.32);
    expect(group.userData.mainBuildingDetail).toMatchObject({columns:10,drumRibs:128,drumGuttae:320,wreaths:2,doorHeads:3,batches:7});
    expect(group.userData.mainBuildingDetail.triangles).toBeLessThan(42000);
  });

  it('keeps projecting door heads above the existing open apertures and preserves their low-tier silhouette',()=>{
    const group=createMITMainBuildingDetail(manifest);
    const {center,normal:[nx,,nz]}=manifest.porticoOpening;
    const matrix=new Matrix4(),position=new Vector3();
    const bounds=new Box3(),doorTop=4.86498924701769+3.32;
    for(const name of ['MIT-entrance-head-moldings','MIT-entrance-head-silhouettes']){
      const mesh=group.getObjectByName(name) as InstancedMesh;
      expect(mesh.count).toBe(9);
      mesh.geometry.computeBoundingBox();
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
        bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix);
        expect(bounds.min.y).toBeGreaterThan(doorTop);
        const x=(position.x-center[0])*nz-(position.z-center[2])*nx;
        const doorX=[-4.10,0,4.10][Math.floor(i/3)];
        expect(Math.abs(x-doorX)).toBeLessThanOrEqual(1.301);
      }
    }
    group.setQuality(true);
    expect(group.getObjectByName('MIT-entrance-head-moldings')!.visible).toBe(true);
    expect(group.getObjectByName('MIT-entrance-head-silhouettes')!.visible).toBe(true);
    expect(group.getObjectByName('MIT-frieze-wreath-rings')!.visible).toBe(true);
    expect(group.getObjectByName('MIT-frieze-wreath-leaves')!.visible).toBe(false);
  });

  it('connects the hanging drum ornaments to the existing lower torus molding',()=>{
    const group=createMITMainBuildingDetail(manifest);
    const drops=group.getObjectByName('MIT-drum-guttae') as InstancedMesh;
    const matrix=new Matrix4(),position=new Vector3();
    const radius=manifest.dome.profile[0][0];
    for(let i=0;i<drops.count;i++){
      drops.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
      const radial=Math.hypot(position.x-manifest.dome.center[0],position.z-manifest.dome.center[1]);
      const ringOffset=radial-(radius+.07);
      const ringBottom=34.12-Math.sqrt(.08**2-ringOffset**2);
      expect(position.y+.085/2).toBeGreaterThan(ringBottom);
      expect(position.y-.085/2).toBeLessThan(ringBottom);
    }
  });
});
