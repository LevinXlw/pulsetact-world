import type {WorldPoint} from './charles-geography';
import type {CampusLayout} from './campus-regions';

type Edge={a:number;b:number;length:number};
type RouteTree={projection:Projection;distances:number[];next:number[]};
type Graph={points:WorldPoint[];edges:Edge[];neighbors:{to:number;length:number}[][];routes:Map<string,RouteTree>};
type Projection={point:WorldPoint;distance:number;edge:number;t:number};
const graphs=new WeakMap<CampusLayout,Graph>();
const length=(a:WorldPoint,b:WorldPoint)=>Math.hypot(b[0]-a[0],b[1]-a[1]);

function projection(p:WorldPoint,a:WorldPoint,b:WorldPoint){
  const dx=b[0]-a[0],dz=b[1]-a[1],squared=dx*dx+dz*dz;
  const t=squared?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/squared)):0;
  const point:WorldPoint=[a[0]+dx*t,a[1]+dz*t];
  return {point,t,distance:length(p,point)};
}

function pathGraph(layout:CampusLayout):Graph{
  const cached=graphs.get(layout);if(cached)return cached;
  const paths=layout.paths??[layout.route],points:WorldPoint[]=[],indices=new Map<string,number>();
  const index=(point:WorldPoint)=>{
    const key=point.map(value=>Math.round(value*10000)).join(',');
    let id=indices.get(key);if(id===undefined){id=points.length;indices.set(key,id);points.push(point);}return id;
  };
  const segments:WorldPoint[][]=[];
  for(const path of paths)for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i];index(a);index(b);if(length(a,b)>.0001)segments.push([a,b]);
  }
  // Split crossing paths and T junctions, even when their junction is not listed
  // as a vertex in both polylines. This also joins the promenade to side walks.
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const [a,b]=segments[i],[c,d]=segments[j],rx=b[0]-a[0],rz=b[1]-a[1],sx=d[0]-c[0],sz=d[1]-c[1],cross=rx*sz-rz*sx;
    if(Math.abs(cross)<.000001)continue;
    const qx=c[0]-a[0],qz=c[1]-a[1],t=(qx*sz-qz*sx)/cross,u=(qx*rz-qz*rx)/cross;
    if(t>=0&&t<=1&&u>=0&&u<=1)index([a[0]+rx*t,a[1]+rz*t]);
  }
  const edges:Edge[]=[],seen=new Set<string>();
  for(const [a,b] of segments){
    const chain=points.map((p,id)=>({id,...projection(p,a,b)})).filter(p=>p.distance<.001).sort((p,q)=>p.t-q.t);
    for(let i=1;i<chain.length;i++){
      const a=chain[i-1].id,b=chain[i].id,key=[a,b].sort((p,q)=>p-q).join(',');
      if(a===b||seen.has(key))continue;seen.add(key);edges.push({a,b,length:length(points[a],points[b])});
    }
  }
  const neighbors=points.map(()=>[] as {to:number;length:number}[]);
  for(const edge of edges){neighbors[edge.a].push({to:edge.b,length:edge.length});neighbors[edge.b].push({to:edge.a,length:edge.length});}
  const graph={points,edges,neighbors,routes:new Map<string,RouteTree>()};graphs.set(layout,graph);return graph;
}

function nearestProjection(graph:Graph,point:WorldPoint):Projection{
  let best:Projection={point:graph.points[0],distance:Infinity,edge:0,t:0};
  graph.edges.forEach((edge,i)=>{const p=projection(point,graph.points[edge.a],graph.points[edge.b]);if(p.distance<best.distance)best={...p,edge:i};});
  return best;
}

/** Surveyed sidewalk pieces can be almost collinear while their independently
 * offset endpoints differ by centimetres. At such a junction, choosing only
 * the closest geometric edge can alternate between a dead end and the route
 * forward. Use the cached destination tree to resolve that narrow ambiguity. */
