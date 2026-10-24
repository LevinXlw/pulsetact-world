import {describe,expect,it} from 'vitest';
import {ALL_CAMPUS_PLACES,REMOTE_LAYOUTS,campusNavigationGuide,campusPlaces,campusSpawn,insideCampus,nearestCampusPlace} from '../src/features/world/campus-regions';
import {changeSoloCampus,defaultSoloProgress,sanitizeSoloProgress} from '../src/features/world/solo-progress';
import {guideCampusPaths} from '../src/features/world/campus-paths';
import type {CampusLayout} from '../src/features/world/campus-regions';

describe('independent campus journeys',()=>{
  it('keeps older Boston saves and their original discoveries intact',()=>{
    const saved=sanitizeSoloProgress({version:1,position:[-632,1098],visited:['axis','dome'],visitedPlaces:['bu-questrom'],trackedId:'bu-questrom',lesson:{stage:1,mirrorA:-45}});
    expect(saved.campus).toBe('boston');expect(saved.position).toEqual([-632,1098]);expect(saved.trackedId).toBe('bu-questrom');
    expect(saved.visited).toEqual(['axis','dome']);expect(saved.visitedPlaces).toEqual(['bu-questrom']);expect(saved.campusVisits).toEqual([]);
  });
  it('round trips each campus checkpoint without mixing local coordinates or losing work',()=>{
    const original={...defaultSoloProgress(),visited:['axis'],visitedPlaces:['bu-beach'],photos:4,quality:'low' as const};
    const maryland=changeSoloCampus(original,[-632,1098],'umd');
    expect(maryland.position).toEqual(campusSpawn('umd'));expect(maryland.campusPositions.boston).toEqual([-632,1098]);
    maryland.campusVisits=['umd-library'];
    const penn=changeSoloCampus(maryland,[0,14],'upenn');
    penn.campusVisits.push('penn-college');
    const back=changeSoloCampus(penn,[-23,29],'boston');
    expect(back.position).toEqual([-632,1098]);expect(back.campusPositions.umd).toEqual([0,14]);expect(back.campusPositions.upenn).toEqual([-23,29]);
    expect(back.visited).toEqual(['axis']);expect(back.visitedPlaces).toEqual(['bu-beach']);expect(back.photos).toBe(4);expect(back.quality).toBe('low');
    expect(back.campusVisits).toEqual(['umd-library','penn-college']);
    expect(sanitizeSoloProgress(back)).toEqual(back);
    expect(changeSoloCampus(back,[-632,1098],'umd').position).toEqual([0,14]);
  });
  it('validates coordinates and tracked destinations against the saved campus',()=>{
    const malformed=sanitizeSoloProgress({version:1,campus:'umd',position:[99999,99999],trackedId:'penn-college',campusVisits:['umd-library','umd-library','axis','unknown'],campusPositions:{umd:[Infinity,0],upenn:[-23,29],boston:[0,0],unknown:[1,2]}});
    expect(malformed.position).toBeUndefined();expect(malformed.trackedId).toBe('umd-library');
    expect(malformed.campusVisits).toEqual(['umd-library']);expect(malformed.campusPositions).toEqual({upenn:[-23,29],boston:[0,0]});
    expect(sanitizeSoloProgress({version:1,campus:'upenn',position:[-23,29],trackedId:'optics'}).trackedId).toBe('penn-college');
    expect(sanitizeSoloProgress({version:1,campus:'unknown'}).campus).toBe('boston');
    expect(insideCampus('umd',NaN,0)).toBe(false);
  });
  it('makes regional discoveries unique and guides every pair of arrival points both ways',()=>{
    expect(new Set(ALL_CAMPUS_PLACES.map(point=>point.id)).size).toBe(ALL_CAMPUS_PLACES.length);
    expect(campusPlaces('umd')).toHaveLength(19);
    for(const campus of ['umd','upenn'] as const){
      const points=campusPlaces(campus);
      expect(nearestCampusPlace(campus,campusSpawn(campus))).toBeDefined();
      for(const from of points)for(const to of points){
        let position:[number,number]=[...from.position];
        // Visit every route turn rather than take centimetre steps across all
        // campus pairs. Separate segment checks cover continuous clearance.
        for(let i=0;i<1000&&Math.hypot(position[0]-to.position[0],position[1]-to.position[1])>1;i++){
          const guide=campusNavigationGuide(campus,position,to.position),dx=guide.point[0]-position[0],dz=guide.point[1]-position[1],length=Math.hypot(dx,dz);
          expect(Number.isFinite(guide.distance)).toBe(true);
          expect(length).toBeGreaterThan(0);position=[...guide.point];
          expect(insideCampus(campus,...position)).toBe(true);
          // Route corners must keep the player capsule outside every footprint.
          const obstructing=REMOTE_LAYOUTS[campus].mapBuildings.find(building=>{
            const dx=position[0]-building.x,dz=position[1]-building.z,c=Math.cos(building.yaw),s=Math.sin(building.yaw);
            return Math.abs(c*dx-s*dz)<building.width/2+.65&&Math.abs(s*dx+c*dz)<building.depth/2+.65;
          });
          expect(obstructing,`${campus}: ${from.id} → ${to.id} at ${position}`).toBeUndefined();
        }
        expect(Math.hypot(position[0]-to.position[0],position[1]-to.position[1])).toBeLessThanOrEqual(1);
      }
      for(const path of REMOTE_LAYOUTS[campus].paths??[REMOTE_LAYOUTS[campus].route])for(const p of path)expect(insideCampus(campus,...p)).toBe(true);
    }
  });
  it('keeps every authored walkway clear of building footprints',()=>{
    for(const campus of ['umd','upenn'] as const){
      const layout=REMOTE_LAYOUTS[campus];
      for(const path of layout.paths??[layout.route])for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);
        for(let step=0;step<=steps;step++){
          const t=steps?step/steps:0,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
          const obstructing=layout.mapBuildings.find(building=>{
            const dx=x-building.x,dz=z-building.z,c=Math.cos(building.yaw),s=Math.sin(building.yaw);
            return Math.abs(c*dx-s*dz)<building.width/2+.65&&Math.abs(s*dx+c*dz)<building.depth/2+.65;
          });
          expect(obstructing,`${campus}: walkway ${a} → ${b} at ${x},${z}`).toBeUndefined();
        }
      }
    }
  });
  it('preserves original Maryland checkpoints while accepting new destinations',()=>{
    const saved=sanitizeSoloProgress({version:1,campus:'umd',position:[0,14],trackedId:'umd-administration',campusVisits:['umd-library','umd-mall','umd-administration'],campusPositions:{boston:[-632,1098],umd:[0,14]}});
    expect(saved.position).toEqual([0,14]);expect(saved.trackedId).toBe('umd-administration');
    expect(saved.campusVisits).toEqual(['umd-library','umd-mall','umd-administration']);
    const expanded=sanitizeSoloProgress({...saved,position:[-185,-182],trackedId:'umd-stamp',campusVisits:[...saved.campusVisits,'umd-stamp','umd-armory','umd-chapel']});
    expect(expanded.position).toEqual([-185,-182]);expect(expanded.trackedId).toBe('umd-stamp');expect(expanded.campusVisits).toHaveLength(6);
  });
  it('covers every Maryland district with searchable buildings and a distinct arrival point',()=>{
    const layout=REMOTE_LAYOUTS.umd,districts=layout.districts!;
    expect(districts).toHaveLength(11);expect(layout.mapBuildings.length).toBeGreaterThanOrEqual(150);
    expect(new Set(districts.map(district=>district.id)).size).toBe(districts.length);
    for(const district of districts){
      expect(layout.mapBuildings.some(building=>building.district===district.id&&building.label)).toBe(true);
      expect(layout.points.some(point=>point.district===district.id)).toBe(true);
      expect(insideCampus('umd',...district.center)).toBe(true);
    }
    for(const point of layout.points){
      expect(nearestCampusPlace('umd',point.position)?.id).toBe(point.id);
      expect(districts.some(district=>district.id===point.district)).toBe(true);
      expect(sanitizeSoloProgress({version:1,campus:'umd',position:point.position,trackedId:point.id,campusVisits:[point.id]})).toMatchObject({position:point.position,trackedId:point.id,campusVisits:[point.id]});
    }
    const previousPositions=[[-108,14],[0,14],[110,14],[-185,-182],[174,-140],[110,145]];
    expect(layout.points.slice(0,6).map(point=>point.position)).toEqual(previousPositions);
  });
  it('walks around the northern faculty buildings instead of pointing through them',()=>{
    const stamp=campusPlaces('umd').find(p=>p.id==='umd-stamp')!,library=campusPlaces('umd')[0];
    expect(campusNavigationGuide('umd',stamp.position,library.position).point).toEqual([-185,-155]);
    expect(campusNavigationGuide('umd',[-185,-155],library.position).point).toEqual([-116,-155]);
    expect(campusNavigationGuide('umd',[-116,-155],library.position).point).toEqual([-116,14]);
    expect(campusNavigationGuide('umd',stamp.position,library.position).distance).toBeCloseTo(273);
  });
  it('joins crossing walkways and chooses the shorter side of a loop',()=>{
    const layout:CampusLayout={bounds:{minX:0,maxX:100,minZ:0,maxZ:100},spawn:[0,25],lookTarget:[50,25],route:[[0,25],[100,25]],points:[],mapBuildings:[],paths:[[[0,25],[100,25]],[[50,0],[50,50]]]};
    const crossing=guideCampusPaths(layout,[0,25],[50,50]);
    expect(crossing.point).toEqual([50,25]);expect(crossing.distance).toBeCloseTo(75);
    const loop:CampusLayout={...layout,paths:[[[0,0],[0,100],[100,100],[100,0]],[[0,0],[100,0]]]};
    expect(guideCampusPaths(loop,[0,0],[100,0]).distance).toBeCloseTo(100);
    expect(guideCampusPaths(loop,[0,0],[100,0]).point).toEqual([100,0]);
  });
  it('reuses destination routes while handling either approach and projections along one edge',()=>{
    const layout:CampusLayout={bounds:{minX:-20,maxX:120,minZ:-20,maxZ:120},spawn:[0,0],lookTarget:[100,0],route:[[0,0],[100,0]],points:[],mapBuildings:[],paths:[[[0,0],[100,0],[100,100],[0,100],[0,0]]]};
    expect(guideCampusPaths(layout,[20,0],[80,0])).toMatchObject({point:[80,0],distance:60,viaRoute:false});
    expect(guideCampusPaths(layout,[90,0],[80,0])).toMatchObject({point:[80,0],distance:10,viaRoute:false});
    expect(guideCampusPaths(layout,[100,50],[80,0])).toMatchObject({point:[100,0],distance:70,viaRoute:true});
    expect(guideCampusPaths(layout,[0,20],[80,0])).toMatchObject({point:[0,0],distance:100,viaRoute:true});
    expect(guideCampusPaths(layout,[50,-10],[80,0])).toMatchObject({point:[50,0],distance:40,viaRoute:true});
    // A search can request many unique coordinates without invalidating routes
    // to actual landmarks when the bounded cache turns over.
    for(let x=0;x<100;x++)expect(guideCampusPaths(layout,[0,100],[x,0]).distance).toBeCloseTo(100+x);
    expect(guideCampusPaths(layout,[90,0],[80,0]).distance).toBeCloseTo(10);
  });
});
