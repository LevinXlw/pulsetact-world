"""Validate exported BU sample GLBs with Python's standard library only.

Checks the actual embedded buffers and PBR references, not merely .blend data.
Run using Blender's bundled Python or any Python 3.11+ interpreter.
"""
import argparse
import json
import math
from pathlib import Path
import struct

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--directory", type=Path, default=REPO / "public/assets/bu-quality")
parser.add_argument("--report", type=Path, default=HERE / "verification.json")
args = parser.parse_args()
checks = []


def check(condition, name):
    checks.append({"name": name, "passed": bool(condition)})
    if not condition:
        raise AssertionError(name)


def inspect(sample_id):
    path = args.directory / (sample_id + ".glb")
    data = path.read_bytes()
    magic, version, total = struct.unpack_from("<III", data)
    check(magic == 0x46546C67 and version == 2 and total == len(data), sample_id + ": valid GLB header")
    json_size, json_type = struct.unpack_from("<II", data, 12)
    check(json_type == 0x4E4F534A, sample_id + ": JSON chunk")
    doc = json.loads(data[20:20 + json_size])
    binary_size, binary_type = struct.unpack_from("<II", data, 20 + json_size)
    binary = data[28 + json_size:]
    check(binary_type == 0x004E4942 and len(binary) == binary_size, sample_id + ": complete binary chunk")
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    formats = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}

    def accessor(index):
        a = doc["accessors"][index]
        view = doc["bufferViews"][a["bufferView"]]
        fmt = "<" + formats[a["componentType"]] * components[a["type"]]
        width = struct.calcsize(fmt)
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = view.get("byteStride", width)
        assert start + stride * (a["count"] - 1) + width <= len(binary)
        return [struct.unpack_from(fmt, binary, start + i * stride) for i in range(a["count"])]

    triangles = 0
    input_manifest = json.loads((HERE / "input/manifest.json").read_text(encoding="utf-8"))
    source_sample = next(sample for sample in input_manifest["samples"] if sample["id"] == sample_id)
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            attrs = primitive["attributes"]
            label = sample_id + ": " + mesh.get("name", "mesh")
            check(all(k in attrs for k in ("POSITION", "NORMAL", "TEXCOORD_0", "TANGENT")), label + " PBR attributes")
            position, normal, uv, tangent = (accessor(attrs[key]) for key in ("POSITION", "NORMAL", "TEXCOORD_0", "TANGENT"))
            indices = accessor(primitive["indices"])
            check(len(indices) % 3 == 0 and all(0 <= value[0] < len(position) for value in indices), label + " triangle indices")
            check(all(len(a) == len(position) for a in (normal, uv, tangent)), label + " aligned attribute counts")
            check(all(math.isfinite(v) for attr in (position, normal, uv, tangent) for entry in attr for v in entry), label + " finite geometry and UV")
            check(all(abs(sum(v * v for v in n) - 1) < .002 for n in normal), label + " unit normals")
            check(all(abs(sum(v * v for v in t[:3]) - 1) < .002 and abs(abs(t[3]) - 1) < .001 for t in tangent), label + " tangent frames")
            check(all(abs(sum(n[i] * t[i] for i in range(3))) < .003 for n, t in zip(normal, tangent)), label + " orthogonal tangent frames")
            triangles += len(indices) // 3
    images = []
    for image in doc["images"]:
        check(image.get("mimeType") == "image/png" and "bufferView" in image, sample_id + ": embedded PNG " + image.get("name", ""))
        view = doc["bufferViews"][image["bufferView"]]
        blob = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        check(blob[:8] == b"\x89PNG\r\n\x1a\n", sample_id + ": PNG signature")
        width, height = struct.unpack_from(">II", blob, 16)
        check((width, height) in ((1024, 1024), (512, 512)), sample_id + ": bounded texture resolution")
        images.append({"name": image.get("name"), "width": width, "height": height, "bytes": len(blob)})
    for material in doc["materials"]:
        pbr = material["pbrMetallicRoughness"]
        label = sample_id + ": " + material["name"]
        check(material.get("alphaMode", "OPAQUE") == "OPAQUE" and pbr.get("baseColorFactor", [1, 1, 1, 1])[3] == 1, label + " opaque facade")
        check(material.get("emissiveFactor", [0, 0, 0]) == [0, 0, 0] and "emissiveTexture" not in material, label + " no emission")
        if "glass" in material["name"].lower():
            check(abs(pbr.get("roughnessFactor", 1) - .16) < .001, label + " glass roughness")
            check("KHR_materials_transmission" not in material.get("extensions", {}), label + " no fictional interior transmission")
            check(pbr.get("metallicFactor", 1) == 0, label + " dielectric glass")
            source_name = material.get("extras", {}).get("bu_source_material", "").split(".")[0]
            source_material = next(item for item in source_sample["materials"] if item["finish"] == source_name)
            factor = .2 if sample_id == "cds-ground" else 1
            expected = [v * factor for v in source_material["color"]]
            check(all(abs(a - b) < 1e-6 for a, b in zip(pbr["baseColorFactor"][:3], expected)), label + " sample-specific linear glass tint")
        else:
            check(all(key in pbr for key in ("baseColorTexture", "metallicRoughnessTexture")) and "normalTexture" in material, label + " baked PBR channels")
    return {"id": sample_id, "bytes": len(data), "triangles": triangles, "meshes": len(doc["meshes"]), "materials": len(doc["materials"]), "images": images}


report = {"samples": [], "checks": checks}
try:
    for sample_id in ("bay-state-192", "cds-ground"):
        report["samples"].append(inspect(sample_id))
    total = sum(sample["bytes"] for sample in report["samples"])
    check(total < 10 * 1024 * 1024, "Both review samples together stay below 10 MiB")
    report["totalBytes"] = total
    report["passed"] = True
finally:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"checks": len(checks), "passed": True, "samples": [{k: v for k, v in s.items() if k != "images"} for s in report["samples"]]}))
