"""Prepare the two existing CDS doors for runtime animation, without re-export.

This is an explicit postprocess of build-cds-full.py, not a generic mesh cutter.
All untouched vertex attributes, materials, images and node transforms retain
their source values. Only the four documented door leaves, their hardware, the
two center posts and the backing directly behind the openings are changed.
The editable .blend remains the closed-door source; this deterministic final
export step is recorded separately in the full-building manifest.
"""
from __future__ import annotations

import argparse
from collections import Counter
import copy
import hashlib
import json
import math
from pathlib import Path
import struct

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
REVISION = "cds-runtime-door-openings-20261020-v1"
AXES = [30.2, 44.2]
OFFSET = [35.75, 0, 21.15]
TOL = .00035
MOVING_KINDS = {"door leaf stile", "door leaf bottom rail", "door leaf top rail",
                "round pull grip", "handle glass fixing rose", "handle standoff"}
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
FORMATS = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_glb(path):
    raw = path.read_bytes()
    assert struct.unpack_from("<III", raw) == (0x46546C67, 2, len(raw))
    size, kind = struct.unpack_from("<II", raw, 12)
    assert kind == 0x4E4F534A
    return json.loads(raw[20:20 + size]), bytearray(raw[28 + size:])


def rows(doc, binary, index):
    a = doc["accessors"][index]
    v = doc["bufferViews"][a["bufferView"]]
    fmt = "<" + FORMATS[a["componentType"]] * COMPONENTS[a["type"]]
    size = struct.calcsize(fmt)
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", size)
    return [list(struct.unpack_from(fmt, binary, start + i * stride)) for i in range(a["count"])]


def replace_rows(doc, binary, index, values):
    a = doc["accessors"][index]
    fmt = "<" + FORMATS[a["componentType"]] * COMPONENTS[a["type"]]
    binary.extend(b"\0" * (-len(binary) % 4))
    start = len(binary)
    for row in values:
        binary.extend(struct.pack(fmt, *row))
    old = doc["bufferViews"][a["bufferView"]]
    view = {"buffer": 0, "byteOffset": start, "byteLength": len(binary) - start}
    if "target" in old:
        view["target"] = old["target"]
    doc["bufferViews"].append(view)
    a["bufferView"] = len(doc["bufferViews"]) - 1
    a.pop("byteOffset", None)
    a["count"] = len(values)
    for key, reducer in (("min", min), ("max", max)):
        if key in a:
            a[key] = [reducer(row[i] for row in values) for i in range(len(values[0]))]


def packed_glb(document, binary):
    """Discard obsolete views, copying every retained view byte-for-byte."""
    doc = copy.deepcopy(document)
    references = [a for a in doc["accessors"] if "bufferView" in a]
    references += [i for i in doc.get("images", []) if "bufferView" in i]
    for a in doc["accessors"]:
        references += list(a.get("sparse", {}).values()) if a.get("sparse") else []
    live = sorted({r["bufferView"] for r in references if isinstance(r, dict) and "bufferView" in r})
    packed, views, mapping = bytearray(), [], {}
    for old in live:
        view = copy.deepcopy(doc["bufferViews"][old])
        packed.extend(b"\0" * (-len(packed) % 4))
        offset = view.get("byteOffset", 0)
        chunk = binary[offset:offset + view["byteLength"]]
        view["byteOffset"] = len(packed)
        mapping[old] = len(views)
        views.append(view)
        packed.extend(chunk)
    for ref in references:
        if isinstance(ref, dict) and "bufferView" in ref:
            ref["bufferView"] = mapping[ref["bufferView"]]
    packed.extend(b"\0" * (-len(packed) % 4))
    doc["bufferViews"], doc["buffers"] = views, [{"byteLength": len(packed)}]
    encoded = json.dumps(doc, separators=(",", ":"), ensure_ascii=True).encode()
    encoded += b" " * (-len(encoded) % 4)
    return (struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(packed))
            + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
            + struct.pack("<II", len(packed), 0x004E4942) + packed)


def texture_free(doc):
    doc = copy.deepcopy(doc)
    def strip(value):
        if isinstance(value, dict):
            for key in list(value):
                if key.endswith("Texture"):
                    value.pop(key)
                else:
                    strip(value[key])
        elif isinstance(value, list):
            for child in value:
                strip(child)
    for material in doc.get("materials", []):
        strip(material)
    for key in ("images", "textures", "samplers"):
        doc.pop(key, None)
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in doc:
            doc[key] = [v for v in doc[key] if not v.startswith("KHR_texture_")
                        and v not in ("EXT_texture_webp", "EXT_texture_avif")]
            if not doc[key]:
                doc.pop(key)
    return doc


def inside_box(points, lo, hi):
    return all(lo[i] - TOL <= p[i] <= hi[i] + TOL for p in points for i in range(3))


