"""Bake CC0 UAL animations onto the Sakurada Fumiriya VRM 0 source.

Run with Blender 4.5:
  blender -b --python assets-source/characters/sakurada/retarget_sakurada.py -- \
    --avatar "assets-source/characters/sakurada/original/Sakurada Fumiriya.vrm" \
    --motions PATH_TO_CC0_UAL1_STANDARD_GLB \
    --output assets-source/characters/sakurada/sakurada-animated.glb

Adapted from the local marathon asset pipeline. Original meshes, skins, morphs,
materials and image bytes remain intact. VRM 0 humanoid semantics provide the
bone correspondence; UAL world transforms rotate to match Sakurada's native -Z
facing. Hair and clothing retain source rest transforms without spring physics.
"""

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree


CLIPS = {
    'Idle': 'Idle_Loop',
    'Walk': 'Walk_Loop',
    'Run': 'Jog_Fwd_Loop',
    'Sprint': 'Sprint_Loop',
    'Seated': 'Sitting_Idle_Loop',
}
HUMANOID_SOURCE = {
    'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_02',
    'upperChest': 'spine_03', 'neck': 'neck_01', 'head': 'Head',
}
for side, suffix in [('left', 'l'), ('right', 'r')]:
    for semantic, source in [
        ('Shoulder', 'clavicle'), ('UpperArm', 'upperarm'),
        ('LowerArm', 'lowerarm'), ('Hand', 'hand'), ('UpperLeg', 'thigh'),
        ('LowerLeg', 'calf'), ('Foot', 'foot'), ('Toes', 'ball'),
    ]:
        HUMANOID_SOURCE[side + semantic] = source + '_' + suffix
    for finger, source in [('Index', 'index'), ('Middle', 'middle'),
                           ('Ring', 'ring'), ('Little', 'pinky')]:
        for joint, number in [('Proximal', 1), ('Intermediate', 2), ('Distal', 3)]:
            HUMANOID_SOURCE[side + finger + joint] = f'{source}_0{number}_{suffix}'
    for joint, number in [('Metacarpal', 1), ('Proximal', 2), ('Distal', 3)]:
        HUMANOID_SOURCE[side + 'Thumb' + joint] = f'thumb_0{number}_{suffix}'

# VRM 0 Sakurada faces -Z. Rotate the +Z UAL source around world Y first.
BLENDER_TO_GLTF = Matrix.Rotation(math.pi, 4, 'Y') @ Matrix(((1, 0, 0, 0), (0, 0, 1, 0),
                          (0, -1, 0, 0), (0, 0, 0, 1)))
AXES = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)),
        'Z': Vector((0, 0, 1))}


def load_glb(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError('Expected a valid glTF 2 binary')
    offset, document, binary = 12, None, None
    while offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == 0x4E4F534A:
            document = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += 8 + size
    if document is None or binary is None or len(document['buffers']) != 1:
        raise ValueError('Expected one embedded GLB buffer')
    return document, bytearray(binary), data


def save_glb(path, document, binary):
    document['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(struct.pack('<III', 0x46546C67, 2, total)
                           + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
                           + struct.pack('<II', len(binary), 0x004E4942) + binary)


def quaternion(node):
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    return Quaternion((w, x, y, z)).normalized()


def local_matrix(node):
    if 'matrix' in node:
        values = node['matrix']
        return Matrix([values[i::4] for i in range(4)])
    return Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])),
                              quaternion(node), Vector(node.get('scale', [1, 1, 1])))


def append_accessor(document, binary, rows, kind):
    dimensions = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[kind]
    binary += b'\0' * (-len(binary) % 4)
    offset = len(binary)
    flat = [number for row in rows for number in (row if dimensions > 1 else [row])]
    binary += struct.pack('<' + 'f' * len(flat), *flat)
    view = len(document.setdefault('bufferViews', []))
    document['bufferViews'].append({'buffer': 0, 'byteOffset': offset,
                                    'byteLength': 4 * len(flat)})
    index = len(document.setdefault('accessors', []))
    accessor = {'bufferView': view, 'componentType': 5126, 'count': len(rows), 'type': kind}
    if kind == 'SCALAR':
        accessor.update(min=[min(rows)], max=[max(rows)])
    document['accessors'].append(accessor)
    return index


def read_accessor(document, binary, index):
    accessor = document['accessors'][index]
    view = document['bufferViews'][accessor['bufferView']]
    dimensions = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[accessor['type']]
    code, size = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}[accessor['componentType']]
    stride = view.get('byteStride', dimensions * size)
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return [struct.unpack_from('<' + code * dimensions, binary, offset + row * stride)
            for row in range(accessor['count'])]


