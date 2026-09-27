import {BufferAttribute,BufferGeometry,Group,Mesh} from 'three';
export type PorticoOpening={center:number[];normal:number[];width:number;bottom:number;top:number};
export function isPorticoTriangle(vertices:number[][],opening:PorticoOpening){
 const {center:c,normal:n,width,bottom,top}=opening;
 return vertices.every(p=>Math.abs((p[0]-c[0])*n[0]+(p[2]-c[2])*n[2])<.025&&
  Math.abs((p[0]-c[0])*n[2]-(p[2]-c[2])*n[0])<width/2+.03&&p[1]>=bottom-.03&&p[1]<=top+.03);
}
/** Remove only the surveyed front cover, retaining the original recessed wall and roof. */
export function openPortico(group:Group,opening:PorticoOpening,crown?:{center:number[];base:number;radius:number}){
 let removed=0;
 group.traverse(object=>{
  if(!(object instanceof Mesh))return;const material=Array.isArray(object.material)?object.material[0]:object.material;
  if(material.name!=='Cambridge buildings (untextured)')return;
  const old=object.geometry as BufferGeometry,source=old.index?old.toNonIndexed():old,p=source.getAttribute('position'),keep:number[]=[];
  for(let i=0;i<p.count;i+=3){const vertices=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]);
   if(isPorticoTriangle(vertices,opening)){removed++;continue;}
   if(crown&&vertices.every(v=>v[1]>=crown.base-.02&&Math.hypot(v[0]-crown.center[0],v[2]-crown.center[1])<=crown.radius))continue;
   keep.push(i,i+1,i+2);
  }
  const geometry=new BufferGeometry();
  for(const [name,attribute] of Object.entries(source.attributes)){
   const array=new Float32Array(keep.length*attribute.itemSize);
   keep.forEach((index,out)=>{for(let k=0;k<attribute.itemSize;k++)array[out*attribute.itemSize+k]=attribute.getComponent(index,k);});
   geometry.setAttribute(name,new BufferAttribute(array,attribute.itemSize));
  }
  object.geometry=geometry;if(source!==old)source.dispose();old.dispose();
 });
 return removed;
}
