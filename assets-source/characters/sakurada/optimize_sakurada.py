"""Reduce runner texture cost without re-exporting geometry, rig, or animation.

Run with Blender's Python, for example:
  blender --background --python-exit-code 1 --python
  assets/blender/optimize_imported_runner.py --
  --input output/imported-runner-cloth2.glb --output output/runner-vrm-optimized.glb

The game's GLTFLoader uses MeshBasicMaterial for KHR_materials_unlit. Its later
ArtMaterials conversion samples the base-color map, not the unused VRM normal,
outline, or specular maps. Standard lit materials retain normal/AO/emissive maps.
Face color and long-hair detail keep 1024 pixels; other maps use at most 512.
All non-image buffer views are copied byte for byte and verified after writing.
"""

import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile

import bpy


def read_glb(path):
    data = Path(path).read_bytes()
    if data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise ValueError("Expected GLB 2.0")
    if struct.unpack_from("<I", data, 8)[0] != len(data):
        raise ValueError("Truncated GLB")
    offset, document, binary = 12, None, None
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == 0x4E4F534A:
            document = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += 8 + length
    if document is None or binary is None or len(document.get("buffers", [])) != 1:
        raise ValueError("Expected one embedded JSON/BIN buffer")
    return data, document, binary


def write_glb(path, document, binary):
    document["buffers"][0]["byteLength"] = len(binary)
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    binary = bytes(binary) + b"\0" * (-len(binary) % 4)
    size = 12 + 8 + len(encoded) + 8 + len(binary)
    data = struct.pack("<4sII", b"glTF", 2, size)
    data += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    data += struct.pack("<II", len(binary), 0x004E4942) + binary
    Path(path).write_bytes(data)


def view_bytes(document, binary, index):
    view = document["bufferViews"][index]
    if view.get("buffer", 0) != 0:
        raise ValueError("External buffers are unsupported")
    start = view.get("byteOffset", 0)
    return binary[start : start + view["byteLength"]]


