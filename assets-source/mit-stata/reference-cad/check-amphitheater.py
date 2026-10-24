from pathlib import Path
from collections import defaultdict
import bpy, bmesh, json, importlib.util, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE=Path(__file__).resolve().parent.parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

source=load('inspect-source');amph=load('amphitheater-details')
V,F=source.read_source();P=json.loads((HERE/'patches.json').read_text())
removed=amph.replaced_faces(V,F,P)

class Geometry:
    def __init__(self):self.groups=defaultdict(lambda:{'v':[],'f':[]});self.mapper=None
    def polygon(self,mat,points,uv=None):
        d=self.groups[mat];off=len(d['v']);d['v'].extend(tuple(p) for p in points)
        for i in range(1,len(points)-1):
            d['f'].append((off,off+i,off+i+1))

reports={}
for mobile in (False,True):
    g=Geometry();r=amph.add_amphitheater(g,mobile)
    nonfinite=degenerate=0;triangles=0;ground_vs=[];ground_fs=[];downward=0
    for name,d in g.groups.items():
        for p in d['v']:nonfinite+=not all(math.isfinite(c) for c in p)
        for f in d['f']:
            triangles+=1;a,b,c=[Vector(d['v'][i]) for i in f];n=(b-a).cross(c-a)
            degenerate+=n.length_squared<1e-12
            if name in ('curb','paving'):
                downward+=n.z<=0
                off=len(ground_vs);ground_vs.extend((a,b,c));ground_fs.append((off,off+1,off+2))
    bvh=BVHTree.FromPolygons(ground_vs,ground_fs,all_triangles=True)
    hits=[]
    for center in amph.AISLES:
        for k in range(amph.ROWS*amph.SUBSTEPS):
            row,sub=divmod(k,amph.SUBSTEPS)
            expected=amph._height(row)+(amph._height(row+1)-amph._height(row))*(sub+1)/amph.SUBSTEPS
            p=amph._point((k+.5)/(amph.ROWS*amph.SUBSTEPS),center,expected+2)
            hit=bvh.ray_cast(p,Vector((0,0,-1)),5)[0]
            hits.append({'step':k,'aisle':center,'heightError':None if hit is None else abs(hit.z-expected)})
    r.update({'triangles':triangles,'trianglesByMaterial':{name:len(d['f']) for name,d in g.groups.items()},
              'nonfinite':nonfinite,'degenerate':degenerate,'downwardTreads':downward,
              'stairRayMisses':sum(h['heightError'] is None for h in hits),
              'maximumStairRayHeightError':max(h['heightError'] or 0 for h in hits)})
    reports['mobile' if mobile else 'full']=r
    if not mobile:full=g

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
colors={'brick':(.56,.40,.23,1),'curb':(.54,.56,.54,1),'paving':(.46,.45,.40,1),'frame':(.50,.53,.56,1),'context':(.70,.70,.67,1)}
def object_for(name,vs,fs):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    mat=bpy.data.materials.new(name);mat.diffuse_color=colors.get(name,(.7,.7,.7,1));mesh.materials.append(mat)
    return obj
for name,d in full.groups.items():object_for(name,d['v'],d['f'])
context=object_for('context',V,[f for i,f in enumerate(F) if i not in removed]);context.hide_render=True
s=bpy.context.scene;s.render.engine='BLENDER_WORKBENCH';s.render.resolution_x=1400;s.render.resolution_y=1000;s.render.resolution_percentage=100
s.display.shading.light='STUDIO';s.display.shading.color_type='MATERIAL';s.display.shading.show_shadows=True;s.display.shading.show_cavity=True
s.display.shading.cavity_type='BOTH';s.display.shading.background_type='WORLD';s.world.color=(.82,.84,.86)
s.view_settings.view_transform='Standard';s.render.image_settings.file_format='PNG'
bpy.ops.object.camera_add(location=(196,231,31));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=40;source.look(cam,(167,261,5));s.camera=cam
s.render.filepath=str(HERE/'reference-cad'/'amphitheater-detail.png');bpy.ops.render.render(write_still=True)
context.hide_render=False;cam.location=(225,205,95);source.look(cam,(160,270,10));cam.data.ortho_scale=91
s.render.filepath=str(HERE/'reference-cad'/'amphitheater-context.png');bpy.ops.render.render(write_still=True)
(HERE/'reference-cad'/'amphitheater-check.json').write_text(json.dumps(reports,indent=2))
print(json.dumps({k:{key:r[key] for key in ('sourceReplacedFaceCount','triangles','nonfinite','degenerate','downwardTreads','stairRayMisses','maximumStairRayHeightError')} for k,r in reports.items()}))