def garment_skin(document, binary, material_name, cloth_joints):
    for mesh_node in document['nodes']:
        if 'mesh' not in mesh_node or 'skin' not in mesh_node:
            continue
        for primitive in document['meshes'][mesh_node['mesh']]['primitives']:
            if material_name not in document['materials'][primitive['material']].get('name', ''):
                continue
            skin = document['skins'][mesh_node['skin']]
            inverse_bind = [Matrix([values[i::4] for i in range(4)])
                            for values in read_accessor(document, binary, skin['inverseBindMatrices'])]
            attrs = primitive['attributes']
            points = read_accessor(document, binary, attrs['POSITION'])
            joints = read_accessor(document, binary, attrs['JOINTS_0'])
            weights = read_accessor(document, binary, attrs['WEIGHTS_0'])
            indices = [row[0] for row in read_accessor(document, binary, primitive['indices'])]
            return {'points': [Vector(point) for point in points], 'joints': joints, 'weights': weights,
                    'skin': skin['joints'], 'inverseBind': inverse_bind,
                    'triangles': [indices[index:index + 3] for index in range(0, len(indices), 3)],
                    'clothWeights': [{skin['joints'][joint]: weight
                                      for joint, weight in zip(vertex_joints, vertex_weights)
                                      if skin['joints'][joint] in cloth_joints and weight > 0}
                                     for vertex_joints, vertex_weights in zip(joints, weights)]}
    return None


def skin_points(garment, world):
    transforms = [world[joint] @ inverse for joint, inverse
                  in zip(garment['skin'], garment['inverseBind'])]
    return [sum((transforms[joint] @ point * weight for joint, weight in zip(joints, weights)
                 if weight > 0), Vector())
            for point, joints, weights in zip(garment['points'], garment['joints'], garment['weights'])]


def garment_clearance(shirt, shorts, cloth_joints, world):
    """Project six existing hem bones outside the evaluated shorts surface.

    This is an offline, deterministic skin binding correction, not new cloth
    geometry. Skinning is linear in a bone's world translation, so weighted
    projection resolves contacts while leaving vertex data and UVs untouched.
    """
    shirt_points = skin_points(shirt, world)
    tree = BVHTree.FromPolygons(skin_points(shorts, world), shorts['triangles'], all_triangles=True)
    deltas = {index: Vector() for index in cloth_joints}
    # Extra clearance covers both the garment's triangles between sampled
    # vertices and the subsequent cyclic smoothing of the baked bone tracks.
    margin = 0.018
    for _ in range(12):
        changed = False
        for point, weights in zip(shirt_points, shirt['clothWeights']):
            denominator = sum(weight * weight for weight in weights.values())
            if denominator < 0.002:
                continue
            moved = point + sum((deltas[index] * weight for index, weight in weights.items()), Vector())
            nearest, normal, _, distance = tree.find_nearest(moved)
            signed = (moved - nearest).dot(normal)
            if distance > 0.055 or signed >= margin:
                continue
            changed = True
            correction = normal * (margin - signed) * 0.8 / denominator
            for index, weight in weights.items():
                deltas[index] += correction * weight
                if deltas[index].length > 0.12:
                    deltas[index] = deltas[index].normalized() * 0.12
        if not changed:
            break
    return deltas


def set_action(rig, action):
    data = rig.animation_data_create()
    data.action = action
    if action is not None and len(action.slots):
        data.action_slot = action.slots[0]


