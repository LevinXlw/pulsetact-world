import {BoxGeometry,BufferGeometry,CanvasTexture,CylinderGeometry,DoubleSide,ExtrudeGeometry,Float32BufferAttribute,Group,LineBasicMaterial,LineSegments,Mesh,MeshStandardMaterial,PlaneGeometry,Quaternion,Shape,SRGBColorSpace,Vector3,type Material,type Texture} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {buElevation} from './bu-terrain';
import {createBUTransitDetail} from './bu-transit-detail';
import {BU_GREEN_LINE_PATHS,BU_GREEN_LINE_STATIONS,BU_GREEN_LINE_TIMETABLES,BU_GREEN_LINE_VEHICLE,sampleBUGreenLine,sampleBUGreenLineService,type BUGreenLineDirection} from './bu-green-line-layout';

export type BUGreenLineOptions={quality?:'desktop'|'mobile';reducedMotion?:boolean};
type Finish='green'|'silver'|'glass'|'rubber'|'steel'|'light'|'red'|'amber';
type Door={group:Group;leaves:Mesh[];z:number;side:number};
type CarSection={group:Group;offset:number;length:number;doors:Door[]};
type Train={direction:BUGreenLineDirection;group:Group;sections:CarSection[];bogies:Group[];materials:MeshStandardMaterial[];phase:number};

/** Runtime-only rail scenery. It adds no collision walls or baked geometry:
 * walking remains possible at the existing crossings, and mobile keeps the
 * same two articulated cars with fewer exterior details. */
