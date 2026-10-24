"""Vassar frontage landscape, in the existing east/north/up metre frame.

Photo-informed planting and low walls, not a landscape survey.  The measured
building and its road/apron surfaces remain the caller's responsibility.  All
coordinates live in SITE_LAYOUT so a better architectural source can replace
the shell without coupling the landscape to its patch numbers.

add_site_details(g, height, mobile) adds visible non-ground detail to g and
returns separate groundGeometry and wallGeometry.  The caller must flag only
groundGeometry as stataGround, and merge wallGeometry into its hidden collision
mesh.  No leaf, shrub, branch or decorative surface is a ground collider.
"""
import math
import random
from mathutils import Vector
from mathutils.geometry import tessellate_polygon


SITE_MATERIALS = {
    'siteSoil': ((.135, .097, .062, 1), .99, 0, None),
    'siteStone': ((.45, .445, .40, 1), .94, 0, None),
    'siteStoneCap': ((.59, .58, .52, 1), .90, 0, None),
    'siteBark': ((.19, .145, .105, 1), .98, 0, None),
    'siteLeafDark': ((.075, .14, .043, 1), .86, 0, None),
    'siteLeaf': ((.17, .255, .072, 1), .83, 0, None),
    'siteLeafLight': ((.29, .355, .11, 1), .82, 0, None),
    'siteGrassDry': ((.42, .355, .20, 1), .95, 0, None),
    # The cutout images already contain the calibrated foliage colors.
    'siteFoliage': ((1, 1, 1, 1), .86, 0, None),
    'siteMeadow': ((1, 1, 1, 1), .95, 0, None),
}

SITE_LAYOUT = {
    'frame': 'metres: Blender east, north, up; runtime east, up, south',
    'routeClearance': 1.8,
    'routes': [
        [(180, 292), (176, 324), (172, 328), (145, 340)],
        [(145, 340), (132, 336), (124, 332), (116, 328), (65, 305)],
    ],
    'aprons': [
        {'name': 'Dreyfoos vehicle passage', 'path': [(62, 304), (59, 294)], 'width': 6.3},
        {'name': 'Gates parking and loading', 'path': [(141, 338), (131, 330)], 'width': 5.2},
    ],
    'road': [(43, 305), (64, 313), (88, 323), (112, 334), (138, 344), (165, 355), (178, 360)],
    'roadHalfWidth': 5.45,
    'beds': [
        {
            'name': 'west garden',
            'polygon': [(69, 304), (81, 309.2), (88, 312.2), (87.5, 309.7), (79, 304), (70, 299.5)],
            'streetEdge': [(69, 304), (81, 309.2), (88, 312.2)],
            'berm': .43,
            'seed': 731,
        },
        {
            'name': 'Twins garden',
            'polygon': [(90, 313), (98, 316.5), (108, 321), (114, 324), (114.5, 321.3), (108, 317), (99, 312), (92, 309)],
            'streetEdge': [(90, 313), (98, 316.5), (108, 321), (114, 324)],
            'berm': .52,
            'seed': 1927,
        },
        {
            'name': 'east garden',
            'polygon': [(144, 334.5), (154, 338.2), (165, 342.5), (173, 345.8), (175, 341), (164, 336.6), (155, 332.1), (147, 329.5)],
            'streetEdge': [(144, 334.5), (154, 338.2), (165, 342.5), (173, 345.8)],
            'berm': .58,
            'seed': 4401,
        },
    ],
    # Heights include the crown, and are above terrain rather than absolute Z.
    # These are planting anchors for optional reuse by runtime vegetation too.
    'trees': [
        {'name': 'west broadleaf', 'xy': (73.5, 303.4), 'height': 10.8, 'spread': 3.25, 'radius': .24, 'seed': 801},
        {'name': 'Twins young tree', 'xy': (96, 313.7), 'height': 6.6, 'spread': 1.95, 'radius': .12, 'seed': 813},
        {'name': 'central young tree', 'xy': (109.3, 320), 'height': 7.3, 'spread': 2.1, 'radius': .14, 'seed': 839},
        {'name': 'east broadleaf', 'xy': (151, 332.8), 'height': 11.6, 'spread': 3.55, 'radius': .27, 'seed': 853},
        {'name': 'east end broadleaf', 'xy': (166, 339.4), 'height': 10.1, 'spread': 3.1, 'radius': .23, 'seed': 877},
    ],
    'leafTrianglesDesktop': 46000,
    'leafTrianglesMobile': 8800,
    'leafSpraysDesktop': 4500,
    'leafSpraysMobile': 1650,
    # This existing navigation link crosses a gap between the east beds. Give
    # it an actual walk surface rather than exposing the aerial-photo ground.
    'walkFinish': [{'path': [(172, 328), (145, 340)], 'width': 3.6}],
}

