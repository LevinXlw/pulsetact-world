"""Bounded, source-window-driven refinement for the 192 Bay State sample.

Use from Blender after loading bay-state-192.blend:
    new_objects, report = refine([o for o in bpy.context.scene.objects if o.type == "MESH"])

All dimensions introduced here are authored joinery approximations. Original
glass, openings, building mass and source objects are never modified.
"""
from __future__ import annotations

import json
import hashlib
import math
from pathlib import Path
import sys
import struct

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

REFINEMENT_ID = "bay-state-192-window-joinery-v2"
UP = Vector((0, 0, 1))


def glass_components(objects):
    result = []
    for obj in objects:
        if obj.type != "MESH" or not any("glass" in m.name.lower() for m in obj.data.materials):
            continue
        mesh = obj.data
        vertex_faces = {}
        for face in mesh.polygons:
            for vertex in face.vertices:
                vertex_faces.setdefault(vertex, []).append(face.index)
        remaining = set(range(len(mesh.polygons)))
        while remaining:
            stack, ids = [remaining.pop()], []
            while stack:
                index = stack.pop()
                ids.append(index)
                for vertex in mesh.polygons[index].vertices:
                    for neighbour in vertex_faces[vertex]:
                        if neighbour in remaining:
                            remaining.remove(neighbour)
                            stack.append(neighbour)
            vertices = {v for i in ids for v in mesh.polygons[i].vertices}
            points = [obj.matrix_world @ mesh.vertices[v].co for v in vertices]
            result.append({"object": obj, "faces": ids, "points": points, "indices": vertices})
    return sorted(result, key=lambda item: (round(min(p.z for p in item["points"]), 3), round(sum(p.x for p in item["points"]) / len(item["points"]), 3)))


def inspect(objects):
    windows = glass_components(objects)
    return [{
        "id": index, "faces": len(window["faces"]), "vertices": len(window["points"]),
        "bounds": {kind: [fn(p[k] for p in window["points"]) for k in range(3)] for kind, fn in (("min", min), ("max", max))},
        "normals": [list(window["object"].data.polygons[i].normal) for i in window["faces"]],
    } for index, window in enumerate(windows)]


def _fingerprint(objects):
    digest = hashlib.sha256()
    for obj in sorted(objects, key=lambda item: item.name):
        digest.update(obj.name.encode())
        digest.update(struct.pack("<16f", *(value for row in obj.matrix_world for value in row)))
        for vertex in obj.data.vertices:
            digest.update(struct.pack("<3f", *vertex.co))
        for polygon in obj.data.polygons:
            digest.update(struct.pack("<II", len(polygon.vertices), polygon.material_index))
            digest.update(struct.pack("<" + "I" * len(polygon.vertices), *polygon.vertices))
        for material in obj.data.materials:
            digest.update(material.name.encode())
        for layer in obj.data.uv_layers:
            for loop in layer.data:
                digest.update(struct.pack("<2f", *loop.uv))
    return digest.hexdigest()


def _bounds(objects):
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    return {name: [fn(p[k] for p in points) for k in range(3)] for name, fn in (("min", min), ("max", max))}


