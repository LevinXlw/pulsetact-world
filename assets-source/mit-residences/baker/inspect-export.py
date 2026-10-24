"""Reload the delivered GLB, including quantized normals, then render it.
This is an offline export check, not an in-game screenshot.
"""
from pathlib import Path
import bpy,json
from mathutils import Vector
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/mit-residences/baker-full.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
colliders=[o for o in meshes if o.get('mitResidenceCollisionOnly')]
assert len(colliders)==1 and colliders[0].get('mitResidenceWall')
for o in colliders:o.hide_render=True
points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
bounds={'min':[min(p[k] for p in points) for k in range(3)],'max':[max(p[k] for p in points) for k in range(3)]}
assert abs(bounds['min'][2]-2.67134)<.001
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=48;s.cycles.use_denoising=True;s.render.resolution_x=1600;s.render.resolution_y=1000;s.render.resolution_percentage=100;s.world=bpy.data.worlds.new('Inspection World');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.69,.77,.87,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.65;s.view_settings.view_transform='AgX'
bpy.ops.object.light_add(type='SUN',location=(-330,-350,100));sun=bpy.context.object;sun.rotation_euler=(.55,-.35,-.8);sun.data.energy=2.6;sun.data.angle=.12
bpy.ops.mesh.primitive_plane_add(size=350,location=(-300,-280,2.66134));plane=bpy.context.object;plane.name='Inspection-only neutral ground';mat=bpy.data.materials.new('Inspection neutral');mat.diffuse_color=(.36,.39,.37,1);plane.data.materials.append(mat)
# The entrance paving follows the real terrain, not the original building's
# minimum Z. Include that unchanged terrain patch as inspection-only context.
snapshot=json.loads((HERE/'entry-terrain.json').read_text());points=[];faces=[]
for tri in snapshot['triangles']:
    start=len(points)
    for ss,dd,yy in tri:points.append((-293.6132807121133-.8855115793057221*ss+.46461730802401857*dd,-251.20050008562413+.46461730802401857*ss+.8855115793057221*dd,yy))
    a,b,c=[Vector(p) for p in points[-3:]];faces.append((start,start+1,start+2) if (b-a).cross(c-a).z>0 else (start,start+2,start+1))
me=bpy.data.meshes.new('Inspection real terrain');me.from_pydata(points,[],faces);me.update();ob=bpy.data.objects.new('Inspection-only source terrain',me);bpy.context.collection.objects.link(ob);me.materials.append(mat)
meta=json.loads((HERE/'metadata.json').read_text());cc=meta['camerasBlender']['north-court-detail']
bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.location=cc['eye'];target=Vector(cc['target']);cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=48;cam.data.clip_end=600
s.render.filepath=str(HERE/'exported-north-court.png');bpy.ops.render.render(write_still=True)
(HERE/'export-reimport-check.json').write_text(json.dumps({'status':'passed','meshes':len(meshes),'collisionMeshes':len(colliders),'groundMeshes':sum(bool(o.get('mitResidenceGround')) for o in meshes),'boundsBlender':bounds,'evidence':'exported-north-court.png','kind':'Offline render of delivered GLB reimported into Blender; measured terrain is inspection-only context'},indent=2))
