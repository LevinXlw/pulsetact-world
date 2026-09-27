import {BufferGeometry,Group,LOD,Mesh,Vector3} from 'three';

// Each generated cluster has 18 vertices (three blades). Keep whole clusters
// in the far representation, sharing attribute buffers with the near version.
export function vegetationLOD(source:Group){
 const result=new Group();result.name='Vegetation distance levels';
 for(const child of [...source.children]){
  if(!(child instanceof Mesh)||child.geometry.index){result.add(child);continue;}
  const g=child.geometry as BufferGeometry;g.computeBoundingBox();const center=g.boundingBox!.getCenter(new Vector3());g.translate(-center.x,-center.y,-center.z);
  const low=new BufferGeometry();for(const [name,attribute] of Object.entries(g.attributes))low.setAttribute(name,attribute);
  const indices=[];for(let cluster=0;cluster<g.getAttribute('position').count;cluster+=54)for(let vertex=0;vertex<18&&cluster+vertex<g.getAttribute('position').count;vertex++)indices.push(cluster+vertex);
  low.setIndex(indices);low.computeBoundingSphere();const far=new Mesh(low,child.material);
  child.castShadow=true;child.receiveShadow=true;far.castShadow=false;far.receiveShadow=true;
  const lod=new LOD();lod.position.copy(center);lod.addLevel(child,0);lod.addLevel(far,180,.15);result.add(lod);
 }
 return result;
}
