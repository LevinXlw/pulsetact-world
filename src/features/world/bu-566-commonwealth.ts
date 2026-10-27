import {BoxGeometry,BufferGeometry,ExtrudeGeometry,Path,PlaneGeometry,Shape} from 'three';

export type BU566Point=readonly[number,number];
type Finish='brick'|'concrete'|'metal'|'frame'|'roof'|'frontageGlass'|'frontageGlassDark';
type Emitter={put:(finish:Finish,geometry:BufferGeometry,x:number,y:number,z:number,yaw?:number)=>void};
type Opening={x:number;bottom:number;width:number;height:number};
/** City 1373 is the setback residential tower, not the complete land parcel or
 * the adjacent one-storey 560 Commonwealth bank (City 1372). The photographed
 * balcony/slab character is reconstructed only inside this measured envelope.
 * Section heights, balcony divisions and obscured elevations are estimates.
 */
export const BU_566_SECTION={mainTop:37.317,podiumTop:5.4,upperFloors:11,balconyDepth:2.05,slabThickness:.23,wallDepth:.32,glassRecess:.22,balconyBanks:4,railHeight:.98} as const;
const area=(p:readonly BU566Point[])=>p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
const shape=(p:readonly BU566Point[])=>{const s=new Shape();p.forEach(([x,z],i)=>i?s.lineTo(x,-z):s.moveTo(x,-z));s.closePath();return s;};

export function bu566Frame(ground:readonly BU566Point[]){
  if(ground.length<4)throw new Error('566 Commonwealth needs its City 1373 footprint');
  const yaw=-.158,c=Math.cos(yaw),s=Math.sin(yaw),cx=ground.reduce((n,p)=>n+p[0],0)/ground.length,cz=ground.reduce((n,p)=>n+p[1],0)/ground.length;
  const local=(p:BU566Point):BU566Point=>[(p[0]-cx)*c-(p[1]-cz)*s,(p[0]-cx)*s+(p[1]-cz)*c];
  const world=(x:number,z:number):BU566Point=>[cx+x*c+z*s,cz-x*s+z*c];
  const ring=ground.map(local),minX=Math.min(...ring.map(p=>p[0])),maxX=Math.max(...ring.map(p=>p[0])),minZ=Math.min(...ring.map(p=>p[1])),maxZ=Math.max(...ring.map(p=>p[1]));
  // Clip against the measured northern balcony edge rather than enlarging the
  // tower onto the independent commercial frontage/forecourt in front of it.
  const cut=minZ+BU_566_SECTION.balconyDepth,upper:BU566Point[]=[];
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],da=a[1]-cut,db=b[1]-cut;if(da>=0)upper.push(world(a[0],a[1]));if((da>=0)!==(db>=0)){const t=da/(da-db);upper.push(world(a[0]+(b[0]-a[0])*t,cut));}}
  return{yaw,local,world,minX,maxX,minZ,maxZ,cut,upper};
}