_UP = Vector((0, 0, 1))
_LEAF_MATS = ('siteLeafDark', 'siteLeaf', 'siteLeafLight')


def _cutout_image(kind, mobile):
    """Small, packed native textures; no external download or image files.

    This uses the project's existing courtyard-tree spray principle. The 43
    individually shaped leaves on a 1.0–1.3 m spray remain 0.11–0.19 m long.
    Transparent spaces between those leaves are retained in both colour and
    shadow passes, so a low triangle budget does not imply solid crown blobs.
    """
    import bpy
    from array import array
    size = 256 if mobile else 512
    name = 'Stata site ' + kind + (' mobile' if mobile else ' desktop')
    existing = bpy.data.images.get(name)
    if existing:
        return existing
    pixels = array('f', [0.]) * (size * size * 4)
    scale = size / 512

    def pixel(x, y, color, alpha=1.):
        if 0 <= x < size and 0 <= y < size:
            index = (y * size + x) * 4
            if alpha >= pixels[index + 3]:
                pixels[index:index + 4] = array('f', (*color, alpha))

    def line(a, b, width, color):
        ax, ay, bx, by = a[0] * scale, a[1] * scale, b[0] * scale, b[1] * scale
        length = math.hypot(bx - ax, by - ay)
        n = max(1, math.ceil(length * 1.5))
        radius = max(.6, width * scale / 2)
        for i in range(n + 1):
            x, y = ax + (bx - ax) * i / n, ay + (by - ay) * i / n
            for ix in range(math.floor(x - radius), math.ceil(x + radius) + 1):
                for iy in range(math.floor(y - radius), math.ceil(y + radius) + 1):
                    if (ix - x) ** 2 + (iy - y) ** 2 <= radius * radius:
                        pixel(ix, iy, color)

    rng = random.Random(6931 if kind == 'leaf sprays' else 9173)
    if kind == 'leaf sprays':
        leaves = []
        line((246, 6), (282, 472), 2.6, (.29, .30, .13))
        for tier in range(7):
            for side in (-1, 1):
                y, x = 72 + tier * 54 + rng.random() * 17, 249 + tier * 4
                angle = (2.86 - rng.random() * .22) if side < 0 else (.40 + rng.random() * .24)
                reach = (114 + math.sin(tier / 7 * math.pi) * 27) * (.76 if tier == 6 else 1)
                dx, dy = math.cos(angle), math.sin(angle)
                line((x, y), (x + dx * reach, y + dy * reach), 2.0, (.31, .33, .15))
                for j in range(3):
                    along = .30 + j * .28
                    turn = 0 if j == 2 else (1 if j % 2 else -1) * .56
                    leaves.append((x + dx * reach * along, y + dy * reach * along,
                                   angle + turn, 52 + rng.random() * 21, 18 + rng.random() * 7))
        leaves.append((282, 443, 1.43, 58, 23))
        for x, y, angle, length, width in leaves:
            ca, sa = math.cos(angle), math.sin(angle)
            minx, maxx = math.floor((x - length) * scale), math.ceil((x + length) * scale)
            miny, maxy = math.floor((y - length) * scale), math.ceil((y + length) * scale)
            shade = rng.uniform(.88, 1.08)
            for ix in range(max(0, minx), min(size, maxx + 1)):
                for iy in range(max(0, miny), min(size, maxy + 1)):
                    dx, dy = ix / scale - x, iy / scale - y
                    u, v = (dx * ca + dy * sa) / length, -dx * sa + dy * ca
                    if not 0 < u < 1:
                        continue
                    half = width * math.sin(math.pi * u) ** .75 * (.86 if v < 0 else .72)
                    if abs(v) > half:
                        continue
                    ridge = 1 - abs(v) / max(.1, half)
                    light = shade * (.82 + .18 * ridge + .07 * math.sin(u * 5))
                    color = (.37 * light, .455 * light, .19 * light)
                    if abs(v) < .7:
                        color = (.30, .37, .145)
                    elif abs((u + abs(v) / length * .48) % .15 - .075) < .009:
                        color = tuple(c * .86 for c in color)
                    pixel(ix, iy, color)
    else:
        # Blades fan from one crown; seed stems have small separated florets.
        for i in range(35):
            start = (256 + rng.uniform(-45, 45), 8 + rng.uniform(0, 16))
            bend = rng.uniform(-200, 200)
            h = rng.uniform(235, 470)
            color = rng.choice(((.43, .43, .22), (.50, .46, .29), (.34, .40, .18), (.60, .54, .34)))
            previous = start
            for j in range(1, 14):
                t = j / 13
                p = (start[0] + bend * t * t, start[1] + h * (t - .25 * t * t))
                line(previous, p, max(.7, (4.2 - 3.2 * t)), color)
                previous = p
        for i in range(9):
            start = (256 + rng.uniform(-40, 40), 10)
            top = (256 + rng.uniform(-120, 120), rng.uniform(350, 495))
            line(start, top, 1.5, (.47, .40, .24))
            for j in range(12):
                at = .78 + .21 * j / 12
                x, y = start[0] + (top[0] - start[0]) * at, top[1] * at
                for side in (-1, 1):
                    line((x, y), (x + side * rng.uniform(3, 10), y + rng.uniform(2, 8)), 1.7, (.62, .55, .36))
    image = bpy.data.images.new(name, width=size, height=size, alpha=True)
    image.colorspace_settings.name = 'sRGB'
    image.pixels.foreach_set(pixels)
    image.update()
    image.pack()
    return image


