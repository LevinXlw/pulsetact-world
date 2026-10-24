import {BoxGeometry,BufferGeometry,CanvasTexture,Color,CylinderGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,PlaneGeometry,SRGBColorSpace,type Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {MARYLAND_LAYOUT} from './maryland-layout';
import {createCampusGroundSampler} from './campus-ground-sampler';
import {drapeMarylandGeometry,marylandElevation} from './maryland-terrain';
import {MARYLAND_DETAIL_STREETS} from './maryland-street-layout';

type Point=readonly [number,number];
type Finish='asphalt'|'sidewalk'|'curb'|'joint'|'white'|'yellow'|'metal'|'wood'|'glass'|'mulch'|'lawn';
const CELL=160;
const drape=(geometry:BufferGeometry)=>{const result=drapeMarylandGeometry(geometry,3);geometry.dispose();return result;};

const segmentDistance=(x:number,z:number,a:Point,b:Point)=>{
  const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);
};
const paths=MARYLAND_LAYOUT.paths.flatMap(path=>path.slice(1).map((b,i)=>({a:path[i] as Point,b:b as Point})));
const pathDistance=(x:number,z:number)=>Math.min(...paths.map(({a,b})=>segmentDistance(x,z,a,b)));
const streetSegments=MARYLAND_DETAIL_STREETS.flatMap(street=>street.points.slice(1).map((b,i)=>({a:street.points[i],b,width:street.width,name:street.name})));
const streetDistance=(x:number,z:number)=>Math.min(...streetSegments.map(({a,b,width})=>segmentDistance(x,z,a,b)-width/2));
const inBuilding=(x:number,z:number,padding=0)=>MARYLAND_LAYOUT.mapBuildings.some(b=>{
  const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw),s=Math.sin(b.yaw);
  return Math.abs(dx*c-dz*s)<b.width/2+padding&&Math.abs(dx*s+dz*c)<b.depth/2+padding;
});

/** Layered, terrain-following street sections around the Stamp Hill approach.
 * Hard landscape is walkable; curbs are lowered wherever the navigation graph
 * crosses the road. Small furniture stays outside that graph and the road.
 */
