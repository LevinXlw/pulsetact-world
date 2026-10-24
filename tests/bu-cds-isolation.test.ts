import {createHash} from 'node:crypto';
import {afterAll,describe,expect,it} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3} from 'three';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {BU_CDS_HEIGHT,BU_CDS_MAP_FEATURE} from '../src/features/world/bu-landmark-layout';
import {BU_CDS_GROUND_TOWER,BU_CDS_GROUND_PODIUM,BU_CDS_SOUTH_DOORS,buCDSPoint} from '../src/features/world/bu-cds-entry-layout';
import {buElevation} from '../src/features/world/bu-terrain';

const campus=createBostonUniversity({wind:{value:0}});
afterAll(()=>campus.group.traverse(object=>{
  if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}
}));

/** Ignore batch order, but retain every triangle's winding and all attributes. */
function visibleGeometrySignature(excludeCDS=false) {
  const parts=new Map<string,string[]>();let triangles=0,meshes=0;
  campus.group.traverseVisible(object=>{
    if(!(object instanceof Mesh))return;
    if(excludeCDS&&object.userData.buLandmarkScope==='cds')return;
    const geometry=object.geometry;
    expect(geometry.index).toBeNull();
    const key=object.name,hashes=parts.get(key)??[];
    const attributes=Object.keys(geometry.attributes).sort().map(name=>({name,attribute:geometry.getAttribute(name)}));
    for(let i=0;i<geometry.getAttribute('position').count;i+=3){
      const hash=createHash('sha256');
      for(const {name,attribute} of attributes){
        hash.update(name);
        const values=new Float32Array(3*attribute.itemSize);
        for(let vertex=0;vertex<3;vertex++)for(let axis=0;axis<attribute.itemSize;axis++)values[vertex*attribute.itemSize+axis]=attribute.getComponent(i+vertex,axis);
        hash.update(new Uint8Array(values.buffer));
      }
      hashes.push(hash.digest('hex'));triangles++;
    }
    parts.set(key,hashes);meshes++;
  });
  const hash=createHash('sha256');
  for(const [name,hashes] of [...parts].sort(([a],[b])=>a.localeCompare(b))){hash.update(name);hash.update(hashes.sort().join(''));}
  return{triangles,meshes,sha256:hash.digest('hex')};
}

