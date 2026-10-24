"""Roof-0 garden terrace: source-bounded paving, lawn islands and edge detail.

The landscape outlines are restrained photographic estimates, not surveyed
planting plans. No point is allowed on another source building/roof footprint.
The original 8.37254 m level and amphitheater approach clearances are retained.
"""
import math
import random
from collections import Counter
from importlib import import_module
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon

site = import_module('site-details')
MATERIALS = {
    'courtPaver': ((1, 1, 1, 1), .96, 0, None),
    'courtLawn': ((1, 1, 1, 1), .97, 0, None),
    'courtEdge': ((.42, .33, .25, 1), .94, 0, None),
}
LAYOUT = {
    'roofPatch': 0,
    'aisleEnds': [(163.03578186, 274.44619751), (159.82522583, 252.09672546)],
    'aisleClearance': 2.2,
    'walks': [([(147, 275), (163.03578186, 274.44619751)], 2.0),
              ([(138, 251.6), (159.82522583, 252.09672546)], 1.8)],
    'lawns': [
        {'name': 'mirror wing south lawn', 'points': [(127, 238), (131, 243), (136, 245.5), (140, 243), (146, 241), (151, 242), (152, 238.5), (141, 234), (133, 234.5)]},
        {'name': 'amphitheater west lawn', 'points': [(141, 255), (146, 254.7), (150, 257.5), (151, 262), (149, 266), (145, 267), (141, 263.7), (139.5, 260)]},
        {'name': 'west garden lawn', 'points': [(96, 250), (103, 249.8), (110, 251), (114, 253), (114, 255.7), (109, 256.7), (103, 254.5), (98, 254)]},
    ],
    'planters': [
        [(115.2, 249.8), (117.5, 250.2), (118, 252.3), (115.5, 252.6)],
        [(151.2, 265.3), (153.1, 266), (153.6, 269.2), (151.8, 268.6)],
    ],
}


