"""Prepare the two licensed Renderpeople samples for local campus evaluation.

1. python scripts/convert-campus-people.py --textures
2. blender --background --python scripts/convert-campus-people.py

Inputs stay in assets-source/people/{nathan,sophia}; no download is performed.
Blender 4.5 LTS exports one opaque PBR material and one skinned mesh per person.
The source's first frame is a T-pose and is deliberately excluded from playback.
"""
from pathlib import Path
import json
import math
import struct
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets-source/people"
OUTPUT = ROOT / "public/assets/people"
PEOPLE = {"nathan": "walking", "sophia": "idling"}


def prepare_textures():
    # A local Pillow installation is optional; a normal system install also works.
    sys.path.insert(0, str(ROOT / "assets-source/tools/python-libs"))
    from PIL import Image, ImageOps
    for person in PEOPLE:
        source = SOURCE / person / "tex"
        destination = SOURCE / person / "prepared"
        destination.mkdir(parents=True, exist_ok=True)
        for suffix, label in [("dif", "basecolor"), ("norm", "normal")]:
            image = Image.open(source / f"rp_{person}_animated_003_{suffix}.jpg").convert("RGB")
            image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            image.save(destination / f"{label}.jpg", quality=92, subsampling=0, optimize=True)
        gloss = Image.open(source / f"rp_{person}_animated_003_gloss.jpg").convert("L")
        gloss.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        # The author supplies a gloss map, whereas glTF's PBR material uses roughness.
        roughness = ImageOps.invert(gloss).point(lambda x: max(102, min(235, x)))
        roughness.save(destination / "roughness.png", optimize=True)
        print(person, "textures prepared", flush=True)


