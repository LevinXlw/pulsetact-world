import {describe,it,expect} from 'vitest';
import {PlaneGeometry,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {BU_TERRAIN_DATA} from '../src/features/world/bu-terrain-data';
import {buDEMWeight,buSurveyElevation,buElevation,drapeBUGeometry} from '../src/features/world/bu-terrain';

describe('BU central district bare-earth terrain',()=>{
  it('ships complete native elevation samples with acquisition provenance',()=>{
    const {grid,values}=BU_TERRAIN_DATA;
    expect(values).toHaveLength(grid.columns*grid.rows);
    expect(values.every(value=>Number.isFinite(value)&&value> -3&&value<30)).toBe(true);
    expect(BU_TERRAIN_DATA.datasets[0].name).toBe('MA_NE_CMGP_Sandy_Z19_2013');
    expect(BU_TERRAIN_DATA.datasets[0].verticalDatum).toContain('1988');
  });
  it('preserves the measured fall from Marsh Plaza towards the river',()=>{
    // Independent fixed spot checks against the archived raw service responses.
    expect(buSurveyElevation(-1170,1000)).toBeCloseTo(4.580,3);
    expect(buSurveyElevation(-1170,910)).toBeCloseTo(2.943667,3);
    expect(buElevation(-1170,1000)-buElevation(-1170,910)).toBeGreaterThan(1.4);
    expect(buElevation(-1165,850)).toBeLessThan(1.3);
  });
  it('uses actual DEM values at runtime lattice corners inside the core',()=>{
    for(const x of [-1488,-1320,-1176,-912])for(const z of [852,912,972]){
      expect(buDEMWeight(x,z)).toBe(1);
      expect(buElevation(x,z)).toBeCloseTo(buSurveyElevation(x,z)!,6);
    }
  });
  it('limits this pass to the core and makes its boundary continuous',()=>{
    for(const p of [[-1668,960],[-600,960],[-1200,720],[-1200,1100]])expect(buDEMWeight(...p as [number,number])).toBe(0);
    for(const x of [-1608,-624])for(let z=792;z<=1068;z+=12)expect(Math.abs(buElevation(x-.001,z)-buElevation(x+.001,z))).toBeLessThan(.003);
    expect(buSurveyElevation(-5000,0)).toBeUndefined();
  });
  it('drapes visible ground and collision onto the same triangle surface',()=>{
    const source=new PlaneGeometry(96,96);source.rotateX(-Math.PI/2);source.translate(-1176,5.2,948);
    const geometry=drapeBUGeometry(source),material=new MeshBasicMaterial(),mesh=new Mesh(geometry,material),ray=new Raycaster();mesh.updateMatrixWorld(true);
    for(const [x,z] of [[-1207,911],[-1181,932],[-1163,951],[-1133,981]]){
      ray.set(new Vector3(x,100,z),new Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];
      expect(hit).toBeDefined();expect(hit.point.y).toBeCloseTo(buElevation(x,z),4);
    }
    geometry.dispose();source.dispose();material.dispose();
  });
});
