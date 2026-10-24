import {describe,expect,it} from 'vitest';
import {BU_FULL_PLACES,buNavigationBlocked} from '../src/features/world/bu-campus-layout';
import {campusSpawn,walkableCampus} from '../src/features/world/campus-regions';
import {changeSoloCampus,defaultSoloProgress} from '../src/features/world/solo-progress';
import {resolveWorldArrival} from '../src/features/world/world-arrival';
import {BU_FULL_BUILDINGS,isInsideBUCampusBuilding} from '../src/features/world/bu-full-layout';
import {MARYLAND_LAYOUT,marylandNavigationBlocked} from '../src/features/world/maryland-layout';
import {UMD_FULL_BUILDINGS} from '../src/features/world/maryland-full-layout';

const oldWarren:[number,number]=[-980.657,1095.065];
const ground=()=>5.2;

describe('restoring a position after the campus changes',()=>{
  it('recovers a Maryland checkpoint occupied by a corrected engineering building',()=>{
    // Previously open ground north of the undersized Clark model.
    const former:[number,number]=[476,-832];
    expect(marylandNavigationBlocked(...former)).toBe(true);
    const arrival=resolveWorldArrival('umd',former,ground)!;
    expect(marylandNavigationBlocked(...arrival.position)).toBe(false);
    expect(arrival.position).toEqual(MARYLAND_LAYOUT.points.find(p=>p.id==='umd-clark')!.position);
  });
  it('retains Maryland outdoor courts and does not replace them with bounding boxes',()=>{
    const hole=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId==='091')!.holes![0];
    const point:[number,number]=[hole.reduce((s,p)=>s+p[0],0)/hole.length,hole.reduce((s,p)=>s+p[1],0)/hole.length];
    expect(marylandNavigationBlocked(...point)).toBe(false);
    expect(resolveWorldArrival('umd',point,ground)?.position).toEqual(point);
    expect(resolveWorldArrival('umd',[-525,470],ground)?.position).toEqual([-525,470]);
    expect(resolveWorldArrival('umd',[-465,-565],ground)?.position).toEqual([-465,-565]);
  });
  it('retains a safe outdoor courtyard checkpoint instead of treating the whole footprint as solid',()=>{
    const courtyard=BU_FULL_BUILDINGS.find(b=>b.id==='the-towers')!.holes![0];
    const point:[number,number]=[courtyard.reduce((sum,p)=>sum+p[0],0)/courtyard.length,courtyard.reduce((sum,p)=>sum+p[1],0)/courtyard.length];
    expect(isInsideBUCampusBuilding(...point,.85)).toBe(false);
    expect(buNavigationBlocked(...point)).toBe(false);
    expect(resolveWorldArrival('boston',point,ground)?.position).toEqual(point);
  });
  it('moves an old Warren Towers checkpoint to the nearest safe BU arrival even though terrain exists underneath',()=>{
    expect(walkableCampus('boston',...oldWarren)).toBe(true);
    expect(buNavigationBlocked(...oldWarren)).toBe(true);
    const arrival=resolveWorldArrival('boston',oldWarren,ground)!;
    const nearest=BU_FULL_PLACES.filter(p=>walkableCampus('boston',...p.position)&&!buNavigationBlocked(...p.position)).sort((a,b)=>Math.hypot(a.position[0]-oldWarren[0],a.position[1]-oldWarren[1])-Math.hypot(b.position[0]-oldWarren[0],b.position[1]-oldWarren[1]))[0];
    expect(arrival.position).toEqual(nearest.position);
    expect(arrival.position).not.toEqual(oldWarren);
    expect(buNavigationBlocked(...arrival.position)).toBe(false);
    expect(arrival.height).toBe(5.2);
  });

  it('repairs a Boston campusPositions revisit without altering completed work or the saved input',()=>{
    const saved={...defaultSoloProgress(),campus:'umd' as const,campusPositions:{boston:[...oldWarren] as [number,number]},visited:['axis','dome'],visitedPlaces:['bu-questrom'],campusVisits:['umd-library'],photos:7,photoSpots:['dome'],trackedId:'umd-library',lesson:{...defaultSoloProgress().lesson,stage:1 as const}};
    const returning=changeSoloCampus(saved,[0,14],'boston'),before=structuredClone(returning);
    const arrival=resolveWorldArrival('boston',returning.position,ground)!;
    expect(arrival.position).not.toEqual(oldWarren);
    expect(returning).toEqual(before);
    expect(returning).toMatchObject({visited:saved.visited,visitedPlaces:saved.visitedPlaces,campusVisits:saved.campusVisits,photos:7,photoSpots:saved.photoSpots,lesson:saved.lesson});
    expect(saved.campusPositions.boston).toEqual(oldWarren);
  });

  it('keeps safe positions unchanged and returns a separate coordinate array',()=>{
    const requested=BU_FULL_PLACES.find(p=>p.id==='bu-warren')!.position;
    const arrival=resolveWorldArrival('boston',requested,()=>6.75)!;
    expect(arrival).toEqual({position:requested,height:6.75});
    expect(arrival.position).not.toBe(requested);
  });

  it('skips nearby arrivals without valid ground and never falls back into the obstructed save',()=>{
    const far=BU_FULL_PLACES.find(p=>p.id==='bu-nickerson')!.position;
    const arrival=resolveWorldArrival('boston',oldWarren,(x,z)=>x===far[0]&&z===far[1]?9:undefined)!;
    expect(arrival).toEqual({position:far,height:9});
    expect(resolveWorldArrival('boston',oldWarren,()=>undefined)).toBeUndefined();
  });

  it.each([[99999,99999],[NaN,0],[Infinity,5]] as [number,number][])('returns an invalid Boston position %j to the safe spawn',(x,z)=>{
    expect(resolveWorldArrival('boston',[x,z],ground)?.position).toEqual(campusSpawn('boston'));
  });

  it('rejects nonfinite ground and keeps the other campuses in their own coordinate system',()=>{
    const spawn=campusSpawn('boston');
    expect(resolveWorldArrival('boston',BU_FULL_PLACES[0].position,(x,z)=>x===spawn[0]&&z===spawn[1]?3:NaN)).toEqual({position:spawn,height:3});
    for(const campus of ['umd','upenn'] as const)expect(resolveWorldArrival(campus,campusSpawn(campus),ground)?.position).toEqual(campusSpawn(campus));
  });
});
