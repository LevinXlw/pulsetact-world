"""Photo-guided reconstruction of the Stata Center's curved Twins.

All numbers controlling the silhouette are authored estimates, NOT facade
survey measurements.  Source coordinates and patch IDs only locate the parts.
References: references/pass2/zahner-twins.jpg and zahner-rendered.jpg.

Use mapper_for(patch) for grouped surfaces and mapper_for({'faces': [face_id]})
for ungrouped source triangles, including the shorter Twin's fragmented cap.
The returned callable accepts/returns mathutils.Vector; all calls use one
position-only function, including window returns and collision triangles.
Split polygons at callable.split_levels BEFORE mapping, interpolating UVs.
No Z coordinate changes.  Ground below Z=4 and attached rear edges stay fixed.
"""

from math import hypot
from mathutils import Vector


_HIGH_PATCHES = frozenset({
    121, 137, 150, 152, 154, 160, 164, 168, 173, 174, 182, 184, 187,
    209, 216, 219, 224, 225, 231, 236, 252, 255, 308, 380, 406,
})
_LOW_PATCHES = frozenset({
    102, 112, 113, 129, 133, 165, 167, 177, 179, 181, 192, 195, 196,
    200, 202, 203, 204, 205, 213, 214, 217, 222, 228, 243, 251,
    263, 265, 266, 304, 342,
})
# Small faces omitted by inspect-source.py's area threshold.  These close the
# low Twin's sloping rim and the high Twin's adjoining small returns.
_EXTRA_FACES = frozenset(list(range(24)) + [169, 170, 275, 276, 1185, 1186])

_HIGH_CENTER = (102.50, 305.60)
_LOW_CENTER = (87.33, 301.70)
# Two exact source XY attachment points: the p17 seam and the brick-side
# contact.  Keeping their chord fixed also pins all intermediate rear points.
_ATTACH_A = (97.96896912278548, 301.60209996517585)
_ATTACH_B = (107.64216912278751, 303.70859983817445)
_DX = _ATTACH_B[0] - _ATTACH_A[0]
_DY = _ATTACH_B[1] - _ATTACH_A[1]
_LENGTH = hypot(_DX, _DY)
_OUTWARD = (-_DY / _LENGTH, _DX / _LENGTH)

# Smooth photographic shaping factors, dimensionless; the values are not
# reconstructed as-built dimensions.  The 18.9..20.3 neutral band preserves
# the high Twin's actual source roof connections at Z=19.485..19.575.
_HIGH_PROFILE = (
    (4.0, 1.0), (8.0, 1.04), (12.0, .94), (16.0, .96),
    (18.9, 1.0), (20.3, 1.0), (24.0, .98), (28.0, .78), (34.0, .58),
)
_LOW_PROFILE = (
    (4.0, 1.0), (8.0, 1.025), (12.0, .94), (16.0, .73),
    (18.0, .68), (20.0, .75), (24.0, .96), (28.0, 1.13),
)


def _smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def _profile(z, knots):
    if z <= knots[0][0]:
        return knots[0][1]
    for (za, a), (zb, b) in zip(knots, knots[1:]):
        if z <= zb:
            return a + (b - a) * _smooth((z - za) / (zb - za))
    return knots[-1][1]


def _map_point(point):
    x, y, z = point
    if z <= 4.0:
        return Vector((x, y, z))
    # The two non-overlapping source cages are separated by a clear gap.
    # Selection depends on position, never the incident patch, so every shared
    # point obtains the same result even when used by different wall/cap IDs.
    if x < 94.7:
        scale = _profile(z, _LOW_PROFILE)
        lean = _smooth((z - 8.0) / 20.0)
        cx, cy = _LOW_CENTER
        return Vector((cx + (x - cx) * scale - 1.00 * lean,
                       cy + (y - cy) * scale + .80 * lean, z))

    scale = _profile(z, _HIGH_PROFILE)
    distance = ((x - _ATTACH_A[0]) * _OUTWARD[0]
                + (y - _ATTACH_A[1]) * _OUTWARD[1])
    # The body opens toward Vassar while its rear contact chord stays fixed.
    dx = _OUTWARD[0] * distance * (scale - 1.0)
    dy = _OUTWARD[1] * distance * (scale - 1.0)
    # The source has a wide cylinder capped by a narrow cylinder.  Compress its
    # exposed shoulder in two directions, fading exactly at the rear attachment
    # chord, to replace that rigid step with a taper toward the neck.  This is a
    # positional field shared by the annular cap and both sets of side faces.
    shoulder = .33 * _smooth((z - 20.3) / 3.5351) * (1 - _smooth((z - 24) / 5))
    tangent = (_DX / _LENGTH, _DY / _LENGTH)
    side = ((x - _HIGH_CENTER[0]) * tangent[0]
            + (y - _HIGH_CENTER[1]) * tangent[1])
    side_weight = _smooth(distance / 3)
    dx -= shoulder * (tangent[0] * side * side_weight + _OUTWARD[0] * distance)
    dy -= shoulder * (tangent[1] * side * side_weight + _OUTWARD[1] * distance)
    # Only the free neck changes to radial taper and a small eccentric lean.
    # The body ends at Z=23.835; the transition begins above that connection.
    free_neck = _smooth((z - 24.0) / 4.0)
    cx, cy = _HIGH_CENTER
    lean = _smooth((z - 24.0) / 10.0)
    radial_dx = (x - cx) * (scale - 1.0) - .50 * lean
    radial_dy = (y - cy) * (scale - 1.0) + 1.25 * lean
    dx += (radial_dx - dx) * free_neck
    dy += (radial_dy - dy) * free_neck
    return Vector((x + dx, y + dy, z))


_map_point.split_levels = [
    4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 18.9, 20.0,
    20.3, 22.0, 23.8, 24.0, 26.0, 28.0, 30.0, 32.0,
]


def mapper_for(p):
    """Return the shared position mapper for a Twin patch or source face.

    Unknown patches return None.  For ungrouped faces pass {'faces': [f]}.
    No neighboring brick, main roof, or ground geometry is selected here.
    """
    if not p:
        return None
    if p.get('id') in _HIGH_PATCHES or p.get('id') in _LOW_PATCHES:
        return _map_point
    if any(face in _EXTRA_FACES for face in p.get('faces', ())):
        return _map_point
    return None
