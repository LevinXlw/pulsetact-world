import {Vector3,type Mesh} from 'three';

/** The mobile ground index stores packed triangle values instead of allocating
 * ten-property JS objects for every face of the terrain and bridge meshes. */
export function createMobileGroundSampler(meshes:readonly Mesh[]){
  const total=meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3,0);
  const triangles=new Float32Array(total*10),cells=new Map<number,number[]>(),cellSize=16;
  const key=(x:number,z:number)=>(x+32768)*65536+z+32768;
  const a=new Vector3(),b=new Vector3(),c=new Vector3();let length=0;
  for(const mesh of meshes){
    const positions=mesh.geometry.getAttribute('position'),indices=mesh.geometry.index,count=indices?.count??positions.count;
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(positions,indices?indices.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,indices?indices.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,indices?indices.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      if((b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z)<1e-10)continue;
      const offset=length++*10;triangles.set([a.x,a.z,a.y,b.x,b.z,b.y,c.x,c.z,c.y,1/((b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z))],offset);
      const minX=Math.floor(Math.min(a.x,b.x,c.x)/cellSize),maxX=Math.floor(Math.max(a.x,b.x,c.x)/cellSize),minZ=Math.floor(Math.min(a.z,b.z,c.z)/cellSize),maxZ=Math.floor(Math.max(a.z,b.z,c.z)/cellSize);
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const id=key(x,z),cell=cells.get(id);if(cell)cell.push(offset);else cells.set(id,[offset]);}
    }
  }
  return(x:number,z:number)=>{
    const candidates=cells.get(key(Math.floor(x/cellSize),Math.floor(z/cellSize)));if(!candidates)return undefined;let highest=-Infinity;
    for(const i of candidates){const ax=triangles[i],az=triangles[i+1],bx=triangles[i+3],bz=triangles[i+4],cx=triangles[i+6],cz=triangles[i+7],inverse=triangles[i+9],wa=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))*inverse,wb=((cz-az)*(x-cx)+(ax-cx)*(z-cz))*inverse,wc=1-wa-wb;
      if(wa<-.00001||wb<-.00001||wc<-.00001)continue;highest=Math.max(highest,triangles[i+2]*wa+triangles[i+5]*wb+triangles[i+8]*wc);
    }
    return highest===-Infinity?undefined:highest;
  };
}
