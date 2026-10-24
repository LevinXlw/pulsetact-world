"""Photo-informed Vassar canopies and closed service-front details.

Blender coordinates are east/north/up metres, matching the measured shell.
References: Zahner's 0995 and giraffe photographs, plus MIT LIDS' entrance view.
The blue canopy covers a vehicle passage with side glazing; the silver canopy
covers a parking/loading dock. Neither is a fabricated pedestrian portal.

The caller should omit REPLACED_ENTRY_PATCHES from the visible source shell and
omit the former add_entrance_canopies() call. Retain the original collision shell.
"""
import math
from mathutils import Vector


# Exact source patches, never a spatial deletion of neighboring architecture.
# 90/132/143/175 are the old Dreyfoos service-front box. The five Gates pieces
# are rebuilt from their measured faces with thin metal edges and raised ribs.
DREYFOOS_FRONT_PATCHES = frozenset((90, 132, 143, 175))
GATES_CANOPY_PATCHES = frozenset((274, 317, 394, 395, 416))
REPLACED_ENTRY_PATCHES = DREYFOOS_FRONT_PATCHES | GATES_CANOPY_PATCHES | {186}


def _beam(g, a, b, width=.10, depth=None, material='frame'):
    a, b = Vector(a), Vector(b)
    direction = b - a
    if direction.length < .001:
        return
    along = direction.normalized()
    reference = Vector((0, 0, 1)) if abs(along.z) < .94 else Vector((1, 0, 0))
    across = along.cross(reference).normalized()
    normal = along.cross(across).normalized()
    g.box(material, (a + b) / 2, along, across, normal,
          direction.length, width, depth or width)


def _cylinder(g, a, b, radius, mobile, material='silver'):
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    reference = Vector((1, 0, 0)) if abs(axis.x) < .9 else Vector((0, 1, 0))
    u = axis.cross(reference).normalized()
    v = axis.cross(u).normalized()
    sides = 10 if mobile else 18
    ring = [u * (math.cos(i * math.tau / sides) * radius)
            + v * (math.sin(i * math.tau / sides) * radius) for i in range(sides)]
    for i in range(sides):
        j = (i + 1) % sides
        g.polygon(material, [a + ring[i], a + ring[j], b + ring[j], b + ring[i]])
    g.polygon('frame', [a + p for p in reversed(ring)])
    g.polygon('frame', [b + p for p in ring])


def _plate(g, corners, mobile, material='silver', ribs=True):
    """A thin roof sheet, with real underside, perimeter and slope-wise ribs."""
    points = [Vector(p) for p in corners]
    normal = (points[1] - points[0]).cross(points[2] - points[0]).normalized()
    if normal.z < 0:
        points.reverse()
        normal = -normal
    top = [p + normal * .025 for p in points]
    bottom = [p - normal * .095 for p in points]
    g.polygon(material, top)
    g.polygon('zinc', list(reversed(bottom)))
    for i in range(len(points)):
        j = (i + 1) % len(points)
        g.polygon('frame', [top[i], bottom[i], bottom[j], top[j]])
    if ribs and len(points) == 4:
        # The long edges of authored quads run down the roof slope.
        p0, p1, p2, p3 = points
        width = max((p3 - p0).length, (p2 - p1).length)
        count = max(2, math.ceil(width / (.48 if mobile else .18)))
        for i in range(1, count):
            t = i / count
            a = p0.lerp(p3, t) + normal * .045
            b = p1.lerp(p2, t) + normal * .045
            _beam(g, a, b, .018 if not mobile else .025, .022, 'frame')
    return points, normal


def _glass_panel(g, at, x0, x1, z0, z1, depth=.025):
    g.polygon('glass', [at(x0, depth, z0), at(x1, depth, z0),
                        at(x1, depth, z1), at(x0, depth, z1)])
    for a, b in (((x0, z0), (x1, z0)), ((x1, z0), (x1, z1)),
                 ((x1, z1), (x0, z1)), ((x0, z1), (x0, z0))):
        _beam(g, at(a[0], depth + .04, a[1]), at(b[0], depth + .04, b[1]), .065)


