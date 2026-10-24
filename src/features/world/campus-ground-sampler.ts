import {Vector3,type Mesh} from 'three';

type Triangle={ax:number;az:number;ay:number;bx:number;bz:number;by:number;cx:number;cz:number;cy:number;inverse:number};

/** Exact vertical terrain samples for planting, partitioned into small cells.
 * Grass checks thousands of roots against paving; testing every triangle of a
 * merged campus mesh for every root makes large campuses expensive to load.
 * This index is temporary. Walking and camera collision keep their own queries.
 */
export function createCampusGroundSampler(meshes:readonly Mesh[]){
  const cellSize=16,cells=new Map<string,Triangle[]>(),a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);
    const positions=mesh.geometry.getAttribute('position'),indices=mesh.geometry.index,count=indices?.count??positions.count;
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(positions,indices?indices.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,indices?indices.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,indices?indices.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      const normalY=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);
      if(normalY<1e-10)continue; // Only upward-facing, nonvertical terrain.
      const inverse=1/((b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z));
      const triangle:Triangle={ax:a.x,az:a.z,ay:a.y,bx:b.x,bz:b.z,by:b.y,cx:c.x,cz:c.z,cy:c.y,inverse};
      const minX=Math.floor(Math.min(a.x,b.x,c.x)/cellSize),maxX=Math.floor(Math.max(a.x,b.x,c.x)/cellSize);
      const minZ=Math.floor(Math.min(a.z,b.z,c.z)/cellSize),maxZ=Math.floor(Math.max(a.z,b.z,c.z)/cellSize);
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
        const key=`${x}:${z}`,cell=cells.get(key);if(cell)cell.push(triangle);else cells.set(key,[triangle]);
      }
    }
  }
  return (x:number,z:number):number|undefined=>{
    const cell=cells.get(`${Math.floor(x/cellSize)}:${Math.floor(z/cellSize)}`);if(!cell)return undefined;
    let highest=-Infinity;
    for(const t of cell){
      const wa=((t.bz-t.cz)*(x-t.cx)+(t.cx-t.bx)*(z-t.cz))*t.inverse;
      const wb=((t.cz-t.az)*(x-t.cx)+(t.ax-t.cx)*(z-t.cz))*t.inverse,wc=1-wa-wb;
      // A point exactly on a shared triangle edge can become -1e-16 after
      // transformation. Keep that boundary, matching Three's vertical raycast.
      if(wa<-1e-9||wb<-1e-9||wc<-1e-9)continue;
      highest=Math.max(highest,t.ay*wa+t.by*wb+t.cy*wc);
    }
    return highest===-Infinity?undefined:highest;
  };
}
