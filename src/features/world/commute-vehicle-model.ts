import {Box3,BoxGeometry,BufferGeometry,CatmullRomCurve3,CylinderGeometry,Group,Mesh,MeshPhysicalMaterial,MeshStandardMaterial,SphereGeometry,TorusGeometry,TubeGeometry,Vector3,type Material} from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type RideMode='motorcycle'|'broom';
type Point=[number,number,number];
const V=(p:Point)=>new Vector3(...p);
/** Shared actor-local contacts: vehicle faces +Z; actor feet remain on terrain. */
export const RIDE_CONTACTS={
 motorcycle:{hip:[0,.925,-.29] as Point,hands:[[.345,1.045,.36],[-.345,1.045,.36]] as Point[],feet:[[.245,.31,.015],[-.245,.31,.015]] as Point[]},
 broom:{hip:[0,1.035,-.12] as Point,hands:[[.063,.98,.36],[-.063,.98,.45]] as Point[],feet:[[.23,.43,.02],[-.23,.43,.02]] as Point[]},
};

/** Original, unbranded classic street motorcycle. Proportions informed by
 * Triumph's published 1.45 m wheelbase / .79 m seat-height, not a brand replica.
 * Small static parts are merged by finish; wheels retain separate pivots. */
export function createCommuteVehicle(mode:RideMode){
 const root=new Group();root.name=`commute-${mode}`;
 const materials:Record<string,MeshStandardMaterial>={
  paint:new MeshPhysicalMaterial({name:'Deep evergreen enamel',color:'#244f48',metalness:.36,roughness:.25,clearcoat:.65,clearcoatRoughness:.2}),
  cream:new MeshPhysicalMaterial({name:'Warm ivory coachline',color:'#e6dcc5',roughness:.32,metalness:.15,clearcoat:.3}),
  steel:new MeshStandardMaterial({name:'Brushed alloy',color:'#aab3b0',metalness:.78,roughness:.34}),
  dark:new MeshStandardMaterial({name:'Powder coated steel',color:'#192426',metalness:.53,roughness:.46}),
  rubber:new MeshStandardMaterial({name:'Tire rubber and grips',color:'#141a1c',roughness:.94}),
  leather:new MeshStandardMaterial({name:'Stitched tobacco saddle',color:'#4d3226',roughness:.86}),
  gold:new MeshStandardMaterial({name:'Warm brass hardware',color:'#ac8850',metalness:.72,roughness:.36}),
  lens:new MeshStandardMaterial({name:'Headlamp warm lens',color:'#f7ead0',emissive:'#ffd6a1',emissiveIntensity:.6,roughness:.25,metalness:.12}),
  red:new MeshStandardMaterial({name:'Rear lamp lens',color:'#b53024',emissive:'#8a2016',emissiveIntensity:.45,roughness:.33}),
  wood:new MeshStandardMaterial({name:'Oiled ash broom handle',color:'#6f452b',roughness:.61}),
  woodLight:new MeshStandardMaterial({name:'Ash grain',color:'#9c7043',roughness:.69}),
  bristle:new MeshStandardMaterial({name:'Woven golden reed',color:'#ad8653',roughness:.9}),
  bristleDark:new MeshStandardMaterial({name:'Shadowed reed fibres',color:'#6b4d30',roughness:.94}),
  glow:new MeshStandardMaterial({name:'Quiet jade enchantment',color:'#a8ecce',emissive:'#5fcdb1',emissiveIntensity:1.25,roughness:.45}),
 };
 const wheels:Group[]=[];
 function add(group:Group,geometry:BufferGeometry,finish:string,p:Point=[0,0,0],rotation?:Point,scale?:Point){const mesh=new Mesh(geometry,materials[finish]);mesh.position.set(...p);if(rotation)mesh.rotation.set(...rotation);if(scale)mesh.scale.set(...scale);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;}
 function bar(group:Group,a:Point,b:Point,r:number,finish:string,segments=8){const av=V(a),bv=V(b),mesh=add(group,new CylinderGeometry(r,r,av.distanceTo(bv),segments),finish);mesh.position.copy(av).add(bv).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new Vector3(0,1,0),bv.sub(av).normalize());return mesh;}
 function curve(group:Group,points:Point[],r:number,finish:string,segments=24,sides=7){return add(group,new TubeGeometry(new CatmullRomCurve3(points.map(V)),segments,r,sides,false),finish);}
 function round(group:Group,size:Point,p:Point,finish:string,r=.035){return add(group,new RoundedBoxGeometry(...size,2,r),finish,p);}
 function ring(group:Group,r:number,tube:number,p:Point,finish:string,rotation:Point=[0,Math.PI/2,0],arc=Math.PI*2){return add(group,new TorusGeometry(r,tube,6,48,arc),finish,p,rotation);}
 const body=new Group();body.name=`${mode} body`;root.add(body);
 if(mode==='motorcycle'){
  const wheelRadius=.335;
  for(const [index,z] of [-.70,.75].entries()){
   const wheel=new Group();wheel.name=index?'Front rolling wheel':'Rear rolling wheel';wheel.position.set(0,wheelRadius,z);root.add(wheel);wheels.push(wheel);
   ring(wheel,.279,.056,[0,0,0],'rubber');
   for(const side of [-1,1]){ring(wheel,.248,.014,[side*.039,0,0],'steel');ring(wheel,.302,.0025,[side*.039,0,0],'rubber');}
   add(wheel,new CylinderGeometry(.045,.045,.15,16),'steel',[0,0,0],[0,0,Math.PI/2]);
   for(let i=0;i<32;i++){const a=i*Math.PI*2/32,offset=(i%2?1:-1)*.12;bar(wheel,[(i%2?1:-1)*.037,Math.cos(a+offset)*.043,Math.sin(a+offset)*.043],[0,Math.cos(a)*.238,Math.sin(a)*.238],.0028,'steel',5);}
   // Tread grooves are physical shallow diagonal ribs, not painted circles.
   for(let i=0;i<48;i++){const a=i*Math.PI*2/48;add(wheel,new BoxGeometry(.077,.004,.009),'dark',[0,Math.cos(a)*.334,Math.sin(a)*.334],[a,(i%2?1:-1)*.2,0]);}
   add(wheel,new CylinderGeometry(index?.142:.112,index?.142:.112,.008,32),'steel',[-.065,0,0],[0,0,Math.PI/2]);
   for(let i=0;i<16;i++){const a=i*Math.PI/8;add(wheel,new CylinderGeometry(.005,.005,.009,6),'dark',[-.071,Math.cos(a)*(index?.116:.086),Math.sin(a)*(index?.116:.086)],[0,0,Math.PI/2]);}
  }
  // Twin-cradle steel frame and rear swing arm.
  for(const x of [-.14,.14]){
   curve(body,[[x,.78,.38],[x,.52,.30],[x,.29,.20],[x,.26,-.28],[x,.40,-.50],[x,.77,-.48]],.019,'dark');
   bar(body,[x,.77,-.48],[x,.78,.38],.021,'dark');bar(body,[x,.4,-.20],[x,.335,-.70],.022,'dark');
   bar(body,[x,.78,-.49],[x,.335,-.70],.022,'steel');
   for(let i=0;i<9;i++){const t=i/8;ring(body,.034,.005,[x,.41+t*.26,-.663+t*.123],'dark',[Math.PI/2-.44,0,0]);}
   bar(body,[x,.335,.75],[x,.88,.47],.026,'steel');bar(body,[x,.335,.75],[x,.56,.635],.033,'dark');
  }
  // Fenders retain an open underside and a true curved metal profile.
  for(const z of [-.70,.75]){const fender=ring(body,.364,.027,[0,.335,z],'paint',[0,Math.PI/2,0],Math.PI*1.04);fender.rotation.z=-Math.PI*.02;fender.scale.z=2.5;}
  const tank=add(body,new SphereGeometry(1,32,20),'paint',[0,.79,.16],undefined,[.225,.205,.335]);
  tank.name='Sculpted fuel tank';
  // Inset ivory flanks, brass cap, tank knee pads.
  for(const side of [-1,1]){
   add(body,new SphereGeometry(1,20,12),'cream',[side*.196,.78,.155],undefined,[.024,.095,.25]);
   add(body,new SphereGeometry(1,16,10),'rubber',[side*.22,.725,-.006],undefined,[.014,.068,.112]);
   curve(body,[[side*.199,.84,-.03],[side*.221,.837,.12],[side*.19,.83,.34]],.0038,'gold',18,5);
  }
  add(body,new CylinderGeometry(.038,.038,.018,24),'steel',[0,.993,.18]);
  round(body,[.38,.105,.70],[0,.795,-.34],'leather',.055);
  for(let i=0;i<9;i++)curve(body,[[-.175,.838,-.63+i*.072],[0,.852,-.63+i*.072],[.175,.838,-.63+i*.072]],.0035,'woodLight',8,4);
  curve(body,[[-.21,.79,-.67],[-.23,.79,-.48],[0,.79,-.39],[.23,.79,-.48],[.21,.79,-.67]],.008,'steel',20);
  // Finned twin-cylinder engine and crankcases.
  round(body,[.34,.22,.31],[0,.38,-.08],'dark');
  for(const x of [-.105,.105]){
   round(body,[.16,.22,.17],[x,.565,.055],'dark',.02);
   for(let i=0;i<9;i++)round(body,[.186,.012,.195],[x,.48+i*.021,.055],'steel',.007);
   round(body,[.175,.055,.19],[x,.685,.055],'dark',.02);
  }
  for(const x of [-.19,.19]){add(body,new CylinderGeometry(.104,.104,.035,24),'steel',[x,.365,-.08],[0,0,Math.PI/2]);add(body,new CylinderGeometry(.067,.067,.041,24),'dark',[x*1.11,.365,-.08],[0,0,Math.PI/2]);
   curve(body,[[x*.53,.61,.15],[x*.76,.51,.28],[x,.26,.13],[x*1.21,.235,-.29],[x*1.21,.25,-.73]],.025,'steel',25,8);
   bar(body,[x*1.21,.25,-.35],[x*1.21,.25,-.80],.047,'steel',16);
   add(body,new CylinderGeometry(.032,.032,.012,16),'dark',[x*1.21,.25,-.807],[Math.PI/2,0,0]);
   bar(body,[x*.8,.22,.015],[x*1.48,.22,.015],.016,'steel');bar(body,[x*1.2,.22,.015],[x*1.48,.22,.015],.026,'rubber');
   round(body,[.025,.10,.09],[-.096,.48,.74],'dark',.01);
  }
  // Steering assembly, bar risers, controls, mirrors and cables.
  bar(body,[-.15,.865,.478],[.15,.865,.478],.025,'steel');
  curve(body,[[-.39,1.045,.36],[-.24,1.045,.36],[-.18,1.02,.56],[0,1.005,.56],[.18,1.02,.56],[.24,1.045,.36],[.39,1.045,.36]],.014,'steel',22);
  for(const s of [-1,1]){
   bar(body,[s*.295,1.045,.36],[s*.395,1.045,.36],.022,'rubber');
   curve(body,[[s*.29,1.04,.37],[s*.30,1.16,.40],[s*.38,1.21,.40]],.006,'steel',10);
   add(body,new SphereGeometry(1,16,10),'steel',[s*.39,1.22,.40],undefined,[.06,.044,.012]);
   round(body,[.044,.045,.05],[s*.275,1.045,.36],'dark',.009);
   curve(body,[[s*.26,1.06,.385],[s*.33,1.063,.417],[s*.40,1.052,.395]],.005,'steel',10,5);
   curve(body,[[s*.23,1.01,.42],[s*.17,.92,.43],[s*.13,.61,.38]],.004,'rubber',15,5);
   const clock=add(body,new CylinderGeometry(.05,.05,.03,24),'steel',[s*.059,1.003,.58],[.4,0,0]);clock.name='Analog instrument housing';
   add(body,new CylinderGeometry(.043,.043,.031,24),'dark',[s*.059,1.009,.581],[.4,0,0]);
   bar(body,[s*.059,1.029,.581],[s*.08,1.023,.604],.0018,'cream',4);
  }
  add(body,new CylinderGeometry(.123,.115,.105,32),'steel',[0,.93,.69],[Math.PI/2,0,0]);
  add(body,new CylinderGeometry(.107,.107,.007,32),'lens',[0,.93,.747],[Math.PI/2,0,0]);
  for(let i=-4;i<=4;i++)bar(body,[i*.021,.93-Math.sqrt(.1*.1-(i*.021)**2),.753],[i*.021,.93+Math.sqrt(.1*.1-(i*.021)**2),.753],.0015,'cream',4);
  for(const s of [-1,1]){bar(body,[s*.11,.8,.60],[s*.21,.8,.60],.009,'steel');add(body,new SphereGeometry(.025,12,8),'gold',[s*.215,.8,.60]);add(body,new SphereGeometry(.025,12,8),'red',[s*.175,.68,-.78]);}
  round(body,[.12,.055,.035],[0,.68,-.83],'red',.01);round(body,[.13,.095,.006],[0,.59,-.855],'cream',.005);
 }else{
  curve(body,[[0,.85,-.75],[.008,.875,-.40],[0,.89,0],[.008,.94,.43],[0,1.02,.87],[0,1.045,.99]],.029,'wood',36,10);
  // Subtle grain ridges and wrapped grip remain tangible at riding distance.
  for(let i=0;i<3;i++)curve(body,[[.018*Math.cos(i*2.1),.87+.012*Math.sin(i*2.1),-.62],[.025*Math.cos(i*2.1),.90+.012*Math.sin(i*2.1),0],[.023*Math.cos(i*2.1),.96+.012*Math.sin(i*2.1),.60]],.0018,'woodLight',20,4);
  for(let i=0;i<14;i++)ring(body,.032,.0032,[0,.912+i*.0025,.18+i*.018],'leather',[Math.PI/2-.14,0,0]);
  // Each swept reed tapers independently; the tail is not a solid cone.
  for(let i=0;i<94;i++){
   const a=i*2.39996323,r=.04+.19*Math.sqrt((i+.5)/94),length=.63+.17*Math.sin(i*1.7)**2;
   const sx=.034*Math.cos(a),sy=.855+.026*Math.sin(a),ex=r*Math.cos(a),ey=.86+r*.67*Math.sin(a);
   const c=new CatmullRomCurve3([new Vector3(sx,sy,-.48),new Vector3(sx*1.7,sy,-.67),new Vector3(ex*.77,ey,-.90),new Vector3(ex,ey+.022*Math.sin(i),-.48-length)]);
   const geometry=new TubeGeometry(c,9,.0085,5,false),pos=geometry.attributes.position;
   // Tube ring radii taper towards the tip instead of ending as cut cylinders.
   for(let ringIndex=0;ringIndex<=9;ringIndex++){const center=c.getPointAt(ringIndex/9),scale=1-.87*(ringIndex/9)**1.4;for(let radial=0;radial<=5;radial++){const n=ringIndex*6+radial;pos.setXYZ(n,center.x+(pos.getX(n)-center.x)*scale,center.y+(pos.getY(n)-center.y)*scale,center.z+(pos.getZ(n)-center.z)*scale);}}
   geometry.computeVertexNormals();add(body,geometry,i%4?'bristle':'bristleDark');
  }
  for(let i=0;i<6;i++)ring(body,.045+i*.003,.007,[0,.855,-.53-i*.022],'gold',[Math.PI/2,0,0]);
  ring(body,.055,.004,[0,.855,-.60],'glow',[Math.PI/2,0,0]);
  for(let i=0;i<9;i++)add(body,new SphereGeometry(.0055,6,4),'glow',[Math.sin(i*2.4)*.14,.84+Math.cos(i*2.4)*.08,-1.15-i*.018]);
 }
 // Batch each rigid section by material. Geometry remains fully 3D.
 for(const group of [body,...wheels]){
  const batches=new Map<Material,BufferGeometry[]>();
  for(const object of [...group.children]){if(!(object instanceof Mesh))continue;object.updateMatrix();const transformed=object.geometry.clone().applyMatrix4(object.matrix),geometry=transformed.index?transformed.toNonIndexed():transformed,list=batches.get(object.material as Material)??[];if(geometry!==transformed)transformed.dispose();list.push(geometry);batches.set(object.material as Material,list);object.geometry.dispose();group.remove(object);}
  for(const [material,geometries] of batches){const merged=mergeGeometries(geometries);if(!merged)throw Error('Vehicle geometry batch mismatch');geometries.forEach(g=>g.dispose());const mesh=new Mesh(merged,material);mesh.name=`${mode} · ${material.name}`;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
 }
 root.updateMatrixWorld(true);const bounds=new Box3().setFromObject(root),size=bounds.getSize(new Vector3());let triangles=0,meshes=0;
 root.traverse(o=>{if(o instanceof Mesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;meshes++;}});
 root.userData.commute={mode,triangles,meshes,size:size.toArray(),contacts:RIDE_CONTACTS[mode]};
 let disposed=false;
 return{root,wheels,body,bounds,update:(dt:number,speed:number,time:number)=>{if(disposed)return;if(mode==='motorcycle')wheels.forEach(wheel=>wheel.rotation.x=(wheel.rotation.x+Math.max(0,speed)*Math.min(dt,.05)/.335)%(Math.PI*2));else body.position.y=Math.sin(time*2.4)*.022;},dispose:()=>{if(disposed)return;disposed=true;root.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});Object.values(materials).forEach(m=>m.dispose());root.clear();wheels.length=0;}};
}