def _in_triangle(point, triangle):
    signs = []
    for i, a in enumerate(triangle):
        b = triangle[(i + 1) % 3]
        signs.append((b[0] - a[0]) * (point[1] - a[1])
                     - (b[1] - a[1]) * (point[0] - a[0]))
    return min(signs) >= -1e-5 or max(signs) <= 1e-5


def _outside_rectangle(points, origin, u, x0, x1, z0, z1):
    """Subtract a portal from a wall triangle in local-horizontal/world-Z."""
    remaining=points;pieces=[]
    for axis,value,less in ((0,x0,True),(0,x1,False),(1,z0,True),(1,z1,False)):
        if len(remaining)<3:break
        def clip(poly,keep):
            result=[]
            for i,a in enumerate(poly):
                b=poly[(i+1)%len(poly)]
                va=(a-origin).dot(u) if axis==0 else a.z
                vb=(b-origin).dot(u) if axis==0 else b.z
                da=(va-value)*(1 if keep else -1);db=(vb-value)*(1 if keep else -1)
                ina,inb=da<=1e-7,db<=1e-7
                if ina:result.append(a)
                if ina!=inb:result.append(a.lerp(b,da/(da-db)))
            return result
        outside=clip(remaining,less)
        if len(outside)>=3:pieces.append(outside)
        remaining=clip(remaining,not less)
    return pieces