export function createMarylandStreetscape(){
  const group=new Group();group.name='Maryland · Stamp Hill and Union Lane streetscape';
  const ground:Mesh[]=[],walls:Mesh[]=[],trees:{x:number;z:number;radius:number}[]=[];
  const batches=new Map<string,{finish:Finish;ground:boolean;parts:BufferGeometry[]}>();
  const detailMeshes:Mesh[]=[],shadowMeshes:Mesh[]=[];
  const invisible=new MeshBasicMaterial();invisible.name='UMD street furniture collision';
  const collider=(name:string,x:number,z:number,width:number,height:number,depth:number,yaw=0)=>{
    const mesh=new Mesh(new BoxGeometry(width,height,depth),invisible);mesh.name=name;mesh.position.set(x,marylandElevation(x,z)+height/2,z);mesh.rotation.y=yaw;mesh.visible=false;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();group.add(mesh);walls.push(mesh);
  };
  const lawnParts:BufferGeometry[]=[],lawnFootprints:{x:number;z:number;width:number;depth:number;yaw:number}[]=[];
  const lawn=(x:number,z:number,width:number,depth:number,yaw=0)=>{
    if(inBuilding(x,z,3)||pathDistance(x,z)<4||streetDistance(x,z)<.7)return;
    let geometry:BufferGeometry=new PlaneGeometry(width,depth,Math.ceil(width/3),Math.ceil(depth/3));geometry.rotateX(-Math.PI/2);geometry.rotateY(yaw);geometry.translate(x,.035,z);geometry=drape(geometry);
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();lawnParts.push(part);lawnFootprints.push({x,z,width,depth,yaw});
  };
  const append=(finish:Finish,geometry:BufferGeometry,surface:boolean,x:number,z:number)=>{
    const part=geometry.index?geometry.toNonIndexed():geometry;if(part!==geometry)geometry.dispose();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    const key=`${Math.floor(x/CELL)}:${Math.floor(z/CELL)}:${surface?'ground':'detail'}:${finish}`;
    const batch=batches.get(key)??{finish,ground:surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const slab=(finish:Finish,x:number,z:number,w:number,d:number,y:number,height:number,yaw=0)=>{
    let geometry:BufferGeometry=new BoxGeometry(w,height,d);geometry.rotateY(yaw);geometry.translate(x,y,z);
    geometry=drape(geometry);append(finish,geometry,true,x,z);
  };
  const box=(finish:Finish,x:number,z:number,w:number,h:number,d:number,y:number,yaw=0,base=marylandElevation(x,z))=>{
    const geometry=new BoxGeometry(w,h,d);geometry.rotateY(yaw);geometry.translate(x,base+y,z);append(finish,geometry,false,x,z);
  };
  const cylinder=(finish:Finish,x:number,z:number,r:number,h:number,y:number,segments=10)=>{
    const geometry=new CylinderGeometry(r,r,h,segments);geometry.translate(x,marylandElevation(x,z)+y,z);append(finish,geometry,false,x,z);
  };
  const stripe=(finish:Finish,a:Point,b:Point,width:number,height=.074)=>{
    const dx=b[0]-a[0],dz=b[1]-a[1];slab(finish,(a[0]+b[0])/2,(a[1]+b[1])/2,width,Math.hypot(dx,dz),height,.008,Math.atan2(dx,dz));
  };
  const crossing=(x:number,z:number,yaw=0,width=10.5)=>{
    const c=Math.cos(yaw),s=Math.sin(yaw);
    for(let i=-3;i<=3;i++){
      const dx=i*.95;slab('white',x+dx*c,z-dx*s,.48,width-.7,.079,.009,yaw);
    }
    // Two shallow, ochre tactile pads flank the marked crossing. They are part
    // of the walking surface and never become collision barriers.
    for(const side of [-1,1]){
      const zLocal=side*(width/2+1.0);slab('sidewalk',x+zLocal*s,z+zLocal*c,7.3,2.6,.068,.026,yaw);
      for(let j=-5;j<=5;j++)for(let k=-1;k<=1;k++){
        const dx=j*.40,dz=zLocal+k*.34;slab('yellow',x+dx*c+dz*s,z-dx*s+dz*c,.085,.085,.089,.014,yaw);
      }
    }
  };

  // Paved carriageways have a continuous section instead of thin, unrelated
  // polygons. The global terrain field supplies the ascent to the union.
  for(const street of MARYLAND_DETAIL_STREETS){
    for(let i=1;i<street.points.length;i++){
      const a=street.points[i-1],b=street.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length,nx=-uz,nz=ux,yaw=Math.atan2(dx,dz);
      const pieces=Math.ceil(length/3),step=length/pieces;
      for(let k=0;k<pieces;k++){
        const t=(k+.5)/pieces,x=a[0]+dx*t,z=a[1]+dz*t;
        slab('asphalt',x,z,street.width,step+.035,.052,.025,yaw);
        for(const side of [-1,1]){
          const sidewalkOffset=street.width/2+4.0,sx=x+nx*side*sidewalkOffset,sz=z+nz*side*sidewalkOffset;
          const sidewalkAtJunction=streetSegments.some(seg=>seg.name!==street.name&&segmentDistance(sx,sz,seg.a,seg.b)<seg.width/2+1.8);
          // The south side of Campus Drive already has an old Mall footpath;
          // a matching overlay gives it joints and a road-side verge.
          if(!inBuilding(sx,sz,2)&&!sidewalkAtJunction)slab('sidewalk',sx,sz,3.4,step+.025,.091,.09,yaw);
          const cx=x+nx*side*(street.width/2+.15),cz=z+nz*side*(street.width/2+.15);
          const atOtherJunction=streetSegments.some(seg=>seg.name!==street.name&&segmentDistance(cx,cz,seg.a,seg.b)<seg.width/2+2);
          // Smooth curb cuts at every authored walkway, including the direct
          // Stamp forecourt approach, keep saved routes independently usable.
          if(!atOtherJunction&&pathDistance(cx,cz)>5.4){
            slab('curb',cx,cz,.32,step+.025,.098,.19,yaw);
            slab('sidewalk',cx-nx*side*.28,cz-nz*side*.28,.26,step+.025,.052,.026,yaw);
          }
          if(k%2===0&&!inBuilding(sx,sz,2)&&!sidewalkAtJunction&&streetDistance(sx,sz)>1)stripe('joint',[sx-nx*1.7,sz-nz*1.7],[sx+nx*1.7,sz+nz*1.7],.025,.139);
        }
        // Muted lane markings stop before entrances and the pedestrian route.
        if(k%4<2&&pathDistance(x,z)>5&&!(Math.abs(x+282)<11&&Math.abs(z+165)<13)){
          const markerLength=Math.max(.2,step-.45);
          for(const side of [-1,1])slab('yellow',x+nx*side*.15,z+nz*side*.15,.095,markerLength,.071,.008,yaw);
        }
      }
    }
  }
  crossing(-185,-165,0,10.5);crossing(-116,-165,0,10.5);crossing(-282,-190,Math.PI/2,8.5);
  // Fieldhouse Drive entrance to Union Lane Garage: the GIS outline places the
  // garage south of the street. A paved apron reaches its northern facade.
  slab('asphalt',-335,-393,8.2,17,.055,.028);

  const lamp=(x:number,z:number)=>{
    if(pathDistance(x,z)<3.5||streetDistance(x,z)<2||inBuilding(x,z,2))return;
    cylinder('metal',x,z,.10,6,3);cylinder('metal',x,z,.19,.28,.14,12);
    box('metal',x,z,.48,.09,.48,5.84);box('glass',x,z,.34,.56,.34,6.15);box('metal',x,z,.55,.10,.55,6.47);
    for(const dx of [-.20,.20])for(const dz of [-.20,.20])box('metal',x+dx,z+dz,.035,.59,.035,6.15,0,marylandElevation(x,z));
    collider('UMD street lamp',x,z,.4,6.5,.4);
  };
  const bench=(x:number,z:number,yaw=0)=>{
    if(pathDistance(x,z)<3.6||streetDistance(x,z)<4||inBuilding(x,z,3))return;
    const c=Math.cos(yaw),s=Math.sin(yaw),base=marylandElevation(x,z);
    const local=(dx:number,dz:number)=>[x+dx*c+dz*s,z-dx*s+dz*c];
    for(const dz of [-.26,0,.26]){const [px,pz]=local(0,dz);box('wood',px,pz,2.8,.10,.22,.53,yaw,base);}
    for(const y of [.91,1.16]){const [px,pz]=local(0,-.43);box('wood',px,pz,2.8,.16,.09,y,yaw,base);}
    for(const dx of [-1.03,1.03]){const [px,pz]=local(dx,0);box('metal',px,pz,.09,.54,.70,.27,yaw,base);const [bx,bz]=local(dx,-.42);box('metal',bx,bz,.075,1.10,.08,.62,yaw,base);}
    collider('UMD roadside bench',x,z,2.9,1.3,1.05,yaw);
  };
  const drain=(x:number,z:number,yaw=0)=>{
    slab('metal',x,z,.52,1.1,.078,.018,yaw);
    const c=Math.cos(yaw),s=Math.sin(yaw);
    for(let i=-3;i<=3;i++){const dz=i*.13;slab('curb',x+dz*s,z+dz*c,.45,.032,.090,.006,yaw);}
  };
  for(const x of [-344,-312,-248,-210,-151,-85,-35,14,109]){
    lamp(x,-181);lamp(x+8,-148);drain(x,-169.8,Math.PI/2);
  }
  for(const z of [-218,-266,-314,-361]){lamp(-295,z);lamp(-269,z-12);drain(-285.9,z);}
  for(const p of [[-235,-182],[-161,-180],[-71,-148],[-24,-148],[-295,-245],[-269,-315],[-309,-414]] as Point[])bench(p[0],p[1],p[0]<-265?Math.PI/2:0);

  // Vegetation is deliberately on verges and in groves beyond the sidewalks,
  // never in the carriageway. Root additionally filters the official paving.
  const treeCandidates:Point[]=[];
  for(const x of [-351,-324,-304,-248,-226,-151,-94,-64,-30,5,35,110]){
    treeCandidates.push([x,-142]);if(x<-117)treeCandidates.push([x+4,-185]);
  }
  for(const z of [-225,-251,-285,-317,-345,-379])treeCandidates.push([-301,z],[-263,z+9]);
  for(const [x,z] of treeCandidates){
    if(pathDistance(x,z)<7||streetDistance(x,z)<6.5||inBuilding(x,z,7)||trees.some(t=>Math.hypot(t.x-x,t.z-z)<13))continue;
    // Low mulch rings connect the trunk to the landscape without a hard,
    // raised planter that would obstruct free exploration.
    const ring=new CylinderGeometry(1.65,1.65,.028,20);ring.translate(x,.045,z);append('mulch',drape(ring),true,x,z);
    trees.push({x,z,radius:4.4+((Math.abs(x*3+z)%9)/9)*1.1});
  }
  // Sparse, continuous grass strips articulate the kerb/green-verge/footpath
  // section; a few wider pockets anchor the small groups of street trees.
  for(const x of [-353,-322,-247,-213,-156,-91,-51,-8,27,104]){
    lawn(x,-171.8,20,2.1);lawn(x,-141,16,7);
  }
  for(const z of [-225,-257,-290,-323,-354,-381]){lawn(-288.8,z,1.9,17);lawn(-301,z,8,16);}

  const sign=(x:number,z:number,text:string,yaw=0)=>{
    if(typeof document==='undefined'||pathDistance(x,z)<3.5)return;
    cylinder('metal',x,z,.052,3.1,1.55,8);
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=160;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#46594a';ctx.fillRect(0,0,768,160);ctx.strokeStyle='#d9dec6';ctx.lineWidth=5;ctx.strokeRect(10,10,748,140);ctx.fillStyle='#f1edcf';ctx.font='500 50px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,84,720);
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;
    const mesh=new Mesh(new PlaneGeometry(3.7,.77),new MeshStandardMaterial({map:texture,roughness:.9}));mesh.position.set(x,marylandElevation(x,z)+2.85,z);mesh.rotation.y=yaw;mesh.name=`UMD street sign · ${text}`;group.add(mesh);detailMeshes.push(mesh);
  };
  sign(-270,-181,'CAMPUS DRIVE');sign(-295,-183,'UNION LANE',Math.PI/2);sign(-297,-414,'FIELDHOUSE DRIVE');

  const colors:Record<Finish,string>={asphalt:'#76827b',sidewalk:'#b9b3a0',curb:'#d0c9b6',joint:'#8f8d80',white:'#e6debd',yellow:'#c4ad65',metal:'#414e49',wood:'#85745b',glass:'#c7d5b3',mulch:'#76684e',lawn:'#788c5a'};
  const materials=new Map<Finish,MeshStandardMaterial>();
  for(const [key,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(part=>part.dispose());if(!geometry)continue;
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    let material=materials.get(batch.finish);
    if(!material){
      material=(batch.finish==='asphalt'||batch.finish==='sidewalk'||batch.finish==='curb'?createCampusSurface(batch.finish==='asphalt'?'road':'pavement'):new MeshStandardMaterial({roughness:.95})) as MeshStandardMaterial;
      material.color=new Color(colors[batch.finish]);material.name=`UMD streetscape ${batch.finish}`;
      if(['asphalt','sidewalk','white','yellow','joint','mulch'].includes(batch.finish)){material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=batch.finish==='asphalt'?-9:batch.finish==='sidewalk'?-10:-12;}
      materials.set(batch.finish,material);
    }
    const mesh=new Mesh(geometry,material);mesh.name=`UMD street detail ${key}`;mesh.receiveShadow=true;mesh.castShadow=!batch.ground;group.add(mesh);
    if(batch.ground)ground.push(mesh);else shadowMeshes.push(mesh);
    if(['metal','glass','wood','joint'].includes(batch.finish))detailMeshes.push(mesh);
  }
  const lawns:{mesh:Mesh;footprints:typeof lawnFootprints}[]=[];
  if(lawnParts.length){
    const geometry=mergeGeometries(lawnParts,false);lawnParts.forEach(part=>part.dispose());
    if(geometry){
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const material=createCampusSurface('grass') as MeshStandardMaterial;material.color=new Color(colors.lawn);material.polygonOffset=false;
      const mesh=new Mesh(geometry,material);mesh.name='UMD Stamp Hill roadside lawns';mesh.receiveShadow=true;group.add(mesh);ground.push(mesh);lawns.push({mesh,footprints:lawnFootprints});
    }
  }
  group.updateMatrixWorld(true);
  // Mulch disks intentionally belong to ground for terrain sampling, but are
  // not paving: the caller must not reject the tree in its own planted bed.
  const pavedGround=ground.filter(mesh=>!mesh.name.endsWith(':mulch')&&!mesh.name.endsWith('lawns'));
  const pavedAt=createCampusGroundSampler(pavedGround);
  return{group,ground,walls,trees,lawns,pavedGround,pavedAt,
    setQuality:(low:boolean)=>{shadowMeshes.forEach(mesh=>mesh.castShadow=!low);},
    update:(camera:Vector3)=>{for(const mesh of detailMeshes){const center=mesh.geometry.boundingSphere?.center;if(center)mesh.visible=Math.hypot(camera.x-center.x-mesh.position.x,camera.z-center.z-mesh.position.z)<360;}},
  };
}