export function createBUGreenLine(options:BUGreenLineOptions={}){
  const mobile=options.quality==='mobile',group=new Group();group.name='BU · Green Line B service';
  const geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>(),labelTextures=new Map<string,CanvasTexture>();
  const ownGeometry=<T extends BufferGeometry>(g:T)=>{geometries.add(g);return g;};
  const ownMaterial=<T extends Material>(m:T)=>{materials.add(m);return m;};
  const colors:Record<Finish,string>={green:'#18764f',silver:'#d6d8cb',glass:'#233b3e',rubber:'#333c3a',steel:'#687371',light:'#fff4ce',red:'#ad332d',amber:'#efb650'};
  const paint=(finish:Finish)=>ownMaterial(new MeshStandardMaterial({color:colors[finish],roughness:finish==='glass'?.24:finish==='silver'?.4:.65,metalness:finish==='steel'||finish==='silver'?.42:.05,emissive:['light','red','amber'].includes(finish)?colors[finish]:'#000000',emissiveIntensity:['light','amber'].includes(finish)?.6:.15}));
  const boxGeometry=ownGeometry(new BoxGeometry(1,1,1));
  const addBox=(parent:Group,material:MeshStandardMaterial,x:number,y:number,z:number,w:number,h:number,d:number)=>{
    const mesh=new Mesh(boxGeometry,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);parent.add(mesh);return mesh;
  };
  function label(text:string,subline:string,width:number,height:number){
    if(typeof document==='undefined')return undefined;
    const key=`${text}\n${subline}`;let texture=labelTextures.get(key);
    if(!texture){
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');if(!ctx)return undefined;
      ctx.fillStyle='#133b2d';ctx.fillRect(0,0,512,128);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f6f2db';ctx.font='bold 38px Arial';ctx.fillText(text,256,subline?42:64,490);if(subline){ctx.font='21px Arial';ctx.fillText(subline,256,96,490);}
      texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;textures.add(texture);labelTextures.set(key,texture);
    }
    const material=ownMaterial(new MeshStandardMaterial({map:texture,roughness:.8,side:DoubleSide}));
    return new Mesh(ownGeometry(new PlaneGeometry(width,height)),material);
  }
  const wheelGeometry=ownGeometry(new CylinderGeometry(.34,.34,.18,mobile?8:12));wheelGeometry.rotateZ(Math.PI/2);
  const up=new Vector3(0,1,0),quaternion=new Quaternion();
  function beam(parent:Group,material:MeshStandardMaterial,a:Vector3,b:Vector3,width:number){
    const mesh=new Mesh(boxGeometry,material),delta=b.clone().sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.set(width,delta.length(),width);mesh.quaternion.setFromUnitVectors(up,delta.normalize());parent.add(mesh);return mesh;
  }
  function shell(length:number,cab:boolean){
    const shape=new Shape();shape.moveTo(-1.25,.68);shape.lineTo(1.25,.68);shape.lineTo(1.32,.95);shape.lineTo(1.32,2.84);shape.lineTo(1.09,3.3);shape.lineTo(-1.09,3.3);shape.lineTo(-1.32,2.84);shape.lineTo(-1.32,.95);shape.closePath();
    const geometry=new ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,steps:1});geometry.translate(0,0,-length/2);
    if(cab){const position=geometry.getAttribute('position');for(let i=0;i<position.count;i++){const taper=Math.max(0,(position.getZ(i)-(length/2-1.3))/1.3);position.setX(i,position.getX(i)*(1-taper*.16));}geometry.computeVertexNormals();}
    return ownGeometry(geometry);
  }
  const trainShell=shell(8.7,true),middleShell=shell(3.2,false);
  const trains:Train[]=[];
  for(const direction of ['inbound','outbound'] as const){
    const trainGroup=new Group();trainGroup.name=`Green Line B ${direction}`;group.add(trainGroup);
    const paints=Object.fromEntries((Object.keys(colors) as Finish[]).map(f=>[f,paint(f)])) as Record<Finish,MeshStandardMaterial>;
    const trainMaterials=Object.values(paints),sections:CarSection[]=[],bogies:Group[]=[];
    for(const [offset,length] of [[-6.5,8.7],[0,3.2],[6.5,8.7]]){
      const section=new Group();section.name=`Articulated body ${offset}`;trainGroup.add(section);
      const body=new Group();if(offset<0)body.rotation.y=Math.PI;section.add(body);
      body.add(new Mesh(length===3.2?middleShell:trainShell,paints.silver));
      addBox(body,paints.green,0,1.19,0,2.645,.73,length-(length>4?1.2:.12));
      addBox(body,paints.rubber,0,.59,0,2.2,.23,length-.4);
      addBox(body,paints.silver,0,3.38,0,1.82,.20,length-1.1);
      const doors:Door[]=[];
      for(const side of [-1,1]){
        const doorZ=length>4?-.9:undefined;
        const windows=length>4?[-3.30,-2.25,1.1,2.4]:[-.84,.84];
        for(const z of windows){addBox(body,paints.rubber,side*1.323,2.21,z,.035,1.18,.98);addBox(body,paints.glass,side*1.345,2.21,z,.02,1.04,.86);}
        if(doorZ!==undefined){
          addBox(body,paints.rubber,side*1.327,1.77,doorZ,.035,2.24,1.38);
          const doorway=new Group();doorway.position.set(side*1.35,0,doorZ);body.add(doorway);const leaves:Mesh[]=[];
          for(const sign of [-1,1]){
            const leaf=new Group(),plate=addBox(leaf,paints.silver,0,1.77,0,.04,2.16,.62);plate.position.z=sign*.33;doorway.add(leaf);
            const glass=addBox(leaf,paints.glass,side*.028,2.05,sign*.33,.025,1.23,.48);plate.userData.dynamicDoor=true;glass.userData.dynamicDoor=true;leaves.push(plate,glass);
          }
          doors.push({group:doorway,leaves,z:doorZ,side});
        }
        if(!mobile){for(const h of [.88,1.44])addBox(body,paints.silver,side*1.325,h,0,.025,.025,length-1.3);}
      }
      if(length>4){
        const front=length/2;
        addBox(body,paints.green,0,1.22,front-.05,2.16,1.05,.18);
        const windscreen=addBox(body,paints.glass,0,2.4,front+.014,2.12,1.22,.045);windscreen.rotation.x=-.08;
        addBox(body,paints.rubber,0,3.05,front+.04,1.85,.30,.04);
        const head=offset>0?paints.light:paints.red;
        for(const side of [-1,1])addBox(body,head,side*.83,1.04,front+.06,.22,.15,.07);
        addBox(body,paints.rubber,0,.73,front+.07,1.9,.16,.19);
        addBox(body,paints.steel,0,.53,front+.22,.34,.19,.40);
        const destination=label('B',direction==='inbound'?'GOVERNMENT CENTER':'BOSTON COLLEGE',1.74,.28);
        if(destination){destination.position.set(0,3.05,front+.066);body.add(destination);trainMaterials.push(destination.material as MeshStandardMaterial);}
        const fleet=label(direction==='inbound'?'3912':'3908','',.40,.16);
        if(fleet){fleet.position.set(0,1.02,front+.15);body.add(fleet);trainMaterials.push(fleet.material as MeshStandardMaterial);}
      }else{
        addBox(body,paints.steel,0,3.62,0,1.34,.24,1.8);
        for(const side of [-1,1]){
          beam(body,paints.steel,new Vector3(side*.43,3.75,-.8),new Vector3(side*.43,4.9,.65),.065);
          beam(body,paints.steel,new Vector3(side*.43,4.9,.65),new Vector3(side*.43,5.99,-.45),.055);
        }
        addBox(body,paints.rubber,0,5.99,-.45,1.65,.06,.14);
      }
      sections.push({group:section,offset,length,doors});
    }
    for(const offset of [-2.0,2.0]){
      const section=new Group();section.name='Flexible bellows';trainGroup.add(section);
      for(let i=0;i<6;i++)addBox(section,i%2?paints.steel:paints.rubber,0,1.98,(i-2.5)*.085,2.46,2.5,.067);
      sections.push({group:section,offset,length:.65,doors:[]});
    }
    for(const offset of [-7.45,0,7.45]){
      const bogie=new Group();bogie.userData.offset=offset;bogie.name='Track-following bogie';trainGroup.add(bogie);
      addBox(bogie,paints.steel,0,.34,0,1.8,.28,1.85);
      for(const side of [-1,1])for(const end of [-1,1]){const wheel=new Mesh(wheelGeometry,paints.rubber);wheel.position.set(side*.7175,.34,end*.69);bogie.add(wheel);}
      bogies.push(bogie);
    }
    // Merge rigid details by material within each articulated section; moving
    // door leaves stay separate. This keeps mobile draw calls independent of
    // the hundreds of trim, window, bogie and pantograph construction pieces.
    for(const component of [...sections.map(s=>s.group),...bogies]){
      component.updateMatrixWorld(true);const batches=new Map<Material,BufferGeometry[]>(),remove:Mesh[]=[];
      component.traverse(object=>{
        if(!(object instanceof Mesh)||object.userData.dynamicDoor)return;
        let geometry=object.geometry.clone().applyMatrix4(object.matrixWorld);if(geometry.index){const flat=geometry.toNonIndexed();geometry.dispose();geometry=flat;}
        const material=object.material as Material,parts=batches.get(material)??[];parts.push(geometry);batches.set(material,parts);remove.push(object);
      });
      for(const mesh of remove)mesh.removeFromParent();
      for(const [material,parts] of batches){const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(geometry){ownGeometry(geometry);const mesh=new Mesh(geometry,material);mesh.castShadow=!mobile;component.add(mesh);}}
    }
    const table=BU_GREEN_LINE_TIMETABLES[direction],initial=table.legs.find(leg=>leg.stopId===(direction==='inbound'?'place-bucen':'place-amory'))!;
    trains.push({direction,group:trainGroup,sections,bogies,materials:trainMaterials,phase:initial.at+initial.duration+2});
  }

  // A single station model is shared by desktop and mobile. The campus streets
  // and mobile bake own the ground slabs; neither carries another shelter/sign.
  const stationDetail=createBUTransitDetail({mobile});group.add(stationDetail.group);
  const staticGroup=new Group();staticGroup.name='Green Line stations and contact wires';group.add(staticGroup);
  const steel=paint('steel');
  const staticBatches=new Map<Material,BufferGeometry[]>();
  const collect=(object:Mesh)=>{object.updateMatrix();const g=object.geometry.clone().applyMatrix4(object.matrix);const list=staticBatches.get(object.material as Material)??[];list.push(g);staticBatches.set(object.material as Material,list);};
  const staticBox=(mat:MeshStandardMaterial,x:number,y:number,z:number,w:number,h:number,d:number,yaw=0)=>{const mesh=new Mesh(boxGeometry,mat);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.rotation.y=yaw;collect(mesh);};
  const wirePositions:number[]=[];
  for(const path of Object.values(BU_GREEN_LINE_PATHS))for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i];wirePositions.push(a[0],buElevation(...a)+6.182,a[1],b[0],buElevation(...b)+6.182,b[1]);
  }
  const wireGeometry=ownGeometry(new BufferGeometry());wireGeometry.setAttribute('position',new Float32BufferAttribute(wirePositions,3));
  const wireMaterial=ownMaterial(new LineBasicMaterial({color:'#536461'}));staticGroup.add(new LineSegments(wireGeometry,wireMaterial));
  if(mobile){const path=BU_GREEN_LINE_PATHS.inbound;for(let d=20;d<path.length;d+=40){const p=sampleBUGreenLine(path,d),x=p.x+p.dz*1.7325,z=p.z-p.dx*1.7325,y=buElevation(x,z);staticBox(steel,x,y+3.2,z,.12,6.4,.12);staticBox(steel,x,y+6.15,z,8.4,.10,.12,Math.atan2(p.dx,p.dz));}}
  for(const [material,parts] of staticBatches){const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(geometry){ownGeometry(geometry);staticGroup.add(new Mesh(geometry,material));}}

  let time=0,disposed=false;
  const target=new Vector3(),forward=new Vector3();
  const orient=(object:Group,direction:BUGreenLineDirection,distance:number,span:number)=>{
    const path=BU_GREEN_LINE_PATHS[direction],p=sampleBUGreenLine(path,distance),a=sampleBUGreenLine(path,distance-span/2),b=sampleBUGreenLine(path,distance+span/2);
    const ya=buElevation(a.x,a.z)+BU_GREEN_LINE_VEHICLE.railHeight,yb=buElevation(b.x,b.z)+BU_GREEN_LINE_VEHICLE.railHeight;
    object.position.set(p.x,Math.max(buElevation(p.x,p.z)+BU_GREEN_LINE_VEHICLE.railHeight,(ya+yb)/2),p.z);
    forward.set(b.x-a.x,yb-ya,b.z-a.z).normalize();quaternion.setFromUnitVectors(target.set(0,0,1),forward);object.quaternion.copy(quaternion);
  };
  function update(deltaSeconds:number){
    if(disposed)return;if(!options.reducedMotion&&Number.isFinite(deltaSeconds)&&deltaSeconds>0)time+=Math.min(deltaSeconds,1);
    for(const train of trains){
      const state=sampleBUGreenLineService(BU_GREEN_LINE_TIMETABLES[train.direction],time+train.phase);train.group.visible=state.opacity>.005;train.group.userData={direction:train.direction,...state};
      for(const material of train.materials){material.opacity=state.opacity;material.transparent=state.opacity<1;material.depthWrite=state.opacity>.95;}
      if(!train.group.visible)continue;
      for(const section of train.sections){
        orient(section.group,train.direction,state.distance+section.offset,Math.min(section.length,6));
        for(const door of section.doors)for(let i=0;i<door.leaves.length;i++){
          const leaf=door.leaves[i],sign=i<2?-1:1;
          // Inbound platforms are on the right of travel, as are outbound
          // platforms after reversing the lane. Rear bodies face the other way.
          const platformSide=section.offset<0?1:-1,opening=door.side===platformSide?state.doors:0;
          leaf.position.z=sign*(.33+opening*.56);
        }
      }
      for(const bogie of train.bogies)orient(bogie,train.direction,state.distance+bogie.userData.offset,1.4);
    }
  }
  update(0);
  group.userData.runtimeOnly=true;group.userData.greenLine={stations:BU_GREEN_LINE_STATIONS.length,trains:trains.length,mobile};
  return{group,update,dispose(){if(disposed)return;disposed=true;stationDetail.dispose();group.removeFromParent();group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
