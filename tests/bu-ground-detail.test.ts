import {describe,expect,it} from 'vitest';
import {InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,PlaneGeometry,Vector3} from 'three';
import {createBostonUniversity,BU_LAWNS} from '../src/features/world/boston-university';
import {createBULawnDetail,lawnFootprintDistance} from '../src/features/world/bu-ground-detail';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {createCharlesRiver} from '../src/features/world/charles-river';
import {createCampusGroundSampler} from '../src/features/world/campus-ground-sampler';

describe('BU close grass placement',()=>{
  it('retains grass on a hillside while excluding a raised path on that slope',()=>{
    const material=new MeshBasicMaterial();
    const surface=(width:number,offset:number)=>{
      const geometry=new PlaneGeometry(width,20,1,1);geometry.rotateX(-Math.PI/2);
      const positions=geometry.getAttribute('position');
      for(let i=0;i<positions.count;i++)positions.setY(i,4+positions.getX(i)*.12+offset);
      geometry.computeVertexNormals();geometry.computeBoundingBox();
      return new Mesh(geometry,material);
    };
    const lawn=surface(20,0),path=surface(3,.05);
    const ground=createCampusGroundSampler([lawn,path]);
    const detail=createBULawnDetail([lawn],[{x:0,z:0,width:20,depth:20,yaw:0}],{value:0},ground,1000);
    const matrix=new Matrix4(),position=new Vector3();let count=0;
    detail.group.traverse(object=>{
      if(!(object instanceof InstancedMesh))return;
      count+=object.count;
      for(let i=0;i<object.count;i++){
        object.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
        expect(Math.abs(position.x)).toBeGreaterThan(1.9);
        expect(position.y).toBeCloseTo(4+position.x*.12+.012,4);
      }
      object.dispose();object.geometry.dispose();
      for(const finish of Array.isArray(object.material)?object.material:[object.material])finish.dispose();
    });
    expect(count).toBeGreaterThan(400);
    lawn.geometry.dispose();path.geometry.dispose();material.dispose();
  });
  it('roots blades only on upward turf surfaces, keeps paths clear, and culls distant chunks',()=>{
    const campus=createBostonUniversity({wind:{value:0}});
    const collision=new CampusCollision(),river=createCharlesRiver(collision,{value:0});
    const ground=[...campus.ground,...river.ground];
    const turfHeight=createCampusGroundSampler(campus.ground.filter(mesh=>mesh.name.endsWith('grass')));
    // Match the runtime's triangle index now that the south bank spans BU.
    collision.rebuild(ground,[],createCampusGroundSampler(ground));
    const detail=createBULawnDetail(campus.ground.filter(mesh=>mesh.name.endsWith('grass')),BU_LAWNS,{value:0},(x,z)=>collision.groundHeight(x,z));
    const chunks:InstancedMesh[]=[],matrix=new Matrix4(),position=new Vector3();
    detail.group.traverse(object=>{if(object instanceof InstancedMesh)chunks.push(object);});
    try{
      const count=chunks.reduce((n,mesh)=>n+mesh.count,0);expect(count).toBeGreaterThan(4000);expect(count).toBeLessThanOrEqual(7000);
      for(const mesh of chunks)for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
        expect(lawnFootprintDistance(position.x,position.z,BU_LAWNS)).toBeGreaterThan(.064);
        expect(position.y).toBeCloseTo(turfHeight(position.x,position.z)!+.012,3);
        // The river's raised arrival paving overlaps the original lawn box.
        // All retained roots must stand on visible turf, including tuft spread.
        for(const [dx,dz] of [[0,0],[-.4,0],[.4,0],[0,-.4],[0,.4]]){
          const x=position.x+dx,z=position.z+dz;
          expect(collision.groundHeight(x,z)??0).toBeLessThanOrEqual(turfHeight(x,z)!+.001);
        }
      }
      detail.update(new Vector3(53.5,6,52.5));expect(chunks.every(mesh=>!mesh.visible)).toBe(true);
      detail.update(new Vector3(BU_LAWNS[0].x,6,BU_LAWNS[0].z));expect(chunks.some(mesh=>mesh.visible)).toBe(true);
      detail.setQuality(true);expect(chunks.reduce((n,mesh)=>n+mesh.count,0)).toBeLessThan(count*.32);
    }finally{
      for(const group of [campus.group,river.group,detail.group])group.traverse(object=>{
        if(object instanceof Mesh){if(object instanceof InstancedMesh)object.dispose();object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}
      });
    }
  },15000);
});
