import {BufferGeometry,Float32BufferAttribute} from 'three';
// Shared grid vertices and boundary relaxation remove the stair-step outlines of a classified raster.
export function surfaceGeometry(runs,step,kind,height,exclude){
 const vertices=[],lookup=new Map(),quads=[],edges=new Map();
 const vertex=(x,z)=>{const key=`${x},${z}`;if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push([x,z]);}return lookup.get(key);};
 for(const [x,z,length] of runs)for(let offset=0;offset<length;offset+=step){
  const a=x+offset;if(exclude(a+step/2,z+step/2))continue;
  const quad=[vertex(a,z),vertex(a,z+step),vertex(a+step,z+step),vertex(a+step,z)];quads.push(quad);
  for(let i=0;i<4;i++){const u=quad[i],v=quad[(i+1)%4],key=u<v?`${u},${v}`:`${v},${u}`;if(edges.has(key))edges.delete(key);else edges.set(key,[u,v]);}
 }
 const neighbours=new Map();for(const [u,v] of edges.values()){if(!neighbours.has(u))neighbours.set(u,[]);if(!neighbours.has(v))neighbours.set(v,[]);neighbours.get(u).push(v);neighbours.get(v).push(u);}
 for(let pass=0;pass<3;pass++){const copy=vertices.map(p=>[...p]);for(const [i,ns] of neighbours){if(ns.length!==2)continue;for(let axis=0;axis<2;axis++)vertices[i][axis]=copy[i][axis]*.5+(copy[ns[0]][axis]+copy[ns[1]][axis])*.25;}}
 const positions=[],uv=[],colors=[];
 for(const [x,z] of vertices){positions.push(x,kind==='water'?.12:height(x,z)+.12,z);uv.push(x/3,z/3);colors.push(1,1,1);}
 const indices=[];for(const [a,b,c,d] of quads)indices.push(a,b,d,d,b,c);
 const g=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)).setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);
 if(kind==='grass')g.setAttribute('color',new Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
