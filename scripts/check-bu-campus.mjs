import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {Group,Vector3,Box3,Raycaster} from 'three';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[],entries:[]},appType:'custom',logLevel:'error'});
const mobile=process.argv.includes('--mobile');
const riverBridges=process.argv.includes('--river-bridges');
const selected=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
await mkdir('output/bu-full-campus',{recursive:true});
try{
  if(riverBridges&&selected)throw new Error('--river-bridges checks shared river polylines and cannot be combined with --only');
  const [a,b,c,d,e,f,g]=await Promise.all([
    vite.ssrLoadModule('/src/features/world/boston-university.ts'),vite.ssrLoadModule('/src/features/world/bu-full-campus.ts'),
    vite.ssrLoadModule('/src/features/world/bu-campus-streets.ts'),vite.ssrLoadModule('/src/features/world/charles-river.ts'),
    vite.ssrLoadModule('/src/features/real-campus/campus-collision.ts'),vite.ssrLoadModule('/src/features/world/campus-ground-sampler.ts'),
    vite.ssrLoadModule('/src/features/world/world-destinations.ts'),
  ]);
  const geo=await vite.ssrLoadModule('/src/features/world/charles-geography.ts'),layout=await vite.ssrLoadModule('/src/features/world/bu-campus-layout.ts');
  console.time('build');const collision=new e.CampusCollision();collision.rebuild([],[]);
  let parts,groundSampler=f.createCampusGroundSampler;
  if(mobile){
    const [{parseMobileCampus},{createMobileGroundSampler}]=await Promise.all([vite.ssrLoadModule('/src/features/world/mobile-campus-glb.ts'),vite.ssrLoadModule('/src/features/world/mobile-ground-sampler.ts')]);
    const bytes=await readFile('public/data/mobile/boston.glb'),group=parseMobileCampus(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),ground=[],walls=[];
    group.traverse(mesh=>{if(mesh.userData.mobileGround)ground.push(mesh);if(mesh.userData.mobileWall)walls.push(mesh);});
    parts=[{group,ground,walls}];groundSampler=createMobileGroundSampler;
  }else parts=[a.createBostonUniversity({wind:{value:0}}),b.createBUFullCampus(),c.createBUCampusStreets(),d.createCharlesRiver(collision,{value:0})];
  const model=new Group();parts.forEach(p=>model.add(p.group));model.updateMatrixWorld(true);
  const ground=parts.flatMap(p=>p.ground),walls=parts.flatMap(p=>p.walls);collision.rebuild(ground,walls,groundSampler(ground));console.timeEnd('build');
  const report={arrivals:[],routes:[],failures:[],ground:ground.length,walls:walls.length,samples:0,maxStep:0};
  const origin=new Vector3(),direction=new Vector3(),ray=new Raycaster();
  if(riverBridges){
    const river=await vite.ssrLoadModule('/src/features/world/bu-river-core-layout.ts');
    const spacing=.35,maxStep=.68,wallClearance=.34;
    Object.assign(report,{mode:'river-bridges',geometry:mobile?'public/data/mobile/boston.glb':'assembled desktop campus',spacing,maxAllowedStep:maxStep,wallClearance});
    const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-5;
    const coreStart=geo.SOUTH_RIVER_WALK.findIndex(point=>same(point,river.BU_CORE_RIVER_WALK[0]));
    if(coreStart<1)throw new Error('Core river walk is not joined to the shared south-bank route');
    const bay=river.BU_RIVER_FOOTBRIDGES.find(bridge=>bridge.id==='bay-state');
    const silber=river.BU_RIVER_FOOTBRIDGES.find(bridge=>bridge.id==='silber-way');
    const silberExit=river.BU_SILBER_CAMPUS_ROUTE.findIndex(point=>same(point,silber.points.at(-1)));
    if(silberExit<0)throw new Error('Silber bridge is not joined to the shared campus route');
    const routes=[
      ...river.BU_RIVER_FOOTBRIDGES.map(bridge=>({id:`footbridge-${bridge.id}`,points:bridge.points})),
      {id:'core-riverside-walk',points:river.BU_CORE_RIVER_WALK},
      {id:'silber-riverside-link',points:river.BU_SILBER_RIVER_LINK},
      // Include the whole east approach rather than only its final vertex: a
      // terrain seam before the core would otherwise escape the bridge checks.
      {id:'core-east-riverside-connection',points:geo.SOUTH_RIVER_WALK.slice(0,coreStart+1)},
      {id:'bay-state-campus-connection',points:[bay.points.at(-1),geo.LANDMARKS.buBeach]},
      {id:'silber-campus-connection',points:river.BU_SILBER_CAMPUS_ROUTE.slice(silberExit)},
    ];
    for(const route of routes)for(const reverse of [false,true]){
      const points=reverse?[...route.points].reverse():route.points;
      if(points.length<2||points.some(p=>p.length!==2||p.some(value=>!Number.isFinite(value))))throw new Error(`Invalid river check polyline: ${route.id}`);
      let samples=0,routeMaxStep=0,distance=0,failed;
      const initialHeight=collision.groundHeight(...points[0]);
      if(!Number.isFinite(initialHeight))failed={type:'ground',at:points[0]};
      else if(!geo.isWalkableWorld(...points[0]))failed={type:'boundary',at:points[0]};
      for(let segment=1;segment<points.length&&!failed;segment++){
        const a=points[segment-1],b=points[segment],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
        if(length<1e-8)continue;
        const count=Math.ceil(length/spacing),step=length/count;let current=a,y=collision.groundHeight(...a);
        direction.set(dx,0,dz).normalize();
        for(let sample=1;sample<=count;sample++){
          const next=[a[0]+dx*sample/count,a[1]+dz*sample/count],ny=collision.groundHeight(...next);
          samples++;report.samples++;distance+=step;
          if(!Number.isFinite(y)||!Number.isFinite(ny)){failed={type:'ground',at:next,segment};break;}
          const delta=Math.abs(ny-y);routeMaxStep=Math.max(routeMaxStep,delta);report.maxStep=Math.max(report.maxStep,delta);
          if(delta>maxStep){failed={type:'step',at:next,previous:current,from:y,to:ny,segment};break;}
          if(!geo.isWalkableWorld(...next)){failed={type:'boundary',at:next,segment};break;}
          origin.set(current[0],y+.9,current[1]);
          if(collision.distance(origin,direction,step+wallClearance)!==undefined){
            ray.set(origin,direction);ray.far=step+wallClearance;
            failed={type:'wall',at:current,aim:next,segment,wall:ray.intersectObjects(walls,false)[0]?.object.name};break;
          }
          current=next;y=ny;
        }
      }
      const row={id:route.id,direction:reverse?'reverse':'forward',start:points[0],end:points.at(-1),done:!failed,samples,distance,maxStep:routeMaxStep,...failed};
      report.routes.push(row);if(failed)report.failures.push(row);console.log(JSON.stringify(row));
    }
  }else{
  const bounds=walls.map(mesh=>({mesh,box:new Box3().setFromObject(mesh)}));
  const places=[...g.WORLD_DESTINATIONS.filter(p=>p.id.startsWith('bu-')),
    // Exercise the complete crossing, beyond the south-side quick-travel point.
    // MassDOT names the shared middle span as a Reid rotary ramp.
    {id:'bu-bridge-north-regression',position:[-1494.499915,589.53334]},
  ].filter(p=>!selected||selected.includes(p.id));
  if(selected&&places.length!==selected.length)throw new Error('Unknown or duplicate BU check destination');
  for(const p of places){const y=collision.groundHeight(...p.position),at=new Vector3(p.position[0],(y??5)+.9,p.position[1]);
    const candidates=bounds.filter(b=>b.box.containsPoint(at));
    const contained=mobile?(layout.buNavigationBlocked(...p.position)?['navigation footprint']:[]):candidates.filter(b=>{
      // A concave building's bounding box also contains outdoor recesses. A
      // single forward ray with no hit does not prove that an arrival is inside.
      const ring=b.mesh.userData.campusFootprint;
      if(ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[i],c=ring[j];if((a[1]>at.z)!==(c[1]>at.z)&&at.x<(c[0]-a[0])*(at.z-a[1])/(c[1]-a[1])+a[0])inside=!inside;
      }return inside;}
      ray.set(at,new Vector3(1,0,0));ray.far=300;return ray.intersectObject(b.mesh,false).length===0;
    }).map(b=>b.mesh.name);
    const row={id:p.id,position:p.position,y,walkable:geo.isWalkableWorld(...p.position),insideBounds:candidates.map(b=>b.mesh.name),contained};report.arrivals.push(row);
    if(y===undefined||!row.walkable||contained.length)report.failures.push({type:'arrival',...row});
  }
  const home=g.WORLD_DESTINATIONS.find(p=>p.id==='bu-marsh');
  for(const p of places){if(p===home)continue;
    for(const reverse of [false,true]){
      const start=reverse?p:home,end=reverse?home:p;let current=[...start.position],steps=0,done=false,failed;
      for(;steps<26000;steps++){
        const guide=g.navigationGuide(current,end.position);if(!Number.isFinite(guide.distance)){failed={type:'disconnected',at:current};break;}
        const dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],distance=Math.hypot(dx,dz),step=Math.min(.35,distance);
        if(Math.hypot(current[0]-end.position[0],current[1]-end.position[1])<1.3){done=true;break;}
        if(distance<.001){failed={type:'stalled',at:current};break;}
        const next=[current[0]+dx/distance*step,current[1]+dz/distance*step],y=collision.groundHeight(...current),ny=collision.groundHeight(...next);report.samples++;
        if(ny===undefined||y===undefined){failed={type:'ground',at:next};break;}
        const delta=Math.abs(ny-y);report.maxStep=Math.max(report.maxStep,delta);
        if(delta>.68){failed={type:'step',at:next,from:y,to:ny};break;}
        if(!geo.isWalkableWorld(...next)){failed={type:'boundary',at:next};break;}
        origin.set(current[0],y+.9,current[1]);direction.set(dx,0,dz).normalize();
        if(collision.distance(origin,direction,step+.34)!==undefined){ray.set(origin,direction);ray.far=step+.34;failed={type:'wall',at:current,aim:guide.point,wall:ray.intersectObjects(walls,false)[0]?.object.name};break;}
        current=next;
      }
      const row={from:start.id,to:end.id,done,steps,...failed};report.routes.push(row);if(!done)report.failures.push(row);console.log(JSON.stringify(row));
    }
  }
  }
  const reportName=riverBridges?'river-bridges-report':`geometry-report${selected?'-selected':''}`;
  report.status=report.failures.length?'failed':'passed';await writeFile(`output/bu-full-campus/${mobile?'mobile-':''}${reportName}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,samples:report.samples,failures:report.failures.length,arrivals:report.arrivals.length,maxStep:report.maxStep}));if(report.failures.length)process.exitCode=1;
}finally{await vite.close();}