export function buildBU566Commonwealth(ground:readonly BU566Point[],emit:Emitter){
  const S=BU_566_SECTION,F=bu566Frame(ground),pitch=(S.mainTop-S.podiumTop)/S.upperFloors;
  let triangles=0;const finishes=new Set<Finish>();
  const put=(f:Finish,g:BufferGeometry,x:number,y:number,z:number,yaw=0)=>{triangles+=(g.index?.count??g.getAttribute('position').count)/3;finishes.add(f);emit.put(f,g,x,y,z,yaw);};
  const slab=(ring:readonly BU566Point[],y:number,finish:Finish='concrete')=>{const g=new ExtrudeGeometry(shape(ring),{depth:S.slabThickness,steps:1,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);put(finish,g,0,y-S.slabThickness,0);};
  const box=(f:Finish,x:number,y:number,z:number,w:number,h:number,d:number)=>{const p=F.world(x,z);put(f,new BoxGeometry(w,h,d),p[0],y,p[1],F.yaw);};
  const facades:{kind:string;a:BU566Point;b:BU566Point;bottom:number;top:number;windows:Opening[]}[]=[];
  const face=(a:BU566Point,b:BU566Point,bottom:number,height:number,finish:Finish,windows:Opening[],kind:string)=>{
    const width=Math.hypot(b[0]-a[0],b[1]-a[1]);if(width<.03)return;
    const yaw=Math.atan2(a[1]-b[1],b[0]-a[0]),c=Math.cos(yaw),s=Math.sin(yaw),mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
    const part=(f:Finish,g:BufferGeometry,x:number,y:number,z:number)=>put(f,g,mx+x*c+z*s,y,mz-x*s+z*c,yaw);
    const wall=new Shape();wall.moveTo(-width/2,0);wall.lineTo(width/2,0);wall.lineTo(width/2,height);wall.lineTo(-width/2,height);wall.closePath();
    for(const o of windows){const hole=new Path(),l=o.x-o.width/2,r=o.x+o.width/2;hole.moveTo(l,o.bottom);hole.lineTo(l,o.bottom+o.height);hole.lineTo(r,o.bottom+o.height);hole.lineTo(r,o.bottom);hole.closePath();wall.holes.push(hole);}
    part(finish,new ExtrudeGeometry(wall,{depth:S.wallDepth,steps:1,bevelEnabled:false,curveSegments:1}),0,bottom,-S.wallDepth);
    for(const o of windows){const y=bottom+o.bottom+o.height/2;
      part('frontageGlass',new PlaneGeometry(o.width,o.height),o.x,y,-S.glassRecess);
      for(const dx of [-o.width/2+.035,o.width/2-.035])part('frame',new BoxGeometry(.07,o.height,.17),o.x+dx,y,-.17);
      for(const dy of [-o.height/2+.035,o.height/2-.035])part('frame',new BoxGeometry(o.width,.07,.17),o.x,y+dy,-.17);
      if(o.width>1.6)part('frame',new BoxGeometry(.06,o.height,.16),o.x,y,-.15);
    }
    facades.push({kind,a,b,bottom,top:bottom+height,windows});
  };
  const each=(ring:readonly BU566Point[],visit:(a:BU566Point,b:BU566Point)=>void)=>{const reverse=area(ring)>0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];visit(reverse?b:a,reverse?a:b);}};
  // City outline contains small copings and collinear survey vertices. Keep
  // them in all slabs/collision; coalesce only near-collinear facade segments.
  const simplify=(p:readonly BU566Point[])=>{const r=[...p];let change=true;while(change&&r.length>4){change=false;for(let i=0;i<r.length;i++){const a=r[(i+r.length-1)%r.length],b=r[i],c=r[(i+1)%r.length],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);if(len>.1&&((b[0]-a[0])*dx+(b[1]-a[1])*dz)>=0&&Math.abs(dx*(a[1]-b[1])-(a[0]-b[0])*dz)/len<.02){r.splice(i,1);change=true;break;}}}return r;};
  const row=(width:number,floors:number,step:number,windowWidth:number,windowHeight:number,spacing:number,bottom=.65)=>{const n=Math.max(1,Math.round(width/spacing)),cell=width/n,result:Opening[]=[];if(width<1)return result;for(let f=0;f<floors;f++)for(let i=0;i<n;i++)result.push({x:(i-(n-1)/2)*cell,bottom:f*step+bottom,width:Math.min(windowWidth,cell-.55),height:windowHeight});return result;};
  slab(ground,.04);slab(ground,S.podiumTop/2);
  each(simplify(ground),(a,b)=>{const width=Math.hypot(b[0]-a[0],b[1]-a[1]);face(a,b,0,S.podiumTop,'concrete',row(width,2,S.podiumTop/2,2.7,1.6,4.4),'podium-estimated');});
  const floorSlabProbes:{x:number;z:number;y:number}[]=[],northBalconyProbes:{x:number;z:number;y:number;glassX:number;glassZ:number;glassY:number;normal:BU566Point}[]=[];
  const interior=F.world((F.minX+F.maxX)/2,(F.cut+F.maxZ)/2);
  for(let i=0;i<=S.upperFloors;i++){const y=S.podiumTop+i*pitch;slab(ground,y,i===S.upperFloors?'roof':'concrete');floorSlabProbes.push({x:interior[0],z:interior[1],y});}
  each(simplify(F.upper),(a,b)=>{
    const la=F.local(a),lb=F.local(b),width=Math.hypot(b[0]-a[0],b[1]-a[1]),north=Math.abs(la[1]-F.cut)<.03&&Math.abs(lb[1]-F.cut)<.03;
    const side=Math.abs(la[0]-lb[0])<.1&&width>12;
    if(north){
      const openings=row(width,S.upperFloors,pitch,Math.min(8.6,width/S.balconyBanks-1.1),2.28,width/S.balconyBanks,.24);
      face(a,b,S.podiumTop,S.mainTop-S.podiumTop,'concrete',openings,'north-recessed-balcony-doors');
      // Ray targets avoid the central mullion. +Z of this oriented facade is
      // outward (north); the panes sit a further 22 cm behind the balcony wall.
      const dx=(b[0]-a[0])/width,dz=(b[1]-a[1])/width,nx=-dz,nz=dx;
      for(let floor=0;floor<S.upperFloors;floor++){const o=openings[floor*S.balconyBanks],px=(a[0]+b[0])/2+(o.x+.4)*dx,pz=(a[1]+b[1])/2+(o.x+.4)*dz;
        northBalconyProbes.push({x:px+nx*S.balconyDepth*.5,z:pz+nz*S.balconyDepth*.5,y:S.podiumTop+floor*pitch,glassX:px-nx*S.glassRecess,glassZ:pz-nz*S.glassRecess,glassY:S.podiumTop+floor*pitch+.9,normal:[nx,nz]});}
    }else if(side){
      // The clearly visible west end is largely pale and solid, with a narrow
      // horizontal slot per floor. Avoid copying the balcony facade onto it.
      face(a,b,S.podiumTop,S.mainTop-S.podiumTop,'concrete',row(width,S.upperFloors,pitch,1.5,.42,width,1.35),'pale-end-wall');
    }else face(a,b,S.podiumTop,S.mainTop-S.podiumTop,'brick',row(width,S.upperFloors,pitch,1.65,1.6,4.2),'rear-estimated');
  });
  const northEnds=F.upper.map(F.local).filter(p=>Math.abs(p[1]-F.cut)<.03);
  const front=F.minZ+.12,northMinX=Math.min(...northEnds.map(p=>p[0]))+.35,northMaxX=Math.max(...northEnds.map(p=>p[0]))-.35,width=northMaxX-northMinX,bankWidth=width/S.balconyBanks;
  // Red masonry piers separate the dark recessed balconies. Every horizontal
  // edge, end return, handrail and intermediate post has actual depth.
  for(let bank=0;bank<=S.balconyBanks;bank++){const x=northMinX+bank*bankWidth;
    box('brick',Math.max(northMinX+.42,Math.min(northMaxX-.42,x)),(S.podiumTop+S.mainTop)/2,front+S.balconyDepth*.48,bank===0||bank===S.balconyBanks?.75:1.05,S.mainTop-S.podiumTop,S.balconyDepth*.96);
  }
  for(let floor=0;floor<S.upperFloors;floor++){const y=S.podiumTop+floor*pitch;
    for(let bank=0;bank<S.balconyBanks;bank++){const x=northMinX+(bank+.5)*bankWidth,w=bankWidth-1.1;
      box('concrete',x,y-.09,front,w,.18,.25);
      box('metal',x,y+S.railHeight,front+.13,w,.055,.07);box('metal',x,y+.25,front+.13,w,.04,.055);
      const posts=Math.ceil(w/.65);for(let p=0;p<=posts;p++)box('metal',x-w/2+p*w/posts,y+S.railHeight/2,front+.13,.035,S.railHeight,.045);
      for(const end of [-1,1])box('metal',x+end*w/2,y+S.railHeight,front+S.balconyDepth/2,.045,.055,S.balconyDepth);
    }
  }
  // Restrained roof cap observed in the official oblique photo; no speculative
  // full-height penthouse or unrelated low bank is extruded into this tower.
  const capX=(F.minX+F.maxX)/2,capZ=F.maxZ-6;
  box('concrete',capX,S.mainTop+.85,capZ,7.2,1.7,4.8);box('roof',capX,S.mainTop+1.72,capZ,7.4,.12,5);
  return{source:'566-commonwealth/source-20261027.json',section:{...S,pitch},upperFootprint:F.upper,facades,floorSlabProbes,northBalconyProbes,resources:{triangles,materials:finishes.size},scope:'City1373 private setback tower; north balconies and pale west end; podium/rear remain estimated; City1372 low commercial building excluded'};
}