def _dreyfoos(g, mobile, patch, facade_frame, height, by_id):
    origin, u, _v, n, _tris = facade_frame(patch)
    # Cut the real vehicular opening out of the outer backing. A bounded
    # recessed passage below gives its jambs actual depth, without opening an
    # interior gameplay route or pretending the garage is a pedestrian door.
    base=height(origin.x,origin.y)
    for triangle in _tris:
        points=[origin+u*x+_v*y-n*.19 for x,y in triangle]
        for piece in _outside_rectangle(points,origin,u,-2.18,2.55,base+.03,base+6):g.polygon('reveal',piece)
    origin = Vector(origin)
    origin.z = height(origin.x, origin.y)
    up = Vector((0, 0, 1))

    def at(x, depth, z):
        return origin + u * x + n * depth + up * z

    def wall_depth(x, z):
        # Extend the hidden rear flashing to the first measured tower wall,
        # rather than stopping several metres in front of it.
        hits = []
        for patch_id in (3, 23, 33, 50, 67, 82):
            tower = by_id[patch_id]
            o2, u2, v2, n2, triangles = facade_frame(tower)
            denominator = n2.dot(n)
            if abs(denominator) < .03:
                continue
            depth = n2.dot(o2 - at(x, 0, z)) / denominator
            if not -14 < depth < -1.65:
                continue
            point = at(x, depth, z) - o2
            q = (point.dot(u2), point.dot(v2))
            if any(_in_triangle(q, triangle) for triangle in triangles):
                hits.append(depth)
        return (max(hits) if hits else -5.4) - .10

    # Two separate folded leaves: one broad low leaf and one high, asymmetric
    # ridge. The silhouettes and large exposed triangular underside survive LOD.
    leaves = (
        {'xs': (-4.8, -2.5, -.25), 'front': (7.4, 7.9, 7.2), 'depth': 3.45},
        {'xs': (-.12, 1.7, 4.25), 'front': (9.7, 7.4, 7.25), 'depth': 3.85},
    )
    for leaf in leaves:
        xs, front, edge = leaf['xs'], leaf['front'], leaf['depth']
        for i in range(2):
            x0, x1, z0, z1 = xs[i], xs[i + 1], front[i], front[i + 1]
            corners = [at(x0, -1.65, z0 + 4.2), at(x0, edge, z0),
                       at(x1, edge, z1), at(x1, -1.65, z1 + 4.2)]
            points, normal = _plate(g, corners, mobile, 'blue')
            rear = [at(x0, wall_depth(x0, z0 + 4.2), z0 + 4.2),
                    corners[0], corners[3],
                    at(x1, wall_depth(x1, z1 + 4.2), z1 + 4.2)]
            rear_normal = (rear[1] - rear[0]).cross(rear[2] - rear[0]).normalized()
            if rear_normal.z < 0:
                rear.reverse()
                rear_normal = -rear_normal
            g.polygon('zinc', [p + rear_normal * .015 for p in rear])
            g.polygon('reveal', [p - rear_normal * .10 for p in reversed(rear)])
            for j in range(4):
                k = (j + 1) % 4
                g.polygon('zinc', [rear[j] + rear_normal * .015,
                                  rear[j] - rear_normal * .10,
                                  rear[k] - rear_normal * .10,
                                  rear[k] + rear_normal * .015])
            # A broad silver strip is part of the photographed blue/zinc sheet
            # pattern, rather than a flat uniformly blue patch.
            if i == 0:
                a0, a1 = .53, .77
                strip = [corners[0].lerp(corners[3], a0),
                         corners[1].lerp(corners[2], a0),
                         corners[1].lerp(corners[2], a1),
                         corners[0].lerp(corners[3], a1)]
                g.polygon('silver', [p + normal * .052 for p in strip])
            for j in range(4):
                _beam(g, points[j] - up * .16, points[(j + 1) % 4] - up * .16,
                      .13, .18, 'frame')
            if not mobile:
                for t in (.28, .68):
                    a = corners[0].lerp(corners[3], t) - up * .20
                    b = corners[1].lerp(corners[2], t) - up * .20
                    _beam(g, a, b, .09, .15, 'zinc')
        # A visible lower chord and diagonal webs under each front folded edge.
        low = min(front) - .40
        chord = [at(xs[0], edge - .06, low), at(xs[-1], edge - .06, low)]
        _beam(g, *chord, .12, .16)
        for i, x in enumerate(xs):
            _beam(g, at(x, edge - .06, front[i] - .16),
                  at(x, edge - .06, low), .075)
        _beam(g, at(xs[0], edge - .06, low),
              at(xs[1], edge - .06, front[1] - .16), .07)
        _beam(g, at(xs[1], edge - .06, low),
              at(xs[-1], edge - .06, front[-1] - .16), .07)

    # Large diagonal supports are distinctive in both the LIDS and Zahner views.
    # Their feet stay beside the central vehicle opening, not in its center.
    columns = ((-3.65, 2.5, -2.75, 1.25, 8.1, .44),
               (3.55, 2.55, 2.95, 1.15, 8.05, .47))
    for fx, fd, tx, td, top, radius in columns:
        foot = at(fx, fd, 0)
        foot.z = height(foot.x, foot.y) + .04
        head = at(tx, td, top)
        _cylinder(g, foot, head, radius, mobile)
        axis = (head - foot).normalized()
        _cylinder(g, foot, foot + axis * .14, radius + .055, mobile, 'frame')
        _cylinder(g, head - axis * .18, head, radius + .045, mobile, 'frame')
        _beam(g, head - up * .35, at(tx + .7, .1, top + 1.0), .10, .12)

    g.polygon('reveal', [at(-2.18,-5.6,.04),at(2.55,-5.6,.04),at(2.55,-5.6,6),at(-2.18,-5.6,6)])
    g.polygon('paving',[at(-2.18,-.18,.06),at(-2.18,-5.6,.04),at(2.55,-5.6,.04),at(2.55,-.18,.06)])
    g.polygon('reveal',[at(-2.18,-.18,6),at(2.55,-.18,6),at(2.55,-5.6,6),at(-2.18,-5.6,6)])
    g.polygon('zinc',[at(-2.18,-.18,.06),at(-2.18,-.18,6),at(-2.18,-5.6,6),at(-2.18,-5.6,.04)])
    g.polygon('zinc',[at(2.55,-5.6,.04),at(2.55,-5.6,6),at(2.55,-.18,6),at(2.55,-.18,.06)])
    for depth in (-1.2,-3.4):
        _beam(g,at(-2.18,depth,5.7),at(2.55,depth,5.7),.16,.22,'frame')
    for x in (-2.23, 2.60):
        _beam(g, at(x, -.04, .06), at(x, -.04, 6.15), .13, .16, 'zinc')
    _beam(g, at(-2.23, -.04, 6.15), at(2.60, -.04, 6.15), .18, .24, 'zinc')

    # Tall side glazing is visible beside the passage in the official close-up.
    # The irregular surrounding tower is supplied by the caller's facade model.
    for x0, x1 in ((-3.52, -2.25), (2.62, 3.52)):
        for a, b in ((.15, 2.25), (2.25, 4.45), (4.45, 6.65), (6.65, 8.25)):
            _glass_panel(g, at, x0, x1, a, b)
        _beam(g, at((x0 + x1) / 2, .09, .15),
              at((x0 + x1) / 2, .09, 8.25), .055)
    # A shallow closed side return prevents views behind the floating glazing.
    for x in (-3.54, 3.54):
        g.polygon('zinc', [at(x, -.22, .06), at(x, -2.0, .06),
                          at(x, -2.0, 9.0), at(x, -.22, 9.0)])


