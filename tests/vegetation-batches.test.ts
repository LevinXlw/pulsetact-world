import {expect,it} from 'vitest';
import {Color,InstancedBufferAttribute,InstancedMesh,Matrix4,MeshStandardMaterial,PlaneGeometry,Vector3} from 'three';
import {partitionVegetation} from '../src/features/world/vegetation-batches';

it('retains leaf transforms, colors and per-instance normals when partitioning distant groves',()=>{
  const geometry=new PlaneGeometry(1,1);
  geometry.setAttribute('crownNormal',new InstancedBufferAttribute(new Float32Array([1,0,0,0,1,0,0,0,1,-1,0,0]),3));
  const source=new InstancedMesh(geometry,new MeshStandardMaterial(),4),matrix=new Matrix4(),color=new Color();
  const positions=[[-350,4,0],[320,8,-10],[-340,7,2],[340,9,-12]];
  positions.forEach((position,index)=>{
    source.setMatrixAt(index,matrix.makeTranslation(...position as [number,number,number]));
    source.setColorAt(index,color.setRGB(index/4,1-index/4,.5));
  });
  const chunks=partitionVegetation(source);
  expect(chunks).toHaveLength(2);expect(chunks.reduce((sum,chunk)=>sum+chunk.count,0)).toBe(4);
  const restored:number[][]=[];
  for(const chunk of chunks){
    expect(chunk.mesh.boundingBox!.getSize(new Vector3()).x).toBeLessThan(25);
    for(let index=0;index<chunk.count;index++){
      chunk.mesh.getMatrixAt(index,matrix);chunk.mesh.getColorAt(index,color);
      const position=new Vector3().setFromMatrixPosition(matrix).toArray();
      const original=positions.findIndex(point=>point.every((value,axis)=>value===position[axis]));
      expect(original).toBeGreaterThanOrEqual(0);
      expect(color.r).toBeCloseTo(original/4);
      const normal=chunk.mesh.geometry.getAttribute('crownNormal');
      expect([normal.getX(index),normal.getY(index),normal.getZ(index)]).toEqual(Array.from(geometry.getAttribute('crownNormal').array).slice(original*3,original*3+3));
      restored.push(position);
    }
    chunk.mesh.dispose();chunk.mesh.geometry.dispose();
  }
  expect(restored).toEqual(expect.arrayContaining(positions));
  source.dispose();geometry.dispose();(source.material as MeshStandardMaterial).dispose();
});

it('allows an empty foliage layer in low quality without invalid bounds',()=>{
  const source=new InstancedMesh(new PlaneGeometry(),new MeshStandardMaterial(),0);
  expect(partitionVegetation(source)).toEqual([]);
  source.dispose();source.geometry.dispose();(source.material as MeshStandardMaterial).dispose();
});
