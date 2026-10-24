import {BufferGeometry,Float32BufferAttribute} from 'three';
import {UMD_FULL_BUILDINGS,UMD_FULL_SPACES} from './maryland-full-layout';
import {UMD_TERRAIN_DATA} from './maryland-terrain-data';
import {UMD_DISTRICT_TERRAIN_DATA} from './maryland-district-terrain-data';

/** Heights in metres, shifted to a local datum. The 2020/2021 bare-earth DEM
 * is real; the retained, expanded game plan and softened building pads are not
 * a survey. All surfaces use ONE triangulated lattice, so roads cannot sink
 * through a separately tessellated lawn. */
export const MARYLAND_TERRAIN_CELL=12.5;
export const MARYLAND_DISTRICT_TERRAIN_CELL=6.25;
export const MARYLAND_TERRAIN_DATUM=14;
const {grid,values}=UMD_TERRAIN_DATA;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(v:number)=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
// A 3x3 low-pass removes LiDAR-scale curbs/construction scars from traversable
// ground, while preserving the campus's hill and valley structure.
const filtered=values.map((_,index)=>{
  const col=index%grid.columns,row=Math.floor(index/grid.columns);let sum=0,weight=0;
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
    const w=(dx===0?2:1)*(dz===0?2:1);sum+=values[clamp(row+dz,0,grid.rows-1)*grid.columns+clamp(col+dx,0,grid.columns-1)]*w;weight+=w;
  }return sum/weight-MARYLAND_TERRAIN_DATUM;
});
type TerrainGrid={minX:number;minZ:number;step:number;columns:number;rows:number};
function sampleGrid(x:number,z:number,g:TerrainGrid,heights:number[]){
  const gx=clamp((x-g.minX)/g.step,0,g.columns-1),gz=clamp((z-g.minZ)/g.step,0,g.rows-1);
  const ix=Math.min(Math.floor(gx),g.columns-2),iz=Math.min(Math.floor(gz),g.rows-2),tx=gx-ix,tz=gz-iz;
  const a=heights[iz*g.columns+ix],b=heights[iz*g.columns+ix+1],c=heights[(iz+1)*g.columns+ix],d=heights[(iz+1)*g.columns+ix+1];
  return (a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz;
}
const districts=UMD_DISTRICT_TERRAIN_DATA.districts.map(d=>({
  ...d,maxX:d.grid.minX+(d.grid.columns-1)*d.grid.step,maxZ:d.grid.minZ+(d.grid.rows-1)*d.grid.step,
  // Only a 12.5m neighbourhood is softened here, instead of the former 50m.
  // Bare-earth data retains the slope breaks beside Mowatt and Paint Branch.
  filtered:d.values.map((_,index)=>{
    const col=index%d.grid.columns,row=Math.floor(index/d.grid.columns);let sum=0,weight=0;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const w=(dx===0?4:1)*(dz===0?4:1);sum+=d.values[clamp(row+dz,0,d.grid.rows-1)*d.grid.columns+clamp(col+dx,0,d.grid.columns-1)]*w;weight+=w;
    }return sum/weight-MARYLAND_TERRAIN_DATUM;
  }),
}));
const districtAt=(x:number,z:number)=>districts.find(d=>x>=d.grid.minX&&x<=d.maxX&&z>=d.grid.minZ&&z<=d.maxZ);
const districtEdge=(d:typeof districts[number],x:number,z:number)=>Math.min(x-d.grid.minX,d.maxX-x,z-d.grid.minZ,d.maxZ-z);
export function marylandRawElevation(x:number,z:number){
  const base=sampleGrid(x,z,grid,filtered),district=districtAt(x,z);
  if(!district)return base;
  return base+(sampleGrid(x,z,district.grid,district.filtered)-base)*smooth(districtEdge(district,x,z)/37.5);
}
type Pad={minX:number;maxX:number;minZ:number;maxZ:number;height:number;blend:number;footprint?:readonly (readonly number[])[];holes?:readonly (readonly (readonly number[])[])[]};
const pads:Pad[]=[];
function pad(x:number,z:number,width:number,depth:number,height=marylandRawElevation(x,z),blend=32){
  pads.push({minX:x-width/2,maxX:x+width/2,minZ:z-depth/2,maxZ:z+depth/2,height,blend});
}
const anchor=(id:string)=>UMD_TERRAIN_DATA.anchors.find(a=>a.buildingId===id)!.elevationMeters-MARYLAND_TERRAIN_DATUM;
// Legacy central landmarks were compressed before the official whole-campus
// plan was introduced. Their surveyed ground samples are preserved explicitly.
pad(-160,0,82,116,anchor('035'));
pad(160,0,76,108,anchor('077'));
pad(-66,-88,98,36);pad(55,-88,86,36);pad(-61,88,102,36);pad(64,88,90,36);
pad(-185,-236,104,78,anchor('163'),42);
pad(230,-140,50,92);pad(110,220,38,72);pad(78,234,42,32);
pad(5,0,88,16,undefined,30);
for(const building of UMD_FULL_BUILDINGS){
  const xs=building.footprint.map(p=>p[0]),zs=building.footprint.map(p=>p[1]);
  let minX=Math.min(...xs)-3,maxX=Math.max(...xs)+3,minZ=Math.min(...zs)-3,maxZ=Math.max(...zs)+3;
  // Open garages expose their ground slabs. Snap their full platform outward
  // to lattice corners so interpolation at the footprint edge cannot leak
  // higher adjacent terrain through the deck.
  if(building.kind==='garage'){
    minX=Math.floor(minX/MARYLAND_TERRAIN_CELL)*MARYLAND_TERRAIN_CELL;maxX=Math.ceil(maxX/MARYLAND_TERRAIN_CELL)*MARYLAND_TERRAIN_CELL;
    minZ=Math.floor(minZ/MARYLAND_TERRAIN_CELL)*MARYLAND_TERRAIN_CELL;maxZ=Math.ceil(maxZ/MARYLAND_TERRAIN_CELL)*MARYLAND_TERRAIN_CELL;
  }
  // A roofline's bounding box includes open courts and gaps between its wings.
  // Keep those spaces on the measured slope in the refined districts.
  const refined=(building.district==='business'||building.district==='engineering')&&building.kind!=='garage';
  const item:Pad={minX,maxX,minZ,maxZ,height:marylandRawElevation(building.x,building.z),blend:refined?16:32,footprint:refined?building.footprint:undefined,holes:refined?building.holes:undefined};
  if(building.kind==='garage')pads.unshift(item);else pads.push(item);
}
for(const space of UMD_FULL_SPACES){
  if(!['track','baseball','softball','hockey','football','field'].includes(space.kind))continue;
  const c=Math.abs(Math.cos(space.yaw)),s=Math.abs(Math.sin(space.yaw));
  pad(space.x,space.z,space.width*c+space.depth*s+4,space.width*s+space.depth*c+4,undefined,38);
}
const padCells=new Map<string,Pad[]>(),padCell=160;
for(const p of pads)for(let ix=Math.floor((p.minX-p.blend)/padCell);ix<=Math.floor((p.maxX+p.blend)/padCell);ix++)for(let iz=Math.floor((p.minZ-p.blend)/padCell);iz<=Math.floor((p.maxZ+p.blend)/padCell);iz++){
  const key=`${ix},${iz}`,list=padCells.get(key)||[];list.push(p);padCells.set(key,list);
}
function authoredElevation(x:number,z:number){
  const base=marylandRawElevation(x,z);let sum=0,weight=0,strongest=0;
  for(const p of padCells.get(`${Math.floor(x/padCell)},${Math.floor(z/padCell)}`)||[]){
    let distance=Math.hypot(Math.max(p.minX-x,0,x-p.maxX),Math.max(p.minZ-z,0,z-p.maxZ));
    if(p.footprint){
      let inside=false,nearest=Infinity;
      for(const ring of [p.footprint,...p.holes||[]])for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[j],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
        nearest=Math.min(nearest,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
        if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      }
      distance=inside?0:nearest;
    }
    if(distance===0)return p.height;
    if(distance>=p.blend)continue;
    const w=1-smooth(distance/p.blend);sum+=p.height*w;weight+=w;strongest=Math.max(strongest,w);
  }
  return weight?base+(sum/weight-base)*strongest:base;
}
const lattice=new Map<string,number>();
function latticeHeight(ix:number,iz:number){
  const key=`${ix},${iz}`;let height=lattice.get(key);
  if(height===undefined){height=authoredElevation(ix*MARYLAND_TERRAIN_CELL,iz*MARYLAND_TERRAIN_CELL);lattice.set(key,height);}
  return height;
}
function coarseElevation(x:number,z:number):number{
  const gx=x/MARYLAND_TERRAIN_CELL,gz=z/MARYLAND_TERRAIN_CELL,ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz;
  const a=latticeHeight(ix,iz),d=latticeHeight(ix+1,iz+1);
  return tx>=tz?a+(latticeHeight(ix+1,iz)-a)*tx+(d-latticeHeight(ix+1,iz))*tz:a+(d-latticeHeight(ix,iz+1))*tx+(latticeHeight(ix,iz+1)-a)*tz;
}
const districtLattice=new Map<string,number>();
function districtLatticeHeight(ix:number,iz:number){
  const key=`${ix},${iz}`;let height=districtLattice.get(key);
  if(height===undefined){
    const x=ix*MARYLAND_DISTRICT_TERRAIN_CELL,z=iz*MARYLAND_DISTRICT_TERRAIN_CELL,district=districtAt(x,z),coarse=coarseElevation(x,z);
    // Edge midpoints must lie on the neighbouring coarse triangle, otherwise
    // independently tessellated roads and lawns acquire visible T-junctions.
    height=district?coarse+(authoredElevation(x,z)-coarse)*smooth(districtEdge(district,x,z)/MARYLAND_TERRAIN_CELL):coarse;
    districtLattice.set(key,height);
  }return height;
}
export function marylandElevation(x:number,z:number):number{
  if(!districtAt(x,z))return coarseElevation(x,z);
  const gx=x/MARYLAND_DISTRICT_TERRAIN_CELL,gz=z/MARYLAND_DISTRICT_TERRAIN_CELL,ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz;
  const a=districtLatticeHeight(ix,iz),d=districtLatticeHeight(ix+1,iz+1);
  return tx>=tz?a+(districtLatticeHeight(ix+1,iz)-a)*tx+(d-districtLatticeHeight(ix+1,iz))*tz:a+(d-districtLatticeHeight(ix,iz+1))*tx+(districtLatticeHeight(ix,iz+1)-a)*tz;
}