def bake(avatar, motions, output):
    document, binary, original_file = load_glb(avatar)
    original_binary = bytes(binary)
    preserved = {key: copy.deepcopy(document.get(key))
                 for key in ('meshes', 'skins', 'materials', 'textures', 'images')}
    nodes = document['nodes']
    human_bones = {bone['bone']: {'node': bone['node']}
                   for bone in document['extensions']['VRM']['humanoid']['humanBones']}
    # VRM 0 uses Proximal/Intermediate/Distal for thumb joints.
    for side, suffix in [('left', 'l'), ('right', 'r')]:
        HUMANOID_SOURCE.pop(side + 'ThumbMetacarpal', None)
        for joint, number in [('Proximal', 1), ('Intermediate', 2), ('Distal', 3)]:
            HUMANOID_SOURCE[side + 'Thumb' + joint] = f'thumb_0{number}_{suffix}'
    mapped = {human_bones[name]['node']: source for name, source in HUMANOID_SOURCE.items()
              if name in human_bones}
    hips = human_bones['hips']['node']
    parents = {child: parent for parent, node in enumerate(nodes)
               for child in node.get('children', [])}
    rest_local = {index: local_matrix(node) for index, node in enumerate(nodes)}
    rest_rotation = {index: matrix.to_quaternion() for index, matrix in rest_local.items()}
    rest_world = {}

    def get_rest(index):
        if index not in rest_world:
            parent = get_rest(parents[index]) if index in parents else Matrix.Identity(4)
            rest_world[index] = parent @ rest_local[index]
        return rest_world[index]

    for index in range(len(nodes)):
        get_rest(index)
    constraints = {index: node['extensions']['VRMC_node_constraint']['constraint']
                   for index, node in enumerate(nodes)
                   if 'VRMC_node_constraint' in node.get('extensions', {})}
    spring_bone = document.get('extensions', {}).get('VRMC_springBone', {})
    cloth_springs = [spring for spring in spring_bone.get('springs', [])
                     if spring.get('name') == 'TopsUpperLeg']
    cloth_joints = {spring['joints'][0]['node'] for spring in cloth_springs}
    shirt = None
    shorts = None
    unsupported = [value for value in constraints.values()
                   if not any(kind in value for kind in ('roll', 'aim', 'rotation'))]
    if unsupported:
        raise ValueError(f'Unsupported constraints: {unsupported}')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1
    bpy.ops.import_scene.gltf(filepath=str(Path(motions).resolve()))
    rigs = [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError(f'Expected one source rig, got {len(rigs)}')
    rig = rigs[0]
    for track in list(rig.animation_data_create().nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    set_action(rig, None)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    source_actions = {action.name: action for action in bpy.data.actions}
    missing = set(CLIPS.values()) - set(source_actions)
    missing_bones = set(mapped.values()) - set(rig.data.bones.keys())
    if missing or missing_bones:
        raise ValueError(f'Missing source actions={missing}, bones={missing_bones}')
    source_rest = {name: BLENDER_TO_GLTF @ rig.matrix_world @ rig.data.bones[name].matrix_local
                   for name in mapped.values()}
    source_rest_inverse = {name: matrix.to_quaternion().inverted()
                           for name, matrix in source_rest.items()}
    height_ratio = rest_world[hips].translation.y / source_rest['pelvis'].translation.y
    animated = sorted(set(mapped) | set(constraints) | cloth_joints)
    report = {'sourceAvatar': str(avatar), 'sourceAvatarSha256': hashlib.sha256(original_file).hexdigest(),
              'sourceMotions': str(motions), 'output': str(output),
              'humanoidChannels': len(mapped), 'bakedConstraints': len(constraints),
              'rotationChannels': len(animated), 'pelvisHeightRatio': height_ratio,
              'restFacing': '-Z (native VRM 0; source UAL motion rotated by pi)',
              'springBones': 'Hair and clothing retain source rest transforms; no spring physics baked.',
              'clips': {}}
    document['animations'] = []

    for name, source_name in CLIPS.items():
        action = source_actions[source_name]
        set_action(rig, action)
        start, end = action.frame_range
        intervals = max(1, round(end - start))
        duration = float(end - start) / 30
        times = [duration * sample / intervals for sample in range(intervals + 1)]
        rotations = {index: [] for index in animated}
        translations, previous, sample_metrics = [], {}, []
        cloth_translations = {index: [] for index in cloth_joints}

        for sample in range(intervals + 1):
            frame = start + (end - start) * sample / intervals
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            evaluated = rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
            source_pose = {bone: BLENDER_TO_GLTF @ evaluated.matrix_world @ evaluated.pose.bones[bone].matrix
                           for bone in mapped.values()}
            desired_rotation = {
                index: source_pose[bone].to_quaternion() @ source_rest_inverse[bone]
                       @ rest_world[index].to_quaternion()
                for index, bone in mapped.items()
            }
            pelvis_delta = (source_pose['pelvis'].translation.y
                            - source_rest['pelvis'].translation.y) * height_ratio
            world, local_rotations, active = {}, {}, set()

            def solve(index):
                if index in world:
                    return world[index]
                if index in active:
                    raise ValueError(f'Constraint dependency cycle at {nodes[index].get("name")}')
                active.add(index)
                parent = solve(parents[index]) if index in parents else Matrix.Identity(4)
                parent_rotation = parent.to_quaternion()
                translation, rotation, scale = rest_local[index].decompose()
                if index == hips:
                    # Delta is a global Y translation; transform it through the parent.
                    translation += parent.inverted_safe().to_3x3() @ Vector((0, pelvis_delta, 0))
                if index in mapped:
                    rotation = parent_rotation.inverted() @ desired_rotation[index]
                if index in constraints:
                    constraint = constraints[index]
                    kind = next(key for key in ('roll', 'aim', 'rotation') if key in constraint)
                    spec = constraint[kind]
                    source = spec['source']
                    source_world = solve(source)
                    src_rest = rest_rotation[source]
                    dst_rest = rest_rotation[index]
                    if kind == 'aim':
                        sign = -1 if spec['aimAxis'].startswith('Negative') else 1
                        axis = AXES[spec['aimAxis'][-1]] * sign
                        origin = parent @ translation
                        to_vector = source_world.translation - origin
                        if to_vector.length_squared > 1e-12:
                            from_vector = parent_rotation @ dst_rest @ axis
                            swing = from_vector.rotation_difference(to_vector.normalized())
                            goal = parent_rotation.inverted() @ swing @ parent_rotation @ dst_rest
                        else:
                            goal = dst_rest.copy()
                    else:
                        delta = src_rest.inverted() @ local_rotations[source]
                        if kind == 'roll':
                            delta_parent = src_rest @ delta @ src_rest.inverted()
                            delta_dst = dst_rest.inverted() @ delta_parent @ dst_rest
                            axis = AXES[spec['rollAxis']]
                            swing = axis.rotation_difference(delta_dst @ axis)
                            goal = dst_rest @ swing.inverted() @ delta_dst
                        else:
                            goal = dst_rest @ delta
                    rotation = dst_rest.slerp(goal, spec.get('weight', 1))
                rotation.normalize()
                local_rotations[index] = rotation
                world[index] = parent @ Matrix.LocRotScale(translation, rotation, scale)
                active.remove(index)
                return world[index]

            for index in range(len(nodes)):
                solve(index)
            # The source avatar's loose shirt expects VRM spring colliders. Bake
            # their collision response into its six existing garment bones so a
            # plain GLTFLoader can keep the hem outside the shorts as well. The
            # extra 35 mm covers the shorts thickness beyond the skin collider.
            for spring in cloth_springs:
                index = spring['joints'][0]['node']
                tail_index = spring['joints'][1]['node']
                origin = world[index].translation
                rest_tail = world[tail_index].translation
                tail = rest_tail.copy()
                length = (tail - origin).length
                colliders = [spring_bone['colliders'][collider]
                             for group in spring.get('colliderGroups', [])
                             for collider in spring_bone['colliderGroups'][group]['colliders']]
                for _ in range(6):
                    for collider in colliders:
                        shape = collider.get('shape', {}).get('capsule')
                        if shape is None:
                            continue
                        transform = world[collider['node']]
                        start_point = transform @ Vector(shape.get('offset', [0, 0, 0]))
                        end_point = transform @ Vector(shape['tail'])
                        segment = end_point - start_point
                        amount = max(0, min(1, (tail - start_point).dot(segment) / segment.length_squared))
                        nearest = start_point + segment * amount
                        normal = tail - nearest
                        radius = shape['radius'] + spring['joints'][0].get('hitRadius', 0) + 0.035
                        if 1e-12 < normal.length_squared < radius * radius:
                            tail = nearest + normal.normalized() * radius
                            tail = origin + (tail - origin).normalized() * length
                swing = (rest_tail - origin).rotation_difference(tail - origin)
                parent_rotation = world[parents[index]].to_quaternion()
                local_rotations[index] = parent_rotation.inverted() @ swing @ parent_rotation @ local_rotations[index]
                translation, _, scale = rest_local[index].decompose()
                world[index] = world[parents[index]] @ Matrix.LocRotScale(translation, local_rotations[index], scale)
                world[tail_index] = world[index] @ rest_local[tail_index]
            if shirt is not None and shorts is not None:
                for index, delta in garment_clearance(shirt, shorts, cloth_joints, world).items():
                    world[index].translation += delta
                    for child in nodes[index].get('children', []):
                        world[child].translation += delta
            for index in cloth_joints:
                local = world[parents[index]].inverted_safe() @ world[index]
                cloth_translations[index].append(list(local.translation))
            for index in animated:
                rotation = local_rotations[index].copy()
                if index in previous:
                    rotation.make_compatible(previous[index])
                previous[index] = rotation
                rotations[index].append([rotation.x, rotation.y, rotation.z, rotation.w])
            hip_local = (world[parents[hips]].inverted_safe() @ world[hips]).translation
            translations.append(list(hip_local))
            if sample in {0, intervals // 4, intervals // 2, intervals * 3 // 4, intervals}:
                sample_metrics.append({'time': times[sample], 'joints': {
                    semantic: list(world[human_bones[semantic]['node']].translation)
                    for semantic in ['hips', 'head', 'leftHand', 'rightHand',
                                     'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
                                     'rightUpperLeg', 'rightLowerLeg', 'rightFoot']}})

        animation = {'name': name, 'samplers': [], 'channels': []}
        input_accessor = append_accessor(document, binary, times, 'SCALAR')
        for index in animated:
            output_accessor = append_accessor(document, binary, rotations[index], 'VEC4')
            sampler = len(animation['samplers'])
            animation['samplers'].append({'input': input_accessor, 'output': output_accessor,
                                          'interpolation': 'LINEAR'})
            animation['channels'].append({'sampler': sampler,
                                          'target': {'node': index, 'path': 'rotation'}})
        output_accessor = append_accessor(document, binary, translations, 'VEC3')
        animation['channels'].append({'sampler': len(animation['samplers']),
                                      'target': {'node': hips, 'path': 'translation'}})
        animation['samplers'].append({'input': input_accessor, 'output': output_accessor,
                                      'interpolation': 'LINEAR'})
        for index, values in cloth_translations.items():
            # Treat the endpoint as the start of the next cycle, avoiding a
            # visible fabric twitch from a BVH closest-face change at 30 Hz.
            cycle = values[:-1]
            values = [[sum(cycle[(sample + offset) % len(cycle)][axis] * weight
                           for offset, weight in [(-2, 1), (-1, 2), (0, 3), (1, 2), (2, 1)]) / 9
                       for axis in range(3)] for sample in range(len(cycle))]
            values.append(values[0][:])
            output_accessor = append_accessor(document, binary, values, 'VEC3')
            animation['channels'].append({'sampler': len(animation['samplers']),
                                          'target': {'node': index, 'path': 'translation'}})
            animation['samplers'].append({'input': input_accessor, 'output': output_accessor,
                                          'interpolation': 'LINEAR'})
        document['animations'].append(animation)
        max_seam = max(Quaternion((values[0][3], *values[0][:3])).rotation_difference(
            Quaternion((values[-1][3], *values[-1][:3]))).angle for values in rotations.values())
        report['clips'][name] = {'source': source_name, 'duration': duration,
                                 'samples': len(times), 'maxLoopSeamRadians': max_seam,
                                 'hipsY': [min(v[1] for v in translations), max(v[1] for v in translations)],
                                 'posesBeforeFacingWrapper': sample_metrics}
        print(f'BAKED {name}: {duration:.3f}s, {len(times)} samples, {len(animation["channels"])} tracks')

    # The tracks now own these nodes. Removing the runtime constraints prevents
    # a VRM-aware loader from applying the same transform for a second time.
    for index in constraints:
        del nodes[index]['extensions']['VRMC_node_constraint']
        if not nodes[index]['extensions']:
            del nodes[index]['extensions']
    for key in ('extensionsUsed', 'extensionsRequired'):
        if key in document:
            document[key] = [value for value in document[key] if value != 'VRMC_node_constraint']
    # Native VRM 0 Sakurada already faces -Z; do not add the VRM 1 wrapper.
    document.setdefault('asset', {}).setdefault('extras', {})['runnerRetarget'] = {
        'animationSource': 'Quaternius Universal Animation Library Standard (CC0)',
        'retarget': 'VRM humanoid world rotation delta, original bone lengths, baked VRMC constraints',
        'originalAvatarSha256': report['sourceAvatarSha256'],
    }
    report['preservation'] = {key: document.get(key) == value for key, value in preserved.items()}
    report['preservation']['originalBinaryPrefixByteIdentical'] = bytes(binary[:len(original_binary)]) == original_binary
    if not all(report['preservation'].values()):
        raise AssertionError('Original art was unexpectedly altered')
    save_glb(output, document, binary)
    report['outputBytes'] = Path(output).stat().st_size
    report_path = Path(output).with_suffix('.report.json')
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf8')
    print(f'WROTE {output}\nREPORT {report_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--avatar', required=True)
    parser.add_argument('--motions', required=True)
    parser.add_argument('--output', required=True)
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    bake(arguments.avatar, arguments.motions, arguments.output)
