import {BoxGeometry,BufferGeometry,ExtrudeGeometry,Path,PlaneGeometry,Shape} from 'three';

export type BU580Point=readonly[number,number];
type Finish='brick'|'stone'|'metal'|'frame'|'roof'|'concrete'|'frontageGlass'|'frontageGlassDark';
type Emitter={put:(finish:Finish,geometry:BufferGeometry,x:number,y:number,z:number,yaw?:number)=>void};
type Window={x:number;bottom:number;width:number;height:number};
/** Geometry inferred from the BU Housing exterior and published floor plans.
 * City 1374 measures the curved GROUND shop envelope. Its curved west edge is
 * not the eleven-storey facade. Keep the surveyed footprint and explicitly
 * separate the upper faceted bays; see 580-commonwealth/source-20261027.json.
 */
export const BU_580_SECTION={groundTop:3.8,apartmentPitch:3.1,regularFloors:9,metalFloorBottom:31.7,mainTop:35.357,cornerTop:37.05,wallDepth:.36,glassRecess:.27} as const;

const signedArea=(ring:readonly BU580Point[])=>ring.reduce((n,a,i)=>{const b=ring[(i+1)%ring.length];return n+a[0]*b[1]-b[0]*a[1];},0)/2;
const ringShape=(ring:readonly BU580Point[])=>{const shape=new Shape();ring.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();return shape;};

export function bu580UpperFootprints(ground:readonly BU580Point[]){
  if(ground.length!==60)throw new Error('580 Commonwealth requires the unchanged City 1374 ring');
  // The straight west wall and its mid-wall polygonal bay are read from the
  // 2–10 floor plan. Width is tied to unchanged GIS vertex 30, not a new box.
  const yaw=-.159,c=Math.cos(yaw),s=Math.sin(yaw),anchor=ground[30];
  const local=(p:BU580Point):BU580Point=>[(p[0]-anchor[0])*c-(p[1]-anchor[1])*s,(p[0]-anchor[0])*s+(p[1]-anchor[1])*c];
  const world=(x:number,z:number):BU580Point=>[anchor[0]+x*c+z*s,anchor[1]-x*s+z*c];
  const frontZ=local(ground[0])[1];
  const westBay=[world(0,-5.7),world(-1.5,-7.1),world(-1.5,-10.0),world(0,-11.4),world(0,frontZ+3.25),ground[57]];
  const upper=[...ground.slice(0,31),...westBay,...ground.slice(58)];
  // Floor 11's plan removes both north bay projections and the west middle
  // projection. The north-west corner unit remains polygonal and rises above
  // the adjoining metal-clad top floor in the official exterior photograph.
  const top=[ground[0],ground[2],ground[6],ground[8],ground[11],...ground.slice(12,31),world(0,frontZ+3.25),ground[57],...ground.slice(58)];
  const corner=[ground[0],world(2.7,frontZ+.05),world(2.7,frontZ+3.25),world(0,frontZ+3.25),ground[57],...ground.slice(58)];
  return{upper,top,corner};
}