def _patch_canopy(g, mobile, patch, facade_frame):
    """Rebuild a measured planar roof patch without inventing a new footprint."""
    origin, u, v, n, triangles = facade_frame(patch)
    n = Vector(n).normalized()
    # Boundary-edge counting gives thin exterior edges without thick internal
    # seams along the aerial mesh's triangulation.
    boundaries = {}
    for triangle in triangles:
        points = [origin + u * x + v * y for x, y in triangle]
        if (points[1] - points[0]).cross(points[2] - points[0]).dot(n) < 0:
            points.reverse()
        g.polygon('silver', [p + n * .03 for p in points])
        g.polygon('zinc', [p - n * .105 for p in reversed(points)])
        for i, a in enumerate(triangle):
            b = triangle[(i + 1) % 3]
            key = tuple(sorted((tuple(round(c, 5) for c in a),
                                tuple(round(c, 5) for c in b))))
            if key in boundaries:
                boundaries[key] = None
            else:
                boundaries[key] = (a, b)
    for segment in boundaries.values():
        if segment is None:
            continue
        a, b = [origin + u * q[0] + v * q[1] for q in segment]
        g.polygon('frame', [a + n * .03, b + n * .03,
                           b - n * .105, a - n * .105])
        _beam(g, a - n * .15, b - n * .15, .095, .14)

    # Clip each slope-wise rib to the actual roof triangles. Merge intervals
    # first, so aerial triangulation cannot cause doubled standing seams.
    xmin = min(q[0] for t in triangles for q in t)
    xmax = max(q[0] for t in triangles for q in t)
    pitch = .46 if mobile else .18
    for i in range(1, math.ceil((xmax - xmin) / pitch)):
        x = xmin + i * pitch
        intervals = []
        for triangle in triangles:
            ys = []
            for j, a in enumerate(triangle):
                b = triangle[(j + 1) % 3]
                if abs(a[0] - b[0]) < 1e-7:
                    continue
                t = (x - a[0]) / (b[0] - a[0])
                if -1e-6 <= t <= 1 + 1e-6:
                    ys.append(a[1] + (b[1] - a[1]) * t)
            if len(ys) >= 2 and max(ys) - min(ys) > .01:
                intervals.append((min(ys), max(ys)))
        merged = []
        for lo, hi in sorted(intervals):
            if merged and lo <= merged[-1][1] + .01:
                merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
            else:
                merged.append((lo, hi))
        for lo, hi in merged:
            a = origin + u * x + v * lo + n * .05
            b = origin + u * x + v * hi + n * .05
            _beam(g, a, b, .018 if not mobile else .026, .025)


