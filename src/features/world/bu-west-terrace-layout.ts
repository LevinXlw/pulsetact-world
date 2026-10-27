import type {WorldPoint} from './geo-coordinates';

/** Bounded reconstruction from the BU West Campus exterior photograph and
 * 2025 Nickerson plan. The bowl remains at its independent ~7.8 m DEM grade.
 * Wall alignment / paving widths are authored estimates, not surveyed kerbs. */
export const BU_WEST_TERRACE_EDGE:WorldPoint[]=[
  [-2330,652],[-2329,670],[-2322,685],[-2308,699],[-2289,710],[-2268,717],[-2250,722],
];
export const BU_WEST_TERRACE_FOOTPRINT:WorldPoint[]=[
  ...BU_WEST_TERRACE_EDGE,[-2248,762],[-2318,760],[-2348,748],[-2370,710],[-2370,667],[-2355,650],
];
// Stable, archived USGS lattice samples at the occupied Sleeper/Claflin bases.
export const buWestTerraceDatum=(x:number,_z:number)=>13.025+(x+2340)*(.021/48);
export function buWestTerraceEdgeDistance(x:number,z:number){
  let distance=Infinity;
  for(let i=1;i<BU_WEST_TERRACE_EDGE.length;i++){
    const a=BU_WEST_TERRACE_EDGE[i-1],b=BU_WEST_TERRACE_EDGE[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    distance=Math.min(distance,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
  }return distance;
}
export function buWestTerraceWeight(x:number,z:number){
  const p=BU_WEST_TERRACE_FOOTPRINT;
  let inside=false,distance=Infinity,nearest=-1;
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length],dx=b[0]-a[0],dz=b[1]-a[1];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz))),d=Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
    if(d<distance){distance=d;nearest=i;}
  }
  if(inside)return 1;
  const t=Math.max(0,1-distance/6),fade=t*t*(3-2*t);
  if(nearest>=BU_WEST_TERRACE_EDGE.length-1)return fade;
  // The field-facing retaining wall is a true height discontinuity. Raising
  // its lower side by a 6 m fade buried the entire visible face in grass.
  // Keep only the pre-existing public access opening as a local connection.
  const ax=-2343,az=669,dx=132,dz=9,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
  const accessDistance=Math.hypot(x-ax-dx*u,z-az-dz*u),a=Math.max(0,Math.min(1,(3.2-accessDistance)/.8));
  return fade*a*a*(3-2*a);
}

export function reconstructBUWestTerrace(x:number,z:number,height:number){
  if(x< -2376||x> -2242||z<644||z>768)return height;
  const weight=buWestTerraceWeight(x,z);
  return height+(buWestTerraceDatum(x,z)-height)*weight;
}
export const BU_WEST_TERRACE_WALKS:WorldPoint[][]=[
  [[-2371.448758347245,666.390592899577],[-2354,670.6],[-2342,672.3],[-2331,675]],
  [[-2334,658],[-2333,671],[-2326,686],[-2311,703],[-2291,714],[-2270,721],[-2254,726]],
  [[-2339,677],[-2332,690],[-2325,703],[-2311,703]],
  [[-2302,723.8],[-2280,728.1],[-2257,731.8],[-2254,726]],
];
