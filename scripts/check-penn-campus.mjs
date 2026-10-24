import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {Matrix4,Vector3} from 'three';

// No browser, network assets or GPU. Sample the actual authored collision and
// terrain in both directions, including the three fast-travel arrivals.
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try {
  const [{createPennCampus},{PENN_LAYOUT},{CampusCollision}]=await Promise.all([
    vite.ssrLoadModule('/src/features/world/penn-campus.ts'),
    vite.ssrLoadModule('/src/features/world/penn-layout.ts'),
    vite.ssrLoadModule('/src/features/real-campus/campus-collision.ts'),
  ]);
  const scene=createPennCampus({value:0});scene.group.updateMatrixWorld(true);
  const collision=new CampusCollision();collision.rebuild(scene.ground,scene.walls);
  const inverse=new Matrix4(),local=new Vector3(),failures=[];
  const contained=(x,z)=>scene.walls.filter(mesh=>{
    inverse.copy(mesh.matrixWorld).invert();local.set(x,(collision.groundHeight(x,z)??0)+.9,z).applyMatrix4(inverse);
    return mesh.geometry.boundingBox.containsPoint(local);
  }).map(mesh=>mesh.name);
  let samples=0,maxStep=0,triangles=0,meshes=0;
  scene.group.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.visible)return;meshes++;
    triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
    const positions=mesh.geometry.attributes.position.array;
    for(const value of positions)if(!Number.isFinite(value)){failures.push({type:'nonfinite',mesh:mesh.name});break;}
  });
  const arrivals=PENN_LAYOUT.points.map(point=>{
    const [x,z]=point.position,height=collision.groundHeight(x,z),blocked=contained(x,z);
    if(height===undefined||blocked.length)failures.push({type:'arrival',id:point.id,height,blocked});
    return {id:point.id,position:point.position,height,blocked};
  });
  const walks=[PENN_LAYOUT.route,[[-23,29],[-23,40]],[[61,11],[69,11]]];
  for(const authored of walks)for(const reverse of [false,true]){
    const route=reverse?[...authored].reverse():authored;
    for(let i=1;i<route.length;i++){
      const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),steps=Math.ceil(length/.22);
      const direction=new Vector3(dx,0,dz).normalize();let previous=a,previousY=collision.groundHeight(...a);
      for(let step=1;step<=steps;step++){
        const t=step/steps,x=a[0]+dx*t,z=a[1]+dz*t,height=collision.groundHeight(x,z);samples++;
        if(height===undefined)failures.push({type:'ground',x,z});
        const delta=Math.abs((height??0)-(previousY??0));maxStep=Math.max(maxStep,delta);
        if(delta>.45)failures.push({type:'step',x,z,delta});
        const hit=collision.distance(new Vector3(previous[0],(previousY??0)+.9,previous[1]),direction,length/steps+.32);
        if(hit!==undefined)failures.push({type:'route-wall',reverse,x,z,hit});
        previous=[x,z];previousY=height;
      }
    }
  }
  // The level outdoor floor must cover the entire declared bounded vignette.
  const b=PENN_LAYOUT.bounds;
  for(let x=b.minX+.1;x<b.maxX;x+=4)for(let z=b.minZ+.1;z<b.maxZ;z+=4){
    samples++;if(collision.groundHeight(x,z)===undefined)failures.push({type:'boundary-ground',x,z});
  }
  const report={meshes,triangles,ground:scene.ground.length,walls:scene.walls.length,trees:scene.trees.length,lawns:scene.lawns.length,samples,maxStep,arrivals,failures};
  await mkdir('output/penn-campus',{recursive:true});await writeFile('output/penn-campus/geometry-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=1;
} finally {await vite.close();}
