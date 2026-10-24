import {Vector3,type Mesh} from 'three';

type Point=[number,number,number];
type Triangle={points:Point[];minX:number;maxX:number;minZ:number;maxZ:number};

/** Intersect paving footprints with the actual terrain triangles. Sampling a
 * regular grid cuts across the source's kerbs and slope creases, leaving grass
 * splinters through the new paving. Clipping retains those exact break lines. */
export function createMITSurfaceProjection(meshes:readonly Mesh[]){
 const cells=new Map<string,Triangle[]>(),size=16,p=new Vector3();
 for(const mesh of meshes){
  mesh.updateWorldMatrix(true,false);const position=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
  for(let i=0;i<(index?.count??position.count);i+=3){
   const points=[0,1,2].map(j=>p.fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld).toArray() as Point);
   const [a,b,c]=points;if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<1e-10)continue;
   const t:Triangle={points,minX:Math.min(...points.map(v=>v[0])),maxX:Math.max(...points.map(v=>v[0])),minZ:Math.min(...points.map(v=>v[2])),maxZ:Math.max(...points.map(v=>v[2]))};
   // Only index this small corridor, not the full Boston/BU terrain. This is
   // also used during phone loading, where another campus-wide index is costly.
   if(t.maxX < -375||t.minX > 50||t.maxZ < 155||t.minZ > 385)continue;
   for(let x=Math.floor(t.minX/size);x<=Math.floor(t.maxX/size);x++)for(let z=Math.floor(t.minZ/size);z<=Math.floor(t.maxZ/size);z++){
    const key=`${x}:${z}`,list=cells.get(key);if(list)list.push(t);else cells.set(key,[t]);
   }
  }
 }
 return(footprint:readonly Point[],lift:number,out:number[])=>{
  const minX=Math.min(...footprint.map(v=>v[0])),maxX=Math.max(...footprint.map(v=>v[0])),minZ=Math.min(...footprint.map(v=>v[2])),maxZ=Math.max(...footprint.map(v=>v[2]));
  const candidates=new Set<Triangle>();
  for(let x=Math.floor(minX/size);x<=Math.floor(maxX/size);x++)for(let z=Math.floor(minZ/size);z<=Math.floor(maxZ/size);z++)for(const t of cells.get(`${x}:${z}`)??[])candidates.add(t);
  let area=0;for(let i=0;i<footprint.length;i++){const a=footprint[i],b=footprint[(i+1)%footprint.length];area+=a[0]*b[2]-b[0]*a[2];}
  const sign=area>0?1:-1;
  for(const t of candidates){
   if(t.maxX<minX||t.minX>maxX||t.maxZ<minZ||t.minZ>maxZ)continue;let poly=t.points;
   for(let i=0;i<footprint.length&&poly.length>=3;i++){
    const a=footprint[i],b=footprint[(i+1)%footprint.length],distance=(p:Point)=>sign*((b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0])),next:Point[]=[];
    for(let j=0;j<poly.length;j++){
     const p=poly[j],q=poly[(j+1)%poly.length],dp=distance(p),dq=distance(q),inside=dp>=-1e-9;
     if(inside)next.push(p);
     if(inside!==(dq>=-1e-9)){const ratio=dp/(dp-dq);next.push([p[0]+(q[0]-p[0])*ratio,p[1]+(q[1]-p[1])*ratio,p[2]+(q[2]-p[2])*ratio]);}
    }poly=next;
   }
   for(let i=1;i<poly.length-1;i++){
    const [a,b,c]=[poly[0],poly[i],poly[i+1]],normal=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    if(normal<1e-10)continue;for(const p of [a,b,c])out.push(p[0],p[1]+lift,p[2]);
   }
  }
 };
}
