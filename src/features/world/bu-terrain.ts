import {BufferGeometry,Float32BufferAttribute} from 'three';
import {BU_FULL_BUILDINGS,BU_FULL_SPACES} from './bu-full-layout';
import {BU_TERRAIN_DATA} from './bu-terrain-data';

/** Core district: USGS 3DEP bare-earth elevations, NAVD88 metres. Elsewhere
 * retain the older building-base interpolation until that district is rebuilt.
 * The 6 m source samples feed the shared 12 m runtime triangle lattice; neither
 * the interpolation nor the terrain mesh claims to recover stairs/bridge decks. */
export const BU_TERRAIN_CELL=12;
export const BU_DEM_CORE_BOUNDS={minX:-1608,maxX:-624,minZ:780,maxZ:1080};
// Includes the Beacon Street approach to Danielsen, with room for the east edge
// to return gradually to the surrounding scene datum beyond the walk boundary.
export const BU_TERRAIN_BOUNDS={minX:-2850,maxX:390,minZ:600,maxZ:1600};
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
/** Stop north of the Mass Pike cut. Its grade-separated roadway retains its
 * own model in this pass, so a bare-earth trough is not depressed twice. */
export function buDEMWeight(x:number,z:number){
  const b=BU_DEM_CORE_BOUNDS;
  return smooth(Math.min(x-b.minX,b.maxX-x,z-b.minZ,b.maxZ-z)/48);
}
export function buSurveyElevation(x:number,z:number):number|undefined{
  const {grid,values}=BU_TERRAIN_DATA,gx=(x-grid.minX)/grid.step,gz=(z-grid.minZ)/grid.step;
  if(gx<0||gz<0||gx>grid.columns-1||gz>grid.rows-1)return undefined;
  const ix=Math.min(grid.columns-2,Math.floor(gx)),iz=Math.min(grid.rows-2,Math.floor(gz)),tx=gx-ix,tz=gz-iz;
  const at=(dx:number,dz:number)=>values[(iz+dz)*grid.columns+ix+dx];
  return at(0,0)*(1-tx)*(1-tz)+at(1,0)*tx*(1-tz)+at(0,1)*(1-tx)*tz+at(1,1)*tx*tz;
}
const samples=BU_FULL_BUILDINGS.filter(b=>b.groundElevation!==null&&b.groundElevation>=1&&b.groundElevation<25);
const sampleCells=new Map<string,typeof samples>();
for(const sample of samples){const key=`${Math.floor(sample.x/200)}:${Math.floor(sample.z/200)}`,list=sampleCells.get(key)??[];list.push(sample);sampleCells.set(key,list);}
function rawElevation(x:number,z:number){
  if(x<BU_TERRAIN_BOUNDS.minX||x>BU_TERRAIN_BOUNDS.maxX||z<BU_TERRAIN_BOUNDS.minZ||z>BU_TERRAIN_BOUNDS.maxZ)return 5.2;
  let weighted=0,weight=0;
  const candidates:typeof samples=[];
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)candidates.push(...sampleCells.get(`${Math.floor(x/200)+dx}:${Math.floor(z/200)+dz}`)??[]);
  const near=(candidates.length?candidates:samples).map(b=>({b,d:(x-b.x)**2+(z-b.z)**2})).sort((a,b)=>a.d-b.d).slice(0,6);
  for(const {b,d} of near){const w=1/(d+1600);weighted+=b.groundElevation!*w;weight+=w;}
  const base=weight?weighted/weight:5.2;
  const coreDistance=Math.hypot(Math.max(-1320-x,0,x+545),Math.max(875-z,0,z-1145));
  // Existing core facades, river footbridge and old saves keep the same levels.
  const blend=smooth(coreDistance/120)*smooth((z-790)/80)*smooth(Math.min(x-BU_TERRAIN_BOUNDS.minX,BU_TERRAIN_BOUNDS.maxX-x,BU_TERRAIN_BOUNDS.maxZ-z)/100);
  return 5.2+(base-5.2)*blend;
}
type Pad={minX:number;maxX:number;minZ:number;maxZ:number;height:number};
const pads:Pad[]=BU_FULL_BUILDINGS.filter(b=>!b.custom).map(b=>({
  minX:Math.floor((Math.min(...b.footprint.map(p=>p[0]))-2)/12)*12,
  maxX:Math.ceil((Math.max(...b.footprint.map(p=>p[0]))+2)/12)*12,
  minZ:Math.floor((Math.min(...b.footprint.map(p=>p[1]))-2)/12)*12,
  maxZ:Math.ceil((Math.max(...b.footprint.map(p=>p[1]))+2)/12)*12,
  height:rawElevation(b.x,b.z),
}));
for(const space of BU_FULL_SPACES){
  const c=Math.abs(Math.cos(space.yaw)),s=Math.abs(Math.sin(space.yaw)),width=space.width*c+space.depth*s,depth=space.width*s+space.depth*c;
  pads.unshift({minX:Math.floor((space.x-width/2-3)/12)*12,maxX:Math.ceil((space.x+width/2+3)/12)*12,minZ:Math.floor((space.z-depth/2-3)/12)*12,maxZ:Math.ceil((space.z+depth/2+3)/12)*12,height:rawElevation(space.x,space.z)});
}
const cells=new Map<string,Pad[]>();
for(const p of pads)for(let ix=Math.floor((p.minX-30)/160);ix<=Math.floor((p.maxX+30)/160);ix++)for(let iz=Math.floor((p.minZ-30)/160);iz<=Math.floor((p.maxZ+30)/160);iz++){
  const key=`${ix}:${iz}`,list=cells.get(key)??[];list.push(p);cells.set(key,list);
}
const lattice=new Map<string,number>();
function latticeHeight(ix:number,iz:number){
  const key=`${ix}:${iz}`,cached=lattice.get(key);if(cached!==undefined)return cached;
  const x=ix*BU_TERRAIN_CELL,z=iz*BU_TERRAIN_CELL,base=rawElevation(x,z);
  let sum=0,weight=0,strongest=0;
  for(const p of cells.get(`${Math.floor(x/160)}:${Math.floor(z/160)}`)??[]){
    const distance=Math.hypot(Math.max(p.minX-x,0,x-p.maxX),Math.max(p.minZ-z,0,z-p.maxZ));
    const w=1-smooth(distance/30);sum+=p.height*w;weight+=w;strongest=Math.max(strongest,w);
  }
  const legacy=weight?base+(sum/weight-base)*strongest:base,dem=buSurveyElevation(x,z),blend=buDEMWeight(x,z);
  // Blend AFTER legacy building pads: otherwise their large bounding rectangles
  // erase the actual campus slopes and retain the former artificial flat core.
  const height=dem===undefined?legacy:legacy+(dem-legacy)*blend;lattice.set(key,height);return height;
}
export function buElevation(x:number,z:number):number{
  const gx=x/BU_TERRAIN_CELL,gz=z/BU_TERRAIN_CELL,ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz;
  const a=latticeHeight(ix,iz),d=latticeHeight(ix+1,iz+1);
  return tx>=tz?a+(latticeHeight(ix+1,iz)-a)*tx+(d-latticeHeight(ix+1,iz))*tz:a+(d-latticeHeight(ix,iz+1))*tx+(latticeHeight(ix,iz+1)-a)*tz;
}
type Vertex=number[];
/** The input must already be in campus world coordinates. Returns a NEW
 * geometry; callers own disposal of the input. UV/color/custom float attributes
 * are interpolated; material groups are retained; underside triangles are
 * omitted. maxEdge can add detail but never changes the shared height field. */
