import {afterAll,describe,expect,it} from 'vitest';
import {Mesh,PlaneGeometry,Raycaster,Vector3,type Material} from 'three';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {createBUWestTerrace} from '../src/features/world/bu-west-terrace';
import {createCharlesRiver} from '../src/features/world/charles-river';
import {BU_WEST_TERRACE_EDGE,BU_WEST_TERRACE_WALKS} from '../src/features/world/bu-west-terrace-layout';
import {BU_COURTYARD_PATHS,buNavigationBlocked} from '../src/features/world/bu-campus-layout';
import {buElevation,buWestSurveyElevation,drapeBUGeometry} from '../src/features/world/bu-terrain';

const terrace=createBUWestTerrace();
afterAll(()=>{const materials=new Set<Material>();terrace.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());});
describe('West residence raised terrace and lower Nickerson field',()=>{
  it('reconstructs the isolated under-building DEM hole while retaining the lower playing field',()=>{
    expect(buWestSurveyElevation(-2340,732)).toBeCloseTo(7.521,3);
    expect(buElevation(-2340,732)).toBeCloseTo(13.025,3);
    expect(buElevation(-2340,708)).toBeCloseTo(13.025,3);
    expect(buElevation(-2292,744)).toBeCloseTo(13.046,3);
    expect(buElevation(-2232.965,642.358)).toBeCloseTo(7.9213,3);
    // The lower bowl was not indiscriminately raised to residence height.
    for(const p of [[-2280,660],[-2256,684],[-2220,648]])expect(buElevation(p[0],p[1])).toBeLessThan(8.2);
  });
  it('resolves the repaired plateau in actual terrain geometry as well as height queries',()=>{
    const source=new PlaneGeometry(120,120);source.rotateX(-Math.PI/2);source.translate(-2316,5.2,708);
    const geometry=drapeBUGeometry(source,24),material=terrace.ground[0].material,mesh=new Mesh(geometry,material);mesh.updateMatrixWorld(true);
    try{for(const [x,z] of [[-2340,732],[-2320,740],[-2292,744],[-2324,706]]){
      const hit=new Raycaster(new Vector3(x,30,z),new Vector3(0,-1,0)).intersectObject(mesh,false)[0];
      expect(hit).toBeDefined();expect(hit.point.y).toBeCloseTo(buElevation(x,z),3);
    }}finally{geometry.dispose();source.dispose();}
  });
  it('builds valid collision bounds and retains original Nickerson access through the retaining-wall opening',()=>{
    const collision=new CampusCollision();
    expect(()=>collision.rebuild(terrace.ground,terrace.walls)).not.toThrow();
    for(const mesh of [...terrace.ground,...terrace.walls]){expect(mesh.geometry.boundingBox).not.toBeNull();expect(mesh.geometry.boundingSphere).not.toBeNull();}
    for(const path of BU_COURTYARD_PATHS.filter(p=>p[0][0]<-2250))for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],direction=new Vector3(b[0]-a[0],0,b[1]-a[1]),length=direction.length();direction.normalize();
      for(const y of [8,11,13])expect(new Raycaster(new Vector3(a[0],y,a[1]),direction,0,length).intersectObjects(terrace.walls,false)).toHaveLength(0);
    }
    collision.clear();
  });
  it('keeps paving footprints outside occupied buildings and gives the field-facing height change a solid wall',()=>{
    for(const path of BU_WEST_TERRACE_WALKS)for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),count=Math.ceil(length);
      for(let j=0;j<=count;j++)for(const side of [-1,0,1]){
        const x=a[0]+dx*j/count-dz/length*side*1.6,z=a[1]+dz*j/count+dx/length*side*1.6;
        expect(buNavigationBlocked(x,z),`paving intrudes at ${x},${z}`).toBe(false);
      }
    }
    const a=BU_WEST_TERRACE_EDGE[3],b=BU_WEST_TERRACE_EDGE[4],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    expect(new Raycaster(new Vector3(x-nx*2,11,z-nz*2),new Vector3(nx,0,nz),0,4).intersectObjects(terrace.walls,false).length).toBeGreaterThan(0);
    const triangles=terrace.group.children.reduce((n,o)=>o instanceof Mesh?n+(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3:n,0);
    expect(triangles).toBeLessThan(3000);
  });
  it('keeps the actual field-side ground behind the visible retaining face from the archived walking camera',()=>{
    const river=createCharlesRiver(new CampusCollision(),{value:0});
    const sceneMeshes=[...river.ground,...terrace.group.children.filter((o):o is Mesh=>o instanceof Mesh)];
    const eye=new Vector3(-2310,9.602833,670);
    try{
      // Fixed targets on the field-facing wall from the 04 review camera.
      // Previously every ray hit a grass ramp 3-8 m before its wall target.
      for(const [x,z] of [[-2315,692],[-2298.5,704.5],[-2278.5,713.5],[-2259,719.5]]){
        const target=new Vector3(x,11.7,z),direction=target.clone().sub(eye).normalize();
        const first=new Raycaster(eye,direction,0,120).intersectObjects(sceneMeshes,false)[0];
        expect(first.object.name,`grass buried the wall at ${x},${z}`).toBe('BU West terrace retaining wall');
        expect(first.point.distanceTo(target)).toBeLessThan(.01);
      }
    }finally{
      const materials=new Set<Material>();river.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
      materials.forEach(m=>m.dispose());river.group.clear();
    }
  });

});
