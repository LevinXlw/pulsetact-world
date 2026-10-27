import {BoxGeometry,BufferGeometry,CanvasTexture,Color,CylinderGeometry,DoubleSide,ExtrudeGeometry,Float32BufferAttribute,Group,IcosahedronGeometry,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,Path,PlaneGeometry,Quaternion,Shape,ShapeGeometry,SRGBColorSpace,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createCampusSurface} from './painterly-surfaces';
import {BU_FULL_BUILDINGS,BU_FULL_SPACES} from './bu-full-layout';
import {BU_ROAD_EDGES,buSegmentProjection} from './bu-campus-layout';
import {BU_DEM_CORE_BOUNDS,BU_WEST_DEM_CORE_BOUNDS,buElevation,drapeBUGeometry} from './bu-terrain';
import {configureBUGroundLayer} from './bu-ground-layers';
import {BU_SERT_FRAME,BU_SERT_FOUNDATION_ANCHOR,BU_SERT_PARTS,BU_SERT_PUBLIC_PASSAGES,BU_SERT_FORECOURTS,BU_SERT_LINK_ENTRY,buSertPoint,buSertLocal} from './bu-sert-layout';
import {BU_MARSH_ASSEMBLY} from './bu-landmark-layout';
import {buBrownstoneEntry} from './bu-brownstone-entry';
import {createBUFrontageGlazing} from './bu-frontage-glazing';
import {buildBUGSULinkSide,buildBUMugarSouthUpper,isBUGSULinkSide,isBUMugarSouthUpper} from './bu-sert-photo-facades';
import {buildBU580Commonwealth} from './bu-580-commonwealth';
import {buildBU566Commonwealth} from './bu-566-commonwealth';
import {buildBU560Commonwealth} from './bu-560-commonwealth';
import {BU_WARREN_TOWERS,BU_WARREN_TOWER_SECTION} from './bu-warren-tower-layout';

type Point=readonly[number,number];
type Placement={x:number;z:number;yaw:number};
type Building={id:string;name:string;x:number;z:number;width:number;depth:number;yaw:number;height:number;footprint:readonly Point[];holes?:readonly (readonly Point[])[];kind:string;custom?:boolean};
type Finish='brick'|'brickBuff'|'brickDark'|'brickRose'|'brownstone'|'sandstone'|'stone'|'concrete'|'trim'|'roof'|'metal'|'iron'|'glass'|'glassLight'|'glassDark'|'frontageGlass'|'frontageGlassLight'|'frontageGlassDark'|'warrenCanopy'|'bankFascia'|'frame'|'wood'|'shade'|'paving'|'pavingBrick'|'grass'|'turf'|'soil'|'hedge'|'hedgeLight'|'white'|'red';
type Opening={x:number;y:number;width:number;height:number;arch?:boolean;door?:boolean};
type Profile={finish:Finish;levels:number;spacing:number;windowWidth:number;windowHeight:number;bands?:boolean;fins?:boolean;arches?:boolean;curtain?:boolean;flatCoping?:boolean};
type CampusOptions={buildingIds?:ReadonlySet<string>;includeSpaces?:boolean;signage?:boolean;detail?:'full'|'mobile'};
const DATUM=5.2,CELL=260,UP=new Vector3(0,1,0),UNIT=new Vector3(1,1,1);

/** Georeferenced outdoor massing. Boston GIS provides the original envelopes;
 * later additions and internal volume divisions use reviewed BU planning
 * drawings. Facades and unmeasured dimensions remain authored approximations,
 * not an as-built architectural survey (see the per-assembly source records).
 */