def buffer_view_references(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "bufferView":
                yield child
            else:
                yield from buffer_view_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from buffer_view_references(child)


def remap_buffer_views(value, mapping):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "bufferView":
                value[key] = mapping[child]
            else:
                remap_buffer_views(child, mapping)
    elif isinstance(value, list):
        for child in value:
            remap_buffer_views(child, mapping)


def prune_texture_infos(value, mapping):
    if isinstance(value, dict):
        for key in list(value):
            child = value[key]
            if key.lower().endswith("texture") and isinstance(child, dict) and "index" in child:
                if child["index"] in mapping:
                    child["index"] = mapping[child["index"]]
                else:
                    del value[key]
            else:
                prune_texture_infos(child, mapping)
    elif isinstance(value, list):
        for child in value:
            prune_texture_infos(child, mapping)


def runtime_textures(document):
    result = set()
    for material in document.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr:
            result.add(pbr["baseColorTexture"]["index"])
        unlit = "KHR_materials_unlit" in material.get("extensions", {})
        if not unlit:
            for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
                if key in material:
                    result.add(material[key]["index"])
    return sorted(result)


def resize_image(payload, image_name, directory, index):
    original = directory / f"source-{index}.png"
    original.write_bytes(payload)
    image = bpy.data.images.load(str(original), check_existing=False)
    before = tuple(image.size[:])
    if not all(before):
        raise ValueError(f"Could not decode {image_name}")
    cap = 1024 if image_name.endswith("Face_00") else 512
    factor = min(1, cap / max(before))
    after = tuple(max(1, round(value * factor)) for value in before)
    if after == before:
        output = payload
    else:
        # Image.save writes scene-linear pixels back through their original
        # sRGB image color space; no render/view transform is applied.
        image.scale(*after)
        image.filepath_raw = str(directory / f"resized-{index}.png")
        image.file_format = "PNG"
        image.save()
        output = Path(image.filepath_raw).read_bytes()
    bpy.data.images.remove(image)
    return output, before, after


def mip_bytes(width, height):
    total = 0
    while True:
        total += width * height * 4
        if width == 1 and height == 1:
            return total
        width, height = max(1, width // 2), max(1, height // 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    source_path, output_path = Path(args.input).resolve(), Path(args.output).resolve()
    if source_path == output_path:
        raise ValueError("Optimization must not overwrite the source model")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    original_bytes, source, binary = read_glb(source_path)
    document = copy.deepcopy(source)
    texture_ids = runtime_textures(source)
    texture_map = {old: new for new, old in enumerate(texture_ids)}
    image_ids = sorted({source["textures"][index]["source"] for index in texture_ids})
    image_map = {old: new for new, old in enumerate(image_ids)}
    image_views = {image["bufferView"] for image in source.get("images", [])}
    accessor_views = set(buffer_view_references(source.get("accessors", [])))
    if accessor_views & image_views:
        raise ValueError("Image buffer view is unexpectedly shared with geometry")
    optimized_images, texture_report = {}, []
    with tempfile.TemporaryDirectory(prefix="runner-textures-", dir=output_path.parent) as temporary:
        for index in image_ids:
            descriptor = source["images"][index]
            if descriptor.get("mimeType") != "image/png":
                raise ValueError("This source pipeline expects embedded PNG images")
            payload = view_bytes(source, binary, descriptor["bufferView"])
            name = descriptor.get("name", f"image-{index}")
            resized, before, after = resize_image(payload, name, Path(temporary), index)
            optimized_images[descriptor["bufferView"]] = resized
            texture_report.append({
                "name": name,
                "beforeDimensions": list(before), "afterDimensions": list(after),
                "beforeEncodedBytes": len(payload), "afterEncodedBytes": len(resized),
                "beforeRgbaBytes": before[0] * before[1] * 4,
                "afterRgbaBytes": after[0] * after[1] * 4,
                "beforeRgbaMipBytes": mip_bytes(*before),
                "afterRgbaMipBytes": mip_bytes(*after),
                "unchangedPixelData": after == before and payload == resized,
            })

    document["images"] = [document["images"][index] for index in image_ids]
    document["textures"] = [document["textures"][index] for index in texture_ids]
    for texture in document["textures"]:
        texture["source"] = image_map[texture["source"]]
    for material in document.get("materials", []):
        if "KHR_materials_unlit" in material.get("extensions", {}):
            for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
                material.pop(key, None)
        material.get("pbrMetallicRoughness", {}).pop("metallicRoughnessTexture", None)
        prune_texture_infos(material, texture_map)

    # VRM 0 stores texture references as integer shader properties, rather than
    # glTF texture-info objects. Remap kept maps and remove absent optional maps.
    for material in document.get("extensions", {}).get("VRM", {}).get("materialProperties", []):
        properties = material.get("textureProperties", {})
        for name, texture in list(properties.items()):
            if texture in texture_map:
                properties[name] = texture_map[texture]
            else:
                del properties[name]
    meta = document.get("extensions", {}).get("VRMC_vrm", {}).get("meta", {})
    meta.pop("thumbnailImage", None)
    legacy_meta = document.get("extensions", {}).get("VRM", {}).get("meta", {})
    legacy_meta.pop("texture", None)
    new_binary, new_views, view_map = bytearray(), [], {}
    preserved_view_hashes = []
    for index, view in enumerate(source["bufferViews"]):
        if index in image_views and index not in optimized_images:
            continue
        payload = optimized_images.get(index)
        if payload is None:
            payload = view_bytes(source, binary, index)
            preserved_view_hashes.append((index, hashlib.sha256(payload).hexdigest()))
        new_binary.extend(b"\0" * (-len(new_binary) % 4))
        updated = copy.deepcopy(view)
        updated.update(buffer=0, byteOffset=len(new_binary), byteLength=len(payload))
        view_map[index] = len(new_views)
        new_views.append(updated)
        new_binary.extend(payload)
    document["bufferViews"] = new_views
    remap_buffer_views(document, view_map)
    document.setdefault("asset", {}).setdefault("extras", {})["runnerTextureOptimization"] = {
        "sourceSha256": hashlib.sha256(original_bytes).hexdigest(),
        "pipeline": "Preserve geometry and animation bytes; runtime-used maps only; 1024 face/hair, 512 other maps",
        "removedThumbnailOnlyFromMeta": True,
    }
    write_glb(output_path, document, new_binary)

    output_bytes, written, written_binary = read_glb(output_path)
    preserved = {}
    for key in ("meshes", "skins", "nodes", "animations", "scenes", "scene"):
        preserved[key] = source.get(key) == written.get(key)
    preserved["allNonImageBufferViewBytes"] = all(
        hashlib.sha256(view_bytes(written, written_binary, view_map[index])).hexdigest() == digest
        for index, digest in preserved_view_hashes
    )
    expected_accessors = copy.deepcopy(source.get("accessors", []))
    remap_buffer_views(expected_accessors, view_map)
    preserved["accessorsExceptBufferViewRelocation"] = expected_accessors == written.get("accessors", [])
    for extension, image_key in (("VRMC_vrm", "thumbnailImage"), ("VRM", "texture")):
        original_meta = copy.deepcopy(source.get("extensions", {}).get(extension, {}).get("meta", {}))
        original_meta.pop(image_key, None)
        preserved[extension + "LicenseMeta"] = original_meta == written.get("extensions", {}).get(extension, {}).get("meta", {})
    preserved["inputFileUnchanged"] = source_path.read_bytes() == original_bytes
    if not all(preserved.values()):
        raise AssertionError(f"An invariant changed: {preserved}")

    before_rgba = sum(item["beforeRgbaBytes"] for item in texture_report)
    after_rgba = sum(item["afterRgbaBytes"] for item in texture_report)
    before_mips = sum(item["beforeRgbaMipBytes"] for item in texture_report)
    after_mips = sum(item["afterRgbaMipBytes"] for item in texture_report)
    report = {
        "source": str(source_path), "output": str(output_path),
        "sourceSha256": hashlib.sha256(original_bytes).hexdigest(),
        "outputSha256": hashlib.sha256(output_bytes).hexdigest(),
        "beforeBytes": len(original_bytes), "afterBytes": len(output_bytes),
        "savedBytes": len(original_bytes) - len(output_bytes),
        "sourceImageCount": len(source.get("images", [])), "runtimeImageCount": len(image_ids),
        "removedImages": [image.get("name", str(index)) for index, image in enumerate(source.get("images", [])) if index not in image_map],
        "beforeRuntimeRgbaMiB": round(before_rgba / 1024 ** 2, 4),
        "afterRuntimeRgbaMiB": round(after_rgba / 1024 ** 2, 4),
        "beforeRuntimeRgbaWithMipsMiB": round(before_mips / 1024 ** 2, 4),
        "afterRuntimeRgbaWithMipsMiB": round(after_mips / 1024 ** 2, 4),
        "copyrightMeta": meta or legacy_meta,
        "textures": texture_report, "preservation": preserved,
        "budgets": {"under8MB": len(output_bytes) < 8_000_000, "under32MiBIncludingMips": after_mips < 32 * 1024 ** 2},
    }
    report_path = output_path.with_suffix(".optimization.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print("RUNNER_TEXTURE_OPTIMIZED", json.dumps({
        key: report[key] for key in (
            "beforeBytes", "afterBytes", "beforeRuntimeRgbaMiB", "afterRuntimeRgbaMiB",
            "beforeRuntimeRgbaWithMipsMiB", "afterRuntimeRgbaWithMipsMiB", "removedImages", "budgets", "preservation",
        )
    }))
    print("REPORT", report_path)
    if not all(report["budgets"].values()):
        raise RuntimeError("Texture optimization missed the requested budget")


if __name__ == "__main__":
    main()
