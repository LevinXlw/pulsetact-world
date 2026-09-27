import * as T from 'three';
import {TextGeometry} from 'three/examples/jsm/geometries/TextGeometry.js';

// A bounded, photo-informed elevation. The source GIS anchor stays unchanged.
export function buildPortico({facade:f,study,put,matrix,worldBox,height,font}){
 const floor=height(f.center[0]+f.normal[0]*5,f.center[2]+f.normal[2]*5)+.75;
 const {wall,windows,doors,columns}=study,n=f.normal,t=[n[2],0,-n[0]],angle=Math.atan2(n[0],n[2]);
 const box=(kind,x,y,z,w,h,d)=>worldBox(f,kind,x,y,z,w,h,d);
 const local=(x,y,z)=>new T.Vector3(f.center[0]+t[0]*x+n[0]*z,y,f.center[2]+t[2]*x+n[2]*z);
 const place=(g,kind,x,y,z)=>put(g,kind,matrix(...local(x,y,z).toArray(),1,1,1,angle));
 const holes=[],glazed=[];
 for(let i=-4;i<=4;i++){
  const x=i*windows.baySpacing,w=Math.abs(i)<=2?windows.centralWidth:windows.outerWidth;
  if(Math.abs(i)<=2){
   const bottom=Math.abs(i)<=1?floor+doors.height+.16:floor+.42;
   glazed.push({id:`window-${i+4}`,x,w,bottom,top:windows.top});
  }else{
   glazed.push({id:`window-${i+4}-lower`,x,w,bottom:floor+.48,top:windows.lowerOuterTop});
   glazed.push({id:`window-${i+4}-upper`,x,w,bottom:windows.upperOuterBottom,top:windows.top});
  }
 }
 for(const window of glazed)holes.push({...window,kind:'window'});
 for(const [i,x] of doors.centers.entries())holes.push({id:`door-${i}`,x,w:doors.width,bottom:floor,top:floor+doors.height,kind:'door'});
 // Partition the wall into non-overlapping solid rectangles around all apertures.
 // Boxes carry depth, so the reveals are real surfaces visible from oblique angles.
 const levels=[...new Set([floor,wall.top,...holes.flatMap(h=>[h.bottom,h.top])])].sort((a,b)=>a-b);
 for(let j=0;j<levels.length-1;j++){
  const bottom=levels[j],top=levels[j+1],mid=(bottom+top)/2;
  const openings=holes.filter(h=>mid>h.bottom&&mid<h.top).sort((a,b)=>a.x-b.x);
  let left=-wall.width/2;
  for(const h of [...openings,{x:wall.width/2,w:0}]){
   const right=h.x-h.w/2;
   if(right-left>.001)box('porticoWall',(left+right)/2,mid,wall.front-wall.thickness/2,right-left,top-bottom,wall.thickness);
   left=h.x+h.w/2;
  }
 }
 // Visible glazing stays inside its own recess, with a real cavity behind it.
 const glassDepth=wall.front-windows.glassSetback;
 for(const h of glazed){
  const center=(h.bottom+h.top)/2,H=h.top-h.bottom;
  box('porticoGlass',h.x,center,glassDepth,h.w-.10,H-.10,.045);
  box('windowInterior',h.x,center,wall.front-1.08,h.w-.07,H-.07,.05);
  for(const sign of [-1,1]){
   box('windowFrame',h.x+sign*(h.w/2-.07),center,glassDepth+.045,.09,H,.11);
   box('windowFrame',h.x,h.bottom+(sign+1)/2*H,glassDepth+.045,h.w,.09,.11);
   box('porticoTrim',h.x+sign*(h.w/2+.075),center,wall.front+.035,.15,H+.23,.14);
  }
  // The tall central bays use a fine metal grid; profile widths stay consistent.
  const rows=Math.max(3,Math.round(H/.66)),cols=4;
  for(let i=1;i<cols;i++)box('windowFrame',h.x-h.w/2+i*h.w/cols,center,glassDepth+.07,.037,H,.08);
  for(let j=1;j<rows;j++)box('windowFrame',h.x,h.bottom+j*H/rows,glassDepth+.07,h.w,.037,.08);
  box('porticoTrim',h.x,h.bottom-.08,wall.front+.12,h.w+.37,.16,.48);
  box('porticoTrim',h.x,h.top+.06,wall.front+.04,h.w+.28,.12,.18);
  // A few shallow partitions behind the glass establish depth, without an invented room.
  for(let k=0;k<Math.floor(H/3);k++)box('interiorShade',h.x,h.bottom+1.2+k*3,wall.front-.98,h.w,.055,.08);
 }
 for(const x of doors.centers){
  const W=doors.width,H=doors.height,z=glassDepth+.08;
  box('entranceDoor',x,floor+H/2,z-.09,W-.13,H-.10,.13);
  // Two recessed glazed leaves and solid lower panels, surrounded by deep bronze/wood trim.
  for(const side of [-1,1]){
   const cx=x+side*W/4;
   box('doorGlass',cx,floor+1.74,z+.008,W/2-.21,1.84,.025);
   box('entrancePanel',cx,floor+.43,z+.018,W/2-.22,.56,.035);
   for(const dx of [-1,1])box('entranceFrame',cx+dx*(W/4-.075),floor+1.58,z+.065,.075,3.10,.12);
   for(const yy of [.11,.77,2.69,3.18])box('entranceFrame',cx,floor+yy,z+.065,W/2-.07,.09,.12);
   const handle=new T.CylinderGeometry(.021,.021,.43,10);
   place(handle,'doorHardware',x+side*.13,floor+1.38,z+.21);
   for(const y of [1.18,1.58])box('doorHardware',x+side*.13,floor+y,z+.15,.044,.044,.16);
  }
  for(const side of [-1,1]){
   box('porticoTrim',x+side*(W/2+.115),floor+H/2,wall.front+.09,.23,H+.20,.36);
   box('entranceFrame',x+side*(W/2-.035),floor+H/2,wall.front-.12,.09,H,.38);
  }
  box('porticoTrim',x,floor+H+.13,wall.front+.12,W+.65,.26,.47);
  box('porticoTrim',x,floor+H+.31,wall.front+.15,W+.83,.10,.56);
  box('steps',x,floor-.016,wall.front+.20,W+.42,.035,.9);
 }
 box('porticoFloor',0,floor-.14,-.45,43.6,.28,6.35);
 // Preserve the existing collision heights while adding stone nosings and end joints.
 for(let step=0;step<5;step++){
  const top=floor-.15*step,z=3+.62*step;
  box('steps',0,top-.11,z,43.6,.22,.65);
  for(let x=-21.8;x<21.8;x+=2.05){
   const width=Math.min(2.05,21.8-x);
   box('stepNosing',x+width/2,top-.012,z+.255,width-.006,.025,.14);
  }
 }
 // Cylindrical moldings and proper Ionic spirals replace the old torus capitals.
 for(let i=0;i<columns.count;i++){
  const x=(i-(columns.count-1)/2)*columns.spacing,z=1.15+.4*(1-(x/19)**2);
  box('columnTrim',x,floor+.12,z,1.76,.24,1.76);
  const profile=[[.82,.24],[.86,.29],[.86,.34],[.75,.40],[.71,.46],[.77,.50],[.77,.57],[.72,.62]];
  place(new T.LatheGeometry(profile.map(([r,h])=>new T.Vector2(r,h)),64),'columnTrim',x,floor,z);
  const bottom=floor+columns.baseHeight,top=columns.shaftTop,H=top-bottom;
  const shaft=new T.CylinderGeometry(.56,.71,H,144,16),p=shaft.getAttribute('position'),uv=shaft.getAttribute('uv');
  for(let j=0;j<p.count;j++){
   const px=p.getX(j),pz=p.getZ(j),r=Math.hypot(px,pz),theta=Math.atan2(pz,px),v=p.getY(j)/H+.5;
   if(r>.1){const next=r-.027*(1+Math.cos(theta*24))+.034*Math.sin(Math.PI*v);p.setX(j,px*next/r);p.setZ(j,pz*next/r);}
   uv.setXY(j,uv.getX(j)*2,uv.getY(j)*H/2);
  }
  shaft.computeVertexNormals();place(shaft,'columnStone',x,(bottom+top)/2,z);
  place(new T.LatheGeometry([[.56,0],[.64,.07],[.65,.16],[.71,.24],[.72,.31]].map(([r,h])=>new T.Vector2(r,h)),48),'columnTrim',x,top-.10,z);
  box('columnTrim',x,top+.43,z,1.77,.18,1.56);
  box('columnTrim',x,top+.56,z,1.88,.12,1.67);
  for(const face of [-1,1])for(const side of [-1,1]){
   const points=[];
   for(let k=0;k<=64;k++){const phase=k/64*Math.PI*4.3,r=.31*(1-k/78);points.push(new T.Vector3(x+side*(.59+r*Math.cos(phase)),top+.25+r*Math.sin(phase),z+face*.78));}
   const scroll=new T.TubeGeometry(new T.CatmullRomCurve3(points),64,.036,6,false);
   scroll.applyMatrix4(matrix(f.center[0],0,f.center[2],1,1,1,angle));put(scroll,'columnTrim');
  }
 }
 // Continuous soffit gives the column heads a physical connection to the beam.
 box('porticoTrim',0,19.56,-.47,43.7,.20,6.64);
 for(const [y,h,w,z,d] of [[19.49,.16,43.7,1.12,2.9],[19.62,.10,43.9,1.2,3.04],[20.48,.13,44.05,1.27,3.19],[20.70,.20,44.2,1.31,3.28]])box('porticoTrim',0,y,z,w,h,d);
 box('porticoStone',0,20.05,1.12,43.7,1.2,2.8);
 box('porticoStone',0,22.08,.12,43.7,2.64,.65);
 box('porticoTrim',0,23.45,.16,44.2,.18,1.05);
 for(let i=0;i<85;i++)box('porticoTrim',(i-42)*.5,20.56,2.69,.25,.17,.28);
 const text=new TextGeometry('MASSACHVSETTS INSTITVTE OF TECHNOLOGY',{font,size:1,depth:.018,curveSegments:3});
 text.computeBoundingBox();const b=text.boundingBox;
 text.translate(-(b.min.x+b.max.x)/2,-b.min.y,0);text.scale(38/(b.max.x-b.min.x),.62/(b.max.y-b.min.y),1);
 // Keep the lettering proud of the frieze and clear of the upper/lower moldings.
 place(text,'lettering',0,19.75,2.55);
 return {floor,windowCount:glazed.length,manifest:{version:1,wall,glassDepth,openings:holes,columns:columns.count,reference:'assets-source/killian-reference/portico-study.json',status:'Photo-informed approximate portico sample; no surveyed dimension or interior claim'}};
}
