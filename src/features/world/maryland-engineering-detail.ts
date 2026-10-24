import {BoxGeometry,BufferGeometry,CanvasTexture,Color,ExtrudeGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Quaternion,Shape,ShapeGeometry,SRGBColorSpace,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {UMD_FULL_BUILDINGS,type UMDFullBuilding} from './maryland-full-layout';
import {marylandElevation} from './maryland-terrain';
import {createCampusSurface} from './painterly-surfaces';

type Point=readonly[number,number];
type Face={x:number;z:number;yaw:number;length:number;nx:number;nz:number};
type Finish='brick'|'stone'|'white'|'roof'|'glass'|'glassBlue'|'glassPink'|'glassViolet'|'glassTeal'|'frame'|'bronze'|'shade'|'wood';
type Opening={x:number;y:number;width:number;height:number;glass?:Finish};
type Bounds={minX:number;maxX:number;minZ:number;maxZ:number;width:number;depth:number};
const UP=new Vector3(0,1,0),UNIT=new Vector3(1,1,1);

/** These four shells replace their generic district buildings. Reference photos
 * and publicly available plans are documented in assets-source/maryland/engineering-sources.json.
 * Horizontal coordinates always come from the shared GIS layout. Facade detail,
 * floor heights and roof plant are authored approximations, not surveyed BIM. */
export const MARYLAND_ENGINEERING_DETAIL_IDS=['088','225','228','429'] as const;

function ring(points:readonly Point[],hole=false):Point[]{
  const result=points.map(([x,z])=>[x,z] as Point);
  if(result.length>3&&Math.hypot(result[0][0]-result.at(-1)![0],result[0][1]-result.at(-1)![1])<.01)result.pop();
  let area=0;for(let i=0;i<result.length;i++){const a=result[i],b=result[(i+1)%result.length];area+=a[0]*b[1]-b[0]*a[1];}
  if(hole?area<0:area>0)result.reverse();return result;
}
function shapeOf(points:readonly Point[],holes:readonly (readonly Point[])[]=[]){
  const shape=new Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
  for(const points of holes){const path=new Path();points.forEach(([x,z],i)=>i?path.lineTo(x,-z):path.moveTo(x,-z));path.closePath();shape.holes.push(path);}
  return shape;
}
function boundsOf(points:readonly Point[]):Bounds{
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  return{minX,maxX,minZ,maxZ,width:maxX-minX,depth:maxZ-minZ};
}
function facesOf(points:readonly Point[],bounds:Bounds):Face[]{return points.map((a,i)=>{
  const b=points[(i+1)%points.length],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
  return{x,z,yaw:Math.atan2(a[1]-b[1],b[0]-a[0]),length:Math.hypot(b[0]-a[0],b[1]-a[1]),nx:(x-bounds.minX)/bounds.width,nz:(z-bounds.minZ)/bounds.depth};
}).filter(f=>f.length>.18);}

export function createMarylandEngineeringDistrict(_wind?:{value:number}){
  const group=new Group();group.name='Maryland · engineering architecture';
  const ground:Mesh[]=[],walls:Mesh[]=[],shadowMeshes:Mesh[]=[],fineMeshes:Mesh[]=[];
  const trees:{x:number;z:number;radius:number}[]=[];
  const batches=new Map<string,{finish:Finish;fine:boolean;parts:BufferGeometry[]}>();
  const matrix=new Matrix4(),rotation=new Quaternion(),translation=new Vector3();
  const invisible=new MeshBasicMaterial();invisible.name='Engineering footprint collision';
  let base=0,buildingId='';
  const put=(finish:Finish,geometry:BufferGeometry,x=0,y=0,z=0,yaw=0,fine=false)=>{
    rotation.setFromAxisAngle(UP,yaw);translation.set(x,y+base,z);matrix.compose(translation,rotation,UNIT);geometry.applyMatrix4(matrix);
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${buildingId}:${finish}:${fine?'detail':'massing'}`,batch=batches.get(key)??{finish,fine,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const at=(f:Pick<Face,'x'|'z'|'yaw'>,x:number,z:number)=>({x:f.x+x*Math.cos(f.yaw)+z*Math.sin(f.yaw),z:f.z-x*Math.sin(f.yaw)+z*Math.cos(f.yaw)});
  const box=(finish:Finish,f:Pick<Face,'x'|'z'|'yaw'>,x:number,y:number,z:number,w:number,h:number,d:number,fine=false)=>{
    if(w<=0||h<=0||d<=0)return;const p=at(f,x,z);put(finish,new BoxGeometry(w,h,d),p.x,y,p.z,f.yaw,fine);
  };
  const plane=(finish:Finish,f:Face,x:number,y:number,z:number,w:number,h:number,fine=false)=>{if(w<=0||h<=0)return;const p=at(f,x,z);put(finish,new PlaneGeometry(w,h),p.x,y,p.z,f.yaw,fine);};
  const label=(f:Face,text:string,y:number,width:number)=>{
    if(typeof document==='undefined')return;const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=128;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#dedbd0';ctx.fillRect(0,0,1536,128);ctx.fillStyle='#4a5551';ctx.font='500 55px Georgia,serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,768,66,1480);
    const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;const material=new MeshStandardMaterial({map,roughness:1});
    const mesh=new Mesh(new PlaneGeometry(width,width/12),material),p=at(f,0,.64);mesh.position.set(p.x,base+y,p.z);mesh.rotation.y=f.yaw;mesh.name=`Engineering nameplate · ${text}`;group.add(mesh);fineMeshes.push(mesh);
  };
  const roof=(points:Point[],holes:Point[][],height:number,finish:Finish='roof')=>{const geo=new ShapeGeometry(shapeOf(points,holes));geo.rotateX(-Math.PI/2);put(finish,geo,0,height,0);};
  const opening=(f:Face,o:Opening)=>{
    plane(o.glass??'glass',f,o.x,o.y+o.height/2,-.36,o.width,o.height);
    box('stone',f,o.x,o.y-.055,.04,o.width+.16,.11,.5,true);
    for(const x of [o.x-o.width/2,o.x+o.width/2])box('frame',f,x,o.y+o.height/2,-.23,.065,o.height,.10,true);
    box('frame',f,o.x,o.y+o.height,-.23,o.width,.065,.10,true);
    const cols=Math.max(1,Math.ceil(o.width/1.7));for(let c=1;c<cols;c++)box('frame',f,o.x-o.width/2+c*o.width/cols,o.y+o.height/2,-.25,.055,o.height,.09,true);
    if(o.height>2)box('frame',f,o.x,o.y+o.height*.55,-.24,o.width,.055,.10,true);
  };
  const wall=(f:Face,height:number,finish:Finish,openings:Opening[]=[],bottom=0)=>{
    const shape=new Shape();shape.moveTo(-f.length/2,bottom);shape.lineTo(f.length/2,bottom);shape.lineTo(f.length/2,height);shape.lineTo(-f.length/2,height);shape.closePath();
    const valid=openings.filter(o=>o.width>0&&o.height>0&&o.y>bottom+.03&&o.y+o.height<height-.03&&Math.abs(o.x)+o.width/2<f.length/2-.03);
    for(const o of valid){const h=new Path();h.moveTo(o.x-o.width/2,o.y);h.lineTo(o.x-o.width/2,o.y+o.height);h.lineTo(o.x+o.width/2,o.y+o.height);h.lineTo(o.x+o.width/2,o.y);h.closePath();shape.holes.push(h);}
    const p=at(f,0,-.40);put(finish,new ExtrudeGeometry(shape,{depth:.4,bevelEnabled:false,curveSegments:1}),p.x,0,p.z,f.yaw);
    valid.forEach(o=>opening(f,o));
  };
  const curtain=(f:Face,bottom:number,height:number,finish:Finish='glassBlue',bay=2.7)=>{
    plane(finish,f,0,bottom+height/2,-.25,f.length,height);
    for(let x=-f.length/2;x<=f.length/2+.01;x+=f.length/Math.max(1,Math.ceil(f.length/bay)))box('frame',f,x,bottom+height/2,-.14,.075,height,.18,true);
    for(let y=bottom;y<bottom+height;y+=1.5)box('frame',f,0,y,-.13,f.length,.075,.18,true);
  };
  const foundation=(f:Face)=>{
    // A level shell meets a sloping apron with an individually sampled plinth.
    const p0=at(f,-f.length/2,0),p1=at(f,f.length/2,0);
    const bottom=Math.min(-.5,marylandElevation(p0.x,p0.z)-base-.3,marylandElevation(p1.x,p1.z)-base-.3);
    box('stone',f,0,(bottom+.32)/2,-.13,f.length,.32-bottom,.6);
  };
  const collider=(b:UMDFullBuilding,points:Point[],holes:Point[][],height:number)=>{
    const geometry=new ExtrudeGeometry(shapeOf(points,holes),{depth:height,bevelEnabled:false,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,invisible);mesh.position.y=base;mesh.name=b.name;mesh.visible=false;mesh.userData.campusFootprint=points;mesh.userData.campusFootprintHoles=holes;mesh.userData.engineeringBuildingId=b.sourceBuildingId;group.add(mesh);walls.push(mesh);
  };
  const roofPlant=(b:UMDFullBuilding,points:Point[],height:number)=>{
    const inside=(x:number,z:number)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],c=points[j];if((a[1]>z)!==(c[1]>z)&&x<(c[0]-a[0])*(z-a[1])/(c[1]-a[1])+a[0])hit=!hit;}return hit;};
    const bb=boundsOf(points),f={x:b.x,z:b.z,yaw:0};
    for(const [u,v] of [[.28,.22],[.72,.22],[.28,.48]]){
      const x=bb.minX+u*bb.width,z=bb.minZ+v*bb.depth;if(![[-3,-2],[3,2],[-3,2],[3,-2]].every(([dx,dz])=>inside(x+dx,z+dz)))continue;
      box('shade',f,x-b.x,height+.45,z-b.z,5.8,.9,3.2);box('frame',f,x-b.x,height+.95,z-b.z,6.2,.12,3.6,true);
      for(let dz=-1.2;dz<1.3;dz+=.45)box('frame',f,x-b.x,height+.66,z-b.z+dz,5.6,.10,.11,true);
    }
  };

  for(const id of MARYLAND_ENGINEERING_DETAIL_IDS){
    const b=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId===id);if(!b)continue;
    buildingId=id;base=marylandElevation(b.x,b.z);
    const points=ring(b.footprint),holes=(b.holes??[]).map(p=>ring(p,true)),bounds=boundsOf(points),faces=facesOf(points,bounds);
    const height=id==='088'?16.8:id==='225'?20.5:id==='429'?27.8:23.8;
    group.userData[`building-${id}`]={base,height,sourceBuildingId:id,bounds,footprint:points};
    collider(b,points,holes,height);roof(points,holes,height-.16);roofPlant(b,points,height);
    for(const f of [...faces,...holes.flatMap(h=>facesOf(h,bounds))]){
      foundation(f);
      if(id==='088'){
        const south=f.nz>.78&&Math.cos(f.yaw)>.8;
        const portal=south&&f.length>8&&f.length<17&&(f.nx>.2&&f.nx<.36||f.nx>.66&&f.nx<.82);
        const floors=3,spacing=3.7,count=Math.floor((f.length-1.2)/spacing),windows:Opening[]=[];
        for(let row=0;row<floors;row++)for(let col=0;col<count;col++)windows.push({x:(col-(count-1)/2)*spacing,y:1.35+row*4.45,width:portal?1.8:1.95,height:2.75});
        wall(f,height,portal?'stone':'brick',windows);
        box('stone',f,0,height-.22,.05,f.length,.38,.85);box('stone',f,0,4.45,.03,f.length,.15,.62,true);
        if(portal){
          for(let x=-f.length/2+1;x<f.length/2;x+=f.length/4)box('white',f,x,7.65,.26,.52,13.7,.75);
          box('stone',f,0,height+.62,.1,f.length,1.7,.82);
          box('shade',f,0,1.7,.12,Math.min(5.4,f.length-2),2.9,.08);
          for(const x of [-1.6,0,1.6]){plane('glass',f,x,1.6,.18,1.45,2.85);box('frame',f,x-.74,1.6,.23,.06,2.9,.10,true);}
          label(f,'GLENN L. MARTIN HALL',height+.65,Math.min(12,f.length-.6));
        }
      }else if(id==='225'){
        const rotunda=f.nx>.49&&f.nx<.73&&f.nz>.45&&f.nz<.64;
        const north=f.nz<.05&&f.length>14;
        if(rotunda){
          curtain(f,.35,height-2.5,'glassBlue',2.5);
          box('white',f,0,height-1.05,.12,f.length+.10,2.1,.8);
          box('white',f,-f.length/2,height/2,.32,.55,height,.78);
          box('white',f,0,7.0,.10,f.length,.55,.72);
          box('white',f,0,13.8,.10,f.length,.45,.72);
        }else{
          const windows:Opening[]=[],cols=Math.floor((f.length-1.4)/4.2);
          for(let row=0;row<3;row++)for(let col=0;col<cols;col++)windows.push({x:(col-(cols-1)/2)*4.2,y:1.05+row*6.05,width:3.15,height:3.75});
          wall(f,height-.55,'brick',windows);box('white',f,0,height-.25,.08,f.length,.55,.84);
          if((north||f.nz>.45)&&f.length>13){
            for(let x=-f.length/2+2.2;x<f.length/2;x+=6){box('white',f,x,height-3.5,.36,.32,5.6,.72,true);for(let l=0;l<6;l++)box('white',f,x,height-1.4,1.1+l*.28,4.5,.10,.12,true);}
            box('white',f,0,height-6.1,.2,f.length,.38,.92);
          }
        }
      }else if(id==='429'){
        const longSide=f.length>35;
        if(longSide){
          curtain(f,.35,5.3,f.nz>.75?'glassPink':'glassBlue');
          const windows:Opening[]=[];
          for(let row=0;row<4;row++)windows.push({x:0,y:7.0+row*4.6,width:f.length-3.4,height:3.15});
          wall(f,height,'brick',windows,5.7);
          // The closely spaced bronze sunshades are the visible identity of
          // Clark Hall's laboratory elevations, rather than an all-glass box.
          for(let y=7.2;y<height-2.5;y+=.48)box('bronze',f,0,y,.30,f.length-3.9,.075,.52,true);
          for(let x=-f.length/2+2;x<f.length/2-1;x+=4.2)box('frame',f,x,16,.48,.11,19,.16,true);
          box('brick',f,-f.length/2+.75,height/2+.2,.16,1.5,height+.4,.70);
          box('white',f,0,5.7,.15,f.length,.32,.90);
        }else{
          const windows:Opening[]=[];if(f.length>9)for(let row=0;row<5;row++)windows.push({x:0,y:.8+row*5.0,width:f.length*.44,height:3.8,glass:row===0&&f.nz>.7?'glassPink':'glassBlue'});
          wall(f,height,'brick',windows);
        }
        box('stone',f,0,height-.12,.04,f.length,.24,.6);
        if(f.nz>.85&&f.length>11){box('white',f,0,4.1,1.3,f.length+1,.23,3.2);label(f,'A. JAMES CLARK HALL',5.0,Math.min(f.length-1,15));}
      }else{
        // The public second-floor plan places the terrace at the east end;
        // its monumental dichroic window faces that terrace, not the long side.
        const front=f.nx>.7&&Math.sin(f.yaw)>.5;
        curtain(f,.3,7.4,'glass',2.6);box('white',f,0,7.8,.48,f.length,.7,1.8);
        if(front&&f.length>12){
          const inset=Math.min(3.5,f.length*.14),paneWidth=f.length-inset*2;
          wall(f,height,'white',[{x:paneWidth*.08,y:9.15,width:paneWidth*.72,height:12.2,glass:'glassViolet'}],8.1);
          const x0=paneWidth*.08-paneWidth*.36,cellW=paneWidth*.72/6;
          for(let row=0;row<6;row++)for(let col=0;col<6;col++){
            const shade:Finish=row<2?(col%3===0?'glassBlue':'glassTeal'):row<4?(col%2?'glassPink':'glassViolet'):'glassViolet';
            plane(shade,f,x0+(col+.5)*cellW,10.16+row*2.03,-.29,cellW-.07,1.96);
          }
          label(f,'E. A. FERNANDEZ IDEA FACTORY',8.0,Math.min(19,f.length-1));
        }else{
          const windows:Opening[]=[];for(let row=0;row<3;row++)for(let x=-f.length/2+3.1;x<f.length/2-1;x+=6.3)windows.push({x,y:9.1+row*4.45,width:1.2,height:3.2});
          wall(f,height,'white',windows,8.1);
          for(let y=9;y<height;y+=2.15)box('stone',f,0,y,.015,f.length,.035,.045,true);
          for(let x=-f.length/2+2.8;x<f.length/2;x+=4.5)box('stone',f,x,16,.015,.035,15.5,.045,true);
        }
        box('white',f,0,height+.08,.10,f.length,.25,.78);
      }
    }
    if(id==='225'){
      const f=faces.filter(f=>f.nx>.49&&f.nx<.73&&f.nz>.45&&f.nz<.64).sort((a,b)=>b.nz-a.nz)[0];
      if(f)label(f,'JEONG H. KIM ENGINEERING',height-1.05,Math.max(5.6,f.length*1.5));
    }
  }

  // The current Facilities map separates IDEA's upper block from its east
  // terrace and short north-facing bridge. Never infer a bridge from the old
  // placeholder position: it used to be almost a whole block away from Kim.
  const idea=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId==='228') as (UMDFullBuilding&{terraceFootprint?:Point[];bridgeFootprint?:Point[]})|undefined;
  const kim=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId==='225');
  if(idea?.terraceFootprint?.length){
    base=marylandElevation(idea.x,idea.z);buildingId='228-terrace';
    const pts=ring(idea.terraceFootprint),bb=boundsOf(pts),faces=facesOf(pts,bb),deck=7.6;
    const slab=new ExtrudeGeometry(shapeOf(pts),{depth:.42,bevelEnabled:false,curveSegments:1});slab.rotateX(-Math.PI/2);put('stone',slab,0,deck-.42,0);
    group.userData.ideaTerrace={footprint:pts,height:base+deck};
    const solid=new ExtrudeGeometry(shapeOf(pts),{depth:.42,bevelEnabled:false,curveSegments:1});solid.rotateX(-Math.PI/2);solid.computeBoundingBox();solid.computeBoundingSphere();
    const collision=new Mesh(solid,invisible);collision.name='IDEA east terrace deck';collision.position.y=base+deck-.42;collision.visible=false;group.add(collision);walls.push(collision);
    for(const f of faces){
      // The west edge meets the main block. The north strip meets the bridge.
      if(f.nx<.04)continue;
      box('white',f,0,deck-.35,.02,f.length,.65,.42);
      box('frame',f,0,deck+1.03,.02,f.length,.075,.075,true);
      for(let x=-f.length/2+.25;x<f.length/2;x+=1.5)box('frame',f,x,deck+.52,.02,.055,1.04,.055,true);
      for(let x=-f.length/2+2.5;x<f.length/2-1;x+=6){
        const p=at(f,x,-.6),bottom=marylandElevation(p.x,p.z)-base;
        box('stone',f,x,(deck+bottom)/2,-.6,.42,deck-bottom,.42);
      }
    }
    // Low planting benches, kept on the terrace itself instead of scattering
    // trees into its approach. Their coordinates derive from the terrace ring.
    const p={x:(bb.minX+bb.maxX)/2,z:(bb.minZ+bb.maxZ)/2,yaw:0};
    for(const z of [-bb.depth*.23,bb.depth*.23]){
      box('stone',p,0,deck+.32,z,bb.width*.55,.64,1.8);
      box('wood',p,0,deck+.70,z,bb.width*.58,.16,2.0,true);
    }
  }
  if(idea?.bridgeFootprint?.length&&kim){
    base=marylandElevation(idea.x,idea.z);buildingId='228-bridge';
    const pts=ring(idea.bridgeFootprint),bb=boundsOf(pts),faces=facesOf(pts,bb),floor=7.6;
    // Architectural only: retaining the space beneath the bridge as pedestrian
    // ground avoids the height sampler pulling a walker onto its roof.
    for(const y of [floor,floor+3.2]){
      const slab=new ExtrudeGeometry(shapeOf(pts),{depth:.28,bevelEnabled:false,curveSegments:1});slab.rotateX(-Math.PI/2);put(y===floor?'stone':'roof',slab,0,y-.28,0);
    }
    for(const f of faces){curtain(f,floor,3.05,'glassBlue',1.9);box('frame',f,0,floor+3.17,.03,f.length,.17,.22);box('frame',f,0,floor+.12,.03,f.length,.24,.22);}
    const geo=new ExtrudeGeometry(shapeOf(pts),{depth:3.2,bevelEnabled:false,curveSegments:1});geo.rotateX(-Math.PI/2);geo.computeBoundingBox();geo.computeBoundingSphere();
    const collision=new Mesh(geo,invisible);collision.name='IDEA to Kim · second-floor skybridge';collision.position.y=base+floor;collision.visible=false;group.add(collision);walls.push(collision);
    group.userData.ideaKimBridge={footprint:pts,height:base+floor};
  }

  const palette:Record<Finish,string>={brick:'#a16952',stone:'#d8d3c2',white:'#e3e0d3',roof:'#63746e',glass:'#435d68',glassBlue:'#739598',glassPink:'#b18c99',glassViolet:'#807eae',glassTeal:'#659e9d',frame:'#70817c',bronze:'#a7926d',shade:'#344945',wood:'#8c6c45'};
  const materials=new Map<Finish,MeshStandardMaterial>();
  for(const [name,batch] of batches){
    const geo=mergeGeometries(batch.parts,false);batch.parts.forEach(p=>p.dispose());if(!geo)throw new Error(`Unable to batch engineering building ${name}`);geo.computeBoundingBox();geo.computeBoundingSphere();
    let material=materials.get(batch.finish);if(!material){
      material=createCampusSurface(batch.finish.startsWith('glass')?'glass':batch.finish==='brick'?'brick':batch.finish==='roof'?'roof':['frame','bronze'].includes(batch.finish)?'frame':'limestone',{yaw:0}) as MeshStandardMaterial;
      material.name=`Engineering ${batch.finish}`;material.color=new Color(palette[batch.finish]);material.roughness=batch.finish.startsWith('glass')?.42:1;
      if(batch.finish.startsWith('glass')){material.emissive.set(palette[batch.finish]);material.emissiveIntensity=.13;}materials.set(batch.finish,material);
    }
    const mesh=new Mesh(geo,material);mesh.name=`UMD engineering ${name}`;mesh.castShadow=!batch.finish.startsWith('glass');mesh.receiveShadow=true;group.add(mesh);shadowMeshes.push(mesh);if(batch.fine)fineMeshes.push(mesh);
  }
  group.updateMatrixWorld(true);
  let low=false;
  return{group,ground,walls,trees,lawns:[] as {mesh:Mesh;footprints:{x:number;z:number;width:number;depth:number;yaw:number}[]}[],
    setQuality:(value:boolean)=>{low=value;shadowMeshes.forEach(m=>{m.castShadow=!low&&!m.name.includes('glass');});},
    update:(camera:Vector3)=>{const range=low?210:400;for(const mesh of fineMeshes){if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const bb=mesh.geometry.boundingBox!;const x=mesh.position.x,z=mesh.position.z,dx=Math.max(bb.min.x+x-camera.x,0,camera.x-bb.max.x-x),dz=Math.max(bb.min.z+z-camera.z,0,camera.z-bb.max.z-z);mesh.visible=dx*dx+dz*dz<range*range;}},
  };
}
