import {describe,expect,it,vi} from 'vitest';
import {Box3,Mesh,Vector3} from 'three';
import {BU_COMMONWEALTH_MEDIAN,buSegmentProjection} from '../src/features/world/bu-campus-layout';
import {BU_GREEN_LINE_DWELL,BU_GREEN_LINE_GAUGE,BU_GREEN_LINE_MAX_SPEED,BU_GREEN_LINE_PATHS,BU_GREEN_LINE_STATIONS,BU_GREEN_LINE_TIMETABLES,BU_GREEN_LINE_TRACK_OFFSET,BU_GREEN_LINE_VEHICLE,sampleBUGreenLine,sampleBUGreenLineService} from '../src/features/world/bu-green-line-layout';
import {createBUGreenLine} from '../src/features/world/bu-green-line';
import {buElevation} from '../src/features/world/bu-terrain';

describe('BU Green Line B runtime service',()=>{
  it('uses the five campus stops in geographic order and the existing standard-gauge tracks',()=>{
    expect(BU_GREEN_LINE_STATIONS.map(s=>s.name)).toEqual(['Blandford Street','Boston University East','Boston University Central','Amory Street','Babcock Street']);
    expect(BU_GREEN_LINE_GAUGE).toBeCloseTo(2.45-1.015,8);
    for(const [direction,path] of Object.entries(BU_GREEN_LINE_PATHS)){
      expect(path.length).toBeGreaterThan(2200);expect(path.length).toBeLessThan(2400);
      // Reconstruct the already-rendered rail heads independently. The mobile
      // track uses adjacent-vertex normals at curves, rather than a perfect
      // analytic offset from the road-axis polyline.
      const rails=[1.015,2.45].map(offset=>BU_COMMONWEALTH_MEDIAN.map(([x,z],i,list)=>{
        const a=list[Math.max(0,i-1)],b=list[Math.min(list.length-1,i+1)],length=Math.hypot(b[0]-a[0],b[1]-a[1]),sign=direction==='inbound'?1:-1;
        return[x-(b[1]-a[1])/length*offset*sign,z+(b[0]-a[0])/length*offset*sign] as [number,number];
      }));
      const centers=rails[0].map((p,i)=>[(p[0]+rails[1][i][0])/2,(p[1]+rails[1][i][1])/2] as [number,number]);
      for(let distance=0;distance<path.length;distance+=7){
        const p=sampleBUGreenLine(path,distance);
        const error=Math.min(...centers.slice(1).map((b,i)=>buSegmentProjection(p.x,p.z,centers[i],b).distance));
        expect(error,`${direction} must follow rendered rail midpoint at ${distance}`).toBeLessThan(.001);
      }
      const stations=BU_GREEN_LINE_STATIONS.map(s=>s.distances[direction as 'inbound'|'outbound']);
      expect(stations.every((d,i)=>!i||(direction==='inbound'?d<stations[i-1]:d>stations[i-1]))).toBe(true);
    }
    const railSeparation=2*BU_GREEN_LINE_TRACK_OFFSET;
    expect(railSeparation-BU_GREEN_LINE_VEHICLE.width).toBeGreaterThan(.8);
    for(const station of BU_GREEN_LINE_STATIONS){
      expect(station.platformOffset-station.width/2-BU_GREEN_LINE_TRACK_OFFSET-BU_GREEN_LINE_VEHICLE.width/2).toBeGreaterThan(.15);
      expect(station.platformOffset-(station.width+.12)/2-BU_GREEN_LINE_TRACK_OFFSET-BU_GREEN_LINE_VEHICLE.width/2).toBeGreaterThan(.09);
    }
  });

  it('brakes at every platform, holds still with doors open and resets only while invisible',()=>{
    for(const table of Object.values(BU_GREEN_LINE_TIMETABLES)){
      for(const leg of table.legs.filter(l=>l.stopId)){
        const arrival=leg.at+leg.duration;
        const stop=BU_GREEN_LINE_STATIONS.find(s=>s.id===leg.stopId)!;
        for(const dt of [2,6,11]){
          const state=sampleBUGreenLineService(table,arrival+dt);
          expect(state.stationId).toBe(stop.id);expect(state.distance).toBeCloseTo(stop.distances[table.direction],7);expect(state.speed).toBe(0);expect(state.doors).toBe(1);
        }
        expect(sampleBUGreenLineService(table,arrival-.01).speed).toBeLessThan(.02);
        expect(sampleBUGreenLineService(table,arrival+BU_GREEN_LINE_DWELL+.01).speed).toBeLessThan(.02);
      }
      let previous=sampleBUGreenLineService(table,0);
      for(let t=.1;t<table.duration;t+=.1){
        const state=sampleBUGreenLineService(table,t);
        expect(state.distance).toBeGreaterThanOrEqual(previous.distance-1e-6);
        expect(state.distance-previous.distance).toBeLessThanOrEqual(BU_GREEN_LINE_MAX_SPEED*.1+.00001);
        expect(state.distance).toBeGreaterThanOrEqual(table.start);expect(state.distance).toBeLessThanOrEqual(table.end+.00001);
        previous=state;
      }
      expect(sampleBUGreenLineService(table,table.duration-.001).opacity).toBe(0);
      expect(sampleBUGreenLineService(table,table.duration).opacity).toBe(0);
      expect(sampleBUGreenLineService(table,table.duration+12)).toEqual(sampleBUGreenLineService(table,12));
    }
  });

  it('keeps every articulated body and bogie finite and above the draped track across a full service loop',()=>{
    const service=createBUGreenLine({quality:'mobile'});
    try{
      const trains=service.group.children.filter(g=>g.name.startsWith('Green Line B '));expect(trains).toHaveLength(2);
      let meshCount=0,triangles=0;
      service.group.traverse(object=>{if(object instanceof Mesh){meshCount++;triangles+=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3;}});
      expect(meshCount).toBeLessThan(140);expect(triangles).toBeLessThan(25000);
      const box=new Box3(),p=new Vector3();
      for(let t=0;t<Math.max(...Object.values(BU_GREEN_LINE_TIMETABLES).map(s=>s.duration))+1;t++){
        service.update(1);service.group.updateMatrixWorld(true);
        for(const train of trains)for(const section of train.children){
          const {x,y,z}=section.position;expect(Number.isFinite(x+y+z)).toBe(true);
          expect(y-buElevation(x,z)).toBeGreaterThanOrEqual(BU_GREEN_LINE_VEHICLE.railHeight-.001);
          if(section.name.startsWith('Articulated body')){
            box.setFromObject(section);box.getSize(p);expect(p.y).toBeLessThan(7);
            // Lower sill/underframe remains above the rail at both body ends.
            for(const along of [-3,0,3]){p.set(0,.55,along).applyMatrix4(section.matrixWorld);expect(p.y-buElevation(p.x,p.z)).toBeGreaterThan(.30);}
          }
        }
      }
    }finally{service.dispose();}
  });

  it('respects reduced motion and releases geometries/materials once on dispose',()=>{
    const service=createBUGreenLine({quality:'mobile',reducedMotion:true}),train=service.group.children.find(g=>g.name.startsWith('Green Line B '))!;
    const before={...train.userData};service.update(12);expect(train.userData).toEqual(before);
    let mesh:Mesh|undefined;service.group.traverse(object=>{if(!mesh&&object instanceof Mesh)mesh=object;});
    const dispose=vi.spyOn(mesh!.geometry,'dispose');service.dispose();service.dispose();service.update(1);
    expect(dispose).toHaveBeenCalledOnce();expect(service.group.children).toHaveLength(0);
  });
});
