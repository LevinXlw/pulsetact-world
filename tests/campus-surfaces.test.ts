import {expect,it} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Texture,BufferGeometry,Float32BufferAttribute} from 'three';
import {applyCampusSurfaces,tintCampusBuildings,extractSurveyedBridge} from '../src/features/real-campus/campus-surfaces';
it('separates only the surveyed bridge for walking without losing or duplicating triangles',()=>{
 const box=new BoxGeometry().toNonIndexed(),g=new BufferGeometry();
 for(const name of ['position','normal','uv']){const a=box.getAttribute(name),values=new Float32Array(a.array.length*2);values.set(a.array);values.set(a.array,a.array.length);g.setAttribute(name,new Float32BufferAttribute(values,a.itemSize));}
 const group=new Group(),mesh=new Mesh(g,new MeshStandardMaterial({name:'Cambridge buildings (untextured)'}));group.add(mesh);
 extractSurveyedBridge(group,[{id:'building',triangles:12},{id:'CAM_FYDFW-CRKIM-2M698',triangles:12}]);
 expect(group.children).toHaveLength(2);expect(mesh.geometry.getAttribute('position').count).toBe(36);
 const bridge=group.children[1] as Mesh;expect(bridge.geometry.getAttribute('position').count).toBe(36);expect((bridge.material as MeshStandardMaterial).name).toBe('surveyedBridge');
});
it('keeps detailed buildings out of the generic window layer',()=>{
 for(const detailed of [[],['core']]){
  const group=new Group(),g=new BoxGeometry(10,12,8).toNonIndexed(),mesh=new Mesh(g,new MeshStandardMaterial({name:'Cambridge buildings (untextured)'}));group.add(mesh);
  tintCampusBuildings(group,[{id:'core',name:'Example Building',triangles:12}],detailed);
  const facade=g.getAttribute('facade');expect(facade.count).toBe(36);
  expect(Array.from({length:36},(_,i)=>facade.getX(i)).filter(Boolean)).toHaveLength(detailed.length?0:24);
 }
});
it('separates upward roofs, preserves building triangles and leaves terrain untouched',()=>{
 const base=new Group(),detail=new Group(),aerial=new Texture(),stone=new Texture();
 const building=new Mesh(new BoxGeometry(10,12,8),new MeshStandardMaterial({name:'Cambridge buildings (untextured)'}));
 const terrain=new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'2025 orthophotography',map:aerial}));
 const terrainGeometry=terrain.geometry;detail.add(new Mesh(new BoxGeometry(),new MeshStandardMaterial({name:'stone',map:stone})));base.add(building,terrain);
 applyCampusSurfaces(base,detail,420);
 expect(base.userData.surfaceTriangles).toEqual({walls:10,roofs:2});
 expect(building.geometry.index?.count).toBe(36);expect(terrain.geometry).toBe(terrainGeometry);
 const materials=building.material as unknown as MeshStandardMaterial[];expect(materials[0].map).toBe(stone);expect(materials[1].map).toBe(aerial);
 const roofGroup=building.geometry.groups[1],p=building.geometry.getAttribute('position'),uv=building.geometry.getAttribute('uv');
 for(let i=roofGroup.start;i<roofGroup.start+roofGroup.count;i++){const j=building.geometry.index!.getX(i);expect(p.getY(j)).toBe(6);expect(uv.getX(j)).toBeCloseTo((p.getX(j)+420)/840);expect(uv.getY(j)).toBeCloseTo((p.getZ(j)+420)/840);}
});