def configure_site_materials(materials, mobile):
    """Call immediately after the builder creates its material dictionary.

    Math ROUND explicitly exports glTF MASK alphaMode (cutoff .5) in Blender
    4.5; this avoids transparent sorting and retains the cutout shadow silhouette.
    """
    for name, kind in (('siteFoliage', 'leaf sprays'), ('siteMeadow', 'meadow tufts')):
        material = materials[name]
        material.use_backface_culling = False
        material.surface_render_method = 'DITHERED'
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = nodes.get('Principled BSDF')
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = _cutout_image(kind, mobile)
        texture.name = 'Stata cutout ' + kind
        texture.interpolation = 'Linear'
        texture.extension = 'CLIP'
        threshold = nodes.new('ShaderNodeMath')
        threshold.operation = 'ROUND'
        links.new(texture.outputs['Color'], shader.inputs['Base Color'])
        links.new(texture.outputs['Alpha'], threshold.inputs[0])
        links.new(threshold.outputs[0], shader.inputs['Alpha'])
    return materials


def configure_site_objects(objects):
    """Optional after Geometry.build: smooth only the native wood geometry."""
    for obj in objects:
        if obj.type == 'MESH' and any(m and m.name.split('.')[0] == 'siteBark' for m in obj.data.materials):
            for face in obj.data.polygons:
                face.use_smooth = True


def _cross(a, b, p):
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def _ccw(poly):
    area = sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(poly, poly[1:] + poly[:1]))
    return list(poly if area > 0 else reversed(poly))


def _segment_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0., min(1., ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / max(1e-12, dx * dx + dy * dy)))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)


def _poly_inside(p, poly):
    inside = False
    for a, b in zip(poly, poly[1:] + poly[:1]):
        if (a[1] > p[1]) != (b[1] > p[1]):
            if p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]):
                inside = not inside
    return inside


def _edge_distance(p, poly):
    return min(_segment_distance(p, a, b) for a, b in zip(poly, poly[1:] + poly[:1]))


def _corridors():
    out = []
    for path in SITE_LAYOUT['routes']:
        out.extend((a, b, SITE_LAYOUT['routeClearance']) for a, b in zip(path, path[1:]))
    for apron in SITE_LAYOUT['aprons']:
        out.extend((a, b, apron['width'] / 2 + .6) for a, b in zip(apron['path'], apron['path'][1:]))
    path = SITE_LAYOUT['road']
    out.extend((a, b, SITE_LAYOUT['roadHalfWidth']) for a, b in zip(path, path[1:]))
    return out


def _clearance(p, corridors):
    return min(_segment_distance(p, a, b) - r for a, b, r in corridors)


