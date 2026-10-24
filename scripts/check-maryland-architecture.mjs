import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {Raycaster,Vector3} from 'three';

// Ray tests inspect the built geometry rather than repeating a facade formula:
// between the mullions a pane must be behind the neighbouring masonry plane.
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try {
  const [{createMarylandCampus},{CampusCollision},{marylandElevation}]=await Promise.all([
    vite.ssrLoadModule('/src/features/world/maryland-campus.ts'),
    vite.ssrLoadModule('/src/features/real-campus/campus-collision.ts'),
    vite.ssrLoadModule('/src/features/world/maryland-terrain.ts'),
  ]);
  const campus=createMarylandCampus({value:0}),visible=[];
  let triangles=0;
  campus.group.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.visible)return;
    visible.push(mesh);triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
    for(const value of mesh.geometry.attributes.position.array)assert(Number.isFinite(value));
  });
  campus.group.updateMatrixWorld(true);
  const ray=(name,origin,direction)=>{
    origin=[origin[0],origin[1]+(name.startsWith('Miller')?marylandElevation(160,0):marylandElevation(-160,0)),origin[2]];
    const cast=new Raycaster(new Vector3(...origin),new Vector3(...direction).normalize(),0,20),hit=cast.intersectObjects(visible,false)[0];
    assert(hit,`${name}: geometry was not hit`);
    return {name,material:hit.object.material.name,point:hit.point.toArray(),distance:hit.distance};
  };
  const libraryWindow=ray('McKeldin east window',[-137,5.6,39.970909],[-1,0,0]);
  const libraryBrick=ray('McKeldin adjacent masonry',[-137,5.6,38.490909],[-1,0,0]);
  assert.equal(libraryWindow.material,'Maryland glass');assert.equal(libraryBrick.material,'Maryland brick');
  assert(libraryWindow.distance-libraryBrick.distance>.38,'McKeldin glass must be genuinely recessed');
  const adminWindow=ray('Miller west window',[139,8.58,23.036667],[1,0,0]);
  const adminBrick=ray('Miller adjacent masonry',[139,8.58,24.516667],[1,0,0]);
  assert.equal(adminWindow.material,'Maryland glass');assert.equal(adminBrick.material,'Maryland brick');
  assert(adminWindow.distance-adminBrick.distance>.38,'Miller glass must be genuinely recessed');
  const libraryDoor=ray('McKeldin arched lower entrance',[-129,1.65,-9.45],[-1,0,0]);
  assert.equal(libraryDoor.material,'Maryland glass');
  assert(libraryDoor.point[0]<-131.6,'Door must sit behind the stone arch plane');
  const oculus=ray('McKeldin pediment aperture',[-129,21.374,-.17],[-1,0,0]);
  assert.equal(oculus.material,'Maryland glass','Circular opening must reach recessed glazing');
  const collision=new CampusCollision();collision.rebuild(campus.ground,campus.walls);
  // Passage between the columns above the administration stair landing.
  const portico=[];
  for(const x of [135.0,136.0,137.0,138.0,139.0]){
    const ground=collision.groundHeight(x,0);assert(ground!==undefined);
    const hit=collision.distance(new Vector3(x,ground+.9,0),new Vector3(1,0,0),.38);
    assert.equal(hit,undefined,`Miller central portico passage blocked at ${x}`);portico.push({x,ground});
  }
  assert(triangles<250000,`Core geometry budget exceeded: ${triangles}`);
  const report={visibleMeshes:visible.length,triangles,ground:campus.ground.length,colliders:campus.walls.length,
    facadeRays:[libraryWindow,libraryBrick,adminWindow,adminBrick,libraryDoor,oculus],portico};
  await mkdir('output/maryland-modeling',{recursive:true});
  await writeFile('output/maryland-modeling/architecture-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await vite.close();}