def _gates_service_front(g, mobile, patch, facade_frame, height):
    origin, u, _v, n, _triangles = facade_frame(patch)
    base_height = height(origin.x, origin.y)
    # The aerial shell closes the space under the folded roof with a tall
    # triangular gable. Photos show a suspended canopy. Retain only the low
    # service-front wall and its lintel, rather than recreating that false gable.
    upper_boundary = {}
    for triangle in _triangles:
        points = [origin + u * x + _v * y for x, y in triangle]
        clipped = []
        upper = []
        limit = base_height + 3.88
        for i, a in enumerate(points):
            b = points[(i + 1) % len(points)]
            ina, inb = a.z <= limit, b.z <= limit
            if ina:
                clipped.append(a)
            else:
                upper.append(a)
            if ina != inb:
                crossing = a.lerp(b, (limit - a.z) / (b.z - a.z))
                clipped.append(crossing)
                upper.append(crossing)
        if len(clipped) >= 3:
            g.polygon('brick', clipped)
        if len(upper) >= 3:
            # The apparent void behind the canopy is a closed dark exterior
            # recess. Move its backing one metre behind the original front so
            # it cannot read as the former triangular brick gable.
            g.polygon('reveal', [p - n for p in upper])
            for i, a in enumerate(upper):
                b = upper[(i + 1) % len(upper)]
                key = tuple(sorted((tuple(round(c, 5) for c in a),
                                    tuple(round(c, 5) for c in b))))
                if key in upper_boundary:
                    upper_boundary[key] = None
                else:
                    upper_boundary[key] = (a, b)
    for segment in upper_boundary.values():
        if segment is not None:
            a, b = segment
            g.polygon('reveal', [a, b, b - n, a - n])
    origin = Vector(origin)
    origin.z = base_height
    up = Vector((0, 0, 1))

    def at(x, depth, z):
        return origin + u * x + n * depth + up * z

    # The photographed Vassar opening is a parking/loading dock, not the
    # pedestrian Gates entrance. The door is shown closed with horizontal joints.
    half = 2.58
    g.polygon('reveal', [at(-half, .025, .06), at(half, .025, .06),
                         at(half, .025, 3.30), at(-half, .025, 3.30)])
    for z in (.58, 1.12, 1.66, 2.20, 2.74):
        _beam(g, at(-half + .04, .052, z), at(half - .04, .052, z),
              .022, .018, 'zinc')
    for x in (-half - .08, half + .08):
        _beam(g, at(x, .12, .04), at(x, .12, 3.50), .16, .20, 'zinc')
    _beam(g, at(-half - .15, .12, 3.50), at(half + .15, .12, 3.50),
          .23, .22, 'reveal')
    # No invented wording on the signboard. Its thin dark lintel silhouette is
    # retained while the original letters are below this model's detail budget.
    _beam(g, at(-half, .24, 3.67), at(half, .24, 3.67), .18, .055, 'reveal')
    # Dark side returns close the exterior treatment where the survey front face
    # was removed; the adjacent brick/silver architecture stays with the caller.
    for x in (-half - .18, half + .18):
        g.polygon('zinc', [at(x, -.18, .04), at(x, .12, .04),
                          at(x, .12, 3.65), at(x, -.18, 3.65)])


def build_entries(g, mobile, patches, facade_frame, height):
    """Append both canopy zones to Geometry; returns a small audit summary."""
    by_id = {p['id']: p for p in patches}
    _dreyfoos(g, mobile, by_id[132], facade_frame, height, by_id)
    for patch_id in sorted(GATES_CANOPY_PATCHES):
        _patch_canopy(g, mobile, by_id[patch_id], facade_frame)
    _gates_service_front(g, mobile, by_id[186], facade_frame, height)
    return {
        'dreyfoos': 'two folded blue/silver canopies; diagonal columns; vehicle passage and side glazing',
        'gates': 'five measured folded silver roof patches; closed parking/loading door',
        'replacedSourcePatches': sorted(REPLACED_ENTRY_PATCHES),
        'interactiveEntry': False,
        'dimensions': 'photo-informed exterior interpretation; not an as-built survey',
    }