def _clip_half(poly, a, b, inside):
    result = []
    for p, q in zip(poly, poly[1:] + poly[:1]):
        dp, dq = _cross(a, b, p), _cross(a, b, q)
        pin, qin = (dp >= -1e-9, dq >= -1e-9) if inside else (dp <= 1e-9, dq <= 1e-9)
        if pin:
            result.append(p)
        if pin != qin:
            t = dp / (dp - dq)
            result.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return result


def _subtract_convex(poly, blocker):
    if (max(p[0] for p in poly) < min(p[0] for p in blocker) or
            min(p[0] for p in poly) > max(p[0] for p in blocker) or
            max(p[1] for p in poly) < min(p[1] for p in blocker) or
            min(p[1] for p in poly) > max(p[1] for p in blocker)):
        return [poly]
    remainder, result = poly, []
    for a, b in zip(blocker, blocker[1:] + blocker[:1]):
        if len(remainder) < 3:
            break
        outside = _clip_half(remainder, a, b, False)
        if len(outside) >= 3:
            result.append(outside)
        remainder = _clip_half(remainder, a, b, True)
    return result


def _blockers(corridors):
    out = []
    for a, b, radius in corridors:
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        nx, ny = -dy / length * radius, dx / length * radius
        out.append(_ccw([(a[0] + nx, a[1] + ny), (a[0] - nx, a[1] - ny),
                         (b[0] - nx, b[1] - ny), (b[0] + nx, b[1] + ny)]))
        # Circumscribed dodecagons retain the requested round-end clearance.
        r = radius / math.cos(math.pi / 12)
        for p in (a, b):
            out.append([(p[0] + r * math.cos(i * math.tau / 12),
                         p[1] + r * math.sin(i * math.tau / 12)) for i in range(12)])
    return out


def _soil_z(x, y, bed, height, corridors):
    margin = max(0., min(_edge_distance((x, y), bed['polygon']), _clearance((x, y), corridors)))
    s = min(1., margin / 1.55)
    # A gentle rounded bank behind the street edge, not a green plinth.
    return height(x, y) + .13 + bed['berm'] * s * s * (3 - 2 * s)


def _ground(g, bed, height, corridors, blockers):
    poly = _ccw(bed['polygon'])
    vertices = [Vector((x, y, 0)) for x, y in poly]
    triangles = [[poly[p] if isinstance(p, int) else (p.x, p.y) for p in tri]
                 for tri in tessellate_polygon([vertices])]
    pieces = triangles
    for blocker in blockers:
        pieces = [part for p in pieces for part in _subtract_convex(p, blocker)]
    step = .55
    count = 0
    for p in pieces:
        x0, x1 = min(x for x, y in p), max(x for x, y in p)
        y0, y1 = min(y for x, y in p), max(y for x, y in p)
        for ix in range(math.floor(x0 / step), math.ceil(x1 / step)):
            for iy in range(math.floor(y0 / step), math.ceil(y1 / step)):
                x, y = ix * step, iy * step
                cell = [(x, y), (x + step, y), (x + step, y + step), (x, y + step)]
                part = p
                for a, b in zip(cell, cell[1:] + cell[:1]):
                    if len(part) < 3:
                        break
                    part = _clip_half(part, a, b, True)
                if len(part) < 3:
                    continue
                # The fan centre samples actual terrain as well as the outline.
                cx, cy = sum(q[0] for q in part) / len(part), sum(q[1] for q in part) / len(part)
                centre = (cx, cy, _soil_z(cx, cy, bed, height, corridors))
                for a, b in zip(part, part[1:] + part[:1]):
                    g.polygon('siteSoil', [centre, (a[0], a[1], _soil_z(*a, bed, height, corridors)),
                                          (b[0], b[1], _soil_z(*b, bed, height, corridors))])
                    count += 1
    return count


def _walk_finish(g, height):
    for finish in SITE_LAYOUT['walkFinish']:
        for a, b in zip(finish['path'], finish['path'][1:]):
            delta = Vector((b[0] - a[0], b[1] - a[1]))
            length = delta.length
            u = delta.normalized()
            n = Vector((-u.y, u.x))
            along = max(1, math.ceil(length / .45))
            across = max(1, math.ceil(finish['width'] / .45))
            for i in range(along):
                for j in range(across):
                    p = []
                    for f, s in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                        q = Vector(a) + u * (length * f / along) + n * (finish['width'] * (s / across - .5))
                        p.append((q.x, q.y, height(q.x, q.y) + .095))
                    cx, cy = sum(q[0] for q in p) / 4, sum(q[1] for q in p) / 4
                    centre = (cx, cy, height(cx, cy) + .095)
                    for first, second in zip(p, p[1:] + p[:1]):
                        g.polygon('paving', [centre, first, second])


