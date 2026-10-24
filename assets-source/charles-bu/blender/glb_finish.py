"""Small standard-library GLB finishing helpers; no topology or UV changes."""
import math
import struct


def repair_zero_tangents(document, binary):
    """Recover MikkTSpace zero vectors at very acute, valid clipped triangles.

    Blender's angle-weighted tangent generation can round the corner weight to
    zero on a long, narrow triangle. Preserve every valid triangle/UV/normal and
    derive only these zero vectors from adjacent triangle UV derivatives, then
    Gram-Schmidt project against the exported shading normal. Do not fabricate
    a tangent for a genuinely degenerate UV triangle; fail instead.
    """
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    formats = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}

    def accessor(index):
        a = document["accessors"][index]
        v = document["bufferViews"][a["bufferView"]]
        fmt = "<" + formats[a["componentType"]] * components[a["type"]]
        width = struct.calcsize(fmt)
        start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = v.get("byteStride", width)
        return [struct.unpack_from(fmt, binary, start + k * stride) for k in range(a["count"])], start, stride

    def sub(a, b):
        return tuple(x - y for x, y in zip(a, b))

    def dot(a, b):
        return sum(x * y for x, y in zip(a, b))

    def cross(a, b):
        return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    result = []
    for mesh in document.get("meshes", []):
        for primitive in mesh["primitives"]:
            attrs = primitive["attributes"]
            if "TANGENT" not in attrs:
                continue
            tangents, start, stride = accessor(attrs["TANGENT"])
            bad = {i for i, value in enumerate(tangents) if dot(value[:3], value[:3]) < 1e-12}
            if not bad:
                continue
            position, _, _ = accessor(attrs["POSITION"])
            normals, _, _ = accessor(attrs["NORMAL"])
            uv, _, _ = accessor(attrs["TEXCOORD_0"])
            index, _, _ = accessor(primitive["indices"])
            candidates = {i: [] for i in bad}
            for k in range(0, len(index), 3):
                ids = [index[k + j][0] for j in range(3)]
                targets = bad.intersection(ids)
                if not targets:
                    continue
                e1, e2 = sub(position[ids[1]], position[ids[0]]), sub(position[ids[2]], position[ids[0]])
                d1, d2 = sub(uv[ids[1]], uv[ids[0]]), sub(uv[ids[2]], uv[ids[0]])
                det = d1[0] * d2[1] - d1[1] * d2[0]
                if abs(det) < 1e-14:
                    continue
                tangent = tuple((e1[j] * d2[1] - e2[j] * d1[1]) / det for j in range(3))
                bitangent = tuple((e2[j] * d1[0] - e1[j] * d2[0]) / det for j in range(3))
                area_squared = dot(cross(e1, e2), cross(e1, e2))
                for i in targets:
                    normal = normals[i]
                    projected = tuple(tangent[j] - normal[j] * dot(normal, tangent) for j in range(3))
                    length = math.sqrt(dot(projected, projected))
                    if length < 1e-10:
                        continue
                    unit = tuple(value / length for value in projected)
                    sign = -1 if dot(cross(normal, unit), bitangent) < 0 else 1
                    candidates[i].append((area_squared, (*unit, sign)))
            for i, values in candidates.items():
                if not values:
                    raise RuntimeError(f"Cannot recover tangent from valid UVs: {mesh.get('name')} vertex {i}")
                value = max(values, key=lambda item: item[0])[1]
                struct.pack_into("<4f", binary, start + i * stride, *value)
            result.append({"mesh": mesh.get("name"), "vertices": len(bad), "method": "Adjacent triangle UV derivative, orthogonalized against the exported normal."})
    return {"vertices": sum(item["vertices"] for item in result), "meshes": result}