export function drapeBUGeometry(geometry:BufferGeometry,maxEdge=12,elevation:(x:number,z:number)=>number=buElevation):BufferGeometry{
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
      const v=original.slice(),x=v[po],z=v[po+2];v[po+1]+=elevation(x,z)-5.2;
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
      const loX=Math.floor(minX/BU_TERRAIN_CELL),hiX=Math.max(loX,Math.floor((maxX-1e-7)/BU_TERRAIN_CELL)),loZ=Math.floor(minZ/BU_TERRAIN_CELL),hiZ=Math.max(loZ,Math.floor((maxZ-1e-7)/BU_TERRAIN_CELL));
      for(let ix=loX;ix<=hiX;ix++)for(let iz=loZ;iz<=hiZ;iz++){
        const x=ix*BU_TERRAIN_CELL,z=iz*BU_TERRAIN_CELL;
        let poly=clip(tri,v=>v[po]-x);poly=clip(poly,v=>x+BU_TERRAIN_CELL-v[po]);poly=clip(poly,v=>v[po+2]-z);poly=clip(poly,v=>z+BU_TERRAIN_CELL-v[po+2]);
        if(poly.length<3)continue;
        for(const sign of [-1,1]){const half=clip(poly,v=>sign*((v[po]-x)-(v[po+2]-z)));for(let i=1;i<half.length-1;i++)emit(half[0],half[i],half[i+1],up);}
      }
    }
    if(emitted>start)result.addGroup(start,emitted-start,group.materialIndex);
  }
  names.forEach((name,i)=>result.setAttribute(name,new Float32BufferAttribute(output[i],sizes[i],geometry.getAttribute(name).normalized)));
  result.userData={...geometry.userData,buTerrain:true};result.computeBoundingBox();result.computeBoundingSphere();return result;
}

