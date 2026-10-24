import {BU_OFFICIAL_ROAD_SEGMENTS} from './bu-road-data';
import {geoToWorld,type WorldPoint} from './geo-coordinates';

/** Core riverfront only. Road axes/widths are unchanged MassGIS/MassDOT records;
 * banks are MassDEP 1:25,000 hydrography polygon 14934, vertices 63–94.
 * Footbridge switchbacks and path offsets are authored interpretations of BU's
 * published pedestrian connections, not surveyed ramp or structural geometry.
 * See assets-source/charles-bu/river-core-2026.json for the source distinction. */
export const BU_CORE_SOUTH_BANK:WorldPoint[]=[
  [-71.1107362,42.3521928],[-71.1100967,42.3520922],[-71.1089865,42.3521014],
  [-71.1086936,42.3520779],[-71.1069519,42.3517315],[-71.106366,42.3516507],
  [-71.1056723,42.3516152],[-71.104377,42.3514982],[-71.103267,42.351473],
  [-71.1020791,42.3515848],[-71.1011688,42.3517088],[-71.1003977,42.3517072],
  [-71.0999044,42.351638],[-71.0993959,42.3515113],
  [-71.0989338,42.3513386],[-71.0985489,42.3511437],[-71.0983487,42.3510862],
  [-71.098071,42.3510627],[-71.0968991,42.3510491],[-71.0960043,42.3511725],
  [-71.0956497,42.3511949],[-71.0951408,42.3511824],[-71.0948479,42.3511364],
  [-71.0945702,42.3511354],[-71.09386,42.3513974],[-71.0936437,42.3515339],
  [-71.0934584,42.3516019],[-71.0927486,42.3517378],[-71.0921156,42.3519651],
  [-71.0911284,42.3520314],[-71.0904341,42.3521218],[-71.0898324,42.3521663],
].map(([lon,lat])=>geoToWorld(lat,lon));

function clipX(points:number[][],minX:number,maxX:number):WorldPoint[]{
  const result:WorldPoint[]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0];let lo=0,hi=1;
    if(Math.abs(dx)<1e-8){if(a[0]<minX||a[0]>maxX)continue;}
    else {const t0=(minX-a[0])/dx,t1=(maxX-a[0])/dx;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
    if(lo>hi)continue;
    const p:WorldPoint=[a[0]+dx*lo,a[1]+(b[1]-a[1])*lo],q:WorldPoint=[a[0]+dx*hi,a[1]+(b[1]-a[1])*hi];
    if(!result.length||Math.hypot(result.at(-1)![0]-p[0],result.at(-1)![1]-p[1])>.01)result.push(p);
    result.push(q);
  }return result;
}

// Main carriageways plus the recorded Bay State exit; no invented boulevard.
const sourceIds=new Set(['massgis-259583-0','massgis-254750-0','massgis-262420-0','massgis-301963-0','massgis-30605-0','massgis-317477-0',
  'massgis-259582-0','massgis-262412-0','massgis-262906-0','massgis-262907-0','massgis-265767-0','massgis-265768-0','massgis-265769-0']);
export const BU_CORE_STORROW_ROADS=BU_OFFICIAL_ROAD_SEGMENTS.filter(road=>sourceIds.has(road.id)).map(road=>({
  id:road.id,name:road.name,points:clipX(road.points,-1510,400),
  width:road.surfaceWidthFeet?road.surfaceWidthFeet*.3048:5.4864,
  lanes:road.lanes||1,ramp:(road.lanes||1)<2,
})).filter(road=>road.points.length>1);

export const BU_BAY_STATE_FOOTBRIDGE:WorldPoint[]=[[-1210,847],[-1150,855],[-1154,882],[-1209,874],[-1212,888],[-1165,895]];
export const BU_SILBER_FOOTBRIDGE:WorldPoint[]=[[-716,885],[-661,889],[-665,930],[-708,926],[-710,940],[-671.594,931.376]];
export const BU_RIVER_FOOTBRIDGES=[
  {id:'bay-state',name:'Bay State Road footbridge',points:BU_BAY_STATE_FOOTBRIDGE,width:3.0},
  {id:'silber-way',name:'Silber Way footbridge',points:BU_SILBER_FOOTBRIDGE,width:3.0},
];

/** River-side promenade runs north of both Storrow carriageways. The exact
 * path edge is not in the hydrography dataset: this 8 m inland offset is authored. */
export const BU_CORE_RIVER_WALK:WorldPoint[]=[
  ...BU_CORE_SOUTH_BANK.filter(p=>p[0]>=-1176&&p[0]<100).map(([x,z])=>[x,z+8] as WorldPoint).reverse(),
  [-1210,841],BU_BAY_STATE_FOOTBRIDGE[0],
];
export const BU_SILBER_RIVER_LINK:WorldPoint[]=[[-716,838.03],BU_SILBER_FOOTBRIDGE[0]];
export const BU_SILBER_CAMPUS_ROUTE:WorldPoint[]=[...BU_SILBER_FOOTBRIDGE,[-679.903,983.105],[-687.595,1030.16],[-695.562,1090.063]];

type Height=(x:number,z:number)=>number;
export const buRiverWalkHeight=(x:number,z:number,elevation:Height)=>Math.max(.79,elevation(x,z))+.065;
/** Deck stations 1–2 stay above the highway independently of the terrain.
 * Ramp ends/land-side approaches follow DEM, never the old fixed 5.2 m datum.
 * 4.8 m clear height + .32 m slab is an explicit modeled clearance, not a survey. */
export function buFootbridgeHeights(points:WorldPoint[],elevation:Height):number[]{
  const a=points[1],b=points[2];let roadHeight=-Infinity;
  for(let t=0;t<=1;t+=.025)roadHeight=Math.max(roadHeight,elevation(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t));
  const deck=roadHeight+5.165;
  return points.map(([x,z],i)=>i===1||i===2?deck:buRiverWalkHeight(x,z,elevation));
}

export function buStorrowContains(x:number,z:number,padding=0){
  return BU_CORE_STORROW_ROADS.some(road=>road.points.some((b,i)=>{
    if(!i)return false;const a=road.points[i-1],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<road.width/2+padding;
  }));
}