function guidedProjection(graph:Graph,point:WorldPoint,tree:RouteTree):Projection{
  const closest=nearestProjection(graph,point),limit=closest.distance+.3;
  let best=closest,bestCost=Infinity;
  for(let index=0;index<graph.edges.length;index++){
    const edge=graph.edges[index],candidate=projection(point,graph.points[edge.a],graph.points[edge.b]);
    if(candidate.distance>limit)continue;
    const alongSameEdge=index===tree.projection.edge?length(candidate.point,tree.projection.point):Infinity;
    const remaining=Math.min(candidate.t*edge.length+tree.distances[edge.a],(1-candidate.t)*edge.length+tree.distances[edge.b],alongSameEdge);
    const cost=candidate.distance+remaining;
    if(cost<bestCost-.00001||(Math.abs(cost-bestCost)<=.00001&&candidate.distance<best.distance)){
      best={...candidate,edge:index};bestCost=cost;
    }
  }return best;
}

/** A destination stays fixed while the player moves. Cache its reverse route
 * tree so HUD updates only project onto the paths, rather than solve the whole
 * campus graph again. The bounded cache also supports arbitrary map targets. */
function routeTree(graph:Graph,destination:WorldPoint):RouteTree{
  const key=destination.join(',');
  const cached=graph.routes.get(key);if(cached)return cached;
  const to=nearestProjection(graph,destination),edge=graph.edges[to.edge];
  const distances=graph.points.map(()=>Infinity),next=graph.points.map(()=>-1);
  const heap:{node:number;cost:number}[]=[];
  const push=(node:number,cost:number)=>{
    let index=heap.length;heap.push({node,cost});
    while(index>0){const parent=(index-1)>>1;if(heap[parent].cost<=cost)break;heap[index]=heap[parent];index=parent;}
    heap[index]={node,cost};
  };
  const pop=()=>{
    const top=heap[0],last=heap.pop()!;
    if(heap.length){let index=0;while(index*2+1<heap.length){let child=index*2+1;if(child+1<heap.length&&heap[child+1].cost<heap[child].cost)child++;if(heap[child].cost>=last.cost)break;heap[index]=heap[child];index=child;}heap[index]=last;}
    return top;
  };
  for(const [node,cost] of [[edge.a,to.t*edge.length],[edge.b,(1-to.t)*edge.length]]){distances[node]=cost;push(node,cost);}
  while(heap.length){
    const current=pop();if(current.cost!==distances[current.node])continue;
    for(const neighbor of graph.neighbors[current.node]){
      const cost=current.cost+neighbor.length;
      if(cost<distances[neighbor.to]){distances[neighbor.to]=cost;next[neighbor.to]=current.node;push(neighbor.to,cost);}
    }
  }
  const tree={projection:to,distances,next};
  if(graph.routes.size>=64)graph.routes.delete(graph.routes.keys().next().value!);
  graph.routes.set(key,tree);return tree;
}

/** Guide along the shortest connected walkway, including loops and branches. */
export function guideCampusPaths(layout:CampusLayout,position:WorldPoint,destination:WorldPoint){
  const direct=length(position,destination);
  if(direct<.001)return {point:destination,distance:direct,viaRoute:false};
  const graph=pathGraph(layout);
  if(!graph.edges.length)return {point:destination,distance:direct,viaRoute:false};
  const tree=routeTree(graph,destination),from=guidedProjection(graph,position,tree),to=tree.projection,edge=graph.edges[from.edge];
  const viaA=from.t*edge.length+tree.distances[edge.a],viaB=(1-from.t)*edge.length+tree.distances[edge.b];
  const alongSameEdge=from.edge===to.edge?length(from.point,to.point):Infinity;
  const routeDistance=Math.min(viaA,viaB,alongSameEdge),distance=from.distance+routeDistance+to.distance;
  if(from.distance>2.5)return {point:from.point,distance,viaRoute:true};
  const waypoints:WorldPoint[]=[from.point];
  if(alongSameEdge>routeDistance){
    for(let node=viaA<=viaB?edge.a:edge.b;node>=0;node=tree.next[node])waypoints.push(graph.points[node]);
  }
  waypoints.push(to.point,destination);
  // Allow a metre at a junction so an animated controller can round its corner.
  const point=waypoints.find(point=>length(position,point)>1)??destination;
  return {point,distance,viaRoute:length(point,destination)>.001};
}
