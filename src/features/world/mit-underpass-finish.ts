import {Mesh,MeshStandardMaterial,Vector3,type Group} from 'three';
import {createCampusSurface} from './painterly-surfaces';

// Exact source corners recorded in memorial-east-corrections.json. Selecting
// matching triangles avoids repainting nearby dormitory walls or bridge decks.
const corners=[
 [-137.543335,-4.00446,246.509094],[-137.543335,3.05874,246.509094],[-137.161026,-4.00446,247.339798],[-137.161026,3.05874,247.339798],
 [-63.917233,-4.00446,212.622604],[-63.917233,3.05874,212.622604],[-63.523232,-4.00446,213.447906],[-63.523232,3.05874,213.447906],
 [-131.995132,-4.01556,259.866913],[-131.995132,3.27224,259.866913],[-131.617737,-4.01556,260.69989],[-131.617737,3.27224,260.69989],
 [-58.681232,-4.01556,226.573807],[-58.681232,3.27224,226.573807],[-58.30423,-4.01556,227.406799],[-58.30423,3.27224,227.406799],
];
export function finishMITUnderpass(model:Group){
 let count=0;model.updateMatrixWorld(true);const p=new Vector3();
 model.traverse(object=>{
  if(!(object instanceof Mesh)||Array.isArray(object.material)||!/Cambridge[ _]buildings/i.test(object.material.name))return;
  const g=object.geometry,position=g.getAttribute('position'),indices=g.index,matched=new Set<number>();
  for(let i=0;i<position.count;i++){
   p.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld);
   if(p.x < -138||p.x > -58||p.z < 212||p.z > 261)continue;
   if(corners.some(c=>Math.abs(c[0]-p.x)<.003&&Math.abs(c[1]-p.y)<.003&&Math.abs(c[2]-p.z)<.003))matched.add(i);
  }
  const groups:{start:number;count:number;materialIndex:number}[]=[];
  for(let i=0;i<(indices?.count??position.count);i+=3){
   const selected=[0,1,2].every(j=>matched.has(indices?indices.getX(i+j):i+j)),index=selected?1:0;
   if(selected)count++;
   const last=groups.at(-1);if(last?.materialIndex===index)last.count+=3;else groups.push({start:i,count:3,materialIndex:index});
  }
  if(!groups.some(g=>g.materialIndex===1))return;
  const concrete=createCampusSurface('concrete') as MeshStandardMaterial;concrete.color.set('#92948f');concrete.name='MIT underpass weathered concrete';
  object.material=[object.material,concrete];g.clearGroups();groups.forEach(v=>g.addGroup(v.start,v.count,v.materialIndex));
 });
 model.userData.mitUnderpassConcreteTriangles=count;
}
