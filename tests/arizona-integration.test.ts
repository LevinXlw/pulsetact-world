import {describe,expect,it} from 'vitest';
import {ATLAS_SCHOOLS} from '../src/features/world/campus-atlas-data';
import {campusForPlace,campusPlaces,campusSpawn,normalizeCampus} from '../src/features/world/campus-regions';
import {defaultSoloProgress,changeSoloCampus,sanitizeSoloProgress} from '../src/features/world/solo-progress';
import {resolveWorldArrival} from '../src/features/world/world-arrival';
import {distanceKm,globeVector} from '../src/features/world/globe-geography';
import {OrthographicCamera,Vector3} from 'three';
import {arizonaNavigationBlocked} from '../src/features/world/arizona-geography';

describe('Arizona as an independent playable campus',()=>{
  it('keeps positions and discoveries across an Arizona roundtrip and reload',()=>{
    const before={...defaultSoloProgress(),campus:'umd' as const,position:[0,14] as [number,number],campusVisits:['umd-library'],visited:['axis'],visitedPlaces:['bu-questrom'],photos:4};
    const arizona=changeSoloCampus(before,[0,14],'arizona');
    expect(arizona.position).toEqual(campusSpawn('arizona'));
    const place=campusPlaces('arizona').find(p=>p.id==='arizona-enr2')!;
    const explored={...arizona,position:place.position,trackedId:place.id,campusVisits:[...arizona.campusVisits,place.id]};
    const returning=changeSoloCampus(explored,place.position,'umd');
    expect(returning.position).toEqual([0,14]);
    const restored=sanitizeSoloProgress(JSON.parse(JSON.stringify(changeSoloCampus(returning,[0,14],'arizona'))));
    expect(restored.position).toEqual(place.position);expect(restored.campusPositions.umd).toEqual([0,14]);
    expect(restored.campusVisits).toEqual(['umd-library',place.id]);expect(restored.photos).toBe(4);
    expect(restored.visited).toEqual(['axis']);expect(restored.visitedPlaces).toEqual(['bu-questrom']);
    expect(before.campusVisits).toEqual(['umd-library']);
  });

  it('recognizes every Arizona destination and rejects foreign or malformed saved coordinates',()=>{
    expect(normalizeCampus('arizona')).toBe('arizona');
    for(const point of campusPlaces('arizona'))expect(campusForPlace(point.id)).toBe('arizona');
    const saved=sanitizeSoloProgress({version:1,campus:'arizona',position:[999999,3],campusPositions:{arizona:[null,2],umd:[0,14]},trackedId:'umd-library'});
    expect(saved.position).toBeUndefined();expect(saved.campusPositions.arizona).toBeUndefined();
    expect(saved.trackedId).toBe(campusPlaces('arizona')[0].id);
    expect(resolveWorldArrival('arizona',saved.position,()=>3)?.position).toEqual(campusSpawn('arizona'));
  });

  it('recovers a position occupied by Old Main while preserving the open ENR2 canyon',()=>{
    expect(arizonaNavigationBlocked(0,0)).toBe(true);
    const recovered=resolveWorldArrival('arizona',[0,0],()=>3)!;
    expect(arizonaNavigationBlocked(...recovered.position)).toBe(false);
    expect(recovered.position).toEqual(campusPlaces('arizona')[0].position);
    const courtyard:[number,number]=[-178.13,403.26];
    expect(arizonaNavigationBlocked(...courtyard)).toBe(false);
    expect(resolveWorldArrival('arizona',courtyard,()=>3)?.position).toEqual(courtyard);
  });

  it('shows Tucson southwest of the existing campuses and within the Southwest camera',()=>{
    const school=ATLAS_SCHOOLS.find(s=>s.id==='arizona')!,mit=ATLAS_SCHOOLS.find(s=>s.id==='mit')!;
    expect(school.campusId).toBe('arizona');expect(school.status).toBe('open');expect(school.city).toBe('Tucson');
    expect(school.location[0]).toBeLessThan(-110);expect(school.location[0]).toBeGreaterThan(-112);
    expect(school.location[1]).toBeGreaterThan(32);expect(school.location[1]).toBeLessThan(33);
    expect(distanceKm(school.location,mit.location)).toBeGreaterThan(3600);expect(distanceKm(school.location,mit.location)).toBeLessThan(3900);
    const camera=new OrthographicCamera(-1.22,1.22,1.22,-1.22,.1,8);
    camera.position.set(...globeVector([-111,32.4])).multiplyScalar(3);camera.zoom=9;camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const point=new Vector3(...globeVector(school.location)).project(camera);
    expect(Math.abs(point.x)).toBeLessThan(.5);expect(Math.abs(point.y)).toBeLessThan(.5);
  });
});
