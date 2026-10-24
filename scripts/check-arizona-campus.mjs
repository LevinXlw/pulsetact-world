import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {Matrix4,Raycaster,Vector3} from 'three';

// Exercise the same generated geometry and ground sampler used by gameplay.
// Preserve concave footprints and courtyard holes in containment checks.
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try{
  const [{createArizonaCampus},{createCampusGroundSampler},{REMOTE_LAYOUTS,campusNavigationGuide},{CampusCollision},{arizonaInside}]=await Promise.all([
    vite.ssrLoadModule('/src/features/world/arizona-campus.ts'),
    vite.ssrLoadModule('/src/features/world/campus-ground-sampler.ts'),
    vite.ssrLoadModule('/src/features/world/campus-regions.ts'),
    vite.ssrLoadModule('/src/features/real-campus/campus-collision.ts'),
    vite.ssrLoadModule('/src/features/world/arizona-environment.ts'),
  ]);
  const start=performance.now(),campus=createArizonaCampus({value:0}),constructionMs=performance.now()-start;
  campus.group.updateMatrixWorld(true);
  const sampler=createCampusGroundSampler(campus.ground),collision=new CampusCollision();collision.rebuild(campus.ground,campus.walls,sampler);
  const layout=REMOTE_LAYOUTS.arizona;if(!layout)throw new Error('Arizona has not been connected to REMOTE_LAYOUTS');
  const failures=[],inverse=new Matrix4(),local=new Vector3(),probe=new Raycaster(),probeDirection=new Vector3(1,.00013,.371).normalize();let samples=0,triangles=0,meshes=0,maxStep=0,pathSegments=0;
  const contained=(x,z)=>campus.walls.filter(mesh=>{
    const outline=mesh.userData.campusFootprint,holes=mesh.userData.campusHoles??[];
    if(outline)return arizonaInside([x,z],outline)&&!holes.some(h=>arizonaInside([x,z],h));
    inverse.copy(mesh.matrixWorld).invert();const y=(sampler(x,z)??0)+.9;local.set(x,y,z).applyMatrix4(inverse);if(!mesh.geometry.boundingBox?.containsPoint(local))return false;
    // A compound room collider's bounding box includes its open court. On a
    // closed double-sided volume an interior probe first exits an outward face;
    // an exterior probe first enters an inward-facing face instead.
    probe.set(new Vector3(x,y,z),probeDirection);probe.far=5000;const hit=probe.intersectObject(mesh,false)[0];return !!hit?.face&&hit.face.normal.clone().transformDirection(mesh.matrixWorld).dot(probeDirection)>0;
  }).map(m=>m.name);
  campus.group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(mesh.visible){meshes++;triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;}
    for(const value of mesh.geometry.attributes.position.array)if(!Number.isFinite(value)){failures.push({type:'nonfinite',mesh:mesh.name});break;}
  });
  if(meshes>1500)failures.push({type:'mesh-budget',meshes,max:1500});
  if(triangles>4000000)failures.push({type:'triangle-budget',triangles,max:4000000});
  const arrivals=layout.points.map(point=>{
    const [x,z]=point.position,height=sampler(x,z),blocked=contained(x,z);
    if(height===undefined||blocked.length)failures.push({type:'arrival',id:point.id,height,blocked});
    for(let angle=0;angle<Math.PI*2;angle+=Math.PI/4){const direction=new Vector3(Math.cos(angle),0,Math.sin(angle));if(collision.distance(new Vector3(x,(height??0)+.9,z),direction,1.1)!==undefined)failures.push({type:'arrival-clearance',id:point.id,angle});}
    return {id:point.id,position:point.position,height,blocked};
  });
  for(const [pathIndex,path] of (layout.paths??[layout.route]).entries())for(let segment=1;segment<path.length;segment++)for(const reverse of [false,true]){
    const [a,b]=reverse?[path[segment],path[segment-1]]:[path[segment-1],path[segment]],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;
    const direction=new Vector3((b[0]-a[0])/length,0,(b[1]-a[1])/length);pathSegments++;
    for(let distance=0;distance<length;distance+=.65){
      const step=Math.min(.65,length-distance),x=a[0]+direction.x*distance,z=a[1]+direction.z*distance,y=sampler(x,z),height=sampler(x+direction.x*step,z+direction.z*step);samples++;
      const details={pathIndex,segment,reverse,position:[x,z]};
      if(y===undefined||height===undefined){failures.push({type:'missing-ground',...details});break;}
      const delta=Math.abs(height-y);maxStep=Math.max(maxStep,delta);if(delta>.45){failures.push({type:'step',...details,delta});break;}
      if(collision.distance(new Vector3(x,y+.9,z),direction,step+.34)!==undefined){failures.push({type:'route-wall',...details});break;}
    }
  }
  const routes=[];
  for(const from of layout.points)for(const to of layout.points){
    if(from===to)continue;let position=[...from.position],hops=0;const initial=campusNavigationGuide('arizona',position,to.position);
    if(!Number.isFinite(initial.distance))failures.push({type:'disconnected',from:from.id,to:to.id});
    for(;hops<600&&Math.hypot(position[0]-to.position[0],position[1]-to.position[1])>.65;hops++){
      const guide=campusNavigationGuide('arizona',position,to.position);if(!Number.isFinite(guide.distance)||Math.hypot(guide.point[0]-position[0],guide.point[1]-position[1])<.001)break;position=[...guide.point];
    }
    const remaining=Math.hypot(position[0]-to.position[0],position[1]-to.position[1]);if(remaining>.65)failures.push({type:'unreached',from:from.id,to:to.id,remaining,hops});routes.push({from:from.id,to:to.id,distance:Math.round(initial.distance),hops,remaining});
  }
  const b=layout.bounds;
  for(let x=b.minX+.1;x<b.maxX;x+=14)for(let z=b.minZ+.1;z<b.maxZ;z+=14){samples++;if(sampler(x,z)===undefined)failures.push({type:'boundary-ground',x,z});}
  const report={constructionMs,meshes,triangles,ground:campus.ground.length,walls:campus.walls.length,plants:campus.group.userData.plants?.length??0,buildings:campus.group.userData.buildingCount,samples,maxStep,pathSegments,arrivals,routes,failures};
  await mkdir('output/arizona-campus',{recursive:true});await writeFile('output/arizona-campus/geometry-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,routes:`${routes.length} directed journeys`,failures:failures.slice(0,60),failureCount:failures.length},null,2));if(failures.length)process.exitCode=1;
}finally{await vite.close();}
