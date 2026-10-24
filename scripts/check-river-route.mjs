import {mkdir,readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {BufferAttribute, BufferGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3, Matrix4} from 'three';

// Geometry-only reconstruction of scene-assets; skips textures, sky and leaf art.
const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',logLevel:'error'});
try {
  const [{CampusCollision},{openPortico},{createCharlesRiver},{createBostonUniversity,BU_TREE_POSITIONS},{createPainterlyCampusProps},geo,{createBUCampusStreets},{createBUFullCampus},{createCampusGroundSampler},{BU_CAMPUS_ROUTE},{BU_SILBER_FOOTBRIDGE,BU_SILBER_RIVER_LINK}]=await Promise.all([
    vite.ssrLoadModule('/src/features/real-campus/campus-collision.ts'),
    vite.ssrLoadModule('/src/features/real-campus/portico.ts'),
    vite.ssrLoadModule('/src/features/world/charles-river.ts'),
    vite.ssrLoadModule('/src/features/world/boston-university.ts'),
    vite.ssrLoadModule('/src/features/world/painterly-campus-props.ts'),
    vite.ssrLoadModule('/src/features/world/charles-geography.ts'),
    vite.ssrLoadModule('/src/features/world/bu-campus-streets.ts'),
    vite.ssrLoadModule('/src/features/world/bu-full-campus.ts'),
    vite.ssrLoadModule('/src/features/world/campus-ground-sampler.ts'),
    vite.ssrLoadModule('/src/features/world/world-destinations.ts'),
    vite.ssrLoadModule('/src/features/world/bu-river-core-layout.ts'),
  ]);
  const readGlb=async path=>{
    const file=await readFile(path),jsonSize=file.readUInt32LE(12),doc=JSON.parse(file.toString('utf8',20,20+jsonSize));
    const bin=28+jsonSize;
    const attribute=index=>{
      const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
      const Constructor={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array}[a.componentType];
      const offset=bin+(v.byteOffset??0)+(a.byteOffset??0),bytes=Constructor.BYTES_PER_ELEMENT*a.count*size;
      if(v.byteStride&&v.byteStride!==Constructor.BYTES_PER_ELEMENT*size){
        const out=new Constructor(a.count*size);
        for(let i=0;i<a.count;i++)for(let j=0;j<size;j++)out[i*size+j]=file.readFloatLE(offset+i*v.byteStride+j*4);
        return new BufferAttribute(out,size);
      }
      return new BufferAttribute(new Constructor(file.buffer.slice(file.byteOffset+offset,file.byteOffset+offset+bytes)),size);
    };
    const nodes=doc.nodes.map(n=>{
      const group=new Group();group.name=n.name??'';
      if(n.matrix)group.applyMatrix4(new Matrix4().fromArray(n.matrix));
      else {if(n.translation)group.position.fromArray(n.translation);if(n.rotation)group.quaternion.fromArray(n.rotation);if(n.scale)group.scale.fromArray(n.scale);}
      if(n.mesh!==undefined)for(const primitive of doc.meshes[n.mesh].primitives){
        const geometry=new BufferGeometry();geometry.setAttribute('position',attribute(primitive.attributes.POSITION));
        if(primitive.attributes.NORMAL!==undefined)geometry.setAttribute('normal',attribute(primitive.attributes.NORMAL));
        if(primitive.indices!==undefined)geometry.setIndex(attribute(primitive.indices));
        const material=new MeshStandardMaterial({name:doc.materials[primitive.material]?.name??''});
        const mesh=new Mesh(geometry,material);mesh.name=material.name;group.add(mesh);
      }
      return group;
    });
    doc.nodes.forEach((node,i)=>(node.children??[]).forEach(child=>nodes[i].add(nodes[child])));
    const group=new Group();for(const node of doc.scenes[doc.scene??0].nodes)group.add(nodes[node]);
    return group;
  };
  const [base,detail,manifest]=await Promise.all([
    readGlb('public/data/campuses/mit/campus.glb'),readGlb('public/data/killian/detail.glb'),
    readFile('public/data/killian/detail-manifest.json','utf8').then(JSON.parse),
  ]);
  openPortico(base,manifest.porticoOpening,manifest.dome,manifest.courtyardFacades);
  const model=new Group();model.add(base,detail);
  const floors=new Set(['grass','pavement','steps','porticoFloor','courtCurb','road','arterial','bridgeDeck','bridgeWalk']);
  const wallNames=new Set(['Cambridge buildings (untextured)','columnStone','porticoStone','porticoWall','courtyardWall','courtyardPlinth','entranceDoor','entrancePanel']);
  const hide=new Set(['bark','pavingJoint','benchWood','benchMetal','water','bridgeDeck','bridgeWalk','bridgeRail','bridgeSupport']);
  const ground=[],walls=[];
  model.traverse(mesh=>{
    if(!mesh.isMesh)return;const name=mesh.material.name;
    if(hide.has(name)||name.startsWith('leaf'))return;
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    if(floors.has(name)||name.includes('orthophotography'))ground.push(mesh);else if(wallNames.has(name))walls.push(mesh);
  });
  model.updateMatrixWorld(true);const collision=new CampusCollision();collision.rebuild(ground,walls);
  const river=createCharlesRiver(collision,{value:0}),bu=createBostonUniversity({wind:{value:0}}),streets=createBUCampusStreets(),fullBU=createBUFullCampus();
  model.add(river.group,bu.group,streets.group,fullBU.group);ground.push(...river.ground,...bu.ground,...streets.ground,...fullBU.ground);walls.push(...river.walls,...bu.walls,...streets.walls,...fullBU.walls);
  model.updateMatrixWorld(true);const sampleGround=createCampusGroundSampler(ground);collision.rebuild(ground,walls,sampleGround);
  const props=createPainterlyCampusProps(collision);model.add(props.group);walls.push(...props.colliders);
  // Same proxy mesh, seed and radius as painterly-vegetation.ts; no canvas art.
  for(const trees of [manifest.trees,[...BU_TREE_POSITIONS.map(([x,z])=>({x,z})),...river.trees]])trees.forEach((tree,index)=>{
    let seed=263+index*1987;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    random();const radius=index<22?.41+random()*.12:.29+random()*.1;
    const proxy=new Mesh(new CylinderGeometry(.43,.5,2.4,8),new MeshStandardMaterial());proxy.name=`Tree trunk ${tree.x},${tree.z}`;
    proxy.position.set(tree.x,(collision.groundHeight(tree.x,tree.z)??2)+1.2,tree.z);proxy.scale.setScalar(radius/.43);proxy.geometry.computeBoundingBox();
    model.add(proxy);walls.push(proxy);
  });
  // Current BU profile uses a different trunk radius from the legacy MIT trees.
  [...fullBU.trees,...streets.trees].forEach((tree,index)=>{
    const spread=Math.max(3.5,Math.min(6.4,tree.radius*(index%5===1?.9:1.18))),radius=.24+spread*.027;
    const proxy=new Mesh(new CylinderGeometry(.43,.5,2.4,8),new MeshStandardMaterial());proxy.name=`BU tree trunk ${tree.x},${tree.z}`;
    proxy.position.set(tree.x,(sampleGround(tree.x,tree.z)??2)+1.2,tree.z);proxy.scale.setScalar(radius/.43);proxy.geometry.computeBoundingBox();model.add(proxy);walls.push(proxy);
  });
  model.updateMatrixWorld(true);collision.rebuild(ground,walls,sampleGround);

  const ray=new Raycaster(),direction=new Vector3(),origin=new Vector3(),inverse=new Matrix4(),local=new Vector3();
  const failures=[],segments=[];let samples=0,maxDelta=0;
  const record=(kind,data)=>{failures.push({kind,...data});};
  for(const reverse of [false,true]) {
  const route=reverse?[...geo.RIVER_WALK_ROUTE].reverse():geo.RIVER_WALK_ROUTE;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),steps=Math.ceil(length/.25);
    let previous=[...a],prevY=collision.groundHeight(...a),localFailures=0,maxLocal=0,minY=Infinity,maxY=-Infinity;
    direction.set(dx,0,dz).normalize();
    for(let j=1;j<=steps;j++){
      const t=j/steps,point=[a[0]+dx*t,a[1]+dz*t],height=collision.groundHeight(...point);samples++;
      if(height===undefined){record('missing-ground',{segment:i,reverse,point});localFailures++;}
      else {minY=Math.min(minY,height);maxY=Math.max(maxY,height);}
      if(height!==undefined&&prevY!==undefined){
        const delta=Math.abs(height-prevY);maxDelta=Math.max(maxDelta,delta);maxLocal=Math.max(maxLocal,delta);
        if(delta>.68){record('height-step',{segment:i,reverse,point,previous,from:prevY,to:height,delta});localFailures++;}
        origin.set(previous[0],prevY+.9,previous[1]);const reach=length/steps+.34;
        const hit=collision.distance(origin,direction,reach);
        if(hit!==undefined){
          ray.set(origin,direction);ray.near=0;ray.far=reach;const first=ray.intersectObjects(walls,false)[0];
          record('wall',{segment:i,reverse,point,origin:origin.toArray(),distance:hit,wall:first?.object.name,wallPosition:first?.object.position.toArray()});localFailures++;
        }
      }
      if(!geo.isWalkableWorld(...point)){record('boundary',{segment:i,reverse,point});localFailures++;}
      previous=point;prevY=height;
    }
    segments.push({segment:i,reverse,from:a,to:b,samples:steps,failures:localFailures,minY,maxY,maxDelta:maxLocal});
  }
  }
  const landmarks={};
  for(const [name,point] of Object.entries(geo.LANDMARKS)){
    const height=collision.groundHeight(...point),containing=[];
    if(height!==undefined)for(const mesh of walls){
      inverse.copy(mesh.matrixWorld).invert();local.set(point[0],height+.9,point[1]).applyMatrix4(inverse);
      if(mesh.geometry.boundingBox.containsPoint(local))containing.push(mesh.name);
    }
    landmarks[name]={position:point,height,containing};
    if(height===undefined)record('landmark-missing-ground',{name,point});
    // The Cambridge combined mesh's AABB spans all buildings; an AABB test is
    // conclusive only for the individual box proxies added for BU / bridge.
    const blocking=containing.filter(n=>n!=='Cambridge buildings (untextured)');
    if(blocking.length)record('landmark-inside-wall',{name,point,blocking});
  }
  const campusRoutes={
    beachToMarsh:BU_CAMPUS_ROUTE,
    marshToQuestrom:geo.BU_STREET_ROUTE,
    silberRiverConnection:BU_SILBER_RIVER_LINK,
    silberFootbridge:BU_SILBER_FOOTBRIDGE,
  };
  const campusChecks={};
  for(const [routeName,route] of Object.entries(campusRoutes)){
    const issues=[];
    for(const reversed of [false,true]){
      const walk=reversed?[...route].reverse():route;
      for(let i=1;i<walk.length;i++){
        const a=walk[i-1],b=walk[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),steps=Math.ceil(length/.25);
        let previous=[...a],prevY=collision.groundHeight(...a);direction.set(dx,0,dz).normalize();
        for(let j=1;j<=steps;j++){
          const t=j/steps,point=[a[0]+dx*t,a[1]+dz*t],height=collision.groundHeight(...point);
          if(height===undefined||prevY===undefined||Math.abs(height-prevY)>.68||!geo.isWalkableWorld(...point))issues.push({kind:'ground',segment:i,reversed,point,prevY,height});
          if(prevY!==undefined){origin.set(previous[0],prevY+.9,previous[1]);const reach=length/steps+.34;
            if(collision.distance(origin,direction,reach)!==undefined){ray.set(origin,direction);ray.near=0;ray.far=reach;issues.push({kind:'wall',segment:i,reversed,point,wall:ray.intersectObjects(walls,false)[0]?.object.name});}
          }
          previous=point;prevY=height;
        }
      }
    }
    campusChecks[routeName]={route,issues};for(const issue of issues)record('campus-route',{routeName,...issue});
  }
  const report={samples,maxDelta,segments,landmarks,campusChecks,failures,groundMeshes:ground.length,wallMeshes:walls.length,scope:'GLB + river + BU + benches + exact procedural tree collision proxies (leaf art excluded)'};
  await mkdir('output',{recursive:true});await writeFile('output/river-route-report.json',JSON.stringify(report,null,2));
  const failureCounts={};for(const f of failures)failureCounts[f.kind]=(failureCounts[f.kind]??0)+1;
  console.log(JSON.stringify({samples,maxDelta,failureCounts,failedSegments:segments.filter(s=>s.failures),landmarks,campusChecks,firstFailures:failures.slice(0,15)},null,2));
  if(failures.length)process.exitCode=1;
} finally {await vite.close();}