def clip(poly, axis, edge, keep_less):
    """Clip all glTF attribute channels together at an axis-aligned plane."""
    if not poly:
        return []
    out = []
    def within(v):
        d = v["POSITION"][axis] - edge
        return d <= 1e-9 if keep_less else d >= -1e-9
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ai, bi = within(a), within(b)
        if ai:
            out.append(a)
        if ai != bi:
            t = (edge - a["POSITION"][axis]) / (b["POSITION"][axis] - a["POSITION"][axis])
            out.append({key: [x + (y - x) * t for x, y in zip(a[key], b[key])] for key in a})
    return out


def subtract_rect(poly, xmin, xmax, ymin, ymax):
    remaining, outside = poly, []
    for axis, edge, inside_less in ((0, xmin, False), (0, xmax, True), (1, ymin, False), (1, ymax, True)):
        piece = clip(remaining, axis, edge, not inside_less)
        if len(piece) >= 3:
            outside.append(piece)
        remaining = clip(remaining, axis, edge, inside_less)
        if not remaining:
            break
    return outside


def nonzero_triangle(points):
    a, b, c = points
    u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
    cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    return sum(x * x for x in cross) > 1e-16


def triangle_count(doc):
    return sum(doc["accessors"][p["indices"]]["count"] // 3 for m in doc["meshes"] for p in m["primitives"])


def prepare(asset=None, mobile=None):
    asset = Path(asset or REPO / "public/assets/bu-cds/cds-full.glb")
    mobile = Path(mobile or HERE / "full/cds-mobile-source.glb")
    manifest_path = asset.parent / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    doc, binary = read_glb(asset)
    if doc.get("asset", {}).get("extras", {}).get("runtimeDoorPreparation") == REVISION:
        assert manifest["sha256"] == digest(asset), "Prepared asset changed outside the pipeline"
        assert manifest["mobileOfflineSource"]["sha256"] == digest(mobile), "Prepared mobile source changed"
        return manifest["runtimeDoorPreparation"]
    before_hash, before_triangles = digest(asset), triangle_count(doc)
    source_nodes = copy.deepcopy(doc["nodes"])
    source_materials = copy.deepcopy(doc["materials"])
    source_images = [bytes(binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
                     for image in doc.get("images", []) for v in [doc["bufferViews"][image["bufferView"]]]]
    assert all(not any(k in n for k in ("translation", "rotation", "scale", "matrix"))
               for n in doc["nodes"] if "mesh" in n), "Expected applied CDS sample transforms"
    accepted = json.loads((HERE / "pass2/manifest.json").read_text(encoding="utf8"))
    detail = next(s["detail"] for s in accepted["samples"] if s["id"] == "cds-ground")
    moving = [p for p in detail["parts"] if p["kind"] in MOVING_KINDS]
    assert len(moving) == 36, "The accepted four-leaf hardware contract changed"
    # Metadata is Blender (x,-z,y); the GLB is Three (x,y,z).
    moving_boxes = [(p, [p["min"][0], p["min"][2], -p["max"][1]],
                    [p["max"][0], p["max"][2], -p["min"][1]]) for p in moving]
    removed, records, clipped_faces, added_faces = Counter(), [], 0, 0
    matched_parts = set()
    for mesh_index, mesh in enumerate(doc["meshes"]):
        owners = [n["name"] for n in doc["nodes"] if n.get("mesh") == mesh_index]
        assert len(owners) == 1, "Expected one named CDS node per geometry batch"
        name = owners[0]
        if name not in ("BU architecture · glassShade", "BU architecture · frame", "CDS pass2 · metal construction"):
            continue
        for primitive in mesh["primitives"]:
            attrs = {key: rows(doc, binary, index) for key, index in primitive["attributes"].items()}
            indices = [r[0] for r in rows(doc, binary, primitive["indices"])]
            retained, new_polys, removed_here = [], [], Counter()
            for start in range(0, len(indices), 3):
                ids = indices[start:start + 3]
                points = [attrs["POSITION"][i] for i in ids]
                original = [[p[i] + OFFSET[i] for i in range(3)] for p in points]
                reason = None
                if name == "BU architecture · glassShade":
                    for center in AXES:
                        for side in (-1, 1):
                            leaf = center + side * .725
                            if inside_box(original, [leaf - .685, .15, 18.848], [leaf + .685, 2.8, 18.848]):
                                reason = "leaf-pane"
                    if not reason and all(abs(p[2] - 18.618) <= TOL for p in original):
                        assert all(-.001 <= p[1] <= 5.601 for p in original)
                        polygons = [{key: attrs[key][i] for key in attrs} for i in ids]
                        pieces = [polygons]
                        for center in AXES:
                            pieces = [part for poly in pieces for part in subtract_rect(
                                poly, center - OFFSET[0] - 1.4125, center - OFFSET[0] + 1.4125, .10, 2.85)]
                        new_polys.extend(pieces)
                        clipped_faces += 1
                        reason = "backing-source-triangle"
                elif name == "BU architecture · frame":
                    for center in AXES:
                        if inside_box(original, [center - .0325, .10, 18.838], [center + .0325, 2.85, 18.938]):
                            reason = "center-post"
                else:
                    for i, (part, lo, hi) in enumerate(moving_boxes):
                        if inside_box(points, lo, hi):
                            reason = "moving-hardware"
                            matched_parts.add(i)
                if reason:
                    removed_here[reason] += 1
                else:
                    retained.extend(ids)
            for poly in new_polys:
                for j in range(1, len(poly) - 1):
                    triangle = [poly[0], poly[j], poly[j + 1]]
                    if not nonzero_triangle([v["POSITION"] for v in triangle]):
                        continue
                    for vertex in triangle:
                        retained.append(len(attrs["POSITION"]))
                        for key in attrs:
                            value = list(vertex[key])
                            if key in ("NORMAL", "TANGENT"):
                                length = math.sqrt(sum(v * v for v in value[:3]))
                                value[:3] = [v / length for v in value[:3]]
                                if key == "TANGENT":
                                    value[3] = -1 if value[3] < 0 else 1
                            attrs[key].append(value)
                    added_faces += 1
            if removed_here:
                if new_polys:
                    for key, values in attrs.items():
                        replace_rows(doc, binary, primitive["attributes"][key], values)
                replace_rows(doc, binary, primitive["indices"], [[i] for i in retained])
                removed.update(removed_here)
                records.append({"mesh": name, "removedTriangles": dict(removed_here), "retainedTriangles": len(retained) // 3})
    assert removed["leaf-pane"] == 8, removed
    assert removed["center-post"] == 88, removed
    assert clipped_faces == 2, clipped_faces
    assert len(matched_parts) == 36, sorted(set(range(36)) - matched_parts)
    # Sixteen one-segment bevelled bars (44 triangles each), plus twenty
    # twelve-sided bevelled grip/rose/standoff cylinders (92 each).
    assert removed["moving-hardware"] == 16 * 44 + 20 * 92, removed
    assert doc["nodes"] == source_nodes and doc["materials"] == source_materials
    after_triangles = triangle_count(doc)
    assert after_triangles == before_triangles - sum(removed.values()) + added_faces
    report = {
        "revision": REVISION, "inputSHA256": before_hash,
        "beforeTriangles": before_triangles, "afterTriangles": after_triangles,
        "removedTriangles": dict(removed), "newBackingTriangles": added_faces,
        "changedMeshes": records, "movingDetailParts": 36,
        "doors": [{"id": name, "originalLocalCenter": [x, 0, 18.848],
                   "clearWidthBetweenJambs": 2.825, "backingOpening": {"width": 2.825, "bottom": .10, "top": 2.85},
                   "leafCenters": [x - .725, x + .725], "leafWidth": 1.37, "leafBottom": .15, "leafTop": 2.80,
                   "interiorCenter": [x, 0, 19.068]} for name, x in zip(("west", "east"), AXES)],
        "unchanged": ["node transforms", "materials and baked image bytes", "all ground/terrain/paving",
                      "all triangles outside the explicit static leaves/hardware/center posts and the two backing source triangles",
                      "all upper-storey geometry", "existing exterior collision"],
        "scope": "Exterior GLB only. Interior already has corresponding holes; runtime supplies animated leaves. "
                 "Door axes and dimensions retain the authored model, not an as-built survey.",
        "editableSource": "cds-full.blend retains the closed-door source. build-cds-full.py runs this exact postprocess on its export."
    }
    doc.setdefault("asset", {}).setdefault("extras", {})["runtimeDoorPreparation"] = REVISION
    doc["asset"]["extras"]["staticDoorLeaves"] = False
    raw = packed_glb(doc, binary)
    mobile_raw = packed_glb(texture_free(doc), binary)
    # Complete validation precedes mutation of either shipped file.
    asset.write_bytes(raw)
    mobile.write_bytes(mobile_raw)
    final, final_binary = read_glb(asset)
    images = [bytes(final_binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
              for image in final.get("images", []) for v in [final["bufferViews"][image["bufferView"]]]]
    assert images == source_images
    manifest["runtimeDoorPreparation"] = report
    manifest["afterClosedDoorBlenderFinishing"] = copy.deepcopy(manifest["after"])
    manifest["after"]["triangles"] = after_triangles
    manifest["triangleDelta"] = after_triangles - manifest["before"]["triangles"]
    manifest["sha256"], manifest["bytes"] = digest(asset), len(raw)
    manifest["mobileOfflineSource"].update(sha256=digest(mobile), bytes=len(mobile_raw))
    manifest["sourceFacesRetainedOutsideExplicitHandlesAndBevelSelections"] = False
    manifest["sourceFacesRetainedOutsideExplicitSelections"] = "Handles, bounded bevels, and runtimeDoorPreparation selections"
    manifest["protectedSurfaceGeometrySHA256Scope"] = "Closed-door Blender source before explicit runtime door export preparation"
    for path in (manifest_path, mobile.parent / "manifest.json"):
        path.write_text(json.dumps(manifest, indent=2), encoding="utf8")
    (mobile.parent / "door-preparation.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", type=Path)
    parser.add_argument("--mobile", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.asset, args.mobile)))