def _triangles(objects):
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def _window_path(window):
    """Use the actual connected lower boundary, not the curved window's AABB."""
    obj, ids = window["object"], window["faces"]
    mesh = obj.data
    low = min(p.z for p in window["points"])
    high = max(p.z for p in window["points"])
    edge_uses = {}
    for index in ids:
        face = mesh.polygons[index]
        for a, b in zip(face.vertices, (*face.vertices[1:], face.vertices[0])):
            key = tuple(sorted((a, b)))
            edge_uses[key] = edge_uses.get(key, 0) + 1
    adjacency = {}
    for (a, b), count in edge_uses.items():
        pa, pb = obj.matrix_world @ mesh.vertices[a].co, obj.matrix_world @ mesh.vertices[b].co
        if count == 1 and abs(pa.z - low) < .0001 and abs(pb.z - low) < .0001:
            adjacency.setdefault(a, []).append(b)
            adjacency.setdefault(b, []).append(a)
    ends = [index for index, links in adjacency.items() if len(links) == 1]
    if len(ends) != 2 or any(len(links) > 2 for links in adjacency.values()):
        raise RuntimeError("A source glass component lacks a single open bottom boundary")
    order, previous, current = [], None, ends[0]
    while True:
        order.append(current)
        options = [value for value in adjacency[current] if value != previous]
        if not options:
            break
        previous, current = current, options[0]
        if current in order:
            raise RuntimeError("Unexpected cycle in source window boundary")
    if len(order) != len(adjacency):
        raise RuntimeError("Disconnected source window bottom boundary")
    points = [obj.matrix_world @ mesh.vertices[index].co for index in order]
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    normal = sum((normal_matrix @ mesh.polygons[index].normal for index in ids), Vector()).normalized()
    if abs(normal.z) > .01:
        raise RuntimeError("This refinement only accepts vertical source glazing")
    if (points[-1] - points[0]).cross(normal).z < 0:
        points.reverse()
    points = [Vector((p.x, p.y, 0)) for p in points]
    lengths = [0.]
    normals = []
    for a, b in zip(points, points[1:]):
        delta = b - a
        lengths.append(lengths[-1] + delta.length)
        normals.append(Vector((-delta.y, delta.x, 0)).normalized())
    miters = []
    for i in range(len(points)):
        if i == 0:
            miter = normals[0]
        elif i == len(points) - 1:
            miter = normals[-1]
        else:
            bisector = (normals[i - 1] + normals[i]).normalized()
            divisor = bisector.dot(normals[i])
            if divisor < .85:
                raise RuntimeError("Source window has an unsupported sharp horizontal turn")
            miter = bisector / divisor
        miters.append(miter)
    if not .5 < lengths[-1] < 2.6 or not 1 < high - low < 3.3:
        raise RuntimeError("Source glass component is outside the bounded window size")
    return {"points": points, "lengths": lengths, "miters": miters, "width": lengths[-1], "low": low, "high": high, "normal": normal}


def _point(path, distance, depth=0, height=0):
    distance = min(path["width"], max(0., distance))
    for i, stop in enumerate(path["lengths"][1:]):
        if distance <= stop + 1e-8:
            start = path["lengths"][i]
            t = (distance - start) / (stop - start)
            xy = path["points"][i].lerp(path["points"][i + 1], t)
            miter = path["miters"][i].lerp(path["miters"][i + 1], t)
            return xy + miter * depth + UP * height
    raise RuntimeError("Window distance exceeds source boundary")


class _Batch:
    def __init__(self, material, finish):
        self.material = material
        self.finish = finish
        self.vertices = []
        self.faces = []
        self.parts = {}

    def sweep(self, path, start, end, profile, semantic):
        """One watertight swept bar; shared curve miters, caps only at true ends."""
        if end <= start or start < 0 or end > path["width"] + 1e-6:
            raise RuntimeError("Invalid source-relative joinery span")
        distances = [start] + [s for s in path["lengths"] if start + 1e-6 < s < end - 1e-6] + [end]
        offset, count = len(self.vertices), len(profile)
        for distance in distances:
            self.vertices.extend(_point(path, distance, depth, height) for depth, height in profile)
        for i in range(len(distances) - 1):
            a, b = offset + i * count, offset + (i + 1) * count
            for j in range(count):
                k = (j + 1) % count
                self.faces.append((a + j, b + j, b + k, a + k))
        self.faces.extend([tuple(offset + j for j in reversed(range(count))), tuple(offset + (len(distances) - 1) * count + j for j in range(count))])
        self.parts[semantic] = self.parts.get(semantic, 0) + 1

    def bar(self, path, start, end, low, high, back, front, semantic):
        self.sweep(path, start, end, [(back, low), (front, low), (front, high), (back, high)], semantic)

    def create(self):
        mesh = bpy.data.meshes.new("BU192 refined " + self.finish)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.materials.append(self.material)
        mesh.update()
        obj = bpy.data.objects.new("BU192 refinement · " + self.finish, mesh)
        bpy.context.collection.objects.link(obj)
        obj["buQualityRefinement"] = REFINEMENT_ID
        obj["bu_source_material"] = self.material.get("bu_source_material", self.material.name)
        obj["buSemanticParts"] = json.dumps(self.parts, sort_keys=True)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.normal_update()
        edges = [edge for edge in bm.edges if edge.is_manifold and edge.calc_face_angle(0) > math.radians(32)]
        # A 2 mm, one-segment chamfer softens joinery, not the source facade.
        bmesh.ops.bevel(bm, geom=edges, offset=.002, segments=1, profile=.5, affect="EDGES", clamp_overlap=True)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        # Export-ready metric UVs. The caller may run its shared metre_uv again.
        uv = mesh.uv_layers.new(name="UVMap")
        tw, th = (1., 1.) if self.finish == "frame" else (2.8, 1.4)
        for face in mesh.polygons:
            normal = face.normal
            axis = max(range(3), key=lambda i: abs(normal[i]))
            for loop_index in face.loop_indices:
                p = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                if axis == 2:
                    u, v = p.x, p.y
                elif axis == 1:
                    u, v = p.x * (1 if normal.y < 0 else -1), p.z
                else:
                    u, v = p.y * (1 if normal.x > 0 else -1), p.z
                uv.data[loop_index].uv = (u / tw, v / th)
        return obj


