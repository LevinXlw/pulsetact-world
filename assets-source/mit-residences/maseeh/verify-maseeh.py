"""Validate exported, transformed GLB geometry and architectural collision flags."""
from pathlib import Path
import json,struct,hashlib,math
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
def verify(profile):
 path=ROOT/'public/assets/mit-residences'/('maseeh-'+profile+'.glb');raw=path.read_bytes();ln=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+ln]);data=raw[28+ln:]
 def acc(i):
  a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];t={5126:'f',5125:'I',5123:'H',5121:'B',5120:'b'}[a['componentType']];size=n*struct.calcsize(t);off=v.get('byteOffset',0)+a.get('byteOffset',0);return [struct.unpack_from('<'+t*n,data,off+j*v.get('byteStride',size)) for j in range(a['count'])]
 def local(node):
  if 'matrix' in node:return Matrix([node['matrix'][i:i+4] for i in range(0,16,4)]).transposed()
  x,y,z,w=node.get('rotation',[0,0,0,1]);return Matrix.Translation(node.get('translation',[0,0,0]))@Quaternion((w,x,y,z)).to_matrix().to_4x4()@Matrix.Diagonal((*node.get('scale',[1,1,1]),1))
 bounds=[];grounds=[];groundtri=[];collisions=[];triangles=0;meshes=0
 def visit(i,parent):
  nonlocal triangles,meshes
  node=d['nodes'][i];m=parent@local(node);extra=node.get('extras',{})
  if 'mesh' in node:
   meshes+=1
   for prim in d['meshes'][node['mesh']]['primitives']:
    pts=[m@Vector(p) for p in acc(prim['attributes']['POSITION'])];indices=[a[0] for a in acc(prim['indices'])];triangles+=len(indices)//3
    if extra.get('mitResidenceCollisionOnly'):
     assert extra.get('mitResidenceWall');assert set(prim['attributes'])=={'POSITION'};collisions.append(len(indices)//3)
    else:bounds.extend(pts)
    if extra.get('mitResidenceGround'):
     assert not extra.get('mitResidenceWall');off=len(grounds);grounds.extend(pts)
     for j in range(0,len(indices),3):
      ids=indices[j:j+3];a,b,c=[pts[k] for k in ids];normal=(b-a).cross(c-a).normalized();assert normal.y>.999,(profile,'downward or nonhorizontal ground',normal);groundtri.append(tuple(off+k for k in ids))
  for child in node.get('children',[]):visit(child,m)
 for i in d['scenes'][d.get('scene',0)]['nodes']:visit(i,Matrix.Identity(4))
 assert len(collisions)==1 and collisions[0]==572,collisions
 assert meshes==11 and len(groundtri)==18,(meshes,len(groundtri))
 assert triangles<(60000 if profile=='mobile' else 120000)
 assert len(raw)<(4000000 if profile=='mobile' else 8000000)
 box={'min':[min(p[k] for p in bounds) for k in range(3)],'max':[max(p[k] for p in bounds) for k in range(3)]}
 assert -157<box['min'][0]<-154 and -75<box['max'][0]<-72
 assert 125<box['min'][2]<128 and 209<box['max'][2]<213
 assert 33.5<box['max'][1]<35.5
 tree=BVHTree.FromPolygons(grounds,groundtri,all_triangles=True)
 metadata=json.loads((HERE/'metadata.json').read_text());north=metadata['full']['entrances'][0];origin=Vector(north['approximateDoorCenterEastNorthUp']);n=Vector((-.415,.91,0)).normalized();samples=[]
 # Every real northern tread midpoint must exist at the intended rising height.
 for k in range(7):
  p=origin+n*(3.75-k*.30-.15-.1);hit=tree.ray_cast(Vector((p.x,60,-p.y)),Vector((0,-1,0)),80)[0];expected=north['sourceTerrainHeight']+(k+1)*.9/7
  assert hit and abs(hit.y-expected)<.001,(k,hit,expected);samples.append(round(hit.y,6))
 south=metadata['full']['entrances'][1];front=Vector(south['platformFrontCenterEastNorthUp']);south_normal=-n;e=Vector((.91,.415,0)).normalized();south_samples=[]
 # The apron must extend in FRONT of the measured rounded glass vestibule,
 # including the current runtime path end and both outer landing corners.
 for width,depth in [(0,.01),(-4.5,.02),(4.5,.02),(-3.8,1.2),(3.8,1.2),(0,1.0)]:
  p=front+e*width-south_normal*depth;hit=tree.ray_cast(Vector((p.x,60,-p.y)),Vector((0,-1,0)),80)[0]
  assert hit and abs(hit.y-south['landingHeight'])<.001,(profile,'south landing',width,depth,hit)
  south_samples.append([round(p.x,6),round(-p.y,6),round(hit.y,6)])
 hit=tree.ray_cast(Vector((-112.2,60,171.6)),Vector((0,-1,0)),80)[0]
 assert hit and abs(hit.y-south['landingHeight'])<.001,('runtime path end',hit)
 return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles,'meshes':meshes,'collisionTriangles':collisions[0],'upwardGroundTriangles':len(groundtri),'northTreadHeights':samples,'southApronSamplesWorldXZY':south_samples,'runtimePathEndLandingHeight':hit.y,'worldBoundsEastUpSouth':box}
report={profile:verify(profile) for profile in ('full','mobile')};report['passed']=True;(HERE/'verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
