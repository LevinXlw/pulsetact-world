import {expect,it} from 'vitest';
import {BufferGeometry,Float32BufferAttribute,Group,InstancedMesh,Mesh,MeshStandardMaterial,Vector3,Matrix4} from 'three';
import {courtPoint} from '../src/features/real-campus/inspection';
import {courtyardGrassRoots,createCourtyardGroundDetail,lawnEdgeDistance} from '../src/features/real-campus/courtyard-ground-detail';

function slopedLawn(){
 const group=new Group(),positions:number[]=[];
 for(const [u,s] of [[2,95],[2,108],[14,95],[14,95],[2,108],[14,108]]){const [x,z]=courtPoint(u,s);positions.push(x,4+(s-95)*.03,z);}
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
 geometry.computeVertexNormals();group.add(new Mesh(geometry,new MeshStandardMaterial({name:'grass'})));return group;
}
it('samples actual sloped lawn triangles without placing short grass on the path',()=>{
 const source=slopedLawn(),roots=courtyardGrassRoots(source);
 expect(roots.length).toBeGreaterThan(100);expect(roots.length).toBeLessThan(2000);
 roots.forEach(root=>{const edge=lawnEdgeDistance(root.x,root.z);expect(edge).toBeGreaterThan(.04);expect(edge).toBeLessThan(.40);
  const dx=root.x-12.904326,dz=root.z+34.578878,s=dx*.4189689+dz*.9080005;
  expect(root.y).toBeCloseTo(4+(s-95)*.03-.005,4);
 });
 const path=courtPoint(0,102);expect(lawnEdgeDistance(...path)).toBe(-1);
});
it('reduces instance count without moving roots or entering collision and AO passes',()=>{
 const source=slopedLawn(),detail=createCourtyardGroundDetail(source),mesh=detail.children[0] as InstancedMesh,matrix=new Matrix4(),position=new Vector3();
 const initial=mesh.count;mesh.getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);
 expect(mesh.userData.collision).toBe('none');expect(mesh.userData.excludeFromAO).toBe(true);expect(mesh.castShadow).toBe(false);
 detail.userData.setQuality('low');expect(mesh.count).toBe(Math.floor(initial*.3));
 mesh.getMatrixAt(0,matrix);expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual(position.toArray());
 detail.userData.setQuality('standard');expect(mesh.count).toBe(initial);expect(detail.userData.stats.drawCalls).toBe(1);
 mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();
});
