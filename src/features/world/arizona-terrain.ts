import {BufferGeometry,Float32BufferAttribute} from 'three';
import {ARIZONA_TERRAIN_DATA as DATA} from './arizona-terrain-data';

type Point=readonly [number,number];
type Building={x:number;z:number;footprint:readonly Point[];holes?:readonly (readonly Point[])[]};
const CELL=8,PAD_CELL=120;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(v:number)=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
// Modest low-pass of a roughly 9m grid removes individual DEM artefacts while
// retaining the measured campus-wide slope. This is not terrain exaggeration.
const heights=DATA.values.map((_,index)=>{
  const col=index%DATA.width,row=Math.floor(index/DATA.width);let sum=0,total=0;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    const w=(dx===0?4:1)*(dz===0?4:1);sum+=DATA.values[clamp(row+dz,0,DATA.height-1)*DATA.width+clamp(col+dx,0,DATA.width-1)]*w;total+=w;
  }return sum/total;
});
export function arizonaGeographicElevation(longitude:number,latitude:number){
  const e=DATA.extent,gx=clamp((longitude-e.xmin)/(e.xmax-e.xmin)*DATA.width-.5,0,DATA.width-1),gz=clamp((e.ymax-latitude)/(e.ymax-e.ymin)*DATA.height-.5,0,DATA.height-1);
  const ix=Math.min(Math.floor(gx),DATA.width-2),iz=Math.min(Math.floor(gz),DATA.height-2),tx=gx-ix,tz=gz-iz;
  const a=heights[iz*DATA.width+ix],b=heights[iz*DATA.width+ix+1],c=heights[(iz+1)*DATA.width+ix],d=heights[(iz+1)*DATA.width+ix+1];
  return (a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz;
}

/** Shared 8m triangulated terrain, with small, documented building pads.
 * Preserve concave footprints and courtyard openings when blending the pad.
 * All paved polygons must use drape(), including their ground collider mesh. */
export function createArizonaTerrain(origin:{longitude:number;latitude:number},buildings:readonly Building[],mx=111320*Math.cos(origin.latitude*Math.PI/180),mz=111320){
  const datum=arizonaGeographicElevation(origin.longitude,origin.latitude);
  const rawElevation=(x:number,z:number)=>arizonaGeographicElevation(origin.longitude+x/mx,origin.latitude-z/mz)-datum;
  const pads=buildings.map(b=>({...b,minX:Math.min(...b.footprint.map(p=>p[0])),maxX:Math.max(...b.footprint.map(p=>p[0])),minZ:Math.min(...b.footprint.map(p=>p[1])),maxZ:Math.max(...b.footprint.map(p=>p[1])),height:rawElevation(b.x,b.z)}));
  const cells=new Map<string,typeof pads>();
  for(const p of pads)for(let ix=Math.floor((p.minX-14)/PAD_CELL);ix<=Math.floor((p.maxX+14)/PAD_CELL);ix++)for(let iz=Math.floor((p.minZ-14)/PAD_CELL);iz<=Math.floor((p.maxZ+14)/PAD_CELL);iz++){
    const key=`${ix},${iz}`,list=cells.get(key)??[];list.push(p);cells.set(key,list);
  }
  function authoredElevation(x:number,z:number){
    const raw=rawElevation(x,z);let weighted=0,weight=0,strongest=0;
    for(const p of cells.get(`${Math.floor(x/PAD_CELL)},${Math.floor(z/PAD_CELL)}`)??[]){
      if(x<p.minX-14||x>p.maxX+14||z<p.minZ-14||z>p.maxZ+14)continue;
      let inside=false,nearest=Infinity;
      for(const ring of [p.footprint,...p.holes??[]])for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[j],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
        nearest=Math.min(nearest,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
        if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      }
      if(inside)return p.height;if(nearest>=14)continue;
      const w=1-smooth(nearest/14);weighted+=p.height*w;weight+=w;strongest=Math.max(strongest,w);
    }
    return weight?raw+(weighted/weight-raw)*strongest:raw;
  }
  const lattice=new Map<string,number>();
  function height(ix:number,iz:number){const key=`${ix},${iz}`;let h=lattice.get(key);if(h===undefined){h=authoredElevation(ix*CELL,iz*CELL);lattice.set(key,h);}return h;}
  function elevation(x:number,z:number){
    const gx=x/CELL,gz=z/CELL,ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz,a=height(ix,iz),d=height(ix+1,iz+1);
    return tx>=tz?a+(height(ix+1,iz)-a)*tx+(d-height(ix+1,iz))*tz:a+(d-height(ix,iz+1))*tx+(height(ix,iz+1)-a)*tz;
  }
  return {elevation,rawElevation,datum,drape:(geometry:BufferGeometry,maxEdge=12)=>drapeGeometry(geometry,elevation,maxEdge)};
}

type Vertex=number[];
// Clip to the same cell diagonals used by elevation(). Separate road/ground
// triangulations would otherwise create visible seams and invisible steps.
function drapeGeometry(geometry:BufferGeometry,elevation:(x:number,z:number)=>number,maxEdge:number):BufferGeometry{
  const position=geometry.getAttribute('position');if(!position)return geometry.clone();
  const names=Object.keys(geometry.attributes),offsets:number[]=[],sizes:number[]=[];let stride=0;
  names.forEach(name=>{offsets.push(stride);const size=geometry.getAttribute(name).itemSize;sizes.push(size);stride+=size;});
  const po=offsets[names.indexOf('position')],normalIndex=names.indexOf('normal'),no=normalIndex<0?-1:offsets[normalIndex];
  const output:number[][]=names.map(()=>[]),result=new BufferGeometry();let emitted=0;
  function vertex(index:number){const v:number[]=[];for(const name of names){const attr=geometry.getAttribute(name);for(let k=0;k<attr.itemSize;k++)v.push(attr.getComponent(index,k));}return v;}
  const mix=(a:Vertex,b:Vertex,t:number)=>a.map((value,i)=>value+(b[i]-value)*t);
  function clip(poly:Vertex[],distance:(v:Vertex)=>number){
    const out:Vertex[]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a),db=distance(b),ia=da>=-1e-8,ib=db>=-1e-8;if(ia)out.push(a);if(ia!==ib)out.push(mix(a,b,da/(da-db)));}return out;
  }
  function emit(a:Vertex,b:Vertex,c:Vertex,up:boolean,depth=0){
    const ax=b[po]-a[po],ay=b[po+1]-a[po+1],az=b[po+2]-a[po+2],bx=c[po]-a[po],by=c[po+1]-a[po+1],bz=c[po+2]-a[po+2];
    if(Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)<1e-9)return;
    const verts=[a,b,c],edges=verts.map((v,i)=>Math.hypot(v[po]-verts[(i+1)%3][po],v[po+2]-verts[(i+1)%3][po+2]));
    const longest=Math.max(...edges);if(longest>Math.max(maxEdge,2)&&depth<5){const i=edges.indexOf(longest),j=(i+1)%3,k=(i+2)%3,m=mix(verts[i],verts[j],.5);emit(verts[i],m,verts[k],up,depth+1);emit(m,verts[j],verts[k],up,depth+1);return;}
    for(const original of verts){
      const v=original.slice(),x=v[po],z=v[po+2];v[po+1]+=elevation(x,z);
      if(up&&no>=0){const dx=(elevation(x+.8,z)-elevation(x-.8,z))/1.6,dz=(elevation(x,z+.8)-elevation(x,z-.8))/1.6,length=Math.hypot(dx,1,dz);v[no]=-dx/length;v[no+1]=1/length;v[no+2]=-dz/length;}
      names.forEach((_,i)=>{for(let k=0;k<sizes[i];k++)output[i].push(v[offsets[i]+k]);});emitted++;
    }
  }
  const index=geometry.index,total=index?index.count:position.count,groups=geometry.groups.length?geometry.groups:[{start:0,count:total,materialIndex:0}];
  for(const group of groups){
    const start=emitted;
    for(let t=group.start;t<Math.min(total,group.start+group.count);t+=3){
      const tri=[0,1,2].map(i=>vertex(index?index.getX(t+i):t+i));
      const ax=tri[1][po]-tri[0][po],az=tri[1][po+2]-tri[0][po+2],bx=tri[2][po]-tri[0][po],bz=tri[2][po+2]-tri[0][po+2],crossY=az*bx-ax*bz;
      if(crossY<-1e-7)continue;
      const up=crossY>1e-7,minX=Math.min(...tri.map(v=>v[po])),maxX=Math.max(...tri.map(v=>v[po])),minZ=Math.min(...tri.map(v=>v[po+2])),maxZ=Math.max(...tri.map(v=>v[po+2]));
      const loX=Math.floor(minX/CELL),hiX=Math.max(loX,Math.floor((maxX-1e-7)/CELL)),loZ=Math.floor(minZ/CELL),hiZ=Math.max(loZ,Math.floor((maxZ-1e-7)/CELL));
      for(let ix=loX;ix<=hiX;ix++)for(let iz=loZ;iz<=hiZ;iz++){
        const x=ix*CELL,z=iz*CELL;let poly=clip(tri,v=>v[po]-x);poly=clip(poly,v=>x+CELL-v[po]);poly=clip(poly,v=>v[po+2]-z);poly=clip(poly,v=>z+CELL-v[po+2]);if(poly.length<3)continue;
        for(const sign of [-1,1]){const half=clip(poly,v=>sign*((v[po]-x)-(v[po+2]-z)));for(let i=1;i<half.length-1;i++)emit(half[0],half[i],half[i+1],up);}
      }
    }
    if(emitted>start)result.addGroup(start,emitted-start,group.materialIndex);
  }
  names.forEach((name,i)=>result.setAttribute(name,new Float32BufferAttribute(output[i],sizes[i],geometry.getAttribute(name).normalized)));
  result.computeBoundingBox();result.computeBoundingSphere();return result;
}
