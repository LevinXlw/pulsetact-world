"""Offline close-range diagnostics, not in-game screenshots."""
from pathlib import Path
import bpy,json,math
from mathutils import Vector
HERE=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(HERE/'maseeh-full.blend'))
s=bpy.context.scene;cam=s.camera
E=Vector((.91,.415,0)).normalized();N=Vector((-E.y,E.x,0));C=Vector((-114.592,-168.846,0));UP=Vector((0,0,1))
def world(x,y,z):return C+E*x+N*y+UP*z
views={'cupola-detail':(world(-4,-51,31),world(-13.5,-32.6,29),42),'south-door-detail':(world(4,-19,6.1),world(1,-.2,6.5),36),'stone-detail':(world(-18,-54,9),world(-13.5,-32.6,10),48)}
for name,(eye,target,lens) in views.items():
 cam.location=eye;cam.rotation_euler=(target-eye).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP';cam.data.lens=lens;s.render.filepath=str(HERE/(name+'.png'));bpy.ops.render.render(write_still=True)
for o in bpy.data.objects:
 if o.type=='MESH' and o.name.endswith('copper'):print('Copper smooth',sum(p.use_smooth for p in o.data.polygons),len(o.data.polygons),len(o.data.vertices))