export function buildBU580Commonwealth(ground:readonly BU580Point[],emit:Emitter){
  const {upper,top,corner}=bu580UpperFootprints(ground),S=BU_580_SECTION;
  const records:{kind:string;a:BU580Point;b:BU580Point;windows:Window[];bottom:number;top:number}[]=[];
  const slab=(ring:readonly BU580Point[],y:number,thickness=.2,finish:Finish='concrete')=>{
    const g=new ExtrudeGeometry(ringShape(ring),{depth:thickness,steps:1,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);emit.put(finish,g,0,y-thickness,0);
  };
  const face=(a:BU580Point,b:BU580Point,bottom:number,height:number,finish:Finish,windows:Window[],kind:string)=>{
    const width=Math.hypot(b[0]-a[0],b[1]-a[1]);if(width<.025)return;
    const yaw=Math.atan2(a[1]-b[1],b[0]-a[0]),c=Math.cos(yaw),s=Math.sin(yaw),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    const put=(f:Finish,g:BufferGeometry,lx:number,y:number,lz:number)=>emit.put(f,g,x+lx*c+lz*s,y,z-lx*s+lz*c,yaw);
    const box=(f:Finish,lx:number,y:number,lz:number,w:number,h:number,d:number)=>put(f,new BoxGeometry(w,h,d),lx,y,lz);
    const wall=new Shape();wall.moveTo(-width/2,0);wall.lineTo(width/2,0);wall.lineTo(width/2,height);wall.lineTo(-width/2,height);wall.closePath();
    for(const o of windows){const hole=new Path(),l=o.x-o.width/2,r=o.x+o.width/2;hole.moveTo(l,o.bottom);hole.lineTo(l,o.bottom+o.height);hole.lineTo(r,o.bottom+o.height);hole.lineTo(r,o.bottom);hole.closePath();wall.holes.push(hole);}
    put(finish,new ExtrudeGeometry(wall,{depth:S.wallDepth,steps:1,bevelEnabled:false,curveSegments:1}),0,bottom,-S.wallDepth);
    for(const o of windows){
      const y=bottom+o.bottom+o.height/2;
      // Real apertures, recessed reflective panes and physical frame returns.
      put('frontageGlass',new PlaneGeometry(o.width,o.height),o.x,y,-S.glassRecess);
      box('frame',o.x-o.width/2+.035,y,-.21,.07,o.height,.18);box('frame',o.x+o.width/2-.035,y,-.21,.07,o.height,.18);
      box('frame',o.x,y-o.height/2+.035,-.21,o.width,.07,.18);box('frame',o.x,y+o.height/2-.035,-.21,o.width,.07,.18);
      if(o.width>1.15)box('frame',o.x,y,-.19,.06,o.height,.15);
      if(kind!=='shop')box('frame',o.x,y+o.height*.17,-.18,o.width,.045,.14);
      if(kind==='brick')box('stone',o.x,y-o.height/2-.045,-.015,o.width+.15,.09,.4);
    }
    records.push({kind,a,b,windows,bottom,top:bottom+height});
  };
  const each=(ring:readonly BU580Point[],fn:(a:BU580Point,b:BU580Point,index:number)=>void)=>{
    // The GIS order is clockwise in world X/Z; reverse each edge so local +Z
    // points outside and all recesses extend into the occupied envelope.
    const reverse=signedArea(ring)>0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];fn(reverse?b:a,reverse?a:b,i);}
  };
  const northBayEdges=new Set([2,3,4,5,8,9,10]);
  const rowOpenings=(width:number,floors:number,pitch:number,bay:boolean,shop=false)=>{
    const columns=shop?Math.max(1,Math.round(width/3.0)):bay?1:Math.max(1,Math.round(width/4.15));
    const result:Window[]=[];if(width<.85)return result;
    const cell=width/columns;
    for(let row=0;row<floors;row++)for(let col=0;col<columns;col++)result.push({x:(col-(columns-1)/2)*cell,bottom:row*pitch+(shop?.28:bay?.3:.72),width:Math.min(cell-(bay?.18:.65),bay?3.6:shop?4.5:1.86),height:shop?3.05:bay?2.5:1.65});
    return result;
  };
  slab(ground,.05,.22);
  const groundFaces=ground.filter((_,i)=>i<34||i>55||(i-34)%3===0);
  each(groundFaces,(a,b,i)=>{
    const width=Math.hypot(b[0]-a[0],b[1]-a[1]);const shop=i>=31||i<=12;
    face(a,b,0,S.groundTop,shop?'stone':'brick',rowOpenings(width,1,S.groundTop,false,shop),shop?'shop':'ground-rear');
  });
  slab(ground,S.groundTop,.24,'stone');
  // Floors are closed structural slabs: glazing on opposite elevations must
  // not reveal sky or cast another facade's window grid through the building.
  for(let floor=0;floor<=S.regularFloors;floor++)slab(upper,S.groundTop+floor*S.apartmentPitch,.2);
  each(upper,(a,b,i)=>{
    const width=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const bay=northBayEdges.has(i)||i>=31&&i<=33||i>=35;
    face(a,b,S.groundTop,S.regularFloors*S.apartmentPitch,bay?'stone':'brick',rowOpenings(width,S.regularFloors,S.apartmentPitch,bay),bay?'bay':'brick');
    // Broad pale bands group pairs of storeys only on the observed projected
    // bays. They are not spread across the brick wall as generic striping.
    if(bay)for(let row=0;row<=S.regularFloors;row+=2)face(a,b,S.groundTop+row*S.apartmentPitch-.12,.42,'stone',[],'bay-band');
  });
  slab(top,S.metalFloorBottom,.22);
  each(top,(a,b)=>{
    const width=Math.hypot(b[0]-a[0],b[1]-a[1]);
    face(a,b,S.metalFloorBottom,S.mainTop-S.metalFloorBottom,'metal',rowOpenings(width,1,3.5,false),'metal-top');
    face(a,b,S.mainTop-.32,.32,'metal',[],'coping');
  });
  slab(top,S.mainTop,.2,'roof');
  // Corner cap is separately bounded by the retained octagonal corner unit.
  // Its extra 1.693 m is a photo estimate, not the official 116-foot datum.
  each(corner,(a,b)=>face(a,b,S.mainTop,S.cornerTop-S.mainTop,'metal',[],'corner-cap'));
  slab(corner,S.cornerTop,.18,'metal');
  return {source:'580-commonwealth/source-20261027.json',upperFootprint:upper,topFootprint:top,cornerFootprint:corner,facades:records,section:S};
}
