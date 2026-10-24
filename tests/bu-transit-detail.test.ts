import {describe,expect,it} from 'vitest';
import {Mesh,Raycaster,Vector3,type Material} from 'three';
import {createBUTransitDetail} from '../src/features/world/bu-transit-detail';
import {BU_TRANSIT_PLATFORM_DETAILS} from '../src/features/world/bu-public-realm';
import {BU_COMMONWEALTH_MEDIAN} from '../src/features/world/bu-campus-layout';
import {createBUCampusStreets} from '../src/features/world/bu-campus-streets';
import {buElevation} from '../src/features/world/bu-terrain';

describe('BU photo-led platform architecture',()=>{
  it('keeps a clear boarding lane and an actual thin curved canopy in both quality tiers',()=>{
    for(const mobile of [false,true]){
      const detail=createBUTransitDetail({mobile});
      for(const station of BU_TRANSIT_PLATFORM_DETAILS)for(const side of [-1,1]){
        const {dx,dz,nx,nz,width,canopyLength}=station;
        const point=(across:number,along:number)=>[station.position[0]+nx*side*(station.platformOffset+across)+dx*along,station.position[1]+nz*side*(station.platformOffset+across)+dz*along];
        const [x,z]=point(0,-canopyLength/2-.5);
        const walking=new Raycaster(new Vector3(x,buElevation(x,z)+.9,z),new Vector3(dx,0,dz),0,canopyLength+1).intersectObject(detail.group,true);
        expect(walking,`${station.name}/${side} has a post/screen across its clear boarding lane`).toHaveLength(0);
        const heights=[];
        for(const across of [-width*.4,width*.4]){
          const [rx,rz]=point(across,.37),base=buElevation(rx,rz);
          const top=new Raycaster(new Vector3(rx,base+4,rz),new Vector3(0,-1,0),0,1.5).intersectObject(detail.group,true)[0];
          const soffit=new Raycaster(new Vector3(rx,base+2.7,rz),new Vector3(0,1,0),0,1.2).intersectObject(detail.group,true)[0];
          expect(top,`${station.name} missing roof`).toBeDefined();expect(soffit,`${station.name} missing soffit`).toBeDefined();
          heights.push(top.point.y-base);
          expect(top.point.y-soffit.point.y).toBeGreaterThan(.045);
          expect(top.point.y-soffit.point.y).toBeLessThan(.24);
        }
        expect(Math.abs(heights[0]-heights[1]),`${station.name} still has a flat slab roof`).toBeGreaterThan(.04);
      }
      const glass:Mesh[]=[];detail.group.traverse(object=>{if(object instanceof Mesh&&object.userData.buTransitFinish==='glass')glass.push(object);});
      expect(glass).toHaveLength(10);
      expect(glass.every(mesh=>(mesh.material as Material).transparent&&!(mesh.material as Material).depthWrite)).toBe(true);
      detail.dispose();
    }
  });

  it('merges by station/material and releases each owned resource exactly once',()=>{
    const counts=[];
    for(const mobile of [false,true]){
      const detail=createBUTransitDetail({mobile}),materials=new Set<Material>();let triangles=0,meshes=0;
      const released=new Map<object,number>();
      detail.group.traverse(object=>{
        if(!(object instanceof Mesh))return;meshes++;
        const geometry=object.geometry,p=geometry.getAttribute('position');triangles+=(geometry.index?.count??p.count)/3;
        for(let i=0;i<p.count;i++)expect(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i))).toBe(true);
        released.set(geometry,0);geometry.addEventListener('dispose',()=>released.set(geometry,released.get(geometry)!+1));
        for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
      });
      for(const material of materials){released.set(material,0);material.addEventListener('dispose',()=>released.set(material,released.get(material)!+1));}
      expect(meshes).toBeLessThan(60);expect(triangles).toBeLessThan(mobile?10000:40000);
      expect(detail.group.userData.buTransitDetail.nameplates).toBe(10);
      expect(detail.group.userData.buTransitDetail.canopies).toBe(10);
      counts.push({mobile,meshes,triangles,materials:materials.size});
      detail.dispose();detail.dispose();expect([...released.values()].every(n=>n===1)).toBe(true);expect(detail.group.children).toHaveLength(0);
    }
    console.info('BU transit architecture geometry',counts);
  });

  it('retains platform/approach support and makes rail-web sides visible without collision walls',()=>{
    const streets=createBUCampusStreets();
    for(const station of BU_TRANSIT_PLATFORM_DETAILS)for(const side of [-1,1]){
      const {dx,dz,nx,nz,width,platformLength}=station;
      for(const [across,along,height] of [[0,0,.19],[-width/2+.305,0,.199],[0,-platformLength/2-2.5,.1475],[0,platformLength/2+2.5,.1475]]){
        const x=station.position[0]+nx*side*(station.platformOffset+across)+dx*along,z=station.position[1]+nz*side*(station.platformOffset+across)+dz*along;
        const hits=new Raycaster(new Vector3(x,buElevation(x,z)+2,z),new Vector3(0,-1,0)).intersectObjects(streets.ground,false);
        expect(hits[0],`${station.name} missing platform/approach`).toBeDefined();expect(hits[0].point.y-buElevation(x,z)).toBeCloseTo(height,3);
      }
    }
    const i=BU_COMMONWEALTH_MEDIAN.findIndex(p=>p[0]>-750),a=BU_COMMONWEALTH_MEDIAN[i-1],b=BU_COMMONWEALTH_MEDIAN[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length;
    const x=(a[0]+b[0])/2+nx*1.015,z=(a[1]+b[1])/2+nz*1.015;
    const web=streets.group.children.filter(o=>o instanceof Mesh&&o.name.endsWith('railWeb'));
    for(const direction of [-1,1]){
      const ray=new Raycaster(new Vector3(x+nx*.09*direction,buElevation(x,z)+.14,z+nz*.09*direction),new Vector3(-nx*direction,0,-nz*direction),0,.2);
      const hit=ray.intersectObjects(web,false)[0];expect(hit,'rail web must face outwards').toBeDefined();expect(hit.distance).toBeCloseTo(.0765,2);expect(streets.walls.includes(hit.object as Mesh)).toBe(false);
    }
    const materials=new Set<Material>();streets.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}});materials.forEach(m=>m.dispose());
  },30000);
});