def _beam(g, material, a, b, radius_a, radius_b=None, sides=6):
    a, b = Vector(a), Vector(b)
    axis = b - a
    if axis.length < 1e-5:
        return
    axis.normalize()
    u = axis.cross(Vector((0, 0, 1)) if abs(axis.z) < .95 else Vector((0, 1, 0))).normalized()
    v = axis.cross(u).normalized()
    radius_b = radius_a if radius_b is None else radius_b
    low = [a + radius_a * (u * math.cos(i * math.tau / sides) + v * math.sin(i * math.tau / sides)) for i in range(sides)]
    high = [b + radius_b * (u * math.cos(i * math.tau / sides) + v * math.sin(i * math.tau / sides)) for i in range(sides)]
    for i in range(sides):
        j = (i + 1) % sides
        g.polygon(material, [low[i], low[j], high[j], high[i]])
    g.polygon(material, list(reversed(low)))
    g.polygon(material, high)


def _stone_edge(g, walls, bed, height, corridors):
    count, segments = 0, []
    path = bed['streetEdge']
    for a, b in zip(path, path[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        # StreetEdge is authored left-to-right; the garden lies to its right.
        nx, ny = uy, -ux
        steps = max(1, math.ceil(length / 1.18))
        for i in range(steps):
            t0, t1 = i / steps, (i + 1) / steps
            qa = (a[0] + dx * t0, a[1] + dy * t0)
            qb = (a[0] + dx * t1, a[1] + dy * t1)
            # Stop walls before protected routes instead of spanning them with
            # an invisible collision box. The wall is entirely garden-side.
            corners = [(qa[0] + nx * .035, qa[1] + ny * .035),
                       (qb[0] + nx * .035, qb[1] + ny * .035),
                       (qb[0] + nx * .29, qb[1] + ny * .29),
                       (qa[0] + nx * .29, qa[1] + ny * .29)]
            if min(_clearance(q, corridors) for q in corners + [((qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2)]) < .16:
                continue
            corners = _ccw(corners)
            low = [Vector((x, y, height(x, y) + .045)) for x, y in corners]
            top = [Vector((x, y, height(x, y) + .34)) for x, y in corners]
            for j in range(4):
                k = (j + 1) % 4
                face = [low[j], low[k], top[k], top[j]]
                g.polygon('siteStone', face)
                walls.polygon('reveal', face)
            g.polygon('siteStoneCap', top)
            walls.polygon('reveal', top)
            # Actual narrow recessed joints avoid painting a grid on a slab.
            mid = Vector((qa[0] + nx * .1625, qa[1] + ny * .1625,
                          height(qa[0], qa[1]) + .342))
            g.box('siteSoil', mid + _UP * .002, (ux, uy, 0), (nx, ny, 0), _UP, .012, .25, .008)
            count += 1
            segments.append([qa, qb])
    return count, segments


def _spray(g, centre, length, width, angle, inclination, material):
    """One double-sided cutout spray; each painted leaf remains small."""
    c = Vector(centre)
    u = Vector((math.cos(angle), math.sin(angle), 0)) * width * .5
    v = Vector((-math.sin(angle) * math.sin(inclination), math.cos(angle) * math.sin(inclination),
                math.cos(inclination))) * length * .5
    g.polygon(material, [c - u - v, c + u - v, c + u + v, c - u + v],
              [(0, 0), (1, 0), (1, 1), (0, 1)])


def _tree(g, walls, tree, height, bed, corridors, mobile, leaf_count):
    rng = random.Random(tree['seed'])
    x, y = tree['xy']
    ground = _soil_z(x, y, bed, height, corridors)
    h, spread, radius = tree['height'], tree['spread'], tree['radius']
    origin = Vector((x, y, ground))
    sides = 6 if mobile else 8
    lean = Vector((rng.uniform(-.25, .25), rng.uniform(-.22, .22), 0))
    trunk = [origin - _UP * .10,
             origin + lean * .3 + _UP * (h * .18),
             origin + lean + _UP * (h * .36),
             origin + lean * 1.6 + _UP * (h * .58),
             origin + lean * 2 + _UP * (h * .82)]
    radii = [radius * 1.28, radius, radius * .78, radius * .43, .025]
    for a, b, ra, rb in zip(trunk, trunk[1:], radii, radii[1:]):
        _beam(g, 'siteBark', a, b, ra, rb, sides)
    # Collision is the visible trunk, never the canopy bounding sphere.
    _beam(walls, 'reveal', origin - _UP * .06, origin + lean * .8 + _UP * 2.7,
          radius * 1.28, radius * .82, 8)
    for i in range(5):
        angle = i * math.tau / 5 + rng.uniform(-.23, .23)
        root = origin + Vector((math.cos(angle) * radius * 2.2, math.sin(angle) * radius * 2.2, -.035))
        _beam(g, 'siteBark', root, origin + _UP * .42, radius * .12, radius * .32, 5)
    lobes = []
    phase = rng.uniform(0, math.tau)
    branches = 7 if h > 8 else 6
    for i in range(branches):
        angle = phase + i * 2.39996 + rng.uniform(-.16, .16)
        start = origin + lean + _UP * (h * (.34 + i / branches * .23))
        reach = spread * rng.uniform(.62, .94) * (1 - i / branches * .18)
        end = origin + Vector((math.cos(angle) * reach, math.sin(angle) * reach,
                               h * (.63 + i / branches * .24) + rng.uniform(-.3, .3)))
        mid = start.lerp(end, .46) + _UP * .18
        _beam(g, 'siteBark', start, mid, radius * (.43 - i / branches * .13), radius * .19, sides)
        _beam(g, 'siteBark', mid, end, radius * .19, .018, sides)
        for j in range(3):
            a2 = angle + (j - 1) * .64 + rng.uniform(-.2, .2)
            reach2 = spread * rng.uniform(.20, .37)
            branch_start = mid.lerp(end, .28 + j * .27)
            tip = end + Vector((math.cos(a2) * reach2, math.sin(a2) * reach2, rng.uniform(.15, .75)))
            _beam(g, 'siteBark', branch_start, tip, .021 if h > 8 else .014, .005, 4 if mobile else 5)
            lobes.append((tip, spread * rng.uniform(.27, .40), h * rng.uniform(.105, .155)))
    lobes.append((origin + lean * 2 + _UP * (h * .88), spread * .47, h * .14))
    # Each lobe is a loose group of terminal sprays; nothing is an opaque ball.
    for i in range(leaf_count):
        centre, horizontal, vertical = lobes[i % len(lobes)]
        theta = rng.uniform(0, math.tau)
        zz = rng.uniform(-1, 1)
        rr = rng.random() ** .34
        xy = math.sqrt(max(0, 1 - zz * zz))
        p = centre + Vector((math.cos(theta) * horizontal * xy * rr,
                             math.sin(theta) * horizontal * xy * rr,
                             zz * vertical * rr))
        # A small upward crown bias reveals branching below, like street trees.
        if p.z < ground + 3.25:
            p.z = ground + 3.25 + rng.random() * .3
        length = rng.uniform(1.05, 1.28) if mobile else rng.uniform(.95, 1.22)
        p.z = max(p.z, ground + 3.25 + length * .5)
        _spray(g, p, length, length * rng.uniform(.88, 1.04), theta + rng.uniform(-.7, .7),
               rng.uniform(-1.1, 1.1), 'siteFoliage')
    return {'name': tree['name'], 'xy': [x, y], 'ground': round(ground, 4),
            'height': h, 'spread': spread, 'leafSprays': leaf_count, 'individualLeavesApprox': leaf_count * 43,
            'trunkCorridorMargin': round(_clearance((x, y), corridors) - radius * 1.28, 3),
            'minimumLeafHeight': 3.25}


def _grasses(g, bed, height, corridors, mobile):
    rng = random.Random(bed['seed'])
    poly = bed['polygon']
    x0, x1 = min(p[0] for p in poly), max(p[0] for p in poly)
    y0, y1 = min(p[1] for p in poly), max(p[1] for p in poly)
    step = .76 if mobile else .59
    tufts = 0
    for ix in range(math.floor(x0 / step), math.ceil(x1 / step)):
        for iy in range(math.floor(y0 / step), math.ceil(y1 / step)):
            x, y = (ix + rng.uniform(.2, .8)) * step, (iy + rng.uniform(.2, .8)) * step
            p = (x, y)
            if not _poly_inside(p, poly) or _edge_distance(p, poly) < .35 or _clearance(p, corridors) < .5:
                continue
            # Broad quiet mulch near the sidewalk, deeper planting at the back.
            if min(_segment_distance(p, a, b) for a, b in zip(bed['streetEdge'], bed['streetEdge'][1:])) < .7:
                continue
            if any(math.hypot(x - t['xy'][0], y - t['xy'][1]) < .6 for t in SITE_LAYOUT['trees']):
                continue
            z = _soil_z(x, y, bed, height, corridors)
            tall = rng.uniform(.70, 1.18)
            phase = rng.uniform(0, math.pi)
            for j in range(2 if mobile else 3):
                _spray(g, (x, y, z + tall * .49), tall, rng.uniform(.88, 1.22),
                       phase + j * math.pi / 3, rng.uniform(-.08, .08), 'siteMeadow')
            tufts += 1
    return tufts


def _counts(g):
    return {'triangles': sum(len(v['f']) for v in g.groups.values()),
            'materials': len([v for v in g.groups.values() if v['f']])}


def add_site_details(g, height, mobile):
    """Build bounded landscape detail without changing existing architecture."""
    ground, walls = type(g)(), type(g)()
    previous_mapper = getattr(g, 'mapper', None)
    g.mapper = None
    corridors = _corridors()
    blockers = _blockers(corridors)
    bed_reports = []
    baseline = _counts(g)['triangles']
    try:
        _walk_finish(ground, height)
        for bed in SITE_LAYOUT['beds']:
            faces = _ground(ground, bed, height, corridors, blockers)
            wall_count, segments = _stone_edge(g, walls, bed, height, corridors)
            tufts = _grasses(g, bed, height, corridors, mobile)
            bed_reports.append({'name': bed['name'], 'groundTriangles': faces,
                                'wallSegments': wall_count, 'wallPaths': segments, 'grassTufts': tufts})
        leaf_budget = SITE_LAYOUT['leafSpraysMobile' if mobile else 'leafSpraysDesktop']
        weights = [t['spread'] ** 1.3 for t in SITE_LAYOUT['trees']]
        trees = []
        for tree, weight in zip(SITE_LAYOUT['trees'], weights):
            p = tree['xy']
            bed = next((b for b in SITE_LAYOUT['beds'] if _poly_inside(p, b['polygon'])), None)
            if bed is None or _clearance(p, corridors) < tree['radius'] * 1.28 + .2:
                raise ValueError('Tree anchor is outside its garden or blocks a protected corridor: ' + tree['name'])
            leaves = int(leaf_budget * weight / sum(weights))
            trees.append(_tree(g, walls, tree, height, bed, corridors, mobile, leaves))
        report = {
            'kind': 'Photo-informed Vassar landscape; positions are editable estimates, not a landscape survey',
            'references': ['references/pass2/zahner-0995.jpg', '../../output/design/mit-20261021/references/stata-official.webp'],
            'lod': 'mobile' if mobile else 'desktop',
            'routeClearance': SITE_LAYOUT['routeClearance'],
            'serviceApronAdditionalClearance': .6,
            'beds': bed_reports,
            'treeAnchors': trees,
            'treeLeafTriangles': sum(t['leafSprays'] * 2 for t in trees),
            'treeIndividualLeavesApprox': sum(t['individualLeavesApprox'] for t in trees),
            'visibleDetailTriangles': _counts(g)['triangles'] - baseline,
            'ground': _counts(ground),
            'collision': _counts(walls),
            'collisionMaterials': sorted(walls.groups),
            'integration': 'Call configure_site_materials after make_materials. Only groundGeometry gets stataGround. Merge wallGeometry into the single hidden reveal collision mesh. Main g receives no ground flag.',
            'limitations': 'Tree species and exact planting stations are photo estimates; courtyard and confirmed pedestrian entry doors are outside this module.',
        }
        return {'groundGeometry': ground, 'wallGeometry': walls, 'report': report}
    finally:
        g.mapper = previous_mapper