type Vertex=number[];
/** The input must already be in campus world coordinates. Returns a NEW
 * geometry; callers own disposal of the input. UV/color/custom float attributes
 * are interpolated; material groups are retained; underside triangles are
 * omitted. maxEdge can add detail but never changes the shared height field. */
export function drapeMarylandGeometry(geometry:BufferGeometry,maxEdge=12):BufferGeometry{
  const position=geometry.getAttribute('position');if(!position)return geometry.clone();
  const names=Object.keys(geometry.attributes),offsets:number[]=[],sizes:number[]=[];let stride=0;
  names.forEach(name=>{offsets.push(stride);const size=geometry.getAttribute(name).itemSize;sizes.push(size);stride+=size;});
  const po=offsets[names.indexOf('position')],normalIndex=names.indexOf('normal'),no=normalIndex<0?-1:offsets[normalIndex];
  const output:number[][]=names.map(()=>[]),result=new BufferGeometry();let emitted=0;
  function vertex(index:number){const v:number[]=[];for(const name of names){const attr=geometry.getAttribute(name);for(let k=0;k<attr.itemSize;k++)v.push(attr.getComponent(index,k));}return v;}
  function mix(a:Vertex,b:Vertex,t:number){return a.map((value,i)=>value+(b[i]-value)*t);}
  function clip(poly:Vertex[],distance:(v:Vertex)=>number){
    const out:Vertex[]=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a),db=distance(b),ia=da>=-1e-8,ib=db>=-1e-8;
      if(ia)out.push(a);if(ia!==ib)out.push(mix(a,b,da/(da-db)));
    }return out;
  }
  function emit(a:Vertex,b:Vertex,c:Vertex,up:boolean,depth=0){
    const ax=b[po]-a[po],ay=b[po+1]-a[po+1],az=b[po+2]-a[po+2],bx=c[po]-a[po],by=c[po+1]-a[po+1],bz=c[po+2]-a[po+2];
    if(Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)<1e-9)return;
    const verts=[a,b,c],edges=verts.map((v,i)=>Math.hypot(v[po]-verts[(i+1)%3][po],v[po+2]-verts[(i+1)%3][po+2]));
    const longest=Math.max(...edges);
    if(longest>Math.max(maxEdge,2)&&depth<5){const i=edges.indexOf(longest),j=(i+1)%3,k=(i+2)%3,m= mix(verts[i],verts[j],.5);emit(verts[i],m,verts[k],up,depth+1);emit(m,verts[j],verts[k],up,depth+1);return;}
    for(const original of verts){
      const v=original.slice(),x=v[po],z=v[po+2];v[po+1]+=marylandElevation(x,z);
      if(up&&no>=0){const dx=(marylandElevation(x+.8,z)-marylandElevation(x-.8,z))/1.6,dz=(marylandElevation(x,z+.8)-marylandElevation(x,z-.8))/1.6,length=Math.hypot(dx,1,dz);v[no]=-dx/length;v[no+1]=1/length;v[no+2]=-dz/length;}
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
      const loX=Math.floor(minX/MARYLAND_TERRAIN_CELL),hiX=Math.max(loX,Math.floor((maxX-1e-7)/MARYLAND_TERRAIN_CELL)),loZ=Math.floor(minZ/MARYLAND_TERRAIN_CELL),hiZ=Math.max(loZ,Math.floor((maxZ-1e-7)/MARYLAND_TERRAIN_CELL));
      for(let ix=loX;ix<=hiX;ix++)for(let iz=loZ;iz<=hiZ;iz++){
        const x=ix*MARYLAND_TERRAIN_CELL,z=iz*MARYLAND_TERRAIN_CELL;
        const subdivisions=districtAt(x+MARYLAND_TERRAIN_CELL/2,z+MARYLAND_TERRAIN_CELL/2)?2:1,step=MARYLAND_TERRAIN_CELL/subdivisions;
        for(let sx=0;sx<subdivisions;sx++)for(let sz=0;sz<subdivisions;sz++){
          const cellX=x+sx*step,cellZ=z+sz*step;
          let poly=clip(tri,v=>v[po]-cellX);poly=clip(poly,v=>cellX+step-v[po]);poly=clip(poly,v=>v[po+2]-cellZ);poly=clip(poly,v=>cellZ+step-v[po+2]);
          if(poly.length<3)continue;
          for(const sign of [-1,1]){const half=clip(poly,v=>sign*((v[po]-cellX)-(v[po+2]-cellZ)));for(let i=1;i<half.length-1;i++)emit(half[0],half[i],half[i+1],up);}
        }
      }
    }
    if(emitted>start)result.addGroup(start,emitted-start,group.materialIndex);
  }
  names.forEach((name,i)=>result.setAttribute(name,new Float32BufferAttribute(output[i],sizes[i],geometry.getAttribute(name).normalized)));
  result.userData={...geometry.userData,marylandTerrain:true};result.computeBoundingBox();result.computeBoundingSphere();return result;
}