describe('CDS landmark visual isolation',()=>{
  it('retains every pre-isolation visible triangle and shading attribute',()=>{
    // Captured before introducing scope separation. Includes every landmark,
    // rigid building, terrain skirt, draped paving and foundation shader frame.
    expect(visibleGeometrySignature()).toEqual({
      triangles:110302,meshes:39,
      sha256:'d11df2708c99f1bde5e4ae0bb125f2f71325e2f42e5dbcd4e2ffaa471b539333',
    });
  });

  it('owns the entire CDS height and surface batches without taking neighbouring landmarks',()=>{
    const {visual}=campus.cds;
    expect(visual.parent).toBe(campus.group);expect(visual.visible).toBe(true);
    const visible:Mesh[]=[];visual.traverseVisible(object=>{if(object instanceof Mesh)visible.push(object);});
    expect(visible.length).toBeGreaterThanOrEqual(8);
    expect(visible.every(mesh=>mesh.userData.buLandmarkScope==='cds')).toBe(true);
    expect(visible.some(mesh=>mesh.userData.buGround)).toBe(true);
    for(const mesh of visible){
      expect(mesh.name).toMatch(/^BU (ground|architecture) · /);
      expect(Array.isArray(mesh.material)).toBe(false);
    }
    const bounds=new Box3().setFromObject(visual),base=buElevation(BU_CDS_MAP_FEATURE.x,BU_CDS_MAP_FEATURE.z);
    expect(bounds.max.y).toBeCloseTo(base+BU_CDS_HEIGHT,3);
    // Colliders outside the subgroup retain ownership labels too: hiding a
    // visual must not accidentally hide Marsh, its links or Questrom's pillars.
    const sourceCdsWalls=campus.walls.filter(mesh=>mesh.name.startsWith('CDS '));
    expect(new Set(campus.cds.walls)).toEqual(new Set(sourceCdsWalls));
    expect(campus.cds.walls.filter(mesh=>!mesh.userData.foundationSkirt)).toHaveLength(2);
    for(const mesh of campus.walls.filter(mesh=>!sourceCdsWalls.includes(mesh)))expect(mesh.userData.buLandmarkScope).toBe(campus.questrom.walls.includes(mesh)?'questrom':'landmarks');
    for(const mesh of [...campus.cds.ground,...campus.cds.walls]){
      expect(mesh.parent).toBe(campus.group);expect(mesh.visible).toBe(false);
      expect(mesh.userData.buLandmarkScope).toBe('cds');
    }
  });

  it('keeps all ground and wall collision usable when the complete old skin is hidden',()=>{
    const ray=new Raycaster(),heightAt=(x:number,z:number)=>{
      const point=buCDSPoint(x,z);ray.set(new Vector3(point[0],200,point[1]),new Vector3(0,-1,0));
      const hit=ray.intersectObjects(campus.ground,false)[0];expect(hit).toBeDefined();
      expect(campus.cds.ground).toContain(hit.object);
      return hit.point.y;
    };
    const probes=[[-3.5,18],[-18,25],...BU_CDS_SOUTH_DOORS.flatMap(door=>[[door.local[0],door.local[1]+.1],[door.local[0],22.49],[door.local[0],25.5]])];
    const before=probes.map(([x,z])=>heightAt(x,z));
    const wallAt=(x:number,z:number)=>{
      const point=buCDSPoint(x,z);ray.set(new Vector3(point[0],200,point[1]),new Vector3(0,-1,0));
      const hit=ray.intersectObjects(campus.walls,false)[0];expect(hit).toBeDefined();
      expect(campus.cds.walls).toContain(hit.object);return hit.point.y;
    };
    const bodies=[BU_CDS_GROUND_TOWER,BU_CDS_GROUND_PODIUM],wallBefore=bodies.map(body=>wallAt(body.x,body.z));
    const nonCDSBefore=visibleGeometrySignature(true);
    campus.cds.visual.visible=false;
    try{
      expect(probes.map(([x,z])=>heightAt(x,z))).toEqual(before);
      expect(bodies.map(body=>wallAt(body.x,body.z))).toEqual(wallBefore);
      expect(visibleGeometrySignature()).toEqual(nonCDSBefore);
      const oldCdsVisible:Mesh[]=[];
      campus.group.traverseVisible(object=>{if(object instanceof Mesh&&object.userData.buLandmarkScope==='cds')oldCdsVisible.push(object);});
      expect(oldCdsVisible).toHaveLength(0);
    }finally{campus.cds.visual.visible=true;}
    for(const collision of campus.cds.ground){
      expect(campus.ground).toContain(collision);
      const sibling=campus.cds.visual.children.find(object=>object instanceof Mesh&&object.geometry===collision.geometry);
      expect(sibling).toBeDefined();expect(collision.userData.buCollisionOnly).toBe(true);
    }
  });

  it('inherits deferred foundation skirts from CDS colliders, including the visible masonry',()=>{
    const skirts=campus.cds.walls.filter(mesh=>mesh.userData.foundationSkirt);
    expect(skirts).toHaveLength(2);
    const visible:Mesh[]=[];campus.cds.visual.traverse(object=>{if(object instanceof Mesh)visible.push(object);});
    const sourceTriangles=skirts.reduce((sum,mesh)=>sum+mesh.geometry.getAttribute('position').count/3,0);
    expect(visible.reduce((sum,mesh)=>sum+mesh.userData.buFoundationSkirtTriangles,0)).toBe(sourceTriangles);
    const ray=new Raycaster();
    for(const skirt of skirts){
      const position=skirt.geometry.getAttribute('position'),normal=skirt.geometry.getAttribute('normal');
      const center=new Vector3().fromBufferAttribute(position,0).add(new Vector3().fromBufferAttribute(position,1)).add(new Vector3().fromBufferAttribute(position,2)).multiplyScalar(1/3).applyMatrix4(skirt.matrixWorld);
      const outward=new Vector3().fromBufferAttribute(normal,0).normalize();
      ray.set(center.clone().addScaledVector(outward,.5),outward.clone().negate());ray.far=1;
      const collisionHit=ray.intersectObject(skirt,false)[0],visibleHit=ray.intersectObjects(visible,false)[0];
      expect(collisionHit).toBeDefined();expect(visibleHit).toBeDefined();
      expect(visibleHit.distance).toBeCloseTo(collisionHit.distance,4);
    }
  });

  it('preserves ground shadow policy and shared material ownership after splitting batches',()=>{
    campus.setQuality(true);
    campus.group.traverseVisible(object=>{if(object instanceof Mesh)expect(object.castShadow).toBe(false);});
    campus.setQuality(false);
    const byName=new Map<string,Mesh[]>();
    campus.group.traverseVisible(object=>{
      if(!(object instanceof Mesh))return;
      expect(object.castShadow).toBe(!object.userData.buGround&&!object.name.includes('glass'));
      const meshes=byName.get(object.name)??[];meshes.push(object);byName.set(object.name,meshes);
    });
    // Separation must not duplicate the original material/texture resources.
    for(const meshes of byName.values())for(const mesh of meshes)expect(mesh.material).toBe(meshes[0].material);
  });
});