export function createBUFullCampus(options:CampusOptions={}){
  const group=new Group();group.name='Boston University · Charles River campus architecture';
  const ground:Mesh[]=[],walls:Mesh[]=[],shadowMeshes:Mesh[]=[];
  const trees:{x:number;z:number;radius:number}[]=[];
  const modeled:{id:string;family:string;triangles:number}[]=[];
  let triangleCount=0;
  const batches=new Map<string,{finish:Finish;surface:boolean;parts:BufferGeometry[]}>();
  const transform=new Matrix4(),rotation=new Quaternion(),position=new Vector3();
  const collisionMaterial=new MeshBasicMaterial();collisionMaterial.name='BU surveyed footprint collision';
  let cell='0:0',seed=0,base=DATUM,footprintReference:readonly Point[]|undefined;
  let sportsGroundBase:number|undefined;
  let courtyardRings:Point[][]=[];
  const local=(p:Placement,x:number,z:number):Point=>[p.x+x*Math.cos(p.yaw)+z*Math.sin(p.yaw),p.z-x*Math.sin(p.yaw)+z*Math.cos(p.yaw)];
  const put=(finish:Finish,g:BufferGeometry,x:number,y:number,z:number,yaw=0,surface=false)=>{
    rotation.setFromAxisAngle(UP,yaw);position.set(x,base+y,z);transform.compose(position,rotation,UNIT);g.applyMatrix4(transform);g.userData={...g.userData,buBuildingBase:base};
    if(surface&&sportsGroundBase!==undefined){
      // The field, paint and adjoining terrain share the same 12 m triangle
      // lattice. Keep the elevated New Balance deck's extra 4 m intact.
      g.translate(0,DATUM-sportsGroundBase,0);const draped=drapeBUGeometry(g,12);g.dispose();g=draped;
    }
    const part=g.index?g.toNonIndexed():g;if(part!==g)g.dispose();
    const count=part.getAttribute('position').count;triangleCount+=count/3;
    if(!part.getAttribute('uv'))part.setAttribute('uv',new Float32BufferAttribute(new Float32Array(count*2),2));
    part.setAttribute('campusBaseHeight',new Float32BufferAttribute(new Float32Array(count).fill(base),1));
    part.setAttribute('campusYaw',new Float32BufferAttribute(new Float32Array(count).fill(yaw),1));
    const key=`${cell}:${surface?'ground':'architecture'}:${finish}`,batch=batches.get(key)??{finish,surface,parts:[]};batch.parts.push(part);batches.set(key,batch);
  };
  const box=(f:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number,d:number,surface=false)=>{
    if(w<=.001||h<=.001||d<=.001)return;const at=local(p,x,z);put(f,new BoxGeometry(w,h,d),at[0],y,at[1],p.yaw,surface);
  };
  const panel=(f:Finish,p:Placement,x:number,y:number,z:number,w:number,h:number)=>{
    const at=local(p,x,z);put(f,new PlaneGeometry(w,h),at[0],y,at[1],p.yaw);
  };
  const normalize=(points:readonly Point[]):Point[]=>{
    const out=points.map(p=>[p[0],p[1]] as Point);
    if(out.length>3&&Math.hypot(out[0][0]-out.at(-1)![0],out[0][1]-out.at(-1)![1])<.02)out.pop();
    let area=0;for(let i=0;i<out.length;i++){const a=out[i],b=out[(i+1)%out.length];area+=a[0]*b[1]-b[0]*a[1];}if(area>0)out.reverse();return out;
  };
  const outlineShape=(points:readonly Point[])=>{
    const shape=new Shape();points.forEach((p,i)=>i?shape.lineTo(p[0],-p[1]):shape.moveTo(p[0],-p[1]));shape.closePath();
    if(points===footprintReference)for(const ring of courtyardRings){const hole=new Path();ring.forEach((p,i)=>i?hole.lineTo(p[0],-p[1]):hole.moveTo(p[0],-p[1]));hole.closePath();shape.holes.push(hole);}
    return shape;
  };
  const edge=(a:Point,b:Point):Placement=>({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,yaw:Math.atan2(a[1]-b[1],b[0]-a[0])});
  // City outlines often divide one straight wall into dozens of survey edges.
  // Join only those within 15 mm of the same line before laying out windows;
  // roofs and walking collision still use the complete surveyed perimeter.
  const facadeRing=(points:readonly Point[])=>{
    const ring=[...points];let changed=true;
    while(changed&&ring.length>3){changed=false;
      for(let i=0;i<ring.length;i++){
        const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);
        const projection=length?((b[0]-a[0])*dx+(b[1]-a[1])*dz)/(length*length):-1;
        if(length>.01&&projection>=0&&projection<=1&&Math.abs(dx*(a[1]-b[1])-(a[0]-b[0])*dz)/length<.015){ring.splice(i,1);changed=true;break;}
      }
    }return ring;
  };
  const eachFacade=(points:readonly Point[],visit:(p:Placement,width:number)=>void)=>{
    const ring=facadeRing(points);
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];visit(edge(a,b),Math.hypot(b[0]-a[0],b[1]-a[1]));
    }
  };
  const inside=(x:number,z:number,points:readonly Point[])=>{
    let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[i],b=points[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }return hit;
  };
  const intersectsDEM=(points:readonly Point[])=>[BU_DEM_CORE_BOUNDS,BU_WEST_DEM_CORE_BOUNDS].some(({minX,maxX,minZ,maxZ})=>{
    // A centre test misses buildings straddling the DEM edge. Clip the actual
    // outer ring and holes, so bounding-box overlap alone cannot add basements
    // to unrelated parcels or to a courtyard containing the whole DEM region.
    const clippedArea=(ring:readonly Point[])=>{
      let vertices=[...ring];
      for(const [axis,limit,direction] of [[0,minX,1],[0,maxX,-1],[1,minZ,1],[1,maxZ,-1]]){
        const next:Point[]=[];
        for(let i=0;i<vertices.length;i++){
          const a=vertices[i],b=vertices[(i+1)%vertices.length],da=(a[axis]-limit)*direction,db=(b[axis]-limit)*direction;
          if(da>=0)next.push(a);
          if((da>=0)!==(db>=0)){const t=da/(da-db);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
        }
        vertices=next;
      }
      let area=0;for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length];area+=a[0]*b[1]-b[0]*a[1];}
      return Math.abs(area)/2;
    };
    return clippedArea(points)-courtyardRings.reduce((area,ring)=>area+clippedArea(ring),0)>1e-6;
  });
  const roof=(points:readonly Point[],height:number,finish:Finish='roof')=>{
    const geo=new ShapeGeometry(outlineShape(points));geo.rotateX(-Math.PI/2);put(finish,geo,0,height,0);
  };
  const solid=(points:readonly Point[],bottom:number,height:number,finish:Finish)=>{
    const geo=new ExtrudeGeometry(outlineShape(points),{depth:height,bevelEnabled:false,steps:1,curveSegments:1});geo.rotateX(-Math.PI/2);put(finish,geo,0,bottom,0);
  };
  const collider=(name:string,points:readonly Point[],height:number,bottom=0)=>{
    const geometry=new ExtrudeGeometry(outlineShape(points),{depth:height,bevelEnabled:false,steps:1,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.translate(0,base+bottom,0);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,collisionMaterial);mesh.name=name;mesh.visible=false;mesh.userData.campusFootprint=points;mesh.userData.campusBottom=bottom;group.add(mesh);walls.push(mesh);
  };
  const foundation=(points:readonly Point[],finish:Finish='concrete')=>{
    let lowest=-.15;
    const vertices:number[]=[];
    const rings=points===footprintReference?[points,...courtyardRings]:[points];
    for(const ring of rings)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));
      for(let j=0;j<count;j++){
        const u=j/count,v=(j+1)/count,ax=a[0]+(b[0]-a[0])*u,az=a[1]+(b[1]-a[1])*u,bx=a[0]+(b[0]-a[0])*v,bz=a[1]+(b[1]-a[1])*v;
        const ay=Math.min(-.15,buElevation(ax,az)-base-.3),by=Math.min(-.15,buElevation(bx,bz)-base-.3);lowest=Math.min(lowest,ay,by);
        // Rigid occupied floors retain their level. Only the exterior base
        // follows the 3DEP grade, so the north basement is exposed instead of
        // floating or raising the entire adjoining courtyard into a platform.
        vertices.push(ax,ay,az,bx,by,bz,ax,.16,az,ax,.16,az,bx,by,bz,bx,.16,bz);
      }
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();put(finish,g,0,0,0);
    return lowest;
  };
  const rectangle=(p:Placement,x:number,z:number,w:number,d:number)=>normalize([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([dx,dz])=>local(p,x+dx,z+dz)));
  const clipTower=(points:readonly Point[],p:Placement,x:number,z:number,w:number,d:number)=>{
    const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    let vertices=points.map(([px,pz])=>[(px-p.x)*c-(pz-p.z)*s,(px-p.x)*s+(pz-p.z)*c] as Point);
    for(const [axis,limit,direction] of [[0,x-w/2,1],[0,x+w/2,-1],[1,z-d/2,1],[1,z+d/2,-1]]){
      const next:Point[]=[];
      for(let i=0;i<vertices.length;i++){
        const a=vertices[i],b=vertices[(i+1)%vertices.length],da=(a[axis]-limit)*direction,db=(b[axis]-limit)*direction;
        if(da>=0)next.push(a);
        if((da>=0)!==(db>=0)){const t=da/(da-db);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
      }
      vertices=next;
    }
    return normalize(vertices.map(v=>local(p,v[0],v[1])));
  };
  const openingShape=(o:Opening,target:Path|Shape)=>{
    const l=o.x-o.width/2,r=o.x+o.width/2,b=o.y,t=o.y+o.height;
    target.moveTo(l,b);target.lineTo(l,o.arch?t-o.width*.37:t);
    if(o.arch){target.quadraticCurveTo(l,t,o.x,t);target.quadraticCurveTo(r,t,r,t-o.width*.37);}else target.lineTo(r,t);
    target.lineTo(r,b);target.closePath();
  };
  const window=(p:Placement,o:Opening,bottom:number,modern:boolean)=>{
    const pane=new Shape();openingShape(o,pane);const at=local(p,0,-.29);
    put(o.door?'glassDark':(seed++%11===0?'glassLight':'glass'),new ShapeGeometry(pane,5),at[0],bottom,at[1],p.yaw);
    const frame:Finish=modern?'frame':'stone',y=bottom+o.y;
    box(frame,p,o.x,y-.065,.01,o.width+.18,.13,.4);
    if(!o.arch)box(frame,p,o.x,y+o.height+.045,-.03,o.width+.12,.09,.29);
    // The masonry is genuinely open. Mullions sit within the reveal, so the
    // small shadow at a walking camera comes from depth rather than a decal.
    panel('frame',p,o.x,y+o.height*.5,-.22,.055,o.height);
    panel('frame',p,o.x,y+o.height*.58,-.215,o.width,.055);
    if(o.door){box('metal',p,o.x-.14,y+1.1,-.19,.035,.38,.065);box('metal',p,o.x+.14,y+1.1,-.19,.035,.38,.065);}
  };
  const facade=(p:Placement,width:number,bottom:number,height:number,profile:Profile,entrance=false,customDoor?:Opening)=>{
    if(width<.05||height<.1)return;
    const modern=profile.curtain||profile.finish==='concrete',floorHeight=height/profile.levels;
    if(profile.curtain){
      panel('glass',p,0,bottom+height/2,-.31,width,height);
      for(let row=0;row<=profile.levels;row++)box('stone',p,0,bottom+row*floorHeight+.08,-.02,width,.16,.65);
      const columns=Math.max(1,Math.ceil(width/profile.spacing));
      for(let i=0;i<=columns;i++)box('frame',p,-width/2+i*width/columns,bottom+height/2,-.19,.095,height,.25);
      for(let row=0;row<profile.levels;row++)panel('glassDark',p,0,bottom+(row+.1)*floorHeight,-.295,width,.65);
      return;
    }
    const openings:Opening[]=[],columns=Math.max(width>1.9&&profile.spacing<=3.1?1:0,Math.floor((width-.9)/profile.spacing));
    const spacing=columns?Math.min(profile.spacing,(width-.9)/columns):profile.spacing;
    for(let row=0;row<profile.levels;row++)for(let col=0;col<columns;col++){
      const x=(col-(columns-1)/2)*spacing;
      if(entrance&&row===0&&Math.abs(x)<2)continue;
      if(customDoor&&row===0&&Math.abs(x-customDoor.x)<(profile.windowWidth+customDoor.width)/2+.3)continue;
      const h=Math.min(profile.windowHeight,floorHeight*.7),arch=profile.arches&&row===0;
      openings.push({x,y:row*floorHeight+(arch?.45:floorHeight*.18),width:Math.min(profile.windowWidth,spacing*.77,width-.65),height:arch?Math.min(floorHeight-.75,h+1):h,arch});
    }
    if(entrance&&width>7&&bottom<.5)openings.push({x:0,y:.25,width:2.55,height:Math.min(3.5,floorHeight-.5),door:true,arch:profile.arches});
    if(customDoor)openings.push(customDoor);
    if(options.detail==='mobile'){
      // Offline mobile bake: retain the real envelope and window rhythm but
      // use planar panes. No full-detail constructor runs in the phone client.
      panel(profile.finish,p,0,bottom+height/2,-.02,width,height);
      for(const opening of openings){
        panel(opening.door?'glassDark':'glass',p,opening.x,bottom+opening.y+opening.height/2,.015,opening.width,opening.height);
        if(opening.width>1.8)panel('frame',p,opening.x,bottom+opening.y+opening.height/2,.023,.055,opening.height);
      }
      if(profile.flatCoping)panel('trim',p,0,bottom+height-.12,.035,width,.24);
      else box(modern?'concrete':'trim',p,0,bottom+height-.12,.035,width,.24,.55);
      if(profile.bands)for(let row=1;row<profile.levels;row++)panel('stone',p,0,bottom+row*floorHeight-.08,.035,width,.17);
      if(profile.fins&&width>8)for(let col=0;col<=columns;col++)box('concrete',p,-columns*spacing/2+col*spacing,bottom+height/2,.13,.28,height,.74);
      return;
    }
    const face=new Shape();face.moveTo(-width/2,.16);face.lineTo(width/2,.16);face.lineTo(width/2,height);face.lineTo(-width/2,height);face.closePath();
    for(const o of openings){const hole=new Path();openingShape(o,hole);face.holes.push(hole);}
    const at=local(p,0,-.35);put(profile.finish,new ExtrudeGeometry(face,{depth:.35,steps:1,bevelEnabled:false,curveSegments:5}),at[0],bottom,at[1],p.yaw);
    openings.forEach(o=>window(p,o,bottom,!!modern));
    box(profile.finish==='brownstone'?'brownstone':'stone',p,0,bottom+.08,-.06,width,.16,.4);
    box(modern?'concrete':'trim',p,0,bottom+height-.12,.035,width,.24,.55);
    if(profile.bands)for(let row=1;row<profile.levels;row++)box(profile.finish==='concrete'?'concrete':'stone',p,0,bottom+row*floorHeight-.08,.05,width,.17,.55);
    if(profile.fins&&width>8)for(let col=0;col<=columns;col++)box('concrete',p,-columns*spacing/2+col*spacing,bottom+height/2,.13,.28,height,.74);
    if(entrance&&width>9&&bottom<.5){
      box('stone',p,0,.07,1.1,4.1,.14,2.6,true);
      box('metal',p,0,3.8,1.1,4.2,.13,2.3);
      box('shade',p,0,3.72,1.1,3.9,.035,2.1);
    }
  };
  const skin=(points:readonly Point[],bottom:number,height:number,profile:Profile,entrance=true)=>{
    const outer=facadeRing(points),southEdge=outer.reduce((best,p,i)=>{const next=outer[(i+1)%outer.length],mid=(p[1]+next[1])/2,len=Math.hypot(next[0]-p[0],next[1]-p[1]);return len>8&&mid>best.z?{i,z:mid}:best;},{i:-1,z:-Infinity}).i;
    const rings=points===footprintReference?[outer,...courtyardRings.map(facadeRing)]:[outer];
    for(const ring of rings)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],width=Math.hypot(b[0]-a[0],b[1]-a[1]);
      facade(edge(a,b),width,bottom,height,profile,entrance&&ring===outer&&i===southEdge);
    }
    roof(points,bottom+height+.025);
  };
  const parapet=(points:readonly Point[],height:number,finish:Finish='stone',tall=.65)=>{
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],p=edge(a,b),w=Math.hypot(b[0]-a[0],b[1]-a[1]);
      box(finish,p,0,height+tall/2,-.20,w,tall,.4);box('trim',p,0,height+tall+.05,-.20,w+.08,.1,.55);
    }
  };
  const equipment=(b:Building,points:readonly Point[],height:number)=>{
    const count=Math.min(4,Math.max(1,Math.floor(b.width*b.depth/1000)));
    for(let i=0;i<count;i++){
      const x=(i-(count-1)/2)*7,at=local(b,x,-2);
      if(!inside(at[0],at[1],points)||!inside(at[0]+3,at[1]+3,points))continue;
      box('shade',b,x,height+.28,-2,5.2,.5,3.8);box('metal',b,x,height+1.15,-2,4.8,1.35,3.35);
      for(const dz of [-.8,.8]){const g=new CylinderGeometry(.62,.62,.16,10);put('frame',g,at[0],height+1.92,at[1]+dz);}
      for(let y=.7;y<1.6;y+=.22)box('frame',b,x,height+y,-.30,4.4,.055,.025);
    }
  };
  const nameplate=(p:Placement,label:string,width=9,height=3.2)=>{
    if(options.signage===false||typeof document==='undefined')return;const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#f0e4cf';ctx.fillRect(0,0,1024,160);ctx.fillStyle='#913e38';ctx.fillRect(0,0,13,160);ctx.fillStyle='#4c5047';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='500 52px Georgia, serif';ctx.fillText(label.toUpperCase(),512,82,960);
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;const mesh=new Mesh(new PlaneGeometry(width,width*160/1024),new MeshStandardMaterial({map:texture,roughness:.92}));mesh.position.set(p.x,base+height,p.z);mesh.rotation.y=p.yaw;mesh.name=`BU entrance · ${label}`;group.add(mesh);
  };
  const entrancePlate=(b:Building,points:readonly Point[])=>{
    let selected:{p:Placement;length:number}|undefined;
    for(let i=0;i<points.length;i++){
      const a=points[i],c=points[(i+1)%points.length],p=edge(a,c),length=Math.hypot(c[0]-a[0],c[1]-a[1]);
      if(length>10&&(!selected||p.z>selected.p.z))selected={p,length};
    }
    if(selected){const at=local(selected.p,0,.08);nameplate({x:at[0],z:at[1],yaw:selected.p.yaw},b.name,Math.min(selected.length*.58,16),4.8);}
  };
  const profileFor=(b:Building):Profile=>{
    const kind=b.kind.toLowerCase(),name=b.name.toLowerCase();
    if(b.id==='cas-east')return{finish:'stone',levels:4,spacing:4.0,windowWidth:2.0,windowHeight:3.0,bands:true,arches:true};
    if(kind==='brownstone'||/bay state|buswell|mountfort|carlton/.test(name)&&b.height<23)return{finish:seed++%3?'brick':'brownstone',levels:Math.max(2,Math.round(b.height/3.8)),spacing:3.1,windowWidth:1.22,windowHeight:2.05,bands:false};
    if(kind==='historic'||/fine arts|kilachand hall|myles|610 beacon/.test(name))return{finish:/fine arts/.test(name)?'stone':'brick',levels:Math.max(3,Math.round(b.height/4.0)),spacing:3.6,windowWidth:1.65,windowHeight:2.3,bands:true,arches:/fine arts/.test(name)};
    if(kind==='residence'||/claflin|sleeper|rich hall|danielsen|towers/.test(name))return{finish:'brick',levels:Math.max(3,Math.round(b.height/3.15)),spacing:3.35,windowWidth:1.65,windowHeight:1.65,bands:true};
    if(kind==='library'||/mugar|sherman|law/.test(name))return{finish:'concrete',levels:Math.max(2,Math.round(b.height/4.1)),spacing:4.4,windowWidth:3.2,windowHeight:2.3,bands:true,fins:true};
    if(kind==='modern'||kind==='photonics'||/photonics|life science|science.*engineering/.test(name))return{finish:'brick',levels:Math.max(3,Math.round(b.height/4.25)),spacing:3.3,windowWidth:2.45,windowHeight:2.25,bands:true};
    return{finish:seed++%4===0?'stone':'brick',levels:Math.max(2,Math.round(b.height/3.9)),spacing:3.8,windowWidth:1.75,windowHeight:2.25,bands:true};
  };

  const brownstone=(b:Building,points:Point[])=>{
    // BU's Bay State and Buswell exterior references show mixed brick and
    // sandstone, a stone first storey, raised timber entries and ironwork. The
    // facade family varies by parcel; its footprint and measured height do not.
    const variant=b.id.split('').reduce((hash,c)=>Math.imul(hash^c.charCodeAt(0),16777619),2166136261)>>>0;
    const palette:Finish[]=['brick','brickDark','brick','brickRose','brownstone','brickBuff','brickDark','brick'];
    const finish=palette[variant%palette.length],stone:Finish=variant%3===0?'brownstone':variant%3===1?'sandstone':'stone';
    const profile:Profile={finish,levels:Math.max(2,Math.round(b.height/3.8)),spacing:2.9+(variant%3)*.16,windowWidth:1.18+(variant%2)*.16,windowHeight:2.12,flatCoping:true};
    // Public-realm paths use this same authored door axis, rather than the
    // facade midpoint. A house's existing door placement is not resurveyed here.
    const entry=buBrownstoneEntry(points,b.height),front=entry?.front;
    const groundHeight=entry?.groundHeight??Math.min(4.05,b.height*.39),stoopDepth=entry?.stoopDepth??0;
    const rise=entry?.rise??0,doorX=entry?.doorX??0,doorWidth=entry?.doorWidth??1.2;
    const door:Opening={x:doorX,y:rise+.06,width:doorWidth,height:Math.min(2.72,groundHeight-rise-.23),arch:variant%4!==0,door:true};
    const lower:Profile={...profile,finish:stone,levels:1,windowHeight:Math.min(2.3,groundHeight*.56)};
    const upper:Profile={...profile,levels:Math.max(1,profile.levels-1)};
    const isFront=(p:Placement)=>!!front&&Math.hypot(p.x-front.p.x,p.z-front.p.z)<.01;
    const neighbors=BU_FULL_BUILDINGS.filter(other=>other.id!==b.id&&Math.hypot(other.x-b.x,other.z-b.z)<Math.max(65,(b.width+b.depth+other.width+other.depth)/2));
    const partyWall=(p:Placement,width:number)=>[-.3,0,.3].every(fraction=>{
      const at=local(p,width*fraction,.65);return neighbors.some(other=>inside(at[0],at[1],other.footprint));
    });
    // The survey represents a round bow as many ~40 cm edges. Laying out each
    // edge independently gives it zero windows, turning a residential bay into
    // a blind turret. Lay windows out over the whole convex street-facing arc,
    // then clip them back onto the unchanged GIS edges. BU Housing's Bay State
    // photographs support windowed bows, not an exact house-by-house bay count.
    // The 2–4 sash rhythm below is an authored approximation; no room is added.
    // References: bu.edu/housing/residence/central-campus-apartments/ and
    // bu.edu/meetatbu/summer/residence-halls-adult/brownstones/ (street exteriors).
    type BowFace={start:number;windows:readonly [number,number][];innerA:Point;innerB:Point};
    const bows=new Map<string,BowFace>(),faceKey=(p:Placement)=>`${p.x}:${p.z}`;
    if(/\bBAY STATE\b/i.test(b.name)){
      const ring=facadeRing(points),faces=ring.map((a,i)=>{
        const c=ring[(i+1)%ring.length],p=edge(a,c);return{a,b:c,p,width:Math.hypot(c[0]-a[0],c[1]-a[1])};
      });
      const turn=(a:number,c:number)=>Math.atan2(Math.sin(c-a),Math.cos(c-a));
      const linked=faces.map((f,i)=>{
        const next=faces[(i+1)%faces.length],angle=turn(f.p.yaw,next.p.yaw);
        return f.width>.08&&f.width<1.9&&next.width>.08&&next.width<1.9&&angle>.025&&angle<.42;
      });
      const first=linked.findIndex((_,i)=>!linked[(i+linked.length-1)%linked.length]);
      if(first>=0){
        let visited=0;
        while(visited<faces.length){
          const chain:typeof faces=[];let length=0;
          do{const index=(first+visited)%faces.length,f=faces[index];chain.push(f);length+=f.width;visited++;if(!linked[index])break;}while(visited<faces.length);
          if(chain.length<5||length<3||length>9)continue;
          const totalTurn=chain.slice(1).reduce((sum,f,i)=>sum+turn(chain[i].p.yaw,f.p.yaw),0);
          if(totalTurn<.55||totalTurn>2.9)continue;
          let middle=chain[0],walked=0;
          for(const f of chain){if(walked+f.width>=length/2){middle=f;break;}walked+=f.width;}
          const roads=BU_ROAD_EDGES.filter(e=>e.road.name==='BAY STATE ROAD').map(e=>({...e,...buSegmentProjection(middle.p.x,middle.p.z,e.a,e.b)})).sort((a,c)=>a.distance-c.distance);
          const road=roads[0],out=local(middle.p,0,.8);
          if(!road||road.distance>28||buSegmentProjection(...out,road.a,road.b).distance>road.distance-.4||chain.some(f=>partyWall(f.p,f.width)))continue;
          const columns=Math.max(2,Math.min(4,Math.round(length/1.65))),pitch=length/columns,windowWidth=Math.min(1.14,pitch*.66);
          const windows:[number,number][]=Array.from({length:columns},(_,i)=>[(i+.5)*pitch-windowWidth/2,(i+.5)*pitch+windowWidth/2]);
          // Adjacent panes share the same mitered inner vertex. A window that
          // crosses a survey vertex has neither a crack nor a duplicate jamb.
          const inner=chain.map((f,i)=>{
            const previous=i?chain[i-1]:f,sx=Math.sin(previous.p.yaw)+Math.sin(f.p.yaw),sz=Math.cos(previous.p.yaw)+Math.cos(f.p.yaw),den=sx*Math.sin(f.p.yaw)+sz*Math.cos(f.p.yaw);
            return[f.a[0]-.29*sx/den,f.a[1]-.29*sz/den] as Point;
          });
          const last=chain.at(-1)!;inner.push(local(last.p,last.width/2,-.29));
          let start=0;
          for(let i=0;i<chain.length;i++){
            const f=chain[i],toLocal=(point:Point):Point=>{const dx=point[0]-f.p.x,dz=point[1]-f.p.z;return[dx*Math.cos(f.p.yaw)-dz*Math.sin(f.p.yaw),dx*Math.sin(f.p.yaw)+dz*Math.cos(f.p.yaw)];};
            bows.set(faceKey(f.p),{start,windows,innerA:toLocal(inner[i]),innerB:toLocal(inner[i+1])});start+=f.width;
          }
        }
      }
    }
    const bowFacade=(p:Placement,width:number,bottom:number,height:number,profile:Profile,bow:BowFace)=>{
      const at=(s:number,y:number,depth=0):number[]=>{
        const t=s/width,x=-width/2+s,ix=bow.innerA[0]*(1-t)+bow.innerB[0]*t,iz=bow.innerA[1]*(1-t)+bow.innerB[1]*t;
        return[x+(ix-x)*depth/.29,y,iz*depth/.29];
      };
      const quad=(finish:Finish,a:number[],b:number[],c:number[],d:number[])=>{
        const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([...a,...b,...c,...a,...c,...d],3));geometry.computeVertexNormals();put(finish,geometry,p.x,0,p.z,p.yaw);
      };
      const plane=(finish:Finish,left:number,right:number,low:number,high:number,depth=0)=>{
        if(right-left<.0001||high-low<.0001)return;quad(finish,at(left,low,depth),at(right,low,depth),at(right,high,depth),at(left,high,depth));
      };
      const windows=bow.windows.map(([left,right])=>({left:left-bow.start,right:right-bow.start})).filter(o=>o.right>.0001&&o.left<width-.0001);
      const floorHeight=height/profile.levels;
      if(options.detail==='mobile'){
        plane(profile.finish,0,width,bottom,bottom+height,.02);
        for(let row=0;row<profile.levels;row++)for(const opening of windows){
          const y=bottom+row*floorHeight+floorHeight*.18,h=Math.min(profile.windowHeight,floorHeight*.7);
          plane('glass',Math.max(0,opening.left),Math.min(width,opening.right),y,y+h,-.015);
        }
        return;
      }
      const cuts=[0,width,...windows.flatMap(o=>[Math.max(0,o.left),Math.min(width,o.right)])].sort((a,c)=>a-c).filter((v,i,a)=>!i||v-a[i-1]>.0001);
      for(let row=0;row<profile.levels;row++){
        // Unlike the old extruded facade, this shell has no separate 16 cm
        // closing strip. Start each storey at its floor to leave no open seam.
        const low=bottom+row*floorHeight,high=bottom+(row+1)*floorHeight,y=bottom+row*floorHeight+floorHeight*.18,h=Math.min(profile.windowHeight,floorHeight*.7);
        for(let i=0;i<cuts.length-1;i++){
          const left=cuts[i],right=cuts[i+1],middle=(left+right)/2,opening=windows.find(o=>middle>o.left&&middle<o.right);
          if(!opening){plane(profile.finish,left,right,low,high);continue;}
          plane(profile.finish,left,right,low,y);plane(profile.finish,left,right,y+h,high);
          plane('glass',left,right,y,y+h,.29);
          // FrontSide reveals face into the opening: sill up, soffit down.
          quad(stone,at(left,y),at(right,y),at(right,y,.29),at(left,y,.29));
          quad(profile.finish,at(left,y+h),at(left,y+h,.29),at(right,y+h,.29),at(right,y+h));
          plane('frame',left,right,y+h*.53-.0275,y+h*.53+.0275,.255);
          plane(stone,left,right,y-.11,y,-.045);plane(stone,left,right,y+h,y+h+.1,-.025);
        }
        for(const opening of windows)for(const [s,isLeft] of [[opening.left,true],[opening.right,false]] as const){
          if(s<-.0001||s>width+.0001)continue;
          const a=at(s,y),b=at(s,y,.29),c=at(s,y+h,.29),d=at(s,y+h);
          if(isLeft)quad(profile.finish,a,b,c,d);else quad(profile.finish,d,c,b,a);
          plane('frame',Math.max(0,s-.028),Math.min(width,s+.028),y,y+h,.255);
        }
      }
    };
    eachFacade(points,(p,width)=>{
      // Attached row houses do not have rows of windows hidden inside their
      // neighbours. Keep the surveyed shared wall, but omit invisible openings
      // and trim; the solid upper portion also reads correctly above a lower roof.
      if(partyWall(p,width)){
        panel(finish,p,0,b.height/2,-.02,width,b.height);
        panel(stone,p,0,groundHeight/2,.005,width,groundHeight);return;
      }
      const bow=bows.get(faceKey(p));
      if(bow){bowFacade(p,width,0,groundHeight,lower,bow);bowFacade(p,width,groundHeight,b.height-groundHeight,upper,bow);}
      else{facade(p,width,0,groundHeight,lower,false,isFront(p)?door:undefined);facade(p,width,groundHeight,b.height-groundHeight,upper);}
      if(options.detail==='mobile'){
        panel(stone,p,0,groundHeight-.11,.09,width,.22);
        panel(stone,p,0,.23,.015,width,.46);
        panel(variant%2?'roof':stone,p,0,b.height+.25,.02,width,.5);
        return;
      }
      box(stone,p,0,groundHeight-.11,.09,width,.22,.56);
      // Stone courses and a dark plinth create a substantial ground storey,
      // while tall windows remain genuine openings instead of painted blocks.
      box(stone,p,0,.23,-.015,width,.46,.48);
      box(variant%2?'roof':stone,p,0,b.height+.25,-.13,width,.4,.55);
      box(stone,p,0,b.height+.48,-.05,width+.08,.13,.72);
    });
    for(const ring of courtyardRings)eachFacade(ring,(p,width)=>facade(p,width,0,b.height,profile));
    roof(points,b.height+.025);
    for(const offset of [-1,1]){
      const at=local(b,offset*b.width*.31,-b.depth*.23);
      if(inside(at[0],at[1],points)){
        const h=1.3+(variant%4)*.22;box(finish,b,offset*b.width*.31,b.height+h/2,-b.depth*.23,1.05,h,1.3);
        box(stone,b,offset*b.width*.31,b.height+h+.07,-b.depth*.23,1.32,.16,1.56);
        for(const pot of [-.29,.29])box('brickDark',b,offset*b.width*.31+pot,b.height+h+.3,-b.depth*.23,.24,.38,.3);
      }
    }
    if(!front)return;
    const {p,width}=front;
    const timber=new Shape();openingShape(door,timber);const timberAt=local(p,0,-.23);
    put('wood',new ShapeGeometry(timber,8),timberAt[0],0,timberAt[1],p.yaw);
    const surround=new Shape();openingShape({...door,x:door.x,y:door.y-.05,width:door.width+.55,height:door.height+.25},surround);
    const cut=new Path();openingShape(door,cut);surround.holes.push(cut);const surroundAt=local(p,0,-.08);
    put(stone,options.detail==='mobile'?new ShapeGeometry(surround,4):new ExtrudeGeometry(surround,{depth:.23,bevelEnabled:false,curveSegments:8}),surroundAt[0],0,surroundAt[1],p.yaw);
    // Recessed timber panels, a glazed transom and a small brass-toned pull.
    panel('glassDark',p,doorX,door.y+door.height*.77,-.215,doorWidth-.18,door.height*.28);
    for(const side of [-1,1])box('shade',p,doorX+side*doorWidth*.22,door.y+door.height*.33,-.21,doorWidth*.32,door.height*.48,.025);
    box('metal',p,doorX+doorWidth*.22,door.y+1,-.17,.04,.24,.06);
    if(stoopDepth>.38){
      const steps=options.detail==='mobile'?3:Math.max(2,Math.ceil(rise/.17)),run=stoopDepth/steps;
      for(let step=0;step<steps;step++){
        const height=rise*(step+1)/steps,z=stoopDepth-(step+.5)*run;
        box(stone,p,doorX,height/2,z,doorWidth+.6,height,run+.025,true);
        if(options.detail!=='mobile')box('trim',p,doorX,height+.015,z,doorWidth+.65,.03,run+.035);
      }
      for(const side of [-1,1]){
        const x=doorX+side*(doorWidth/2+.27);
        for(let i=0;i<=steps;i++){const z=stoopDepth-i*run,height=rise*i/steps;box('iron',p,x,height+.46,z,.04,.92,.04);}
        const rail=new BoxGeometry(.052,.06,Math.hypot(stoopDepth,rise));rail.rotateX(Math.atan2(rise,stoopDepth));
        const at=local(p,x,stoopDepth/2);put('iron',rail,at[0],rise/2+.94,at[1],p.yaw);
      }
    }
    // Believable roof edge depth, with alternate corbel rhythms rather than
    // the same bright strip repeated across every adjoining house.
    box(stone,p,0,b.height-.23,.18,width,.21,.78);
    box(finish,p,0,b.height-.52,.1,width,.29,.55);
    const bracketSpacing=variant%2?1.25:.86;
    for(let x=-width/2+.35;options.detail!=='mobile'&&x<width/2-.2;x+=bracketSpacing){
      box(stone,p,x,b.height-.73,.14,.16,.38,.42);
      box(stone,p,x,b.height-.47,.25,.22,.12,.62);
    }
    const dy=(b.height-groundHeight)/upper.levels,columns=Math.max(1,Math.floor((width-.9)/profile.spacing)),dx=Math.min(profile.spacing,(width-.9)/columns);
    for(let row=0;row<upper.levels;row++)for(let col=0;col<columns;col++){
      const x=(col-(columns-1)/2)*dx,y=groundHeight+row*dy+dy*.18+Math.min(profile.windowHeight,dy*.7)+.12;
      if(options.detail==='mobile')panel(stone,p,x,y,.11,profile.windowWidth+.35,.2);
      else box(stone,p,x,y,.11,profile.windowWidth+.35,.2,.4);
      if(options.detail!=='mobile'&&row===0&&variant%3===0)box(stone,p,x,y+.15,.13,.28,.28,.45);
    }
    // Low iron balconies wrap only the mapped front-facing bow facets; no
    // invented projecting room volumes cross the original survey outline.
    if(options.detail!=='mobile')eachFacade(points,(bay,bayWidth)=>{
      if(bayWidth<1.9||Math.cos(bay.yaw-p.yaw)<.45||Math.hypot(bay.x-p.x,bay.z-p.z)>Math.max(12,width))return;
      const railWidth=Math.min(5.4,bayWidth-.28),level=groundHeight+.07;
      box(stone,bay,0,level,.28,railWidth+.12,.15,.67);
      for(const y of [.14,.88])box('iron',bay,0,level+y,.61,railWidth,.045,.045);
      for(let x=-railWidth/2;x<=railWidth/2+.01;x+=.24)panel('iron',bay,x,level+.5,.64,.032,.79);
      for(const side of [-1,1])box('iron',bay,side*railWidth/2,level+.88,.32,.045,.045,.58);
    });
    // Front gardens remain inside the gap to the surveyed public sidewalk.
    // Split them around the stoop so the entry route stays open and readable.
    const gardenDepth=Math.min(2.5,front.setback-.3);
    if(gardenDepth<.8||options.detail==='mobile')return;
    const outer=width/2-.25,clear=doorWidth/2+.55;
    const strips:[number,number][]=[[-outer,doorX-clear],[doorX+clear,outer]];
    for(const [left,right] of strips){
      const span=right-left;if(span<1.1)continue;
      const x=(left+right)/2,z=gardenDepth/2+.14,at=local(p,x,z);
      const corners=[[left,.3],[right,.3],[left,gardenDepth],[right,gardenDepth]].map(([x,z])=>local(p,x,z));
      if(corners.some(([x,z])=>inside(x,z,points)))continue;
      const groundY=buElevation(at[0],at[1])-base;
      box('soil',p,x,groundY+.055,z,span,.1,gardenDepth-.2,true);
      box(stone,p,x,groundY+.14,gardenDepth+.1,span,.28,.15);
      for(const edgeX of [left,right])box(stone,p,edgeX,groundY+.14,z,.13,.28,gardenDepth);
      for(const y of [.25,.85])box('iron',p,x,groundY+y,gardenDepth+.1,span,.045,.045);
      const count=Math.max(2,Math.ceil(span/.25));
      for(let i=0;i<=count;i++)panel('iron',p,left+i*span/count,groundY+.54,gardenDepth+.13,.032,.83);
      const shrubs=Math.min(7,Math.max(2,Math.floor(span/.82)));
      for(let i=0;i<shrubs;i++){
        const shrubX=left+(i+.5)*span/shrubs,shrubZ=z+((i+variant)%2?-.14:.18),shrubAt=local(p,shrubX,shrubZ),radius=.43+(variant+i)%3*.09;
        const shrub=new IcosahedronGeometry(1,1);shrub.scale(radius,.42+(i%3)*.1,Math.min(radius,gardenDepth*.32));
        put((i+variant)%3?'hedge':'hedgeLight',shrub,shrubAt[0],buElevation(shrubAt[0],shrubAt[1])-base+.48,shrubAt[1],p.yaw+(i%3)*.6);
      }
    }
  };
  const civic=(b:Building,points:Point[])=>{
    const profile=profileFor(b);skin(points,0,b.height,profile);parapet(points,b.height,profile.finish==='concrete'?'concrete':'stone');equipment(b,points,b.height);entrancePlate(b,points);
  };
  // Recessed panes behind an exposed structural grid. A handful of broad
  // spandrels and continuous piers give these towers their actual facade depth
  // without making a separate extruded polygon for every window opening.
  const structuralGrid=(p:Placement,width:number,bottom:number,height:number,rows:number,spacing:number,spandrel:Finish='concrete',paired=false)=>{
    const cols=Math.max(1,Math.round(width/spacing)),dx=width/cols,dy=height/rows;
    panel('glassDark',p,0,bottom+height/2,-.32,width,height);
    for(let row=0;row<rows;row++){
      const y=bottom+row*dy;
      if(options.detail==='mobile'){
        panel(spandrel,p,0,y+dy*.16,.07,width,dy*.32);
        panel('concrete',p,0,y+.035,.08,width,.10);
      }else{
        box(spandrel,p,0,y+dy*.16,-.12,width,dy*.32,.38);
        box('concrete',p,0,y+.035,.055,width,.10,.53);
      }
      for(let col=0;col<cols;col++){
        const x=-width/2+(col+.5)*dx;
        panel((row+col)%9===0?'glassLight':'glass',p,x,y+dy*.65,-.28,Math.max(.1,dx-.34),dy*.62);
        panel('frame',p,x,y+dy*.49,-.245,Math.max(.1,dx-.34),.045);
        if(paired)panel('frame',p,x,y+dy*.65,-.24,.05,dy*.62);
      }
    }
    for(let col=0;col<=cols;col++)box('concrete',p,-width/2+col*dx,bottom+height/2,.025,.25,height,.50);
    box('concrete',p,0,bottom+height-.08,.02,width,.16,.52);
  };
  const westResidence=(b:Building,points:Point[])=>{
    const lobby=3.7,upper=b.height-lobby,stories=12;
    eachFacade(points,(p,width)=>{
      const long=width>Math.max(b.width,b.depth)*.56;
      facade(p,width,0,lobby,{finish:'brickBuff',levels:1,spacing:5,windowWidth:3.6,windowHeight:2.7},width>22);
      if(long)structuralGrid(p,width,lobby,upper,stories,3.55,'stone',true);
      else{
        // The ends are mainly blank buff brick, interrupted by one narrow
        // central stair/light bay; wrapping the full grid around is incorrect.
        facade(p,width,lobby,upper,{finish:'brickBuff',levels:stories,spacing:Math.max(3,width-.9),windowWidth:Math.min(2.5,width*.4),windowHeight:2.1});
        if(width>7)for(const side of [-1,1])box('concrete',p,side*1.55,lobby+upper/2,.08,.22,upper,.64);
      }
    });
    if(b.id==='claflin-hall'||b.id==='sleeper-hall'){
      // These occupied towers previously cast only their open facade grids:
      // sunlight could cross both window walls without ever meeting a floor.
      // Add the 12 floor plates already implied by the retained upper-storey
      // rhythm. A 22 cm concrete thickness is an authored structural estimate,
      // not a measured dimension; each plate lies within its solid spandrel
      // band, above the open lobby, leaving glazing/reveals and entrances intact.
      const thickness=.22,startTriangles=triangleCount;
      const levels=Array.from({length:stories},(_,i)=>lobby+i*upper/stories);
      for(const level of levels)solid(points,level,thickness,'concrete');
      const records=group.userData.westResidenceFloorSlabs??=[];
      records.push({id:b.id,levels,thickness,triangles:triangleCount-startTriangles,
        source:'existing 12-storey facade rhythm; thickness estimated; west-residence-floor-slabs-20261026.json'});
    }
    roof(points,b.height);parapet(points,b.height,'concrete',.35);entrancePlate(b,points);
  };
  const studentVillagePart=(b:Building,points:Point[])=>{
    const service=b.id==='stuvi-north-core',north=b.id!=='stuvi-south-tower',stories=north?26:19,lobby=4.1;
    skin(points,0,lobby,{finish:'stone',levels:1,spacing:4.2,windowWidth:3.4,windowHeight:3.1,curtain:!service});
    eachFacade(points,(p,width)=>{
      if(service){
        facade(p,width,lobby,b.height-lobby,{finish:'stone',levels:stories-1,spacing:Math.max(3,width),windowWidth:.8,windowHeight:1.75});
        for(let y=b.height-4.5;y<b.height;y+=.38)panel('metal',p,0,y,.035,width,.13);
        return;
      }
      // Separate north/south/core GIS records already describe the stepped
      // skyline. They must not be split into an invented second pair of towers.
      const broad=width>Math.max(b.width,b.depth)*.57;
      if(broad){
        facade(p,width,lobby,b.height-lobby,{finish:'brick',levels:stories-1,spacing:3.5,windowWidth:1.9,windowHeight:1.7,bands:true});
        for(const fraction of [-.38,0,.38]){
          const at=local(p,width*fraction,.38);
          structuralGrid({x:at[0],z:at[1],yaw:p.yaw},Math.min(3.2,width*.13),lobby,b.height-lobby,stories-1,2.5,'metal');
        }
      }else structuralGrid(p,width,lobby,b.height-lobby,stories-1,3.35,'metal');
      if(width>12)for(const side of [-1,1])box('stone',p,side*(width/2-1.1),lobby+(b.height-lobby)/2,-.04,1.15,b.height-lobby,.48);
    });
    roof(points,b.height);parapet(points,b.height,'metal',.36);
    if(b.id==='stuvi-north-tower'){
      // The top-floor lounge is continuous glazing under a shallow crown.
      eachFacade(points,(p,width)=>{
        if(width<9)return;panel('glassLight',p,0,b.height-1.7,.09,width-.6,2.4);
        box('metal',p,0,b.height+.15,.08,width+.18,.22,.82);
        for(let x=-width/2+1.2;x<width/2;x+=2.7)box('frame',p,x,b.height-1.7,.13,.07,2.4,.1);
      });
    }
  };
  const sertComplex=()=>{
    // The old GIS feature joins GSU, Mugar, boiler, tower and Pappas. It must
    // never be extruded as one 18 m roof: both the low Link and the open space
    // beneath Pappas's third-floor bridge would disappear. Rendering, collision
    // and the navigation overlay consume the same reviewed part boundaries.
    base=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    // BU's current GSU directions put the public front door in the Link:
    // Mugar is on the right, Food Hall on the left. The 2012 library reopening
    // confirms this replaced the southeast entrance demolished for Redstone.
    // The shared anchor is the GIS south-edge centre, not a measured door
    // centre. Door-leaf count/width and frame sections remain approximations.
    // https://www.bu.edu/reservations/gsu/
    // https://www.bu.edu/today/close-ups/2012/new-portal-for-library-patrons/
    const linkEntry=BU_SERT_LINK_ENTRY,linkDoorWidth=6.9;
    const linkFloor=Math.max(...[-linkDoorWidth/2,0,linkDoorWidth/2].map(dx=>buElevation(...buSertPoint(linkEntry.local[0]+dx,linkEntry.local[1]+.1))))+.175-base;
    for(const part of BU_SERT_PARTS){
      const points=normalize(part.footprint),bottom=part.bottom,height=part.top-bottom;
      const collisionBottom=bottom===0?foundation(points,part.kind==='redstone'?'stone':'concrete'):bottom;
      collider(part.name,points,part.top-collisionBottom,collisionBottom);
      if(part.kind==='union'){
        eachFacade(points,(p,width)=>{
          if(width<2.5){panel('concrete',p,0,height/2,0,width,height);return;}
          const here=buSertLocal([p.x,p.z]),out=buSertLocal(local(p,0,.5));
          if(isBUGSULinkSide(part.id,here,out)){
            const detail=buildBUGSULinkSide(width,(finish,x,y,depth,w,h,d)=>box(finish,p,x,y,depth,w,h,d));
            // The photo confirms the blank brick wall above the lower lights.
            // Its uppermost storey is outside that photo: retain that existing
            // model instead of projecting the brick treatment onto every face.
            structuralGrid(p,width,detail.brickTop,height-detail.brickTop,1,4.6,'concrete');
            box('concrete',p,0,11.55,.2,width,.42,1.1);
            if(width>12){panel('brickDark',p,0,14.6,-.245,width-.5,1.3);for(let x=-width/2+2.2;x<width/2;x+=4.6)panel('glass',p,x,14.9,-.23,1.7,2.8);}
            (group.userData.sertPhotoFacades??=[]).push({part:part.id,p,width,...detail});return;
          }
          structuralGrid(p,width,0,5.2,1,4.6,'concrete');
          structuralGrid(p,width,5.2,height-5.2,2,4.6,'concrete');
          for(const y of [5.2,11.55])box('concrete',p,0,y,.2,width,.42,1.1);
          if(width>12){
            panel('brickDark',p,0,14.6,-.245,width-.5,1.3);
            for(let x=-width/2+2.2;x<width/2;x+=4.6)panel('glass',p,x,14.9,-.23,1.7,2.8);
          }
        });
      }else if(part.kind==='mugar'){
        eachFacade(points,(p,width)=>{
          const here=buSertLocal([p.x,p.z]),out=buSertLocal(local(p,0,.5));let exposedBottom=0;
          for(const [boundary,lowerTop] of [[18.25,18.3],[27.2,15],[36.6,11.7]])if(Math.abs(here[0]-boundary)<.025){
            if(out[0]<here[0]-.3)return; // A shared wall completely inside the taller neighbor.
            if(out[0]>here[0]+.3)exposedBottom=lowerTop;
          }
          if(exposedBottom===0)facade(p,width,0,7.2,{finish:'concrete',levels:2,spacing:4.1,windowWidth:3.4,windowHeight:2.8,curtain:width>5});
          const upperBottom=Math.max(7.2,exposedBottom);
          const photoSouth=isBUMugarSouthUpper(part.id,here,out);
          if(photoSouth){
            const detail=buildBUMugarSouthUpper(width,(finish,x,y,depth,w,h,d)=>box(finish,p,x,y,depth,w,h,d));
            (group.userData.sertPhotoFacades??=[]).push({part:part.id,p,width,...detail});
          }else facade(p,width,upperBottom,part.top-upperBottom,{finish:'concrete',levels:Math.max(1,Math.round((part.top-upperBottom)/3.4)),spacing:1.85,windowWidth:.88,windowHeight:2.0,bands:true});
          // PNF §4.3.4 locates the deep brise-soleil on the south and east
          // elevations. The quieter north/west walls must not repeat them.
          const sunFacing=out[0]>here[0]+.3||out[1]>here[1]+.3;
          if(!photoSouth&&sunFacing&&width>5)for(let x=-width/2+.65;x<width/2-.3;x+=1.85)box('concrete',p,x,upperBottom+(part.top-upperBottom)/2,.29,.14,part.top-upperBottom,1.15);
          if(exposedBottom===0)box('concrete',p,0,7.17,.2,width,.32,1.0);
        });
      }else if(part.kind==='redstone'){
        eachFacade(points,(p,width)=>{
          facade(p,width,0,height,{finish:'stone',levels:5,spacing:4.0,windowWidth:1.8,windowHeight:3.0,bands:false});
          // Pale unitized masonry separates the addition from Sert concrete.
          if(options.detail!=='mobile')for(let y=2.3;y<height;y+=2.3)panel('trim',p,0,y,.01,width,.035);
        });
      }else if(part.kind==='mechanical'){
        eachFacade(points,(p,width)=>{
          panel('stone',p,0,bottom+height/2,0,width,height);
          panel('shade',p,0,bottom+height/2,.025,Math.max(.1,width-1),height-.8);
          for(let y=bottom+.45;y<part.top-.2;y+=options.detail==='mobile'?.75:.38)panel('metal',p,0,y,.06,Math.max(.1,width-1),.12);
          box('stone',p,0,part.top-.13,.07,width,.26,.5);
        });
      }else if(part.kind==='pappas'){
        eachFacade(points,(p,width)=>{
          structuralGrid(p,width,bottom,height,part.levels,3.45,'concrete');
          if(bottom>0)for(let x=-width/2+.45;x<width/2;x+=3.45)box('concrete',p,x,bottom+height/2,.22,.20,height,.9);
          if(bottom===0)panel('brickDark',p,0,1.2,-.27,width-.25,2.25);
        });
        if(bottom>0)solid(points,bottom,.3,'concrete');
      }else if(part.kind==='boiler'){
        skin(points,0,height,{finish:'brickDark',levels:1,spacing:6,windowWidth:1.9,windowHeight:1.7},false);
      }else{
        const curtain=part.kind==='atrium'||part.kind==='link';
        eachFacade(points,(p,width)=>{
          const here=buSertLocal([p.x,p.z]),out=buSertLocal(local(p,0,.5));
          if(part.kind==='link'&&width>20&&Math.abs(here[1]-linkEntry.local[1])<.04&&out[1]>here[1]+.3){
            // BU Reservations' GSU_Exterior_0008 (2023) shows a tall window
            // wall, six silver-framed doors, deep concrete piers/spandrels and
            // a complete upper row of glazing. The previous 4.15 m cap removed
            // that upper row. Keep the reviewed door axes and graded sill.
            const doorX=(linkEntry.position[0]-p.x)*Math.cos(p.yaw)-(linkEntry.position[1]-p.z)*Math.sin(p.yaw);
            const left=doorX-linkDoorWidth/2,right=doorX+linkDoorWidth/2,doorTop=linkFloor+2.65;
            const belt=4.13,glassDepth=-.45,frameDepth=-.33;
            // Explicit panes terminate at their structural bands. There is
            // no masonry backing across an opening and no flush fake window.
            for(const [a,b] of [[-width/2,left],[right,width/2]]){
              panel('frontageGlass',p,(a+b)/2,(linkFloor+belt-.23)/2,glassDepth,b-a,belt-.23-linkFloor);
            }
            panel('frontageGlass',p,doorX,(doorTop+belt-.23)/2,glassDepth,linkDoorWidth,belt-.23-doorTop);
            panel('frontageGlass',p,0,(belt+.23+height-.42)/2,glassDepth,width,height-.42-belt-.23);
            box('concrete',p,0,belt,-.08,width,.46,.76);
            box('concrete',p,0,height-.22,-.08,width,.44,.76);
            for(const x of [-width/2,width/2])box('concrete',p,x,height/2,-.08,.27,height,.76);
            const pierXs=[left,right];
            for(const interval of [[-width/2,left],[right,width/2]]){
              const count=Math.max(1,Math.ceil((interval[1]-interval[0])/2.8));
              for(let i=1;i<count;i++)pierXs.push(interval[0]+i*(interval[1]-interval[0])/count);
              for(const y of [linkFloor+.1,doorTop+.04])box('frame',p,(interval[0]+interval[1])/2,y,frameDepth,interval[1]-interval[0],.09,.18);
            }
            for(const x of pierXs)box('concrete',p,x,height/2,-.07,.21,height,.72);
            // Window frames sit inside the exposed-aggregate structural grid;
            // upper panes have the shallow lower lights visible in the photo.
            for(const x of pierXs)for(const side of [-1,1])box('frame',p,x+side*.15,height/2,frameDepth,.055,height-.5,.18);
            for(const y of [belt+.28,belt+1.08,height-.45])box('frame',p,0,y,frameDepth,width,.085,.19);
            for(const x of [doorX-linkDoorWidth/6,doorX+linkDoorWidth/6])box('frame',p,x,(belt+height)/2,frameDepth,.075,height-belt-.45,.19);
            for(const x of [left,right])box('frame',p,x,linkFloor+1.325,-.25,.12,2.65,.46);
            box('frame',p,doorX,doorTop-.055,-.25,linkDoorWidth,.11,.46);
            box('metal',p,doorX,linkFloor+.025,-.19,linkDoorWidth,.05,.46);
            for(let pair=0;pair<3;pair++){
              const centre=left+(pair+.5)*linkDoorWidth/3,leaf=linkDoorWidth/6;
              for(const side of [-1,1]){
                const x=centre+side*leaf/2;
                panel('frontageGlassDark',p,x,linkFloor+1.325,-.55,leaf-.12,2.55);
                for(const edge of [-1,1])box('metal',p,x+edge*(leaf-.1)/2,linkFloor+1.325,-.45,.1,2.65,.18);
                for(const [y,tall] of [[.14,.22],[1.04,.10],[2.59,.12]])box('metal',p,x,linkFloor+y,-.44,leaf-.08,tall,.20);
                box('metal',p,centre+side*.14,linkFloor+1.22,-.29,.035,.34,.12);
                if(options.detail!=='mobile')for(const y of [1.07,1.37])box('metal',p,centre+side*.14,linkFloor+y,-.37,.075,.035,.14);
              }
            }
            group.userData.gsuLinkFrontage={p,width,height,doorX,doorWidth:linkDoorWidth,floor:linkFloor,belt,glassDepth,doorDepth:-.55};
          }else if(part.kind==='atrium'&&Math.abs(here[1]-53)<.03&&out[1]>here[1]+.3){
            // The 2012 PNF describes a transparent two-storey wintergarden
            // entrance. Resolve the doorway on the already-modelled southern
            // threshold; door-leaf/jamb sizes are design approximations, not
            // a new survey. The outside ramp and occupied floor stay intact.
            const doorAt=buSertPoint(87,53),doorX=(doorAt[0]-p.x)*Math.cos(p.yaw)-(doorAt[1]-p.z)*Math.sin(p.yaw);
            const doorWidth=3.15,doorTop=3.3,glassDepth=-.28,doorDepth=-.62;
            const left=doorX-doorWidth/2,right=doorX+doorWidth/2;
            panel('glass',p,(-width/2+left)/2,doorTop/2,glassDepth,left+width/2,doorTop);
            panel('glass',p,(right+width/2)/2,doorTop/2,glassDepth,width/2-right,doorTop);
            panel('glass',p,0,doorTop+(height-doorTop)/2,glassDepth,width,height-doorTop);
            for(const x of [left,right])box('frame',p,x,doorTop/2,-.43,.13,doorTop,.66);
            box('frame',p,doorX,doorTop-.065,-.43,doorWidth,.13,.66);
            box('metal',p,doorX,.185,-.43,doorWidth,.05,.62);
            for(const side of [-1,1]){
              const x=doorX+side*doorWidth/4;
              panel('glassDark',p,x,(doorTop+.21)/2,doorDepth,doorWidth/2-.12,doorTop-.21);
              box('frame',p,doorX+side*.035,(doorTop+.21)/2,doorDepth+.035,.05,doorTop-.21,.07);
              if(options.detail!=='mobile')box('metal',p,doorX+side*.22,1.23,doorDepth+.14,.035,.56,.06);
            }
            for(const y of [5.4,height-.08])box('frame',p,0,y,-.18,width,.14,.24);
            const columns=Math.max(2,Math.round(width/2.8)),spacing=width/columns;
            for(let i=0;i<=columns;i++){
              const x=-width/2+i*spacing,aboveDoor=x>left-.15&&x<right+.15,start=aboveDoor?doorTop:0;
              box('frame',p,x,start+(height-start)/2,-.18,.075,height-start,.24);
            }
          }else facade(p,width,bottom,height,{finish:'concrete',levels:part.levels,spacing:2.8,windowWidth:2.2,windowHeight:3.0,curtain:true});
          if(!curtain&&width>4)for(let x=-width/2+.25;x<width/2;x+=1.35)box('concrete',p,x,bottom+height/2,.12,.13,height,.6);
        });
        solid(points,bottom,.22,'concrete');
      }
      roof(points,part.top);
      const coping=part.kind==='redstone'||part.kind==='mechanical'?'stone':'concrete';
      if(options.detail==='mobile')eachFacade(points,(p,width)=>box(coping,p,0,part.top+.14,-.15,width,.28,.3));
      else parapet(points,part.top,coping,.28);
    }
    // Mugar's two blind service towers and GSU's roof enclosures appear in
    // the published north/south elevations. Their internal dimensions remain
    // interpreted; they sit entirely on their respective library/union roofs.
    for(const [x,z,w,d,h] of [[5.3,9,8,8,10.8],[5.3,62,8,8,8.1]]){
      box('concrete',BU_SERT_FRAME,x,21.7+h/2,z,w,h,d);
      box('trim',BU_SERT_FRAME,x,21.7+h+.08,z,w+.2,.16,d+.2);
    }
    for(const x of [-72,-36]){
      box('brickDark',BU_SERT_FRAME,x,23.0,47,7.2,10.16,7.6);
      box('concrete',BU_SERT_FRAME,x,28.14,47,7.5,.12,7.9);
    }
    box('frame',BU_SERT_FRAME,-54,18.25,65,30,.5,22);
    box('glass',BU_SERT_FRAME,-54,18.57,65,29.5,.16,21.5);
    for(let x=-68;x<=-40;x+=3.5)box('frame',BU_SERT_FRAME,x,18.7,65,.11,.12,21.6);
    // Four north-light vaults, rather than a generic flat equipment roof, are
    // Pappas's identifying roofline (PNF §4.3.3). Quadrant profiles are sampled
    // with a fixed small number of segments; no runtime textures are added.
    for(let row=0;row<4;row++){
      const north=24.2+row*8.65,depth=8.3,rise=2.25,width=21.65,segments=options.detail==='mobile'?5:9;
      const positions:number[]=[];
      for(let i=0;i<segments;i++){
        const u=i/segments,v=(i+1)/segments;
        const za=north+depth*u,zb=north+depth*v,ya=14.45+rise*Math.sqrt(Math.max(0,1-u*u)),yb=14.45+rise*Math.sqrt(Math.max(0,1-v*v));
        const a=buSertPoint(103.2,za),b=buSertPoint(103.2+width,za),c=buSertPoint(103.2,zb),d=buSertPoint(103.2+width,zb);
        positions.push(a[0],ya,a[1],c[0],yb,c[1],b[0],ya,b[1],b[0],ya,b[1],c[0],yb,c[1],d[0],yb,d[1]);
        positions.push(a[0],14.2,a[1],c[0],yb,c[1],a[0],ya,a[1],a[0],14.2,a[1],c[0],14.2,c[1],c[0],yb,c[1]);
        positions.push(b[0],14.2,b[1],b[0],ya,b[1],d[0],yb,d[1],b[0],14.2,b[1],d[0],yb,d[1],d[0],14.2,d[1]);
      }
      const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();put('concrete',geometry,0,0,0);
      const at=buSertPoint(114.025,north),face={x:at[0],z:at[1],yaw:BU_SERT_FRAME.yaw+Math.PI};
      panel('glassDark',face,0,15.55,0,width,2.2);box('concrete',face,0,16.7,0,width,.15,.25);
      for(let x=-width/2;x<=width/2;x+=3.6)box('frame',face,x,15.55,.03,.08,2.2,.16);
    }
    // Follow the existing ground instead of a single raised platform across
    // the public Law–Mugar–Marsh connection. No planter enters this route.
    sportsGroundBase=base;
    for(const court of BU_SERT_FORECOURTS){
      if(court.id==='gsu-link-approach'||court.id==='mugar-forecourt'){
        // The 2023 BU photograph shows brick panels bounded by pale stone
        // bands. Partition the existing surface instead of laying a second
        // coplanar decal over it: every cell shares the old DEM + .155 datum.
        // Grid spacing is photo-estimated; the court bounds remain unchanged.
        const points=court.footprint.map(buSertLocal),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
        const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
        const cuts=(a:number,b:number,origin:number,spacing:number)=>{
          const values=[a,b];for(let i=Math.floor((a-origin)/spacing);origin+i*spacing<b+.11;i++){
            for(const edge of [-.11,.11]){const v=origin+i*spacing+edge;if(v>a+.001&&v<b-.001)values.push(v);}
          }return values.sort((a,b)=>a-b);
        };
        // Only the documented Link courtyard strip receives brick; do not
        // infer paving changes across the full Mugar and Law frontage.
        const xCuts=[...cuts(x0,x1,-22.4,4),...[-22.4,-.25].filter(x=>x>x0+.001&&x<x1-.001)].sort((a,b)=>a-b);
        const zCuts=cuts(z0,z1,linkEntry.local[1],3.6);
        const onBand=(v:number,origin:number,spacing:number)=>Math.abs(v-origin-Math.round((v-origin)/spacing)*spacing)<.11001;
        for(let i=0;i<xCuts.length-1;i++)for(let j=0;j<zCuts.length-1;j++){
          const a=xCuts[i],b=xCuts[i+1],c=zCuts[j],d=zCuts[j+1],x=(a+b)/2,z=(c+d)/2;
          if(b-a<.001||d-c<.001)continue;
          const brick=x>=-22.4&&x<=-.25&&!onBand(x,-22.4,4)&&!onBand(z,linkEntry.local[1],3.6);
          const at=buSertPoint(x,z),g=new PlaneGeometry(b-a,d-c);g.rotateX(-Math.PI/2);
          put(brick?'pavingBrick':'paving',g,at[0],.155,at[1],BU_SERT_FRAME.yaw,true);
        }
      }else{
        const g=new ShapeGeometry(outlineShape(normalize(court.footprint)));g.rotateX(-Math.PI/2);put(court.pavingStyle==='brick'?'pavingBrick':'paving',g,0,.155,0,0,true);
      }
    }
    for(const path of BU_SERT_PUBLIC_PASSAGES){
      for(let i=0;i<path.points.length-1;i++){
        const a=path.points[i],b=path.points[i+1],p=edge(a,b),length=Math.hypot(a[0]-b[0],a[1]-b[1]);
        const g=new PlaneGeometry(length+.05,path.width);g.rotateX(-Math.PI/2);put('paving',g,p.x,.16,p.z,p.yaw,true);
      }
    }
    sportsGroundBase=undefined;
    // Only the last 1.6 m of the approach meets a level door sill. The rest
    // of the newly continuous forecourt follows the DEM. This threshold is
    // above the local front grade; using the shared lower Sert base would bury
    // these doors. There is no change to the building collider or its floor.
    const linkLanding:number[]=[],halfWidth=linkDoorWidth/2+.24;
    for(let i=0;i<8;i++){
      const x0=linkEntry.local[0]-halfWidth+2*halfWidth*i/8,x1=linkEntry.local[0]-halfWidth+2*halfWidth*(i+1)/8;
      const north=linkEntry.local[1]-.025,south=linkEntry.local[1]+1.6;
      const a=buSertPoint(x0,north),b=buSertPoint(x1,north),c=buSertPoint(x0,south),d=buSertPoint(x1,south);
      const front=linkFloor+.002,cy=buElevation(...c)+.16-base,dy=buElevation(...d)+.16-base;
      linkLanding.push(a[0],front,a[1],c[0],cy,c[1],b[0],front,b[1],b[0],front,b[1],c[0],cy,c[1],d[0],dy,d[1]);
    }
    const linkLandingGeo=new BufferGeometry();linkLandingGeo.setAttribute('position',new Float32BufferAttribute(linkLanding,3));linkLandingGeo.computeVertexNormals();put('pavingBrick',linkLandingGeo,0,0,0,0,true);
    // Local entry ramp from the lower Law forecourt to the shared occupied
    // floor. This changes only the 5.2 m wide approach, not the DEM landscape.
    const ramp:number[]=[],entrance=buSertPoint(87,53.1),outer=buSertPoint(87,67),startHeight=buElevation(...outer)+.16,targetHeight=base+.16;
    for(let i=0;i<7;i++){
      const u=i/7,v=(i+1)/7;
      const z0=67+(53.1-67)*u,z1=67+(53.1-67)*v,y0=startHeight+(targetHeight-startHeight)*u-base,y1=startHeight+(targetHeight-startHeight)*v-base;
      const a=buSertPoint(84.4,z0),b=buSertPoint(89.6,z0),c=buSertPoint(84.4,z1),d=buSertPoint(89.6,z1);
      ramp.push(a[0],y0,a[1],b[0],y0,b[1],c[0],y1,c[1],b[0],y0,b[1],d[0],y1,d[1],c[0],y1,c[1]);
    }
    const rampGeo=new BufferGeometry();rampGeo.setAttribute('position',new Float32BufferAttribute(ramp,3));rampGeo.computeVertexNormals();put('paving',rampGeo,0,0,0,0,true);
    // A short, level landing reaches the glass face without a final high step.
    const landing=new PlaneGeometry(5.2,.7);landing.rotateX(-Math.PI/2);put('paving',landing,entrance[0],.16,entrance[1],BU_SERT_FRAME.yaw,true);
    if(options.signage!==false&&typeof document!=='undefined'){
      // Actual raised building name on the concrete band, without the old
      // invented combined GSU/Mugar plaque. Letter dimensions are estimated.
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=64;
      const ctx=canvas.getContext('2d');if(ctx){
        ctx.fillStyle='#e2e2db';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='500 43px Georgia, serif';ctx.fillText('GEORGE SHERMAN UNION',512,34,1000);
        const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;
        const letters=new Mesh(new PlaneGeometry(6.9,.43125),new MeshStandardMaterial({map:texture,transparent:true,alphaTest:.15,roughness:.65,metalness:.3,depthWrite:false}));
        const at=buSertPoint(linkEntry.local[0],linkEntry.local[1]+.315);letters.position.set(at[0],base+4.13,at[1]);letters.rotation.y=BU_SERT_FRAME.yaw;
        letters.name='BU entrance · GEORGE SHERMAN UNION';group.add(letters);
      }
    }
    for(const [label,x,z,width,y] of [['SUMNER M. REDSTONE BUILDING',66,65.75,15,4.2],['ROBERT T. BUTLER ATRIUM',87,53.1,7,3.7]] as const){
      const at=buSertPoint(x,z);nameplate({x:at[0],z:at[1],yaw:BU_SERT_FRAME.yaw},label,width,y);
    }
  };
  const openGarage=(b:Building,points:Point[])=>{
    const levels=Math.max(2,Math.round(b.height/3.3)),dy=b.height/levels;solid(points,0,.28,'concrete');
    for(let floor=1;floor<=levels;floor++){
      solid(points,floor*dy-.22,.26,'concrete');
      for(let i=0;i<points.length;i++){
        const a=points[i],c=points[(i+1)%points.length],p=edge(a,c),w=Math.hypot(c[0]-a[0],c[1]-a[1]);box('stone',p,0,floor*dy+.48,0,w,.78,.38);
        for(let x=-w/2+1.3;x<w/2;x+=6.2)box('concrete',p,x,floor*dy-dy/2,-.6,.58,dy,1.2);
        if(floor<levels)panel('shade',p,0,floor*dy+dy/2,-3,w,dy-1);
      }
    }
    const p={x:b.x,z:b.z+b.depth/2+.3,yaw:b.yaw};nameplate(p,'P · UNIVERSITY PARKING',12,3.4);
  };

  // A podium must remain low; raising an entire GIS outline to the maximum
  // roof elevation would erase the characteristic skyline of these complexes.
  const warrenStreetfront=(p:Placement,width:number,podium:number)=>{
    // BU/MDS 2024 EPNF, existing-condition photograph 1-3 (PDF p23),
    // ground plan 2-2 (p38) and north elevation 3-10 (p64). The front is
    // retail + a tall recessed entrance, NOT three continuous parking grids.
    // Source proportions are scaled onto the unchanged GIS north edge;
    // opening widths, frame sections and canopy radius are photo estimates.
    // The future replacement storefront/canopy is deliberately not modeled.
    const entryX=width*(.5-.551),entryWidth=12.5,entryTop=9.5,retailTop=3.4,retailBottom=.18;
    const openings:Opening[]=[{x:entryX,y:retailBottom,width:entryWidth,height:entryTop-retailBottom,door:true}];
    const stores:Opening[]=[];
    // Unequal shop groups follow the drawing, separated by solid service
    // stretches beneath the tower ends. Do not label an unverified tenant.
    for(const [a,b] of [[.012,.095],[.224,.368],[.600,.650],[.777,.985]]){
      const shopWidth=(b-a)*width,columns=Math.max(1,Math.round(shopWidth/5.4)),bay=shopWidth/columns;
      for(let i=0;i<columns;i++)stores.push({x:width*(.5-a)-(i+.5)*bay,y:retailBottom,width:bay-.32,height:retailTop-retailBottom});
    }
    const vents:Opening[]=[];
    for(const [a,b] of [[.015,.095],[.225,.368],[.60,.65],[.778,.98]]){
      const count=Math.max(1,Math.round((b-a)*width/4.6));
      for(let i=0;i<count;i++)vents.push({x:width*(.5-a)-(i+.5)*(b-a)*width/count,y:6.6,width:1.75,height:2.55});
    }
    openings.push(...stores,...vents);
    const face=new Shape();face.moveTo(-width/2,.16);face.lineTo(width/2,.16);face.lineTo(width/2,10.35);face.lineTo(-width/2,10.35);face.closePath();
    for(const opening of openings){const hole=new Path();openingShape(opening,hole);face.holes.push(hole);}
    const wallAt=local(p,0,-.58);put('brickBuff',new ExtrudeGeometry(face,{depth:.58,steps:1,bevelEnabled:false,curveSegments:1}),wallAt[0],0,wallAt[1],p.yaw);
    for(const o of stores){
      panel('frontageGlassDark',p,o.x,(o.y+retailTop)/2,-.43,o.width,o.height);
      for(const side of [-1,1])box('frame',p,o.x+side*o.width/2,(o.y+retailTop)/2,-.33,.085,o.height,.14);
      box('frame',p,o.x,2.62,-.32,o.width,.085,.16);
      box('frame',p,o.x,o.y+.045,-.32,o.width,.09,.16);
      // Narrow paired entrance leaves within the shop opening, with genuine
      // frame depth. The closed surveyed wall collision remains unchanged.
      for(const dx of [-.95,0,.95])box('frame',p,o.x+dx,1.40,-.32,.075,2.45,.16);
      for(const dx of [-.12,.12])box('metal',p,o.x+dx,1.18,-.20,.035,.42,.10);
    }
    for(const o of vents){
      panel('shade',p,o.x,o.y+o.height/2,-.49,o.width,o.height);
      box('stone',p,o.x,o.y-.07,-.08,o.width+.16,.14,.52);
      // Small open ventilation grilles, not enormous black ribbon windows.
      for(let col=0;col<5;col++)box('concrete',p,o.x-o.width/2+(col+.5)*o.width/5,o.y+o.height/2,-.20,.065,o.height,.18);
      for(let row=1;row<5;row++)box('concrete',p,o.x,o.y+row*o.height/5,-.19,o.width,.065,.18);
    }
    // Four doors and two sidelights sit behind a deep masonry reveal. The
    // tall glazing above them is open through the wall, not a pane on brick.
    panel('frontageGlass',p,entryX,(retailBottom+entryTop)/2,-.65,entryWidth,entryTop-retailBottom);
    for(const side of [-1,1])box('stone',p,entryX+side*(entryWidth/2+.13),entryTop/2,.015,.26,entryTop,.67);
    box('stone',p,entryX,entryTop+.14,.015,entryWidth+.52,.28,.67);
    const leaf=1.25,doorSpan=4*leaf,doorBottom=.2,doorTop=2.65;
    for(let i=0;i<4;i++){
      const x=entryX+(i-1.5)*leaf;
      for(const side of [-1,1])box('metal',p,x+side*(leaf-.085)/2,(doorBottom+doorTop)/2,-.52,.085,doorTop-doorBottom,.17);
      for(const y of [doorBottom+.09,.86,doorTop-.045])box('metal',p,x,y,-.51,leaf,.09,.19);
      const handleX=x+(i%2===0?1:-1)*.43;
      box('metal',p,handleX,1.26,-.365,.035,.42,.13);
    }
    for(const x of [-entryWidth/2,-doorSpan/2,doorSpan/2,entryWidth/2])box('metal',p,entryX+x,1.45,-.53,.11,2.55,.22);
    for(let i=0;i<=6;i++)box('metal',p,entryX-entryWidth/2+i*entryWidth/6,(2.95+entryTop)/2,-.54,.09,entryTop-2.95,.20);
    for(const y of [2.84,5.42,7.55])box('metal',p,entryX,y,-.53,entryWidth,y===2.84?.28:.075,.24);
    box('stone',p,entryX,.10,-.13,entryWidth,.20,1.02,true);
    const sign=local(p,entryX,-.38);nameplate({x:sign[0],z:sign[1],yaw:p.yaw},'Warren Towers',5.7,2.84);
    // Retained blue-green curved canopy: split around the taller entrance.
    // Twelve cross-section strips (six on mobile) preserve the curved profile.
    // Mobile omits alternate narrow ribs, not the rain shelter or entry. The
    // thin glazed sheet uses a double-sided material, with real
    // ribs; duplicated coplanar faces would cancel their vertex normals.
    for(const [left,right] of [[-width/2,entryX-entryWidth/2-.22],[entryX+entryWidth/2+.22,width/2]]){
      const span=right-left,mid=(left+right)/2,segments=options.detail==='mobile'?6:12;
      const curve=(t:number)=>({z:2.65*Math.sin(t*Math.PI/2),y:3.53+2.12*Math.cos(t*Math.PI/2)});
      for(let i=0;i<segments;i++){
        const a=curve(i/segments),b=curve((i+1)/segments),vertices:number[]=[];
        for(const x of [left,right])vertices.push(x,a.y,a.z,x,b.y,b.z);
        const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(vertices,3));geo.setIndex([0,1,2,2,1,3]);
        // Analytic ellipse normals keep the thin roof smooth across strips,
        // including the bounded six-strip phone profile.
        const normals:number[]=[];for(let side=0;side<2;side++)for(const t of [i/segments,(i+1)/segments]){
          const ny=2.65*Math.cos(t*Math.PI/2),nz=2.12*Math.sin(t*Math.PI/2),length=Math.hypot(ny,nz);normals.push(0,ny/length,nz/length);
        }geo.setAttribute('normal',new Float32BufferAttribute(normals,3));
        put('warrenCanopy',geo,p.x,0,p.z,p.yaw);
        const ribCount=Math.ceil(span/(options.detail==='mobile'?6.3:3.15));
        for(let rib=0;rib<=ribCount;rib++){
          const g=new BoxGeometry(.055,Math.hypot(b.y-a.y,b.z-a.z),.07);g.rotateX(Math.atan2(b.z-a.z,b.y-a.y));
          const at=local(p,left+span*rib/ribCount,(a.z+b.z)/2);put('metal',g,at[0],(a.y+b.y)/2,at[1],p.yaw);
        }
      }
      box('metal',p,mid,3.53,2.65,span,.105,.13);
    }
    // The fourth-floor common-area ribbon is a separate band above the
    // retained masonry/vents, not another dormitory wall on the sidewalk.
    const upper=podium-10.35;
    structuralGrid(p,width,10.35,upper,1,3.3,'brickBuff');
    group.userData.warrenStreetfront={p,width,entryX,entryWidth,entryTop,stores,vents};
  };
  const warren=(b:Building,points:Point[])=>{
    const podium=Math.min(14.2,b.height*.24),parking=podium*.72;
    // The three lower podium floors are parking, with a long fourth-floor
    // student/dining level. They should not read as four more dormitory floors.
    eachFacade(points,(p,width)=>{
      if(width>b.width*.9&&p.z<b.z){warrenStreetfront(p,width,podium);return;}
      structuralGrid(p,width,0,parking,3,5.5,'concrete');
      for(let row=0;row<3;row++)panel('shade',p,0,(row+.68)*parking/3,-.255,width-.4,parking/3*.55);
      facade(p,width,parking,podium-parking,{finish:'brickBuff',levels:1,spacing:3.25,windowWidth:2.3,windowHeight:2.25});
    });
    roof(points,podium);
    parapet(points,podium,'concrete',.55);
    const long=b.width>=b.depth,p:Placement=long?b:{x:b.x,z:b.z,yaw:b.yaw+Math.PI/2};
    const width=long?b.width:b.depth,depth=long?b.depth:b.width;
    const section=BU_WARREN_TOWER_SECTION,towerRecords=[];
    for(const tower of BU_WARREN_TOWERS){
      const x=tower.centreFraction*width,tw=width*section.widthFraction,td=depth*section.depthFraction,tp=clipTower(points,p,x,0,tw,td);
      if(tp.length<3)continue;
      const h=b.height-podium,floor=h/section.levels;
      eachFacade(tp,(face,span)=>{
        if(span<.1)return;
        // Long east/west sides have repeated vertical glazing; the short
        // north/south ends are solid tan brick around ONE central window band.
        // Openings cut through the solid wall in both desktop and mobile.
        const across=Math.abs(Math.cos(face.yaw-p.yaw))>.8;
        if(span<3.8){box('brickBuff',face,0,podium+h/2,-section.wallDepth/2,span,h,section.wallDepth);return;}
        const count=across?1:section.sideBands,openingWidth=across?section.endWindowWidth:section.sideWindowWidth;
        const spacing=(span-.8)/count,centres=Array.from({length:count},(_,i)=>(i-(count-1)/2)*spacing);
        const wall=new Shape();wall.moveTo(-span/2,0);wall.lineTo(span/2,0);wall.lineTo(span/2,h);wall.lineTo(-span/2,h);wall.closePath();
        for(const cx of centres){const hole=new Path();openingShape({x:cx,y:.12,width:openingWidth,height:h-.28},hole);wall.holes.push(hole);}
        const at=local(face,0,-section.wallDepth);
        put('brickBuff',new ExtrudeGeometry(wall,{depth:section.wallDepth,steps:1,bevelEnabled:false,curveSegments:1}),at[0],podium,at[1],face.yaw);
        for(const cx of centres){
          for(const side of [-1,1]){
            // Original concrete reveals project past the wall; the new
            // composite-metal fins proposed in the EPNF are not reproduced.
            box('concrete',face,cx+side*(openingWidth/2+.08),podium+h/2,-.02,.16,h,.65);
            box('frame',face,cx+side*(openingWidth/2-.04),podium+h/2,-.24,.07,h-.28,.13);
          }
          for(let row=0;row<section.levels;row++){
            const y=podium+row*floor,glassHeight=floor-section.spandrelHeight-.13;
            panel('frontageGlass',face,cx,y+section.spandrelHeight+glassHeight/2,section.glazingDepth,openingWidth-.12,glassHeight);
            panel('shade',face,cx,y+section.spandrelHeight/2,-.30,openingWidth-.10,section.spandrelHeight);
            box('concrete',face,cx,y+.075,.04,openingWidth+.16,.15,.57);
            if(options.detail==='mobile'){
              panel('frame',face,cx,y+section.spandrelHeight+glassHeight/2,-.225,.065,glassHeight);
              panel('frame',face,cx,y+section.spandrelHeight+glassHeight*.34,-.225,openingWidth-.12,.065);
            }else{
              box('frame',face,cx,y+section.spandrelHeight+glassHeight/2,-.225,.065,glassHeight,.12);
              box('frame',face,cx,y+section.spandrelHeight+glassHeight*.34,-.225,openingWidth-.12,.065,.12);
            }
          }
        }
      });
      roof(tp,b.height);
      parapet(tp,b.height,'concrete',.9);const at=local(p,x,0);equipment({...b,x:at[0],z:at[1],width:tw,depth:td,yaw:p.yaw},tp,b.height);
      towerRecords.push({id:tower.id,centre:at,width:tw,depth:td,footprint:tp,bottom:podium,top:b.height});
    }
    group.userData.warrenTowers={version:2,source:'BU/MDS 2024 EPNF Figures 1-2, 1-3, 2-4; existing envelope only',towers:towerRecords};
  };
  const studentVillage=(b:Building,points:Point[],second:boolean)=>{
    const base=second?7.8:Math.min(29,b.height*.51),profile:Profile={finish:'brick',levels:second?2:9,spacing:3.4,windowWidth:2.3,windowHeight:1.9,bands:true};skin(points,0,base,profile);parapet(points,base,'stone',.4);
    // Position the split towers within the surveyed complex. Their heights
    // follow BU's documented 26/19 and 18/15 storey silhouettes.
    const long=b.width>=b.depth,p:Placement=long?b:{x:b.x,z:b.z,yaw:b.yaw+Math.PI/2},width=long?b.width:b.depth,depth=long?b.depth:b.width;
    for(const side of [-1,1]){
      const x=side*width*.245,w=width*.41,d=depth*.82,at=local(p,x,0),other=local(p,-x,0),higher=second?at[1]<other[1]:at[0]<other[0];
      const top=higher?b.height:b.height*(second?19/26:15/18),tp=clipTower(points,p,x,0,w,d);
      if(tp.length<3)continue;
      skin(tp,base,top-base,{finish:'brick',levels:Math.max(1,Math.round((top-base)/3.15)),spacing:3.45,windowWidth:2.25,windowHeight:1.85,bands:true},false);
      parapet(tp,top,'stone',.8);
      // Narrow, pale vertical bays and a glazed upper lounge distinguish the
      // residences from the darker, regular West Campus dormitory slabs.
      for(const s of [-1,1])box('stone',p,x+s*w*.31,base+(top-base)/2,s*d*.04,1.2,top-base,d+.2);
      for(const s of [-1,1]){
        const at=local(p,x,s*(d/2+.02)),face={x:at[0],z:at[1],yaw:p.yaw+(s<0?Math.PI:0)};
        panel('glassLight',face,0,top-1.65,.035,w*.71,2.25);
      }
    }
    entrancePlate(b,points);
  };
  const law=(b:Building,points:Point[])=>{
    // Separate GIS records can already be the narrow tower itself. Only large
    // combined parcels receive a lower Redstone/Pappas wing beneath the tower.
    const wide=b.width*b.depth>2200,base=wide?Math.min(20,b.height*.3):0;
    if(wide)skin(points,0,base,{finish:'concrete',levels:5,spacing:3.4,windowWidth:2.7,windowHeight:2.7,curtain:true});
    const tp=wide?clipTower(points,b,0,-b.depth*.17,Math.min(45,b.width*.72),Math.min(20,b.depth*.39)):points;
    if(tp.length<3)return;
    const height=b.height-base,stories=17-(wide?5:0),dy=height/stories;
    // PNF §4.3.1 / figs 3-11, 3-13 identify solid circulation planes,
    // recessed two-storey base, articulated window fields and a blind crown.
    // Those 2012 renovation drawings establish the hierarchy, not an as-built
    // count of today's windows. Retain the inherited floor rhythm and surveyed
    // roof height; ratios below are explicitly modelled facade proportions.
    const lobby=base+dy*2,crown=b.height-dy*1.65,shoulder=base+dy*6.5;
    const windowField=(p:Placement,width:number,bottom:number,top:number,rows:number,recess=-.54)=>{
      if(top<=bottom||width<.2)return;
      const h=top-bottom,cols=Math.max(1,Math.round(width/3.35)),dx=width/cols,step=h/rows;
      panel('glassDark',p,0,bottom+h/2,recess-.04,width,h);
      for(let row=0;row<rows;row++){
        const y=bottom+row*step,spandrel=step*.27;
        if(options.detail==='mobile')panel('concrete',p,0,y+spandrel/2,-.07,width,spandrel);
        else box('concrete',p,0,y+spandrel/2,-.28,width,spandrel,.48);
        for(let col=0;col<cols;col++){
          const x=-width/2+(col+.5)*dx,w=dx-.25;
          panel('glass',p,x,y+step*.64,recess,w,step*.67);
          // Opaque ventilation leaves and steel mullions are part of Sert's
          // original window system. Keep their variation consistent per bay.
          panel('metal',p,x+w*.34,y+step*.64,recess+.015,w*.23,step*.67);
          panel('frame',p,x+w*.22,y+step*.64,recess+.035,.055,step*.67);
          panel('frame',p,x,y+step*.55,recess+.035,w,.055);
        }
      }
      for(let col=0;col<=cols;col++)box('concrete',p,-width/2+col*dx,bottom+h/2,-.13,.23,h,.78);
      box('concrete',p,0,top-.09,-.16,width,.18,.72);
    };
    eachFacade(tp,(p,width)=>{
      const here=buSertLocal([p.x,p.z]),out=buSertLocal(local(p,0,1));
      const end=Math.abs(out[1]-here[1])>Math.abs(out[0]-here[0]);
      if(width<4.25){
        // Small survey returns are the re-entrant concrete service/core
        // walls, not another seventeen-storey ribbon of tiny windows.
        box('concrete',p,0,base+height/2,-.16,width,height,.32);return;
      }
      const left=end?1.45:.72,right=end?.75:.42,fieldWidth=width-left-right;
      const at=local(p,(left-right)/2,0),field={x:at[0],z:at[1],yaw:p.yaw};
      // Continuous asymmetric concrete flanks frame the set-back glazing.
      box('concrete',p,-width/2+left/2,base+height/2,-.12,left,height,.50);
      box('concrete',p,width/2-right/2,base+height/2,-.12,right,height,.50);
      windowField(field,fieldWidth,base+.16,lobby,2,-.78);
      box('concrete',field,0,lobby-.16,-.05,fieldWidth,.32,1.15);
      windowField(field,fieldWidth,lobby,base+dy*4,2);
      if(end&&out[1]>here[1]){
        // The solid intermediate panel on the narrow end separates the
        // low neighbouring volumes from the upper faculty window field.
        box('concrete',field,0,(base+dy*4+shoulder)/2,-.38,fieldWidth,shoulder-(base+dy*4),.36);
        for(const side of [-1,1])box('concrete',field,side*(fieldWidth/2-.23),(base+dy*4+shoulder)/2,-.05,.18,shoulder-(base+dy*4),.84);
      }else windowField(field,fieldWidth,base+dy*4,shoulder,2,-.72);
      windowField(field,fieldWidth,shoulder,crown-dy*.88,8);
      windowField(field,fieldWidth,crown-dy*.88,crown,1,-.68);
      box('concrete',p,0,(crown+b.height)/2,-.17,width,b.height-crown,.34);
      box('concrete',p,0,b.height-.13,-.2,width,.26,.4);
    });
    roof(tp,b.height);
    // No generic rooftop HVAC or decorative sunhoods: the PNF explicitly
    // records the original south brise-soleil as removed before renovation.
    // The blind upper walls already close the crown at the source roof datum.
    entrancePlate(b,points);
  };
  const arena=(b:Building,points:Point[],fitness:boolean)=>{
    const podium=Math.max(7,b.height*.43);
    skin(points,0,podium,{finish:'brick',levels:1,spacing:6.6,windowWidth:4.7,windowHeight:Math.min(7.2,podium-1),bands:false});
    if(fitness){
      skin(points,podium,b.height-podium,{finish:'stone',levels:2,spacing:3.8,windowWidth:3.2,windowHeight:5,curtain:true},false);parapet(points,b.height,'metal',.5);
    }else{
      // The arena's broad upper enclosure has only clerestory glazing, rather
      // than dormitory windows. Roof seams remain broad enough not to shimmer.
      for(let i=0;i<points.length;i++){
        const a=points[i],c=points[(i+1)%points.length],p=edge(a,c),w=Math.hypot(c[0]-a[0],c[1]-a[1]);
        const commAve=b.id==='agganis'&&p.z>b.z&&Math.cos(p.yaw)>.25;
        box(commAve?'brick':'metal',p,0,podium+(b.height-podium)/2,-.08,w,b.height-podium,.38);
        panel('glassDark',p,0,b.height-2,.14,w,1.45);
        for(let x=-w/2+2;x<w/2;x+=5.5)box('stone',p,x,podium+(b.height-podium)/2,.2,.27,b.height-podium,.53);
      }
      roof(points,b.height,'metal');parapet(points,b.height,'metal',.25);
      const ribCount=Math.floor(b.width/8);for(let i=0;i<=ribCount;i++){
        const x=(i-ribCount/2)*8,a=local(b,x,-b.depth*.42),c=local(b,x,b.depth*.42);
        if(inside(a[0],a[1],points)&&inside(c[0],c[1],points))box('trim',b,x,b.height+.18,0,.16,.24,b.depth*.84);
      }
    }
    if(b.id==='agganis'||fitness){
      eachFacade(points,(p,width)=>{
        if(p.z<b.z||Math.cos(p.yaw)<.25||width<3)return;
        // Public south elevations are large glazed lobbies/gym walls, while
        // the arena bowl stays opaque. The surveyed rounded street frontage
        // itself supplies the curve; no circular annex is invented outside it.
        const at=local(p,0,.44),front={x:at[0],z:at[1],yaw:p.yaw},height=fitness?b.height-2.5:podium-1.0;
        structuralGrid(front,width,.7,height,fitness?2:1,fitness?4.2:4.8,'metal');
        box('stone',p,0,.45,.16,width,.9,.58);
        box('metal',p,0,height+.9,.37,width,.25,1.0);
        if(fitness)for(let y=height*.55;y<height;y+=.55)panel('trim',front,0,y,.10,width,.035);
        if(width>20){
          box('metal',p,0,4.5,.8,Math.min(15,width*.6),.18,1.7);
          for(const x of [-5.5,5.5])if(Math.abs(x)<width/2-.7)box('metal',p,x,2.25,.85,.12,4.5,.12);
        }
      });
    }
    entrancePlate(b,points);
  };

  const sportsField=(space:{name:string;x:number;z:number;width:number;depth:number;yaw:number;kind:string})=>{
    const nickerson=/nickerson/i.test(space.name),hockey=/hockey|new balance/i.test(space.kind+' '+space.name),softball=space.kind==='softball';
    if(!nickerson&&!hockey&&!softball)return;
    const p:Placement={x:space.x,z:space.z,yaw:space.yaw+(space.width<space.depth?Math.PI/2:0)};
    const length=nickerson?106.0704:91.4,width=nickerson?65.8368:55;
    cell=`${Math.floor(p.x/CELL)}:${Math.floor(p.z/CELL)}`;base=buElevation(p.x,p.z);sportsGroundBase=base;footprintReference=undefined;courtyardRings=[];
    if(softball){
      // Approximate outdoor softball diamond fitted inside the mapped play
      // area. The brown infield, bases and curved warning track make this
      // distinct from another rectangular soccer pitch.
      box('grass',p,0,.04,0,space.width,.08,space.depth,true);
      const home:Point=[0,space.depth*.32],radius=Math.min(space.width*.69,space.depth*.69);
      const fan:Point[]=[home];for(let i=0;i<=40;i++){const a=-Math.PI*.75+i*Math.PI*.5/40;fan.push([home[0]+Math.cos(a)*radius,home[1]+Math.sin(a)*radius]);}
      const shape=new Shape();fan.forEach((v,i)=>i?shape.lineTo(v[0],-v[1]):shape.moveTo(v[0],-v[1]));shape.closePath();
      const geo=new ShapeGeometry(shape);geo.rotateX(-Math.PI/2);put('turf',geo,p.x,.085,p.z,p.yaw,true);
      const dirt=new Shape(),infieldRadius=25;dirt.moveTo(0,-home[1]);for(let i=0;i<=32;i++){const a=-Math.PI*.75+i*Math.PI*.5/32;dirt.lineTo(Math.cos(a)*infieldRadius,-(home[1]+Math.sin(a)*infieldRadius));}dirt.closePath();const dirtGeo=new ShapeGeometry(dirt);dirtGeo.rotateX(-Math.PI/2);put('brick',dirtGeo,p.x,.094,p.z,p.yaw,true);
      const baseSpacing=18.29,diagonal=baseSpacing/Math.sqrt(2);
      for(const [x,z] of [[0,home[1]],[diagonal,home[1]-diagonal],[0,home[1]-2*diagonal],[-diagonal,home[1]-diagonal]])box('white',p,x,.112,z,.43,.035,.43,true);
      box('white',p,0,.113,home[1]-13.1,.61,.03,.15,true);
      for(const side of [-1,1]){
        const yaw=p.yaw-side*Math.PI/4,at=local(p,side*radius*.35355,home[1]-radius*.35355);put('white',new BoxGeometry(.1,.012,radius),at[0],.115,at[1],yaw,true);
      }
      for(let i=0;i<=8;i++){const a=-Math.PI*.75+i*Math.PI*.5/8,at=local(p,Math.cos(a)*(radius+1),home[1]+Math.sin(a)*(radius+1));put('metal',new CylinderGeometry(.055,.055,2.2,6),at[0],1.1,at[1]);}
      for(const side of [-1,1]){box('concrete',p,side*22,.28,home[1]-5,9,.56,3.3);box('roof',p,side*22,2.6,home[1]-5,10,.15,4);for(const x of [-4,4])box('metal',p,side*22+x,1.45,home[1]-5,.13,2.5,.13);}
      return;
    }
    if(hockey){
      // New Balance Field is the roof of Langsam Garage. The parking enclosure
      // stays open, and a 32 m long ramp is part of the actual walking ground.
      // Its 4 m deck height and ramp geometry are authored estimates.
      const deck=4,halfX=space.width/2,halfZ=space.depth/2,rampLength=32,rampWidth=7,rampEnd=-halfX+rampLength;
      box('paving',p,0,.025,0,space.width,.05,space.depth,true);
      // Split the slab around the ramp so the downward ground query does not
      // accidentally hit an invisible deck over the start of the slope.
      box('concrete',p,0,deck-.17,-rampWidth/2,space.width,.34,space.depth-rampWidth,true);
      box('concrete',p,rampLength/2,deck-.17,halfZ-rampWidth/2,space.width-rampLength,.34,rampWidth,true);
      const ramp=new BufferGeometry();ramp.setAttribute('position',new Float32BufferAttribute([
        -halfX,.06,halfZ-rampWidth,-halfX,.06,halfZ,rampEnd,deck,halfZ,
        -halfX,.06,halfZ-rampWidth,rampEnd,deck,halfZ,rampEnd,deck,halfZ-rampWidth,
      ],3));ramp.computeVertexNormals();put('paving',ramp,p.x,0,p.z,p.yaw,true);
      for(let x=-halfX+6;x<halfX;x+=16)for(let z=-halfZ+6;z<halfZ;z+=13){
        if(x<rampEnd+2&&z>halfZ-rampWidth-2)continue;
        box('concrete',p,x,1.82,z,.65,3.64,.65);collider('Langsam Garage support',rectangle(p,x,z,.65,.65),3.64);
      }
      for(const side of [-1,1]){
        box('concrete',p,0,3.48,side*(halfZ-.15),space.width,.40,.48);
        for(let x=-halfX+7;x<halfX-2;x+=3)box('white',p,x,.065,side*(halfZ-7),.09,.015,4.8,true);
      }
      // Shallow opaque strips, widely spaced piers and recessed parked cars
      // leave the long open parking level legible from Babcock Street.
      for(const x of [-halfX+9,-halfX+27,halfX-12])for(const z of [-halfZ+7,halfZ-9]){
        if(x<rampEnd&&z>halfZ-12)continue;box('shade',p,x,.69,z,1.85,1.25,4.35);box('glassDark',p,x,1.35,z-.35,1.68,.45,2.35);
      }
      for(let i=0;i<=8;i++){
        const x=-halfX+i*rampLength/8,y=.06+(deck-.06)*i/8;
        for(const z of [halfZ-rampWidth+.12,halfZ-.12])box('metal',p,x,y+.52,z,.065,1.04,.065);
      }
      const rampSlope=Math.atan2(deck-.06,rampLength),rail=new BoxGeometry(Math.hypot(rampLength,deck-.06),.065,.065);rail.rotateZ(rampSlope);
      for(const z of [halfZ-rampWidth+.12,halfZ-.12]){const at=local(p,-halfX+rampLength/2,z);put('metal',rail.clone(),at[0],deck/2+1,at[1],p.yaw);}rail.dispose();
      const sign=local(p,0,halfZ+.05);nameplate({x:sign[0],z:sign[1],yaw:p.yaw},'LANGSAM GARAGE · NEW BALANCE FIELD',19,2.9);
      base+=deck;
      for(const side of [-1,1]){
        box('metal',p,0,1.05,side*(halfZ-.10),space.width,.07,.07);
        for(let x=-halfX+1;x<halfX;x+=5)box('metal',p,x,.55,side*(halfZ-.1),.065,1.1,.065);
      }
      box('metal',p,halfX-.1,1.05,0,.07,.07,space.depth);
      // The lower west edge deliberately opens at the ramp entrance.
      box('metal',p,-halfX+.1,1.05,-rampWidth/2,.07,.07,space.depth-rampWidth);
    }
    box('paving',p,0,.025,0,length+12,.05,width+14,true);
    box('turf',p,0,.065,0,length+5,.06,width+5,true);
    // Regulation soccer lines are drawn to BU Athletics' published dimensions;
    // no giant decorative emblem obscures the playable surface.
    const marking=(x:number,z:number,w:number,d:number)=>box('white',p,x,.102,z,w,.012,d,true);
    for(const side of [-1,1]){marking(side*length/2,0,.12,width);marking(0,side*width/2,length,.12);}marking(0,0,.12,width);
    const ring=(x:number,z:number,r:number)=>{
      for(let i=0;i<60;i++){
        const a=i*Math.PI/30,c=(i+1)*Math.PI/30,dx=r*(Math.cos(c)-Math.cos(a)),dz=r*(Math.sin(c)-Math.sin(a));
        const at=local(p,x+r*(Math.cos(a)+Math.cos(c))/2,z+r*(Math.sin(a)+Math.sin(c))/2);
        put('white',new BoxGeometry(Math.hypot(dx,dz),.012,.115),at[0],.102,at[1],p.yaw-Math.atan2(dz,dx),true);
      }
    };
    if(nickerson){
      ring(0,0,9.15);
      for(const side of [-1,1]){
        marking(side*(length/2-16.5),0,.12,40.32);for(const z of [-20.16,20.16])marking(side*(length/2-8.25),z,16.5,.12);
        marking(side*(length/2-5.5),0,.12,18.32);for(const z of [-9.16,9.16])marking(side*(length/2-2.75),z,5.5,.12);
        const goalX=side*(length/2+.1);
        for(const z of [-3.66,3.66])box('white',p,goalX,1.23,z,.11,2.44,.11);
        box('white',p,goalX,2.45,0,.11,.11,7.43);
        for(const z of [-3.66,3.66])box('frame',p,goalX+side*1.8,1.18,z,.06,2.30,.06);
        box('frame',p,goalX+side*1.8,2.30,0,.065,.065,7.36);
        for(let z=-3.6;z<=3.6;z+=.6)box('trim',p,goalX+side*1.8,1.15,z,.019,2.28,.019);
        for(let y=.3;y<=2.2;y+=.3)box('trim',p,goalX+side*1.8,y,0,.019,.019,7.25);
      }
    }
    // Nickerson retains a broad grandstand on its river side. Rows are stepped
    // geometry with seat strips and access aisles, not an opaque stadium block.
    if(nickerson){
      const side=-1,standDepth=15,standLength=102;
      for(let row=0;row<18;row++){
        const z=side*(width/2+8+row*.78),y=.15+row*.39;
        for(const segment of [-1,0,1]){
          const x=segment*34;box('concrete',p,x,y/2,z,31.3,y,.80);box('red',p,x,y+.18,z-.10,30.6,.16,.25);
          box('red',p,x,y+.42,z-.31,30.6,.39,.085);
        }
      }
      for(const x of [-51,-17,17,51]){
        for(let row=0;row<18;row++)box('stone',p,x,.15+row*.39,side*(width/2+8+row*.78),2.1,.14,.78);
        const top=local(p,x,side*(width/2+standDepth+7));put('metal',new CylinderGeometry(.055,.055,1.1,6),top[0],8,top[1]);
      }
      const back=side*(width/2+standDepth+7);box('concrete',p,0,7.9,back,standLength,.9,.3);
      const press={x:local(p,0,back-3)[0],z:local(p,0,back-3)[1],yaw:p.yaw};
      box('stone',press,0,9.4,0,20,3.4,6);box('roof',press,0,11.2,0,21,.28,6.8);panel('glassDark',press,0,9.8,3.04,18,1.5);
      const stand=rectangle(p,0,side*(width/2+15),standLength,16);collider('Nickerson Field grandstand',stand,11.4);
      const scoreboard=local(p,-length/2-5,0);nameplate({x:scoreboard[0],z:scoreboard[1],yaw:p.yaw+Math.PI/2},'BOSTON UNIVERSITY · NICKERSON FIELD',13,6.3);
    }
    for(const x of [-length/2,length/2])for(const z of [-width/2-6,width/2+6]){
      const at=local(p,x,z);put('metal',new CylinderGeometry(.13,.19,20,8),at[0],10,at[1]);
      box('metal',p,x,19.4,z,3.8,.15,.3);for(const dx of [-1.5,-.5,.5,1.5])box('white',p,x+dx,19.55,z,.65,.42,.5);
    }
  };

  for(const source of BU_FULL_BUILDINGS){
    const b=source as Building,points=normalize(b.footprint);
    if(b.custom||points.length<3||b.height<=0||options.buildingIds&&!options.buildingIds.has(b.id))continue;
    base=source.terrainReference?buElevation(...source.terrainReference.anchor):b.id==='law-tower'||b.id==='gsu-mugar'?buElevation(...BU_SERT_FOUNDATION_ANCHOR):b.id==='cas-east'?buElevation(...BU_MARSH_ASSEMBLY.foundationAnchor):buElevation(b.x,b.z);
    footprintReference=points;courtyardRings=(b.holes??[]).map(ring=>normalize(ring).reverse());
    cell=`${Math.floor(b.x/CELL)}:${Math.floor(b.z/CELL)}`;seed=b.id.split('').reduce((n,c)=>n+c.charCodeAt(0),0);
    const name=b.name.toLowerCase(),kind=b.kind.toLowerCase(),startTriangles=triangleCount;let family='academic';
    if(b.id!=='gsu-mugar'){
      const bottom=intersectsDEM(points)?foundation(points,kind==='brownstone'?'brownstone':'concrete'):0;
      collider(b.name,points,b.height-bottom,bottom);
    }
    if(b.id==='commonwealth-580'){family='580-commonwealth';group.userData.commonwealth580=buildBU580Commonwealth(b.footprint,{put});}
    else if(b.id==='commonwealth-560'){family='560-commonwealth';group.userData.commonwealth560=buildBU560Commonwealth(b.footprint,{put});}
    else if(b.id==='commonwealth-566'){family='566-commonwealth';group.userData.commonwealth566=buildBU566Commonwealth(b.footprint,{put});}
    else if(b.id==='warren-services'){family='warren-parking';openGarage(b,points);}
    else if(b.id==='warren-towers'){family='warren-three-towers';warren(b,points);}
    else if(/^stuvi-(south-tower|north-tower|north-core|north-connectors)$/.test(b.id)){family='stuvi-surveyed-tower';studentVillagePart(b,points);}
    else if(/stuvi.?2|33 harry|student village ii/.test(name)){family='stuvi-combined';studentVillage(b,points,true);}
    else if(/stuvi.?1|10 buick|student village i\b/.test(name)){family='stuvi-combined';studentVillage(b,points,false);}
    else if(/^(claflin|sleeper|rich)-hall$/.test(b.id)){family='west-residence';westResidence(b,points);}
    else if(b.id==='gsu-mugar'){family='sert-reviewed-assembly';sertComplex();}
    else if(kind==='law'||/law tower/.test(name)){family='sert-law';law(b,points);}
    else if(kind==='arena'||/agganis arena/.test(name)){family='arena';arena(b,points,false);}
    else if(kind==='fitrec'||/fitness|fitrec/.test(name)){family='fitness';arena(b,points,true);}
    else if(kind==='garage'||/parking garage|parking structure/.test(name)){family='garage';openGarage(b,points);}
    else if(kind==='brownstone'){family='brownstone';brownstone(b,points);}
    else civic(b,points);
    modeled.push({id:b.id,family,triangles:triangleCount-startTriangles});
  }
  if(options.includeSpaces!==false)for(const space of BU_FULL_SPACES)sportsField(space);

  const materials=new Map<string,MeshStandardMaterial>();
  const getMaterial=(finish:Finish,surface:boolean)=>{
    const key=finish+':'+surface;if(materials.has(key))return materials.get(key)!;
    if(finish==='frontageGlass'||finish==='frontageGlassLight'||finish==='frontageGlassDark'){
      const material=createBUFrontageGlazing({variant:finish==='frontageGlassDark'?'dark':finish==='frontageGlassLight'?'light':'clear',mobile:options.detail==='mobile'});
      materials.set(key,material);return material;
    }
    type OtherFinish=Exclude<Finish,'frontageGlass'|'frontageGlassLight'|'frontageGlassDark'>;
    const source:Record<OtherFinish,string>={brick:'brick',brickBuff:'brick',brickDark:'brick',brickRose:'brick',brownstone:'limestone',sandstone:'limestone',stone:'limestone',concrete:'concrete',trim:'trim',roof:'roof',metal:'frame',iron:'frame',glass:'glass',glassLight:'glass',glassDark:'glass',warrenCanopy:'glass',bankFascia:'frame',frame:'frame',wood:'entranceDoor',shade:'interiorShade',paving:'pavement',pavingBrick:'pavement',grass:'grass',turf:'grass',soil:'pavement',hedge:'grass',hedgeLight:'grass',white:'trim',red:'brick'};
    const colors:Record<OtherFinish,string>={brick:'#a9735e',brickBuff:'#b7a488',brickDark:'#835343',brickRose:'#b77b69',brownstone:'#97725c',sandstone:'#ba9d7d',stone:'#c7baa4',concrete:'#c4bba6',trim:'#ddd0b8',roof:'#657573',metal:'#8d9d9a',iron:'#303b35',glass:'#668b8d',glassLight:'#8daaa8',glassDark:'#395861',warrenCanopy:'#6597a6',bankFascia:'#76a6a1',frame:'#6f7773',wood:'#6d5140',shade:'#34423f',paving:'#bdb8a4',pavingBrick:'#a87e68',grass:'#7d9a62',turf:'#5b865b',soil:'#675644',hedge:'#526f49',hedgeLight:'#738654',white:'#e6dfc6',red:'#a6433d'};
    const material=createCampusSurface(source[finish],{profile:'bu',geometryFrame:true,...(finish==='paving'||finish==='pavingBrick'?{pavingStyle:finish==='pavingBrick'?'brick' as const:'stone' as const}:{})}) as MeshStandardMaterial;material.name=`BU district · ${finish}`;material.color=new Color(colors[finish]);
    if(finish==='iron'||finish==='warrenCanopy')material.side=DoubleSide;
    if(finish.startsWith('glass')){material.roughness=.55;material.metalness=.13;}if(surface)configureBUGroundLayer(material,finish==='white'?'marking':'surface');
    materials.set(key,material);return material;
  };
  for(const [key,batch] of batches){
    const geometry=mergeGeometries(batch.parts,false);batch.parts.forEach(g=>g.dispose());if(!geometry)throw new Error(`BU architecture batch ${key} failed`);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();const mesh=new Mesh(geometry,getMaterial(batch.finish,batch.surface));mesh.name=`BU district ${key}`;mesh.receiveShadow=true;mesh.castShadow=!batch.surface&&!/glass/i.test(batch.finish);group.add(mesh);shadowMeshes.push(mesh);if(batch.surface)ground.push(mesh);
  }
  group.userData.districtModels=modeled;group.updateMatrixWorld(true);
  return{group,ground,walls,trees,setQuality:(low:boolean)=>{for(const mesh of shadowMeshes)mesh.castShadow=!low&&!ground.includes(mesh)&&!/glass/i.test(mesh.name);}};
}
