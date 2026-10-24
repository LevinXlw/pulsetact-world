import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {Matrix4,Vector3} from 'three';

// Sample every actual walkway in both directions, then verify all destination
// pairs on the navigation graph; avoid repeating long shared routes N² times.
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try {
  const [{createMarylandCampus},{createMarylandExpansion},{createMarylandFullCampus},{createMarylandCampusPaving},{createMarylandStreetscape},{createCampusGroundSampler},{REMOTE_LAYOUTS,campusNavigationGuide},{CampusCollision}]=await Promise.all([
    vite.ssrLoadModule('/src/features/world/maryland-campus.ts'),
    vite.ssrLoadModule('/src/features/world/maryland-expansion.ts'),
    vite.ssrLoadModule('/src/features/world/maryland-full-campus.ts'),
    vite.ssrLoadModule('/src/features/world/maryland-campus-paving.ts'),
    vite.ssrLoadModule('/src/features/world/maryland-streetscape.ts'),
    vite.ssrLoadModule('/src/features/world/campus-ground-sampler.ts'),
    vite.ssrLoadModule('/src/features/world/campus-regions.ts'),
    vite.ssrLoadModule('/src/features/real-campus/campus-collision.ts'),
  ]);
  const started=performance.now(),core=createMarylandCampus({value:0}),extra=createMarylandExpansion({value:0}),full=createMarylandFullCampus({value:0}),paving=createMarylandCampusPaving(),streets=createMarylandStreetscape();
  const constructionMs=performance.now()-started;
  core.group.add(extra.group,full.group,paving.group,streets.group);core.group.updateMatrixWorld(true);
  const streetHeight=createCampusGroundSampler([...paving.ground,...streets.pavedGround]);
  const walls=[...core.walls,...extra.walls,...full.walls,...streets.walls],ground=[...core.ground,...extra.ground,...full.ground,...paving.ground,...streets.ground],trees=[...core.trees,...extra.trees,...full.trees,...streets.trees].filter(tree=>streetHeight(tree.x,tree.z)===undefined);
  const collision=new CampusCollision();collision.rebuild(ground,walls,createCampusGroundSampler(ground));
  const inverse=new Matrix4(),local=new Vector3(),failures=[];
  const contained=(x,z)=>walls.filter(mesh=>{
    inverse.copy(mesh.matrixWorld).invert();local.set(x,(collision.groundHeight(x,z)??0)+.9,z).applyMatrix4(inverse);
    return mesh.geometry.boundingBox.containsPoint(local);
  }).map(mesh=>mesh.name);
  let samples=0,maxStep=0,triangles=0,meshes=0;
  core.group.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.visible)return;meshes++;
    triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1);
    for(const value of mesh.geometry.attributes.position.array)if(!Number.isFinite(value)){failures.push({type:'nonfinite',mesh:mesh.name});break;}
  });
  const layout=REMOTE_LAYOUTS.umd;
  const arrivals=layout.points.map(point=>{
    const [x,z]=point.position,height=collision.groundHeight(x,z),blocked=contained(x,z);
    if(height===undefined||blocked.length)failures.push({type:'arrival',id:point.id,height,blocked});
    for(let angle=0;angle<Math.PI*2;angle+=Math.PI/4){
      const direction=new Vector3(Math.cos(angle),0,Math.sin(angle));
      if(collision.distance(new Vector3(x,(height??0)+.9,z),direction,1.1)!==undefined)failures.push({type:'arrival-clearance',id:point.id,angle});
    }
    return {id:point.id,position:point.position,height,blocked};
  });
  let pathSegments=0;
  for(const [pathIndex,path] of layout.paths.entries())for(let segment=1;segment<path.length;segment++){
    const endpoints=[path[segment-1],path[segment]];
    for(const reverse of [false,true]){
      const [a,b]=reverse?[...endpoints].reverse():endpoints;
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;
      const direction=new Vector3((b[0]-a[0])/length,0,(b[1]-a[1])/length);
      pathSegments++;
      for(let distance=0;distance<length;distance+=.65){
        const step=Math.min(.65,length-distance),x=a[0]+direction.x*distance,z=a[1]+direction.z*distance;
        const next=[x+direction.x*step,z+direction.z*step];
        const y=collision.groundHeight(x,z),height=collision.groundHeight(...next);samples++;
        const details={pathIndex,segment,reverse,position:[x,z]};
        if(height===undefined){failures.push({type:'missing-ground',...details});break;}
        const delta=Math.abs(height-(y??0));maxStep=Math.max(maxStep,delta);
        if(delta>.45){failures.push({type:'step',...details,delta});break;}
        if(collision.distance(new Vector3(x,(y??0)+.9,z),direction,step+.34)!==undefined){failures.push({type:'route-wall',...details});break;}
        const tree=trees.find(tree=>Math.hypot(tree.x-next[0],tree.z-next[1])<1.3);
        if(tree){failures.push({type:'route-tree',...details,tree});break;}
      }
    }
  }
  const routes=[];
  for(const from of layout.points)for(const to of layout.points){
    if(from===to)continue;
    let position=[...from.position],hops=0;
    const initial=campusNavigationGuide('umd',position,to.position);
    if(!Number.isFinite(initial.distance))failures.push({type:'disconnected',from:from.id,to:to.id});
    for(;hops<500&&Math.hypot(position[0]-to.position[0],position[1]-to.position[1])>.65;hops++){
      const guide=campusNavigationGuide('umd',position,to.position);
      if(!Number.isFinite(guide.distance)||Math.hypot(guide.point[0]-position[0],guide.point[1]-position[1])<.001)break;
      position=[...guide.point];
    }
    const remaining=Math.hypot(position[0]-to.position[0],position[1]-to.position[1]);
    if(remaining>.65)failures.push({type:'unreached',from:from.id,to:to.id,remaining,hops});
    routes.push({from:from.id,to:to.id,distance:Math.round(initial.distance),hops,remaining});
  }
  const b=layout.bounds;
  for(let x=b.minX+.1;x<b.maxX;x+=12)for(let z=b.minZ+.1;z<b.maxZ;z+=12){samples++;if(collision.groundHeight(x,z)===undefined)failures.push({type:'boundary-ground',x,z});}
  const report={constructionMs,meshes,triangles,ground:ground.length,walls:walls.length,trees:trees.length,lawns:core.lawns.length+extra.lawns.length+full.lawns.length+streets.lawns.length,samples,maxStep,pathSegments,arrivals,routes,failures};
  await mkdir('output/maryland-campus',{recursive:true});await writeFile('output/maryland-campus/geometry-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,routes:`${routes.length} directed journeys`,failures:failures.slice(0,100),failureCount:failures.length},null,2));if(failures.length)process.exitCode=1;
} finally {await vite.close();}
