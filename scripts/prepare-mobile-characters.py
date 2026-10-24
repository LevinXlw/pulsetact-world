"""Create deterministic low-memory avatar GLBs without changing their rig or mesh.

Usage: python scripts/prepare-mobile-characters.py
       python scripts/prepare-mobile-characters.py --profile hd
Requires Pillow. Sources stay untouched; material/texture indices, accessors,
skins, animation channels, morph targets and embedded license metadata survive.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import struct
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PROFILES = {
    "low": {"directory": "mobile", "face": 512, "other": 256},
    "hd": {"directory": "mobile-hd", "face": 1024, "other": 512, "overlay": 256},
}
SOURCES = {
    "pixiv": ROOT / "public/assets/characters/pixiv/character.glb",
    "sakurada": ROOT / "public/assets/characters/sakurada/sakurada.glb",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, length = struct.unpack_from("<III", data)
    assert magic == 0x46546C67 and version == 2 and length == len(data)
    chunks = {}
    offset = 12
    while offset < length:
        size, kind = struct.unpack_from("<II", data, offset)
        assert size % 4 == 0 and offset + 8 + size <= length
        chunks[kind] = data[offset + 8 : offset + 8 + size]
        offset += 8 + size
    assert offset == length and set(chunks) == {0x4E4F534A, 0x004E4942}
    document = json.loads(chunks[0x4E4F534A])
    assert len(document["buffers"]) == 1 and "uri" not in document["buffers"][0]
    return document, chunks[0x004E4942]


def view_bytes(document: dict, binary: bytes, index: int) -> bytes:
    view = document["bufferViews"][index]
    assert view["buffer"] == 0
    start = view.get("byteOffset", 0)
    end = start + view["byteLength"]
    assert start >= 0 and end <= len(binary)
    return binary[start:end]


def encode_glb(document: dict, binary: bytes) -> bytes:
    doc = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    doc += b" " * (-len(doc) % 4)
    binary += b"\0" * (-len(binary) % 4)
    return (
        struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(doc) + 8 + len(binary))
        + struct.pack("<II", len(doc), 0x4E4F534A)
        + doc
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def rgba_mip_bytes(width: int, height: int) -> int:
    result = 0
    while True:
        result += width * height * 4
        if width == height == 1:
            return result
        width, height = max(1, width // 2), max(1, height // 2)


def prepare(identifier: str, path: Path, profile: dict, destination: Path) -> dict:
    original_data = path.read_bytes()
    original, binary = read_glb(original_data)
    result = copy.deepcopy(original)
    image_views = {image["bufferView"] for image in original["images"]}
    # Each image owns its view in these source files. No geometry may alias it.
    assert len(image_views) == len(original["images"])
    for accessor in original["accessors"]:
        assert accessor.get("bufferView") not in image_views
        if "sparse" in accessor:
            assert accessor["sparse"]["indices"]["bufferView"] not in image_views
            assert accessor["sparse"]["values"]["bufferView"] not in image_views

    replacements = {}
    image_report = []
    for index, image in enumerate(original["images"]):
        raw = view_bytes(original, binary, image["bufferView"])
        with Image.open(io.BytesIO(raw)) as texture:
            before = texture.size
            # Face gets the largest budget. The HD profile doubles texture
            # dimensions without restoring the original full desktop budget.
            is_face = image.get("name", "").startswith("Face_00") or "_Face_00" in image.get("name", "")
            cap = profile["face"] if is_face else profile["other"]
            # Small layered facial accents do not need clothing-sized maps.
            # Keep them at the low-profile cap so the larger face/hair/clothes
            # do not silently restore the entire desktop texture allocation.
            is_overlay = any(part in image.get("name", "").lower() for part in ("eye", "brow", "mouth"))
            if is_overlay and "overlay" in profile:
                cap = profile["overlay"]
            has_alpha = "A" in texture.getbands() or "transparency" in texture.info
            texture = texture.convert("RGBA" if has_alpha else "RGB")
            texture.thumbnail((cap, cap), Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            texture.save(encoded, format="PNG", optimize=True)
            replacement = encoded.getvalue()
            replacements[image["bufferView"]] = replacement
            result["images"][index]["mimeType"] = "image/png"
            image_report.append({
                "index": index,
                "name": image.get("name", ""),
                "before": list(before),
                "after": list(texture.size),
                "alphaPreserved": has_alpha,
                "beforeBytes": len(raw),
                "afterBytes": len(replacement),
                "beforeRgbaMipBytes": rgba_mip_bytes(*before),
                "afterRgbaMipBytes": rgba_mip_bytes(*texture.size),
            })

    packed = bytearray()
    payload_offsets = {}
    for index, view in enumerate(result["bufferViews"]):
        payload = replacements.get(index)
        if payload is None:
            payload = view_bytes(original, binary, index)
        # Equal payloads can share their physical buffer range; keep every
        # bufferView descriptor/index and its stride/target unchanged.
        offset = payload_offsets.get(payload)
        if offset is None:
            packed.extend(b"\0" * (-len(packed) % 4))
            offset = len(packed)
            payload_offsets[payload] = offset
            packed.extend(payload)
        view["byteOffset"] = offset
        view["byteLength"] = len(payload)
    result["buffers"][0]["byteLength"] = len(packed)
    output = encode_glb(result, bytes(packed))

    verified, verified_binary = read_glb(output)
    for key in ["meshes", "accessors", "nodes", "skins", "animations", "materials", "textures", "samplers", "extensions", "extensionsUsed", "extensionsRequired"]:
        assert original.get(key) == verified.get(key), f"Changed {identifier} {key}"
    for index, view in enumerate(verified["bufferViews"]):
        assert view["byteOffset"] % 4 == 0
        assert {k: v for k, v in view.items() if k not in {"byteOffset", "byteLength"}} == {
            k: v for k, v in original["bufferViews"][index].items() if k not in {"byteOffset", "byteLength"}
        }
        if index not in image_views:
            assert view_bytes(original, binary, index) == view_bytes(verified, verified_binary, index)
    for index, image in enumerate(verified["images"]):
        with Image.open(io.BytesIO(view_bytes(verified, verified_binary, image["bufferView"]))) as texture:
            assert max(texture.size) <= profile["face"]
            assert list(texture.size) == image_report[index]["after"]
            assert ("A" in texture.getbands()) == image_report[index]["alphaPreserved"]

    output_path = destination / f"{identifier}.glb"
    output_path.write_bytes(output)
    return {
        "id": identifier,
        "source": path.relative_to(ROOT).as_posix(),
        "sourceMetadata": path.with_name("SOURCE.json").relative_to(ROOT).as_posix(),
        "sourceSha256": sha256(original_data),
        "file": output_path.name,
        "sha256": sha256(output),
        "beforeBytes": len(original_data),
        "afterBytes": len(output),
        "beforeDecodedRgbaBytes": sum(item["before"][0] * item["before"][1] * 4 for item in image_report),
        "afterDecodedRgbaBytes": sum(item["after"][0] * item["after"][1] * 4 for item in image_report),
        "beforeRgbaMipBytes": sum(item["beforeRgbaMipBytes"] for item in image_report),
        "afterRgbaMipBytes": sum(item["afterRgbaMipBytes"] for item in image_report),
        "unchangedCounts": {key: len(original.get(key, [])) for key in ["meshes", "accessors", "bufferViews", "nodes", "skins", "animations", "materials", "textures", "images"]},
        "animations": [animation.get("name", "") for animation in original["animations"]],
        "validation": {
            "allNonImageBufferViewsByteIdentical": True,
            "allAccessorsSkinAnimationMeshAndMaterialDescriptorsIdentical": True,
            "allBufferViewOffsetsFourByteAligned": True,
            "embeddedLicenseMetadataPreserved": True,
        },
        "images": image_report,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=PROFILES, default="low")
    arguments = parser.parse_args()
    profile = PROFILES[arguments.profile]
    destination = ROOT / "public/assets/characters" / profile["directory"]
    destination.mkdir(parents=True, exist_ok=True)
    models = [prepare(identifier, path, profile, destination) for identifier, path in SOURCES.items()]
    manifest = {
        "purpose": "Low-memory phone variants of the original campus avatars" if arguments.profile == "low" else "Bounded HD phone variants of the original campus avatars",
        "generator": "scripts/prepare-mobile-characters.py",
        "modifications": [
            f"Face albedos resized to at most {profile['face']}px; remaining albedos to at most {profile['other']}px, retaining aspect ratio and alpha.",
            "Byte-identical bufferView payloads share aligned buffer ranges without changing accessor or bufferView indices.",
            "No mesh, skeleton, morph target, animation, material, texture binding or license metadata removed.",
        ],
        "budgetNote": "RGBA estimates count every image separately, conservatively, including exact full mip chains. Real GPU allocation depends on the browser and sharing.",
        "models": models,
    }
    if "overlay" in profile:
        manifest["modifications"].insert(1, f"Small eye, brow and mouth overlay albedos stay capped at {profile['overlay']}px to bound decoded texture memory.")
    (destination / "SOURCE.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps([{key: model[key] for key in ["id", "beforeBytes", "afterBytes", "beforeDecodedRgbaBytes", "afterDecodedRgbaBytes", "beforeRgbaMipBytes", "afterRgbaMipBytes", "unchangedCounts", "animations", "validation"]} for model in models], indent=2))
