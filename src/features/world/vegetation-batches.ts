import {BufferGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Color} from 'three';

/** Keep instancing, but give each grove its own bounds for frustum/shadow culling.
 * Instance attributes (leaf normals in particular) must follow the same remap.
 * The source's shuffled order is retained within every cell for quality changes.
 */
export function partitionVegetation(source:InstancedMesh,cellSize=160){
  const cells=new Map<string,number[]>(),matrix=new Matrix4(),color=new Color();
  for(let index=0;index<source.count;index++){
    source.getMatrixAt(index,matrix);
    const key=`${Math.floor(matrix.elements[12]/cellSize)}:${Math.floor(matrix.elements[14]/cellSize)}`;
    const indices=cells.get(key)??[];indices.push(index);cells.set(key,indices);
  }
  const chunks=[...cells].map(([key,indices])=>{
    const geometry=new BufferGeometry();
    if(source.geometry.index)geometry.setIndex(source.geometry.index.clone());
    for(const [name,attribute] of Object.entries(source.geometry.attributes)){
      if(attribute instanceof InstancedBufferAttribute){
        const values=new Float32Array(indices.length*attribute.itemSize);
        indices.forEach((original,index)=>{
          for(let component=0;component<attribute.itemSize;component++)values[index*attribute.itemSize+component]=attribute.getComponent(original,component);
        });
        geometry.setAttribute(name,new InstancedBufferAttribute(values,attribute.itemSize,attribute.normalized));
      }else geometry.setAttribute(name,attribute.clone());
    }
    const mesh=new InstancedMesh(geometry,source.material,indices.length);
    mesh.name=`${source.name} · grove ${key}`;
    mesh.position.copy(source.position);mesh.quaternion.copy(source.quaternion);mesh.scale.copy(source.scale);
    mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;
    mesh.customDepthMaterial=source.customDepthMaterial;mesh.customDistanceMaterial=source.customDistanceMaterial;
    indices.forEach((original,index)=>{
      source.getMatrixAt(original,matrix);mesh.setMatrixAt(index,matrix);
      if(source.instanceColor){source.getColorAt(original,color);mesh.setColorAt(index,color);}
    });
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();
    return {mesh,count:indices.length};
  });
  return chunks;
}