def _bvh(objects):
    vertices, polygons = [], []
    for obj in objects:
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
        polygons.extend(tuple(offset + v for v in face.vertices) for face in obj.data.polygons)
    return BVHTree.FromPolygons(vertices, polygons)


def _mesh_check(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    boundary = sum(not edge.is_manifold for edge in bm.edges)
    volume = bm.calc_volume(signed=True)
    bm.free()
    obj.data.calc_loop_triangles()
    degenerate = sum(triangle.area < 1e-12 for triangle in obj.data.loop_triangles)
    finite = all(math.isfinite(value) for v in obj.data.vertices for value in v.co)
    uv = obj.data.uv_layers.active
    uv_finite = uv is not None and all(math.isfinite(value) for entry in uv.data for value in entry.uv)
    passed = boundary == 0 and volume > 0 and degenerate == 0 and finite and uv_finite
    if not passed:
        raise RuntimeError(f"Invalid refined mesh: {obj.name}")
    return {"mesh": obj.name, "nonManifoldEdges": boundary, "signedVolumeCubicMetres": volume, "degenerateTriangles": degenerate, "finitePositionAndUV": finite and uv_finite, "passed": passed}


def refine(objects):
    """Return (new_mesh_objects, JSON-serializable report); never save/export."""
    objects = [obj for obj in objects if obj.type == "MESH"]
    if any(obj.get("buQualityRefinement") == REFINEMENT_ID for obj in objects):
        return [], {"id": REFINEMENT_ID, "alreadyRefined": True, "addedTriangles": 0}
    if not objects:
        raise RuntimeError("192 refinement requires the existing sample mesh objects")
    for obj in objects:
        if any(abs(obj.matrix_world[row][col] - (1 if row == col else 0)) > 1e-5 for row in range(4) for col in range(4)):
            raise RuntimeError("192 refinement expects the confirmed identity world matrices; apply the sample transform first")
    fingerprint = _fingerprint(objects)
    old_bounds, old_triangles = _bounds(objects), _triangles(objects)
    materials = {material.get("bu_source_material", material.name).split(".")[0]: material for obj in objects for material in obj.data.materials}
    if not all(name in materials for name in ("frame", "stone", "glass")):
        raise RuntimeError("Expected existing PBR frame, stone and glass materials")
    components = glass_components(objects)
    paths = [_window_path(window) for window in components]
    # The source sample has three source-authored bays on three storeys. Refuse
    # unreviewed extra/missing components rather than inventing facade windows.
    if len(paths) != 9:
        raise RuntimeError(f"Expected 9 connected 192 glass windows, found {len(paths)}")
    frame, stone = _Batch(materials["frame"], "frame"), _Batch(materials["stone"], "stone")
    window_report = []
    for index, path in enumerate(paths):
        width, low, high = path["width"], path["low"], path["high"]
        height = high - low
        outer, bead = .055, .020
        inset = outer + bead
        # Perimeter geometry follows the existing source opening. Its furthest
        # projection is .11 m from glazing, within the source's recessed reveal.
        for a, b in ((0., outer), (width - outer, width)):
            frame.bar(path, a, b, low, high, .018, .110, "outer-jamb")
        for a, b in ((low, low + outer), (high - outer, high)):
            frame.bar(path, outer, width - outer, a, b, .018, .110, "outer-head-sill")
        # Thin inner sash bead, distinct in depth from the structural perimeter.
        for a, b in ((outer, inset), (width - inset, width - outer)):
            frame.bar(path, a, b, low + outer, high - outer, .012, .058, "inner-sash-stile")
        for a, b in ((low + outer, low + inset), (high - inset, high - outer)):
            frame.bar(path, inset, width - inset, a, b, .012, .058, "inner-sash-rail")
        # Existing source windows already have a flat rail at 53% of height.
        # Upgrade that same axis to a solid member, never add another window row.
        meeting = low + height * .53
        frame.bar(path, inset, width - inset, meeting - .037, meeting + .037, .020, .105, "existing-axis-meeting-rail")
        # Slope only the sill's inner reveal; keep it within the original opening
        # and existing sill projection. No new projecting balcony or bay volume.
        stone.sweep(path, outer, width - outer, [(.065, low + .001), (.245, low + .001), (.245, low + .018), (.065, low + .035)], "sloped-sill-insert")
        window_report.append({
            "window": index + 1, "widthAlongSourceArc": width, "height": height,
            "centerBlender": list(_point(path, width / 2, 0, (low + high) / 2)),
            "sourceFacets": len(path["points"]) - 1, "existingMeetingRailFraction": .53,
            "authoredOuterFrameWidth": outer, "authoredSashBeadWidth": bead,
            "unobstructedGlazingAreaRatioApprox": ((width - 2 * inset) * (height - 2 * inset - .074)) / (width * height),
        })
    new_objects = [frame.create(), stone.create()]
    bpy.context.view_layer.update()
    added_triangles = _triangles(new_objects)
    final_bounds = _bounds(objects + new_objects)
    expansion = max(0., *(old_bounds["min"][i] - final_bounds["min"][i] for i in range(3)), *(final_bounds["max"][i] - old_bounds["max"][i] for i in range(3)))
    if added_triangles >= 12000 or expansion > .001:
        raise RuntimeError(f"Refinement budget/envelope exceeded: {added_triangles} triangles, {expansion} m")
    if _fingerprint(objects) != fingerprint:
        raise RuntimeError("A source object was modified by refinement")
    mesh_checks = [_mesh_check(obj) for obj in new_objects]
    added_bvh = _bvh(new_objects)
    source_glass = _bvh([obj for obj in objects if any("glass" in m.name.lower() for m in obj.data.materials)])
    visibility = []
    for index, path in enumerate(paths):
        for leaf in (.28, .77):
            for across in (.25, .47, .75):
                height = path["low"] + (path["high"] - path["low"]) * leaf
                point = _point(path, path["width"] * across, 0, height)
                normal = (_point(path, path["width"] * across, .1, height) - point).normalized()
                origin = point + normal * .5
                source_hit = source_glass.ray_cast(origin, -normal, .55)
                blocked = added_bvh.ray_cast(origin, -normal, .49)[0] is not None
                passed = source_hit[0] is not None and abs(source_hit[3] - .5) < .003 and not blocked
                visibility.append({"window": index + 1, "leafHeightFraction": leaf, "arcWidthFraction": across, "originalGlassHit": source_hit[0] is not None, "newFrameBlocksClearPane": blocked, "passed": passed})
    if not all(item["passed"] for item in visibility):
        raise RuntimeError("A new member obscures a source clear pane or a glass opening moved")
    return new_objects, {
        "id": REFINEMENT_ID, "sourceObjectsUnchanged": True, "sourceGeometryUVSHA256": fingerprint,
        "sourceTriangles": old_triangles, "addedTriangles": added_triangles, "totalTriangles": old_triangles + added_triangles,
        "newMeshBatches": len(new_objects), "newMaterials": 0, "newTextures": 0,
        "boundsBeforeBlender": old_bounds, "boundsAfterBlender": final_bounds,
        "outwardEnvelopeExpansionMetres": expansion,
        "semanticParts": {**frame.parts, **stone.parts}, "windows": window_report,
        "clearPaneRayChecks": visibility, "newMeshChecks": mesh_checks,
        "dimensionsAreAuthored": True,
        "sourceBasis": "Existing 192 glass boundaries, source 53% meeting-rail axes and recessed sill positions. Joinery widths/profile are design approximations, not surveyed details.",
        "cornice": "Existing source cornice and its prior closed-component bevels retained; no unsupported new dentils or ornament.",
    }


if __name__ == "__main__":
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if "--inspect" in sys.argv:
        print("BU_BAY_STATE_INSPECT " + json.dumps(inspect(objects)))
    else:
        added, report = refine(objects)
        print("BU_BAY_STATE_REFINEMENT " + json.dumps(report))
