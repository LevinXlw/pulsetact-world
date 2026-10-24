import {createServer} from 'vite';
import {Vector3} from 'three';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try{
const [{createBUFullCampus},{createBUCampusStreets},{CampusCollision},{createCampusGroundSampler},{BU_FULL_SPACES}]=await Promise.all([
vite.ssrLoadModule('/src/features/world/bu-full-campus.ts'),vite.ssrLoadModule('/src/features/world/bu-campus-streets.ts'),vite.ssrLoadModule('/src/features/real-campus/campus-collision.ts'),vite.ssrLoadModule('/src/features/world/campus-ground-sampler.ts'),vite.ssrLoadModule('/src/features/world/bu-full-layout.ts')]);
const collision=new CampusCollision();collision.rebuild([],[]);const {createCharlesRiver}=await vite.ssrLoadModule('/src/features/world/charles-river.ts');
const parts=[createBUFullCampus(),createBUCampusStreets(),createCharlesRiver(collision,{value:0})];parts.forEach(p=>p.group.updateMatrixWorld(true));const ground=parts.flatMap(p=>p.ground),walls=parts.flatMap(p=>p.walls);collision.rebuild(ground,walls,createCampusGroundSampler(ground));
const s=BU_FULL_SPACES.find(p=>p.id==='new-balance'),toWorld=([x,z])=>[s.x+x*Math.cos(s.yaw)+z*Math.sin(s.yaw),s.z-x*Math.sin(s.yaw)+z*Math.cos(s.yaw)];
const local=[[-70,37.5],[-65,37.5],[-33,37.5],[-27,30],[0,0]],points=local.map(toWorld),report={samples:0,maxStep:0,failures:[],heights:points.map(p=>collision.groundHeight(...p))};
for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(length/.2),direction=new Vector3(b[0]-a[0],0,b[1]-a[1]).normalize();for(let j=1;j<=n;j++){const previous=[a[0]+(b[0]-a[0])*(j-1)/n,a[1]+(b[1]-a[1])*(j-1)/n],next=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n],y=collision.groundHeight(...previous),ny=collision.groundHeight(...next);report.samples++;if(y===undefined||ny===undefined){report.failures.push({type:'ground',next});break;}report.maxStep=Math.max(report.maxStep,Math.abs(y-ny));if(Math.abs(y-ny)>.68){report.failures.push({type:'step',next,y,ny});break;}const hit=collision.distance(new Vector3(previous[0],y+.9,previous[1]),direction,.54);if(hit!==undefined){report.failures.push({type:'wall',next,hit});break;}}}
console.log(JSON.stringify(report));if(report.failures.length)process.exitCode=1;
}finally{await vite.close();}
