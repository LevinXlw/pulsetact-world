import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Mesh,Raycaster,Vector3,type Material} from 'three';
import {BU_COMMONWEALTH_MEDIAN,BU_ROAD_EDGES,BU_TRANSIT_STOPS,buRoadDistance,buSegmentProjection} from '../src/features/world/bu-campus-layout';
import {BU_FULL_BUILDINGS,BU_FULL_SPACES} from '../src/features/world/bu-full-layout';
import {BU_GROUND_BUILDINGS} from '../src/features/world/bu-campus-footprints';
import {BU_COURTYARD_PUBLIC_SEGMENTS,BU_PUBLIC_FRONTAGES,BU_SIDEWALK_JOIN_PATCHES,BU_TRANSIT_PLATFORM_DETAILS,buClipSidewalkToJunctions,buPublicRealmContains,buStreetSidewalk} from '../src/features/world/bu-public-realm';
import {createBUCampusStreets} from '../src/features/world/bu-campus-streets';
import {configureBUGroundLayer} from '../src/features/world/bu-ground-layers';
import {buElevation} from '../src/features/world/bu-terrain';
import {parseMobileCampus} from '../src/features/world/mobile-campus-glb';

describe('BU street-level public realm',()=>{
  it('keeps authored modern envelopes outside the unchanged road and sidewalk corridors',()=>{
    for(const id of ['booth-theatre','yawkey-center','kilachand-center']){
      const building=BU_FULL_BUILDINGS.find(b=>b.id===id)!;
      expect(building.cityObjectId).toBe(0);
      expect(building.groundElevation).toBeNull();
      expect(building.footprintSource).toContain('authored approximation');
      let clearance=Infinity;
      // Check the whole source envelope, not just its centre or travel arrival.
      // The former Booth and Yawkey envelopes crossed Commonwealth/Bay State.
      for(let i=0;i<building.footprint.length;i++){
        const a=building.footprint[i],b=building.footprint[(i+1)%building.footprint.length];
        const samples=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]));
        for(let step=0;step<=samples;step++){
          const t=step/samples,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
          for(const edge of BU_ROAD_EDGES)clearance=Math.min(clearance,buSegmentProjection(x,z,edge.a,edge.b).distance-edge.road.width/2-buStreetSidewalk(edge.road));
        }
      }
      // Sampling at <=1 m leaves a further buffer beyond rounding tolerance.
      expect(clearance,`${id} footprint intersects a street or sidewalk`).toBeGreaterThan(1.5);
    }
  });

  it('joins real footprint fronts to sidewalks without paving entire parcels',()=>{
    expect(BU_PUBLIC_FRONTAGES.length).toBeGreaterThan(100);
    const ids=new Set(BU_PUBLIC_FRONTAGES.map(p=>p.buildingId));
    expect(ids.size).toBeGreaterThan(60);
    for(const patch of BU_PUBLIC_FRONTAGES){
      expect(patch.area).toBeGreaterThan(0);
      expect(patch.area).toBeLessThan(145);
      // Photo-backed curved aprons have dedicated dense clipping/coverage tests.
      if(patch.source)continue;
      const building=BU_GROUND_BUILDINGS.find(b=>b.id===patch.buildingId)!;
      for(const p of patch.points.slice(0,2))expect(Math.min(...building.footprint.map((a,i)=>buSegmentProjection(...p,a,building.footprint[(i+1)%building.footprint.length]).distance))).toBeLessThan(.001);
      for(const p of patch.points.slice(2)){
        const exits=BU_ROAD_EDGES.filter(e=>e.road.name===patch.roadName).map(e=>Math.abs(buSegmentProjection(...p,e.a,e.b).distance-e.road.width/2-buStreetSidewalk(e.road)+.06));
        expect(Math.min(...exits)).toBeLessThan(.01);
      }
      if(patch.kind==='entrance')expect(Math.hypot(patch.points[1][0]-patch.points[0][0],patch.points[1][1]-patch.points[0][1])).toBeLessThanOrEqual(1.601);
      const x=patch.points.reduce((sum,p)=>sum+p[0],0)/4,z=patch.points.reduce((sum,p)=>sum+p[1],0)/4;
      expect(buRoadDistance(x,z),`frontage intrudes into a cross street: ${patch.buildingId}`).toBeGreaterThan(0);
    }
    // BU Beach, Marsh's forecourt and Nickerson's pitch must stay open.
    for(const p of [[-1200,910],[-1177,965],[-2233,642]])expect(buPublicRealmContains(p[0],p[1])).toBe(false);
  });

  it('keeps mall delivery carriageways separate from positive-width sidewalks',()=>{
    for(const name of ['CUMMINGTON MALL','HINSDALE MALL','BLANDFORD MALL']){
      const road=BU_ROAD_EDGES.find(e=>e.road.name===name)!.road;
      expect(buStreetSidewalk(road)).toBeGreaterThanOrEqual(2);
      expect(road.width).toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps all five stops on the median with long shelters only at the rebuilt stations',()=>{
    expect(BU_TRANSIT_PLATFORM_DETAILS.map(s=>s.name)).toEqual(BU_TRANSIT_STOPS.map(s=>s.name));
    for(const station of BU_TRANSIT_PLATFORM_DETAILS){
      const distance=Math.min(...BU_COMMONWEALTH_MEDIAN.slice(1).map((b,i)=>buSegmentProjection(...station.position,BU_COMMONWEALTH_MEDIAN[i],b).distance));
      expect(distance).toBeLessThan(.001);
      expect(Math.hypot(station.dx,station.dz)).toBeCloseTo(1,8);
      expect(station.platformLength).toBeGreaterThan(station.canopyLength+10);
      if(station.modern)expect(station.canopyLength).toBeCloseTo(150*.3048,5);
    }
  });

  it('leaves sports turf clear of touring-route paving and removes paving from cross streets',()=>{
    expect(BU_COURTYARD_PUBLIC_SEGMENTS.length).toBeGreaterThan(0);
    for(const [a,b] of BU_COURTYARD_PUBLIC_SEGMENTS){
      const samples=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3));
      for(let step=0;step<=samples;step++)for(const field of BU_FULL_SPACES){
        const x=a[0]+(b[0]-a[0])*step/samples-field.x,z=a[1]+(b[1]-a[1])*step/samples-field.z,c=Math.cos(field.yaw),s=Math.sin(field.yaw);
        expect(Math.abs(x*c-z*s)>=field.width/2+1.99||Math.abs(x*s+z*c)>=field.depth/2+1.99,`paving across ${field.id}`).toBe(true);
      }
    }
    const crossing=BU_ROAD_EDGES.find(e=>e.road.name==='SILBER WAY'&&Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1])>20)!;
    const x=(crossing.a[0]+crossing.b[0])/2,z=(crossing.a[1]+crossing.b[1])/2;
    // A sidewalk strip from a transverse street must not float across Silber.
    expect(buClipSidewalkToJunctions([[x-1,z-1],[x+1,z-1],[x+1,z+1],[x-1,z+1]],'COMMONWEALTH AVENUE')).toEqual([]);
  });

  it('closes the outer Commonwealth sidewalk seam over the Pike without filling the median side',()=>{
    const inside=(x:number,z:number,points:readonly (readonly [number,number])[])=>{
      let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;
    };
    // This shared GIS node turns by only 0.67 degrees. The former mobile
    // rectangular sidebands exposed the terrain 4.2 m below the bridge.
    const crack=[-1483.4962836,992.6703502],node=[-1482.229,984.982];
    expect(BU_SIDEWALK_JOIN_PATCHES.some(p=>inside(crack[0],crack[1],p))).toBe(true);
    const mirrored=[node[0]*2-crack[0],node[1]*2-crack[1]];
    expect(BU_SIDEWALK_JOIN_PATCHES.some(p=>inside(mirrored[0],mirrored[1],p))).toBe(false);
    // The same exact join is required within a bridge polyline and across
    // separate bridge records; neither gap is a street-grade intersection.
    for(const point of [[-1518.7301629796048,732.5526810035268],[-1500.1729346765499,608.6515721997755]])expect(BU_SIDEWALK_JOIN_PATCHES.some(p=>inside(point[0],point[1],p))).toBe(true);
  });

  it('keeps the actual baked mobile rail heads above ballast without making rails walkable',()=>{
    const file=readFileSync(new URL('../public/data/mobile/boston.glb',import.meta.url));
    const model=parseMobileCampus(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer);
    try{
      const rails=model.children.filter((object):object is Mesh=>object instanceof Mesh&&object.name==='Mobile rail');
      expect(rails.length).toBe(1);
      let tested=0,minimum=Infinity,worst:[number,number]=[0,0];
      for(const mesh of rails){
        expect(mesh.userData.mobileGround).toBe(false);expect(mesh.userData.mobileWall).toBe(false);
        const position=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getIndex()!;
        for(let i=0;i<indices.count;i+=3){
          const vertices=[0,1,2].map(k=>{const index=indices.getX(i+k);return[position.getX(index),position.getY(index),position.getZ(index)];});
          // An undraped 8 m segment can agree at its vertices while crossing
          // a 12 m terrain break underneath. Sample every edge and interior.
          for(const weights of [[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]]){
            const x=vertices.reduce((sum,v,k)=>sum+v[0]*weights[k],0),y=vertices.reduce((sum,v,k)=>sum+v[1]*weights[k],0),z=vertices.reduce((sum,v,k)=>sum+v[2]*weights[k],0);
            const clearance=y-buElevation(x,z);if(clearance<minimum){minimum=clearance;worst=[x,z];}tested++;
          }
        }
      }
      expect(tested).toBeGreaterThan(500);
      // Ballast is +0.073 m. This allows the mobile .04 m drape tolerance and
      // millimetre welding while catching rails that previously dipped below it.
      expect(minimum,`mobile rail sinks at ${worst.join(',')}`).toBeGreaterThan(.10);
    }finally{
      const geometries=new Set<import('three').BufferGeometry>(),materials=new Set<Material>();
      model.traverse(object=>{if(object instanceof Mesh){geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());model.clear();
    }
  });

  it('batches street detail within a finite geometry/material budget',()=>{
    const streets=createBUCampusStreets(),materials=new Set<Material>();let triangles=0,vertices=0;
    // At pedestrian height the University Road kerb has a real street-facing
    // side; the former horizontal plane could never be hit by this ray.
    const edge=BU_ROAD_EDGES.find(e=>e.road.name==='UNIVERSITY ROAD'&&Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1])>50)!;
    const ex=edge.b[0]-edge.a[0],ez=edge.b[1]-edge.a[1],el=Math.hypot(ex,ez),nx=-ez/el,nz=ex/el;
    const cx=(edge.a[0]+edge.b[0])/2+nx*(edge.road.width/2+.1),cz=(edge.a[1]+edge.b[1])/2+nz*(edge.road.width/2+.1);
    const kerbs=streets.group.children.filter(o=>o instanceof Mesh&&o.name==='BU street detail curb');
    const faceHit=new Raycaster(new Vector3(cx-nx*.4,buElevation(cx,cz)+.08,cz-nz*.4),new Vector3(nx,0,nz),0,.8).intersectObjects(kerbs,false);
    expect(faceHit.length,'University Road kerb has no vertical face').toBeGreaterThan(0);
    expect(faceHit[0].distance).toBeCloseTo(.29,2);
    expect(streets.walls.includes(faceHit[0].object as Mesh),'low kerb became a blocking wall').toBe(false);
    const trackMeshes=streets.group.children.filter(object=>object instanceof Mesh&&/BU street (ground|detail) (rail|gravel)$/.test(object.name));
    const trackIndex=BU_COMMONWEALTH_MEDIAN.findIndex(p=>p[0]>-750),a=BU_COMMONWEALTH_MEDIAN[trackIndex-1],b=BU_COMMONWEALTH_MEDIAN[trackIndex],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const x=(a[0]+b[0])/2-dz/length*1.015,z=(a[1]+b[1])/2+dx/length*1.015;
    const hits=new Raycaster(new Vector3(x,buElevation(x,z)+10,z),new Vector3(0,-1,0)).intersectObjects(trackMeshes,false);
    expect(hits[0]?.object.name).toContain('rail');
    expect(hits[0].point.y-buElevation(x,z)).toBeCloseTo(.192,3);
    const gravel=hits.find(hit=>hit.object.name.endsWith('gravel'));
    expect(gravel).toBeDefined();expect(hits[0].point.y-gravel!.point.y).toBeGreaterThan(.11);
    streets.group.traverse(object=>{
      if(!(object instanceof Mesh))return;
      const p=object.geometry.getAttribute('position');
      let finite=true;for(let i=0;i<p.array.length;i++)if(!Number.isFinite(p.array[i])){finite=false;break;}expect(finite,object.name).toBe(true);
      triangles+=(object.geometry.index?.count??p.count)/3;vertices+=p.count;
      for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
      object.geometry.dispose();
    });
    const paint=[...materials].find(m=>m.userData.buGroundLayer==='marking')!;
    expect(paint.polygonOffsetFactor).toBe(-.25);expect(paint.depthTest&&paint.depthWrite).toBe(true);
    for(const material of materials)if(material.userData.buGroundLayer==='surface')expect(material.polygonOffset).toBe(false);
    const terrain=configureBUGroundLayer(paint.clone(),'terrain');
    expect(terrain.polygonOffsetFactor).toBeGreaterThanOrEqual(0);expect(terrain.depthTest&&terrain.depthWrite).toBe(true);terrain.dispose();
    for(const material of materials)material.dispose();
    expect(materials.size).toBeLessThan(20);
    // Includes the pre-existing bridge trusses, rail sleepers, expressway and
    // all shared terrain-lattice cuts, not only the new facade infill.
    expect(triangles).toBeLessThan(400000);
    expect(streets.group.children.length).toBeLessThan(1800);
    expect(vertices).toBeGreaterThan(1000);
    expect(streets.group.userData.stats.frontagePatches).toBe(BU_PUBLIC_FRONTAGES.length);
  },30000);
});
