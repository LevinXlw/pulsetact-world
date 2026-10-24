"""Render actual optimized GLB actions for a small visual sanity check."""
import bpy, json, sys
from pathlib import Path
from mathutils import Vector
root = Path(__file__).parent.resolve()
model = root.parents[2] / 'public/assets/characters/sakurada/sakurada.glb'
if '--' in sys.argv:
    model = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(model))
scene = bpy.context.scene
scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.resolution_x=800
scene.render.resolution_y=800
scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard'
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.world=bpy.data.worlds.new('World')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0.15,0.17,0.20,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=0.8
rig=next(obj for obj in scene.objects if obj.type=='ARMATURE')
for track in list(rig.animation_data_create().nla_tracks):
    rig.animation_data.nla_tracks.remove(track)
meshes=[obj for obj in scene.objects if obj.type=='MESH' and obj.find_armature() is not None]
bpy.ops.object.camera_add(location=(2.6,4.5,2.3))
cam=bpy.context.object
cam.rotation_euler=(Vector((0,0,0.99))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO'
cam.data.ortho_scale=2.4
scene.camera=cam
bpy.ops.mesh.primitive_plane_add(size=200)
ground=bpy.context.object
ground.name='Ground'
mat=bpy.data.materials.new('GroundMat')
mat.diffuse_color=(0.4,0.45,0.50,1)
ground.data.materials.append(mat)
ground.location.z=-0.04
bpy.ops.object.light_add(type='AREA', location=(3,1,5))
bpy.context.object.data.energy=500
bpy.context.object.data.shape='DISK'
bpy.context.object.data.size=4
bounds=[]
for name in ('Idle','Walk','Run'):
    action=next(a for a in bpy.data.actions if a.name==name)
    rig.animation_data.action=action
    if len(action.slots): rig.animation_data.action_slot=action.slots[0]
    scene.frame_set(round(action.frame_range[0]+(action.frame_range[1]-action.frame_range[0])*.25))
    evaluated=bpy.context.evaluated_depsgraph_get()
    points=[]
    for obj in meshes:
        eo=obj.evaluated_get(evaluated)
        em=eo.to_mesh()
        points.extend(eo.matrix_world@v.co for v in em.vertices)
        eo.to_mesh_clear()
    bound={'action':name,'min':[min(v[i] for v in points) for i in range(3)],'max':[max(v[i] for v in points) for i in range(3)]}
    bounds.append(bound)
    scene.render.filepath=str(root/f'preview-{name.lower()}.png')
    bpy.ops.render.render(write_still=True)
(root/'render-check.json').write_text(json.dumps({'coordinate':'Blender Z up; face +Y corresponds to glTF -Z','bounds':bounds},indent=2))
print(json.dumps(bounds))
