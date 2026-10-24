"""Extract the municipal W1 survey and render labelled source faces only."""
from pathlib import Path
from collections import defaultdict
import json, zipfile, math, random
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
FT=1200/3937
ORIGIN=(766425.8129794697-731100,2956167.074144031-2902900)
def read_source():
 p=json.loads((ROOT/'assets-source/mit-residences/source-index.json').read_text())
 record=next(x for x in p['residences'] if x['id']=='maseeh')['components'][0]
 raw=zipfile.ZipFile(ROOT/record['sourceArchive']).read(record['sourceEntry']).decode()
 (HERE/'source.obj').write_text(raw)
 v=[];f=[]
 for line in raw.splitlines():
  a=line.split()
  if not a:continue
  if a[0]=='v':x,y,z=map(float,a[1:4]);v.append(((x-ORIGIN[0])*FT,(y-ORIGIN[1])*FT,z*FT))
  elif a[0]=='f':f.append([int(s.split('/')[0])-1 for s in a[1:]])
 return v,f,record
def patch_data(v,f):
 groups={}
 for i,face in enumerate(f):
  a,b,c=[Vector(v[j]) for j in face[:3]];n=(b-a).cross(c-a).normalized();d=n.dot(a)
  key=tuple(round(x,3) for x in n)+(round(d,2),)
  groups.setdefault(key,[]).append(i)
 result=[]
 for key,ids in groups.items():
  points=[v[j] for i in ids for j in f[i]];area=sum((Vector(v[f[i][1]])-Vector(v[f[i][0]])).cross(Vector(v[f[i][2]])-Vector(v[f[i][0]])).length/2 for i in ids)
  result.append({'faces':ids,'normal':key[:3],'distance':key[3],'area':area,'bounds':{'min':[min(p[k] for p in points) for k in range(3)],'max':[max(p[k] for p in points) for k in range(3)]},'center':[sum(p[k] for p in points)/len(points) for k in range(3)]})
 result.sort(key=lambda p:-p['area'])
 for i,p in enumerate(result):p['id']=i
 return result
if __name__=='__main__':
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 v,f,record=read_source();parts=patch_data(v,f);(HERE/'patches.json').write_text(json.dumps(parts,indent=2))
 mesh=bpy.data.meshes.new('survey');mesh.from_pydata(v,[],f);mesh.update();obj=bpy.data.objects.new('Maseeh 2010 survey',mesh);bpy.context.collection.objects.link(obj)
 rng=random.Random(42)
 for p in parts:
  mat=bpy.data.materials.new('patch'+str(p['id']));mat.diffuse_color=(*[rng.uniform(.25,.85) for _ in range(3)],1);mesh.materials.append(mat)
  for i in p['faces']:mesh.polygons[i].material_index=len(mesh.materials)-1
  if p['area']>20:
   bpy.ops.object.text_add(location=Vector(p['center'])+Vector(p['normal'])*.25);t=bpy.context.object;t.data.body=str(p['id']);t.data.size=1.6;t.data.align_x='CENTER';t.rotation_euler=Vector(p['normal']).to_track_quat('Z','Y').to_euler()
 s=bpy.context.scene;s.render.engine='BLENDER_EEVEE_NEXT';s.render.resolution_x=1300;s.render.resolution_y=1100;s.render.resolution_percentage=100;s.view_settings.view_transform='Standard';s.world.color=(.7,.7,.7)
 bpy.ops.object.light_add(type='SUN');bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.5,-.3,-.4)
 bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=115
 for name,eye in {'south':(-105,-310,65),'north':(-135,-50,65),'east':(15,-175,65),'top':(-114,-170,180)}.items():
  cam.location=eye;cam.rotation_euler=(Vector((-114,-170,16))-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(HERE/('source-'+name+'.png'));bpy.ops.render.render(write_still=True)
 report={'vertices':len(v),'faces':len(f),'bounds':{'min':[min(p[k] for p in v) for k in range(3)],'max':[max(p[k] for p in v) for k in range(3)]},'source':record,'patches':len(parts)}
 (HERE/'source-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
