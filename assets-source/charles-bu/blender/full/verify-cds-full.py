"""Read the actual full-CDS GLBs and validate geometry/PBR/mobile parity.

Uses only Python's standard library; Blender is not required. Checks buffer
contents rather than trusting the builder report. Does not modify assets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]


def read_glb(path):
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from("<III", raw)
    assert magic == 0x46546C67 and version == 2 and total == len(raw), "Invalid GLB header"
    size, kind = struct.unpack_from("<II", raw, 12)
    assert kind == 0x4E4F534A
    document = json.loads(raw[20:20 + size])
    binary_size, binary_kind = struct.unpack_from("<II", raw, 20 + size)
    binary = raw[28 + size:]
    assert binary_kind == 0x004E4942 and len(binary) == binary_size
    return document, binary


def accessor(document, binary, index):
    item = document["accessors"][index]
    view = document["bufferViews"][item["bufferView"]]
    types = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    formats = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
    fmt = "<" + formats[item["componentType"]] * types[item["type"]]
    width = struct.calcsize(fmt)
    start = view.get("byteOffset", 0) + item.get("byteOffset", 0)
    stride = view.get("byteStride", width)
    assert start + stride * (item["count"] - 1) + width <= len(binary)
    return [struct.unpack_from(fmt, binary, start + i * stride) for i in range(item["count"])]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", type=Path, default=REPO / "public/assets/bu-cds/cds-full.glb")
    parser.add_argument("--mobile", type=Path, default=HERE / "cds-mobile-source.glb")
    parser.add_argument("--report", type=Path, default=HERE / "verification.json")
    args = parser.parse_args()
    checks, report = [], {"passed": False}

    def check(condition, name):
        checks.append({"name": name, "passed": bool(condition)})
        if not condition:
            raise AssertionError(name)

    try:
        document, binary = read_glb(args.asset)
        mobile, mobile_binary = read_glb(args.mobile)
        manifest = json.loads((args.asset.parent / "manifest.json").read_text(encoding="utf-8"))
        check(hashlib.sha256(args.asset.read_bytes()).hexdigest() == manifest["sha256"], "PBR asset matches finished manifest hash")
        check(hashlib.sha256(args.mobile.read_bytes()).hexdigest() == manifest["mobileOfflineSource"]["sha256"], "Mobile source matches finished manifest hash")
        check(args.asset.stat().st_size < 10 * 1024 * 1024, "Full PBR asset below 10 MiB")
        check(not any(key in mobile for key in ("textures", "images", "samplers")), "Mobile source contains no image loader inputs")
        check(document["meshes"] == mobile["meshes"] and document["nodes"] == mobile["nodes"], "Mobile source retains exact PBR meshes and node transforms")
        check(len(document["accessors"]) == len(mobile["accessors"]), "Mobile source retains all geometry accessors")
        for index in range(len(document["accessors"])):
            check(accessor(document, binary, index) == accessor(mobile, mobile_binary, index), f"Mobile accessor {index} is byte-value identical")
        total_triangles, primitives = 0, 0
        heights = []
        for mesh in document["meshes"]:
            for primitive in mesh["primitives"]:
                primitives += 1
                label = mesh.get("name", "mesh")
                attrs = primitive["attributes"]
                check(all(key in attrs for key in ("POSITION", "NORMAL", "TEXCOORD_0", "TANGENT")), label + ": PBR geometry attributes")
                position, normal, uv, tangent = [accessor(document, binary, attrs[key]) for key in ("POSITION", "NORMAL", "TEXCOORD_0", "TANGENT")]
                indices = accessor(document, binary, primitive["indices"])
                check(len(indices) % 3 == 0 and all(0 <= value[0] < len(position) for value in indices), label + ": triangle indices")
                check(all(len(attribute) == len(position) for attribute in (normal, uv, tangent)), label + ": attribute counts")
                check(all(math.isfinite(value) for attribute in (position, normal, uv, tangent) for row in attribute for value in row), label + ": finite buffers")
                check(all(abs(sum(value * value for value in row) - 1) < .002 for row in normal), label + ": unit normals")
                check(all(abs(sum(value * value for value in row[:3]) - 1) < .002 and abs(abs(row[3]) - 1) < .001 for row in tangent), label + ": tangent frames")
                check(all(abs(sum(n[i] * t[i] for i in range(3))) < .003 for n, t in zip(normal, tangent)), label + ": orthogonal tangent frames")
                heights.extend(p[1] for p in position)
                total_triangles += len(indices) // 3
        check(primitives <= 20 and primitives == manifest["primitives"], "At most 20 draw calls")
        check(total_triangles == manifest["after"]["triangles"], "Exported triangle count matches measured full building")
        check(max(heights) > 90, "Asset contains the full-height CDS tower, not the clipped study")
        check(manifest["outwardExpansionMetres"] <= .001, "Source site envelope is preserved")
        check(len(manifest["removedOldHandles"]) == 4 and sum(h["triangles"] for h in manifest["removedOldHandles"]) == 48, "Only the four identified old 12-triangle handles were removed")
        check(manifest["reviewedEntry"]["triangles"] == 4040 and len(manifest["reviewedEntry"]["objects"]) == 2, "Closed-door finishing uses the two reviewed entry-detail batches")
        preparation = manifest.get("runtimeDoorPreparation")
        if preparation:
            check(document.get("asset", {}).get("extras", {}).get("runtimeDoorPreparation") == preparation["revision"], "Runtime door preparation revision is embedded")
            check(preparation["removedTriangles"] == {"moving-hardware": 2544, "center-post": 88, "backing-source-triangle": 2, "leaf-pane": 8}, "Only documented static leaves, hardware, center posts and backing planes are selected")
            check(preparation["movingDetailParts"] == 36 and preparation["newBackingTriangles"] == 22, "Four complete moving hardware sets and two precise backing openings")
            check(preparation["afterTriangles"] == total_triangles and preparation["beforeTriangles"] - total_triangles == 2620, "Door preparation reduces static geometry by 2620 triangles")
        images = []
        for image in document.get("images", []):
            check(image.get("mimeType") == "image/png" and "bufferView" in image, "Embedded PNG: " + image.get("name", ""))
            view = document["bufferViews"][image["bufferView"]]
            blob = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
            check(blob[:8] == b"\x89PNG\r\n\x1a\n", "Valid PNG signature")
            width, height = struct.unpack_from(">II", blob, 16)
            check((width, height) in ((1024, 1024), (512, 512)), "Bounded shared texture resolution")
            images.append({"name": image.get("name"), "width": width, "height": height, "bytes": len(blob)})
        for material, mobile_material in zip(document["materials"], mobile["materials"]):
            pbr = material["pbrMetallicRoughness"]
            label = material["name"]
            family = material.get("extras", {}).get("bu_texture_family")
            check(material.get("alphaMode", "OPAQUE") == "OPAQUE" and pbr.get("baseColorFactor", [1, 1, 1, 1])[3] == 1, label + ": opaque exterior")
            check(material.get("emissiveFactor", [0, 0, 0]) == [0, 0, 0] and "emissiveTexture" not in material, label + ": no emission")
            check(pbr["baseColorFactor"] == mobile_material["pbrMetallicRoughness"]["baseColorFactor"], label + ": identical mobile base tint")
            check("Texture" not in json.dumps(mobile_material), label + ": no mobile material texture references")
            if family == "glass":
                check(abs(pbr.get("roughnessFactor", 1) - .16) < .001 and pbr.get("metallicFactor", 1) == 0, label + ": reviewed dielectric glass")
                check("KHR_materials_transmission" not in material.get("extensions", {}), label + ": no invented interior transmission")
                check(abs(material["extras"]["bu_glass_tint_scale"] - .2) < 1e-8, label + ": reviewed glass tint scale")
            elif family != "plain":
                check("baseColorTexture" in pbr and "metallicRoughnessTexture" in pbr and "normalTexture" in material, label + ": baked base/normal/roughness channels")
        for path, expected in manifest["previousAssetsUnchangedSHA256"].items():
            check(hashlib.sha256(Path(path).read_bytes()).hexdigest() == expected, "Previous review asset unchanged: " + Path(path).name)
        report.update({"passed": True, "triangles": total_triangles, "primitives": primitives, "pbrBytes": args.asset.stat().st_size, "mobileBytes": args.mobile.stat().st_size, "images": images})
    finally:
        report["checks"] = checks
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in ("checks", "images")} | {"checks": len(checks)}))


if __name__ == "__main__":
    main()