def convert():
    import bpy
    import numpy as np
    from mathutils import Quaternion, Vector

    def evaluated_bounds(mesh):
        evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        vertices = np.array([evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices])
        return vertices.min(axis=0), vertices.max(axis=0)

    def build_material(person, mesh):
        material = bpy.data.materials.new(f"{person.title()}_ClothingSkin")
        material.use_nodes = True
        material.diffuse_color = (1, 1, 1, 1)
        material.use_backface_culling = False
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        shader = nodes.get("Principled BSDF")
        shader.inputs["Metallic"].default_value = 0
        shader.inputs["Roughness"].default_value = 0.8
        shader.inputs["IOR"].default_value = 1.45
        for label, socket in [("basecolor", "Base Color"), ("roughness", "Roughness")]:
            texture = nodes.new("ShaderNodeTexImage")
            texture.image = bpy.data.images.load(str(SOURCE / person / "prepared" / (label + (".jpg" if label == "basecolor" else ".png"))))
            texture.image.colorspace_settings.name = "sRGB" if label == "basecolor" else "Non-Color"
            links.new(texture.outputs["Color"], shader.inputs[socket])
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(str(SOURCE / person / "prepared/normal.jpg"))
        texture.image.colorspace_settings.name = "Non-Color"
        normal = nodes.new("ShaderNodeNormalMap")
        normal.inputs["Strength"].default_value = 0.7
        links.new(texture.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], shader.inputs["Normal"])
        # mask01/mask02 select garments; treating these maps as alpha erases skin.
        mesh.data.materials.clear()
        mesh.data.materials.append(material)
        for polygon in mesh.data.polygons:
            polygon.use_smooth = True

    def average_idle(armature, walk_action):
        """Create a neutral standing pose from the gait; this is not an author clip."""
        scene = bpy.context.scene
        rotations = {bone.name: [] for bone in armature.pose.bones}
        positions = {bone.name: [] for bone in armature.pose.bones}
        armature.animation_data.action = walk_action
        for frame in range(1, 69):
            scene.frame_set(frame)
            for bone in armature.pose.bones:
                rotations[bone.name].append(np.array(bone.rotation_quaternion))
                positions[bone.name].append(np.array(bone.location))
        base = {}
        for bone in armature.pose.bones:
            values = np.array(rotations[bone.name])
            values[(values @ values[0]) < 0] *= -1
            quaternion = Quaternion(values.mean(axis=0))
            quaternion.normalize()
            base[bone.name] = (quaternion, Vector(np.array(positions[bone.name]).mean(axis=0)))
        armature.animation_data.action = None
        idle = bpy.data.actions.new("Idle")
        idle["provenance"] = "Derived neutral standing pose averaged from the licensed walk, with a subtle authored breathing cycle."
        armature.animation_data.action = idle
        for frame in range(1, 122, 6):
            phase = math.sin((frame - 1) / 120 * math.tau)
            scene.frame_set(frame)
            for bone in armature.pose.bones:
                quaternion, position = base[bone.name]
                bone.rotation_mode = "QUATERNION"
                bone.rotation_quaternion = quaternion.copy()
                bone.location = position.copy()
                bone.scale = (1, 1, 1)
                if bone.name.endswith("_spine_03"):
                    bone.rotation_quaternion = quaternion @ Quaternion((1, 0, 0), phase * 0.006)
                if bone.name.endswith("_head"):
                    bone.rotation_quaternion = quaternion @ Quaternion((0, 1, 0), phase * 0.008)
                bone.keyframe_insert("location", frame=frame, group=bone.name)
                bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
                bone.keyframe_insert("scale", frame=frame, group=bone.name)
        return idle

    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    for person, source_motion in PEOPLE.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=str(SOURCE / person / f"rp_{person}_animated_003_{source_motion}.fbx"))
        scene = bpy.context.scene
        scene.render.fps = 30
        armature = next(obj for obj in scene.objects if obj.type == "ARMATURE")
        mesh = next(obj for obj in scene.objects if obj.type == "MESH")
        root = next(obj for obj in scene.objects if obj.parent is None)
        armature.name = f"{person.title()}Skeleton"
        mesh.name = f"{person.title()}Body"
        root.name = person.title()
        source_action = armature.animation_data.action
        source_end = int(source_action.frame_range[1])
        root_curve = next((curve for curve in source_action.fcurves if '_root"].location' in curve.data_path and curve.array_index == 2), None)
        source_distance = (root_curve.evaluate(source_end) - root_curve.evaluate(2)) * 0.01 if root_curve else 0
        source_duration = (source_end - 2) / 30
        action = source_action.copy()
        action.name = "Walk" if person == "nathan" else "Idle"
        for curve in action.fcurves:
            for key in list(curve.keyframe_points):
                if key.co.x < 2 and len(curve.keyframe_points) > 1:
                    curve.keyframe_points.remove(key, fast=True)
            for key in curve.keyframe_points:
                key.co.x = max(1, key.co.x - 1)
                if '_root"].location' in curve.data_path:
                    key.co.y = 0
                key.interpolation = "LINEAR"
            # Add the first animated pose as the final loop endpoint.
            curve.keyframe_points.insert(source_end, curve.evaluate(1), options={"FAST"})
            curve.update()
        armature.animation_data.action = action
        bpy.data.actions.remove(source_action)
        build_material(person, mesh)
        clips = [action]
        if person == "nathan":
            clips.append(average_idle(armature, action))
        # Source axes: Y-up/cm below an FBX .01/X90 parent. glTF export gives Y-up/m
        # and +Z-forward, without touching the bind matrices or individual bones.
        lowest = 0.0
        bounds_min = np.array([float("inf")] * 3)
        bounds_max = -bounds_min
        clip_records = []
        for clip in clips:
            armature.animation_data.action = clip
            start, end = [int(x) for x in clip.frame_range]
            clip_min = np.array([float("inf")] * 3)
            clip_max = -clip_min
            for frame in range(start, end + 1):
                scene.frame_set(frame)
                minimum, maximum = evaluated_bounds(mesh)
                lowest = min(lowest, minimum[2])
                clip_min = np.minimum(clip_min, minimum)
                clip_max = np.maximum(clip_max, maximum)
            bounds_min = np.minimum(bounds_min, clip_min)
            bounds_max = np.maximum(bounds_max, clip_max)
            clip_records.append({"name": clip.name, "durationSeconds": round((end - start) / 30, 6), "frames": end - start + 1, "source": "derived neutral standing pose and breathing" if person == "nathan" and clip.name == "Idle" else "author motion; bind frame removed; loop endpoint matched", "boundsBeforeGrounding": {"min": clip_min.tolist(), "max": clip_max.tolist()}})
        root.location.z = -lowest
        root["person"] = person
        root["forwardAxis"] = "+Z"
        root["units"] = "metres"
        root["groundOffsetMetres"] = -lowest
        root["sourceWalkingSpeedMetresPerSecond"] = source_distance / source_duration if person == "nathan" else 0
        root["licenseNote"] = "Renderpeople local evaluation sample; see ATTRIBUTION.md."
        armature.animation_data.action = None
        for clip in clips:
            track = armature.animation_data.nla_tracks.new()
            track.name = clip.name
            strip = track.strips.new(clip.name, 1, clip)
            strip.name = clip.name
        scene.frame_start = 1
        scene.frame_end = max(int(clip.frame_range[1]) for clip in clips)
        scene.frame_set(1)
        output = OUTPUT / f"{person}.glb"
        bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_animations=True,
            export_animation_mode="NLA_TRACKS", export_force_sampling=True,
            export_optimize_animation_size=True, export_frame_range=False,
            export_skins=True, export_all_influences=False, export_yup=True,
            export_extras=True, export_materials="EXPORT", export_image_format="AUTO",
            export_cameras=False, export_lights=False, export_apply=False)
        glb = output.read_bytes()
        json_length = struct.unpack_from("<I", glb, 12)[0]
        document = json.loads(glb[20:20 + json_length])
        triangles = sum(document["accessors"][primitive["indices"]]["count"] // 3 for gltf_mesh in document.get("meshes", []) for primitive in gltf_mesh["primitives"])
        record = {"id": person, "file": f"{person}.glb", "bytes": len(glb), "triangles": triangles,
            "bones": len(armature.data.bones), "meshCount": len(document.get("meshes", [])),
            "materialCount": len(document.get("materials", [])), "units": "metres", "forward": "+Z",
            "groundOffsetMetres": round(-lowest, 6),
            "dimensionsMetres": [round(float(value), 6) for value in (bounds_max - bounds_min)[[0, 2, 1]]],
            "textures": {"baseColor": [2048, 2048], "normal": [2048, 2048], "roughness": [1024, 1024]},
            "clips": clip_records, "exportedClips": [a["name"] for a in document.get("animations", [])]}
        if person == "nathan":
            record["sourceWalkingSpeedMetresPerSecond"] = round(source_distance / source_duration, 6)
        records.append(record)
        print(json.dumps(record), flush=True)
    (OUTPUT / "models.json").write_text(json.dumps({"converter": "Blender 4.5 LTS", "models": records}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if "--textures" in sys.argv:
        prepare_textures()
    else:
        convert()
