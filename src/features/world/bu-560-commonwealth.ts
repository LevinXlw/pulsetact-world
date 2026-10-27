import {BoxGeometry,BufferGeometry,ExtrudeGeometry,PlaneGeometry,Shape} from 'three';
export type BU560Point=readonly[number,number];
type Finish='stone'|'brownstone'|'frame'|'roof'|'bankFascia'|'frontageGlass';
type Emitter={put:(finish:Finish,geometry:BufferGeometry,x:number,y:number,z:number,yaw?:number)=>void};
/** Separate City1372 commercial bank envelope, east of the City1373 tower.
 * The one tall banking hall is not a row of apartments. Reference photograph:
 * 560-commonwealth/bank-2019.jpg. Store branding is deliberately not inferred.
 */
export const BU_560_SECTION={roofTop:9.043,glassBottom:1.0,glassTop:6.65,fasciaTop:8.0,wallDepth:.34,glassRecess:.24,doorTop:2.4,slabThickness:.22} as const;
const area=(ring:readonly BU560Point[])=>ring.reduce((n,a,i)=>{const b=ring[(i+1)%ring.length];return n+a[0]*b[1]-b[0]*a[1];},0)/2;
export function buildBU560Commonwealth(ground:readonly BU560Point[],emit:Emitter){
  if(ground.length!==38)throw new Error('560 Commonwealth requires the unchanged City1372 ring');
  const S=BU_560_SECTION,reverse=area(ground)>0;
  const glazingProbes:{x:number;y:number;z:number;normal:BU560Point;kind:string}[]=[],curveFacets:{a:BU560Point;b:BU560Point;door:boolean}[]=[];
  const finishes=new Set<Finish>();let triangles=0;
  const put=(f:Finish,g:BufferGeometry,x:number,y:number,z:number,yaw=0)=>{triangles+=(g.index?.count??g.getAttribute('position').count)/3;finishes.add(f);emit.put(f,g,x,y,z,yaw);};
  const slab=(y:number,finish:Finish)=>{const shape=new Shape();ground.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();const g=new ExtrudeGeometry(shape,{depth:S.slabThickness,steps:1,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);put(finish,g,0,y-S.slabThickness,0);};
  slab(.03,'brownstone');slab(S.roofTop,'roof');
  for(let i=0;i<ground.length;i++){
    const a=reverse?ground[(i+1)%ground.length]:ground[i],b=reverse?ground[i]:ground[(i+1)%ground.length],width=Math.hypot(b[0]-a[0],b[1]-a[1]);if(width<.01)continue;
    const yaw=Math.atan2(a[1]-b[1],b[0]-a[0]),c=Math.cos(yaw),s=Math.sin(yaw),mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
    const part=(f:Finish,g:BufferGeometry,x:number,y:number,z:number)=>put(f,g,mx+x*c+z*s,y,mz-x*s+z*c,yaw);
    const box=(f:Finish,x:number,y:number,z:number,w:number,h:number,d:number)=>part(f,new BoxGeometry(w,h,d),x,y,z);
    const curve=i>=1&&i<=27,street=curve||i===0||i===28,door=curve&&i>=13&&i<=18;
    const lower=door?0:S.glassBottom;
    if(street){
      if(!door){box('brownstone',0,.15,-.16,width,.3,.32);box('stone',0,(S.glassBottom+.3)/2,-.17,width,S.glassBottom-.3,.34);}
      // Separate base and head construction leaves a real open glazing band.
      part('frontageGlass',new PlaneGeometry(width,S.glassTop-lower),0,(S.glassTop+lower)/2,-S.glassRecess);
      box('frame',0,lower+.04,-.17,width,.08,.16);box('frame',0,S.glassTop-.04,-.17,width,.08,.16);
      // Physical transoms, seen in the double-height bank hall photograph.
      for(const y of [S.doorTop,4.48])box('frame',0,y,-.17,width,.065,.18);
      const columns=curve?0:Math.max(1,Math.round(width/3.6));
      if(columns)for(let j=0;j<=columns;j++)box('frame',-width/2+j*width/columns,(S.glassTop+lower)/2,-.16,.085,S.glassTop-lower,.2);
      if(curve&&(i%3===0||i===13||i===19))box('frame',-width/2,(S.glassTop+lower)/2,-.16,.085,S.glassTop-lower,.2);
      const dx=(b[0]-a[0])/width,dz=(b[1]-a[1])/width,nx=-dz,nz=dx,offset=curve?width*.16:.4;
      if(width>.3)glazingProbes.push({x:mx+offset*dx-nx*S.glassRecess,y:door?1.25:3.3,z:mz+offset*dz-nz*S.glassRecess,normal:[nx,nz],kind:door?'curved-entry':'street-window'});
      if(curve)curveFacets.push({a,b,door});
    }else{
      // Unphotographed western service wall remains restrained masonry; no
      // invented storefront entrances into the adjacent private tower.
      box('stone',0,S.glassTop/2,-S.wallDepth/2,width,S.glassTop,S.wallDepth);
    }
    box('stone',0,(S.roofTop+S.glassTop)/2,-S.wallDepth/2,width,S.roofTop-S.glassTop,S.wallDepth);
    if(street)box('bankFascia',0,(S.fasciaTop+S.glassTop)/2,.015,width,S.fasciaTop-S.glassTop,.1);
    // Pale stone upper course joints and metal coping remain actual shallow
    // components. No bank name, advertisement or tenant is fabricated.
    box('frame',0,S.roofTop-.065,-.08,width,.13,.42);
    box('brownstone',0,8.48,.006,width,.014,.014);
    if(width>3)for(let j=1;j<Math.ceil(width/1.45);j++)box('brownstone',-width/2+j*width/Math.ceil(width/1.45),8.51,.006,.014,S.roofTop-S.fasciaTop-.13,.014);
  }
  const center={x:ground.reduce((n,p)=>n+p[0],0)/ground.length,z:ground.reduce((n,p)=>n+p[1],0)/ground.length};
  return{source:'560-commonwealth/source-20261027.json',section:S,glazingProbes,curveFacets,roofProbe:{...center,y:S.roofTop},resources:{triangles,materials:finishes.size},scope:'City1372 independent curved one-storey banking hall; 2019 unbranded exterior reconstruction; current tenant and western service wall unverified'};
}
