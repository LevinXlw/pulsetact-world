import {BufferGeometry,Float32BufferAttribute,Uint8BufferAttribute} from 'three';

// Three smaller tapered blades replace one oversized pentagonal leaf card.
// Six triangles per cluster, versus five previously; no alpha texture required.
export function foliageCluster(radius){
 const positions=[],colors=[],uv=[];
 for(let leaf=0;leaf<3;leaf++){
  const angle=leaf*Math.PI*2/3,c=Math.cos(angle),s=Math.sin(angle);
  const points=[[0,0,0],[radius*.34,radius*.4,.035],[0,radius*.95,.065],[-radius*.34,radius*.4,.035]];
  for(const i of [0,1,2,0,2,3]){
   const [x,y,z]=points[i];positions.push(x*c-y*s,x*s+y*c,z);
   const tone=i===0?174:i===2?255:229;colors.push(tone,tone,tone);
   uv.push((x/radius+1)/2,y/radius);
  }
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('color',new Uint8BufferAttribute(colors,3,true));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