def _area(poly):
    return abs(sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2


def _smooth(poly, subdivisions):
    result = []
    for i in range(len(poly)):
        a, b, c, d = (Vector(poly[(i + j) % len(poly)]) for j in (-1, 0, 1, 2))
        for j in range(subdivisions):
            t = j / subdivisions
            q = .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
            result.append((q.x, q.y))
    return site._ccw(result)


def _triangulate(poly):
    vertices = [Vector((x, y, 0)) for x, y in poly]
    return [[poly[p] if isinstance(p, int) else (p.x, p.y) for p in tri]
            for tri in tessellate_polygon([vertices])]


def _intersection(poly, convex):
    part = poly
    convex = site._ccw(convex)
    for a, b in zip(convex, convex[1:] + convex[:1]):
        if len(part) < 3:
            return []
        part = site._clip_half(part, a, b, True)
    return part if len(part) >= 3 and _area(part) > 1e-7 else []


def _protected(p):
    if any(math.dist(p[:2], end) < LAYOUT['aisleClearance'] for end in LAYOUT['aisleEnds']):
        return True
    return any(site._segment_distance(p, a, b) < width for path, width in LAYOUT['walks'] for a, b in zip(path, path[1:]))


def _texture(kind, mobile):
    import bpy
    from array import array
    name = 'Stata courtyard ' + kind + (' mobile' if mobile else ' full')
    if bpy.data.images.get(name):
        return bpy.data.images[name]
    size = 128 if mobile else 256
    rng = random.Random(62911 if kind == 'paving' else 4721)
    pixels = array('f')
    tones = [rng.uniform(.91, 1.09) for _ in range(128)]
    for y in range(size):
        for x in range(size):
            if kind == 'paving':
                # 1.6 m repeat: eight .2 m rows and staggered .4 m pavers.
                row = int(y / size * 8)
                u = (x / size * 4 + (row % 2) * .5) % 4
                col = int(u)
                joint = min(u % 1, 1 - u % 1) < .012 or min((y / size * 8) % 1, 1 - (y / size * 8) % 1) < .025
                variation = tones[row * 8 + col] * rng.uniform(.96, 1.04)
                color = (.52, .43, .32) if joint else (.66 * variation, .52 * variation, .365 * variation)
            else:
                field = .94 + .065 * math.sin(x * .15) * math.sin(y * .11) + rng.uniform(-.12, .12)
                color = (.34 * field, .425 * field, .18 * field)
            pixels.extend((*color, 1.))
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    image.colorspace_settings.name = 'sRGB'
    image.pixels.foreach_set(pixels)
    image.update()
    image.pack()
    return image


def configure_courtyard_materials(materials, mobile):
    for mat, texture in (('courtPaver', 'paving'), ('courtLawn', 'lawn')):
        m = materials[mat]
        node = m.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = _texture(texture, mobile)
        node.extension = 'REPEAT'
        m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (1, 1, 1, 1)
        m.node_tree.links.new(node.outputs['Color'], m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return materials


def add_courtyard(g, vertices, faces, patches, mobile):
    floor = next(p for p in patches if p['id'] == LAYOUT['roofPatch'])
    floor_ids = set(floor['faces'])
    z = sum(vertices[v][2] for f in floor_ids for v in faces[f]) / sum(len(faces[f]) for f in floor_ids)
    if not 8.3 < z < 8.5:
        raise ValueError('Roof-0 terrace must retain the measured 8.37 m level')
    bvh = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
    ground, walls = type(g)(), type(g)()
    previous_mapper = getattr(g, 'mapper', None)
    g.mapper = None
    base_triangles = [site._ccw([vertices[i][:2] for i in faces[f]]) for f in floor_ids]
    blockers = []
    for i, f in enumerate(faces):
        if i in floor_ids or max(vertices[v][2] for v in f) <= z + .025:
            continue
        projected = site._ccw([vertices[v][:2] for v in f])
        if _area(projected) > .00001:
            blockers.append(projected)
    exposed = base_triangles
    for blocker in blockers:
        exposed = [part for poly in exposed for part in site._subtract_convex(poly, blocker) if _area(part) > 1e-7]

    def allowed(p, margin=0.):
        samples = [p]
        if margin:
            samples += [(p[0] + math.cos(a * math.tau / 8) * margin, p[1] + math.sin(a * math.tau / 8) * margin) for a in range(8)]
        for q in samples:
            hit = bvh.ray_cast(Vector((q[0], q[1], 100)), Vector((0, 0, -1)), 150)
            if hit[2] not in floor_ids or _protected(q):
                return False
        return True

    try:
        for poly in exposed:
            ground.polygon('courtPaver', [(x, y, z + .022) for x, y in poly], [(x / 1.6, y / 1.6) for x, y in poly])
        reserved = []
        for end in LAYOUT['aisleEnds']:
            r = LAYOUT['aisleClearance'] / math.cos(math.pi / 16)
            reserved.append([(end[0] + r * math.cos(i * math.tau / 16), end[1] + r * math.sin(i * math.tau / 16)) for i in range(16)])
        walk_corridors = [(a, b, width) for path, width in LAYOUT['walks'] for a, b in zip(path, path[1:])]
        reserved += site._blockers(walk_corridors)
        lawn_report = []
        for index, lawn in enumerate(LAYOUT['lawns']):
            outline = _smooth(lawn['points'], 5 if mobile else 9)
            lawn_parts = []
            for a in _triangulate(outline):
                for b in exposed:
                    part = _intersection(a, b)
                    if part:
                        lawn_parts.append(part)
            for reserve in reserved:
                lawn_parts = [part for poly in lawn_parts for part in site._subtract_convex(poly, reserve) if _area(part) > 1e-7]
            for part in lawn_parts:
                ground.polygon('courtLawn', [(x, y, z + .067) for x, y in part], [(x / 2.2, y / 2.2) for x, y in part])
            edge_length = 0.
            for a, b in zip(outline, outline[1:] + outline[:1]):
                middle = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if not all(allowed(q, .12) for q in (a, middle, b)):
                    continue
                direction = Vector((b[0] - a[0], b[1] - a[1], 0))
                length = direction.length
                if length < .02:
                    continue
                direction.normalize()
                n = Vector((-direction.y, direction.x, 0))
                g.box('courtEdge', (*middle, z + .055), direction, n, (0, 0, 1), length, .10, .065)
                edge_length += length
            # Sparse short blades add close-up depth without turning the lawn
            # into shrubs or hiding the architectural bases.
            rng = random.Random(8100 + index)
            blade_count = 70 if mobile else 210
            added = 0
            bounds = (min(p[0] for p in outline), max(p[0] for p in outline), min(p[1] for p in outline), max(p[1] for p in outline))
            for _ in range(blade_count * 3):
                x, y = rng.uniform(*bounds[:2]), rng.uniform(*bounds[2:])
                if not site._poly_inside((x, y), outline) or not allowed((x, y), .12):
                    continue
                angle = rng.random() * math.tau
                u = Vector((math.cos(angle), math.sin(angle), 0)) * .008
                c = Vector((x, y, z + .068))
                tip = c + Vector((rng.uniform(-.025, .025), rng.uniform(-.025, .025), rng.uniform(.04, .10)))
                g.polygon('courtLawn', [c - u, c + u, tip])
                g.polygon('courtLawn', [tip, c + u, c - u])
                added += 1
                if added >= blade_count:
                    break
            lawn_report.append({'name': lawn['name'], 'area': round(sum(_area(p) for p in lawn_parts), 2), 'edgedLength': round(edge_length, 2), 'shortBlades': added})

        planter_count = 0
        for pi, outline in enumerate(LAYOUT['planters']):
            outline = site._ccw(outline)
            centre = tuple(sum(p[k] for p in outline) / len(outline) for k in range(2))
            if not all(allowed(q, .35) for q in outline + [centre]):
                continue
            for a, b in zip(outline, outline[1:] + outline[:1]):
                wall = [(a[0], a[1], z + .025), (b[0], b[1], z + .025), (b[0], b[1], z + .38), (a[0], a[1], z + .38)]
                g.polygon('courtEdge', wall)
                walls.polygon('reveal', wall)
            ground.polygon('siteSoil', [(x, y, z + .36) for x, y in outline])
            rng = random.Random(7111 + pi)
            for i in range(15 if mobile else 30):
                x = rng.uniform(min(p[0] for p in outline), max(p[0] for p in outline))
                y = rng.uniform(min(p[1] for p in outline), max(p[1] for p in outline))
                if site._poly_inside((x, y), outline):
                    site._spray(g, (x, y, z + .67), .62, .58, rng.random() * math.tau, 0, 'siteMeadow')
            planter_count += 1

        # Only true, exposed terrace drops get perimeter railings. Building
        # contacts, skylights, amphitheater and stair approaches are skipped.
        edge_counts = Counter(tuple(sorted((a, b))) for f in floor_ids for a, b in zip(faces[f], faces[f][1:] + faces[f][:1]))
        rail_length, rail_runs = 0., 0
        for (ia, ib), count in edge_counts.items():
            if count != 1:
                continue
            a, b = Vector(vertices[ia]), Vector(vertices[ib])
            length = (b - a).length
            if length < 1.4:
                continue
            mid = (a + b) * .5
            if _protected(mid) or (mid.x > 155 and 243 < mid.y < 280):
                continue
            u = (b - a).normalized()
            n = Vector((-u.y, u.x, 0))
            left = allowed((mid.x + n.x * .4, mid.y + n.y * .4))
            right = allowed((mid.x - n.x * .4, mid.y - n.y * .4))
            if left == right:
                continue
            inward = n if left else -n
            outside = mid - inward * .45
            hit = bvh.ray_cast(Vector((outside.x, outside.y, 100)), Vector((0, 0, -1)), 150)
            if hit[0] and hit[0].z > z - 1.0:
                continue
            a, b = a + inward * .16, b + inward * .16
            if not all(allowed((a.lerp(b, t).x, a.lerp(b, t).y), .08) for t in (0.05, .25, .5, .75, .95)):
                continue
            for height in (.25, .66, 1.07):
                site._beam(g, 'frame', a + Vector((0, 0, height)), b + Vector((0, 0, height)), .018 if height < 1 else .025, sides=5 if mobile else 7)
            steps = max(1, math.ceil(length / 1.35))
            for i in range(steps + 1):
                p = a.lerp(b, i / steps)
                site._beam(g, 'frame', p + Vector((0, 0, .035)), p + Vector((0, 0, 1.08)), .025, sides=5 if mobile else 7)
            # Thin infill rods provide a readable real railing silhouette.
            rods = max(1, math.ceil(length / (.44 if mobile else .22)))
            for i in range(1, rods):
                p = a.lerp(b, i / rods)
                site._beam(g, 'frame', p + Vector((0, 0, .25)), p + Vector((0, 0, 1.04)), .006, sides=3)
            walls.box('reveal', (a + b) * .5 + Vector((0, 0, .55)), u, (0, 0, 1), inward, length, 1.1, .075)
            rail_length += length
            rail_runs += 1
        return {'groundGeometry': ground, 'wallGeometry': walls, 'report': {
            'kind': 'Photo-informed roof-0 garden landscape, source-bounded; not a landscape survey',
            'terraceElevation': z, 'sourceRoofArea': floor['area'],
            'exposedPavingArea': round(sum(_area(p) for p in exposed), 2),
            'lawns': lawn_report, 'planters': planter_count,
            'railingRuns': rail_runs, 'railingLength': round(rail_length, 2),
            'aisleEnds': LAYOUT['aisleEnds'], 'aisleClearance': LAYOUT['aisleClearance'],
            'groundTriangles': site._counts(ground)['triangles'], 'collisionTriangles': site._counts(walls)['triangles'],
            'references': ['references/pass2/csail-exterior.jpg', 'references/pass2/zahner-1039.jpg'],
            'integration': 'Configure courtyard materials after make_materials; mark only returned groundGeometry as stataGround and merge reveal wallGeometry into the existing hidden collision object.',
        }}
    finally:
        g.mapper = previous_mapper
