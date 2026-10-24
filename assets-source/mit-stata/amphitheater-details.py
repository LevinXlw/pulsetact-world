"""Survey-anchored Hockfield Court amphitheater, in Blender east/north/up metres.

The footprint and three elevations come from the source mesh. Twelve seating
tiers, two stair aisles, coping and rail dimensions are photographic estimates
from A. Zahner Company's completed-building photograph 1039, not CAD dimensions.
Only this component's source fan and retaining faces are replaced; roof patch 0
and the surrounding courtyard are not changed.
"""
import bisect
import math
from mathutils import Vector

REFERENCE = 'https://azahner.com/wp-content/uploads/2025/11/2_mit-stata-center-photo-c-zahner-1039.jpg'
SIDE_PATCHES = {212, 215}
ROWS = 12
SUBSTEPS = 3
AISLES = (.27, .70)
AISLE_WIDTH = 1.35
_DATA = None


def _key(p):
    return tuple(round(float(c), 5) for c in p)


def _xykey(p):
    return tuple(round(float(c), 5) for c in p[:2])


def _circle(points):
    mx = sum(p.x for p in points) / len(points)
    my = sum(p.y for p in points) / len(points)
    xx = xy = yy = xr = yr = 0.0
    for p in points:
        x, y = p.x - mx, p.y - my
        r = (x*x + y*y) / 2
        xx += x*x
        xy += x*y
        yy += y*y
        xr += x*r
        yr += y*r
    det = xx*yy - xy*xy
    if abs(det) < 1e-10:
        raise ValueError('Amphitheater arc has no stable fitted circle')
    center = Vector((mx + (xr*yy-yr*xy)/det, my + (yr*xx-xr*xy)/det, 0))
    angles = sorted((math.atan2(p.y-center.y, p.x-center.x) % math.tau, p) for p in points)
    # Both surveyed arcs have their opening to the east, so their occupied
    # intervals do not cross angle zero. Validate instead of silently wrapping.
    if angles[-1][0] - angles[0][0] > math.radians(300):
        raise ValueError('Unexpected amphitheater arc orientation')
    a0, a1 = angles[0][0], angles[-1][0]
    nodes = [((a-a0)/(a1-a0), p.copy()) for a, p in angles]
    radius = sum(math.hypot(p.x-center.x, p.y-center.y) for p in points)/len(points)
    return {'center': center, 'radius': radius, 'angles': (a0, a1), 'nodes': nodes}


def replaced_faces(vertices, faces, patches):
    """Identify the survey component and cache its geometry for construction.

    The two recorded side patches anchor the search. Connectivity then selects
    the fan, so an unrelated roof with the same elevations is never removed.
    Source coordinates are used rather than hard-coded scene placement.
    """
    global _DATA
    vs = [Vector(p) for p in vertices]
    sides = {f for p in patches if p['id'] in SIDE_PATCHES for f in p['faces']}
    if len(sides) != 4:
        raise ValueError('Expected the two surveyed amphitheater side walls')
    levels = sorted(set(round(vs[i].z, 4) for f in sides for i in faces[f]))
    if len(levels) != 3:
        raise ValueError('Amphitheater needs stage, inner rim and outer rim levels')
    zbase, zinner, zouter = [sum(vs[i].z for f in sides for i in faces[f] if abs(vs[i].z-z)<.001) /
                            sum(1 for f in sides for i in faces[f] if abs(vs[i].z-z)<.001) for z in levels]
    def edges(fi):
        ps = [_key(vs[i]) for i in faces[fi]]
        return {tuple(sorted((a, b))) for a, b in zip(ps, ps[1:]+ps[:1])}
    possible = set()
    edgeowners = {}
    for fi, ids in enumerate(faces):
        zs = [vs[i].z for i in ids]
        if all(min(abs(z-zinner), abs(z-zouter)) < .001 for z in zs) and max(zs)-min(zs) > 1:
            possible.add(fi)
            for edge in edges(fi):
                edgeowners.setdefault(edge, set()).add(fi)
    seededges = set().union(*(edges(fi) for fi in sides))
    fan = set().union(*(edgeowners.get(e, set()) for e in seededges))
    stack = list(fan)
    while stack:
        fi = stack.pop()
        for edge in edges(fi):
            for other in edgeowners.get(edge, ()):
                if other not in fan:
                    fan.add(other)
                    stack.append(other)
    if len(fan) < 20:
        raise ValueError('Could not identify the full amphitheater fan')
    inner = {_key(vs[i]): vs[i] for f in fan for i in faces[f] if abs(vs[i].z-zinner)<.001}
    outer = {_key(vs[i]): vs[i] for f in fan for i in faces[f] if abs(vs[i].z-zouter)<.001}
    ikeys, okeys = {_xykey(p) for p in inner.values()}, {_xykey(p) for p in outer.values()}
    innerwall, outerwall = set(), set()
    for fi, ids in enumerate(faces):
        ps = [vs[i] for i in ids]
        if max(p.z for p in ps)-min(p.z for p in ps)<.01:
            continue
        if all(_xykey(p) in ikeys and zbase-.001<=p.z<=zinner+.001 for p in ps):
            innerwall.add(fi)
        if all(_xykey(p) in okeys and p.z<=zouter+.001 for p in ps) and abs(max(p.z for p in ps)-zouter)<.001:
            outerwall.add(fi)
    replaced = fan | sides | innerwall | outerwall
    _DATA = {'inner': _circle(list(inner.values())), 'outer': _circle(list(outer.values())),
             'base': zbase, 'inner_z': zinner, 'outer_z': zouter,
             'outer_faces': [[vs[i].copy() for i in faces[f]] for f in sorted(outerwall)],
             'replaced': replaced, 'source_counts': {'fan': len(fan), 'innerWall': len(innerwall),
                                                      'outerWall': len(outerwall), 'sides': len(sides)},
             'bounds': [[min(p[k] for p in list(inner.values())+list(outer.values())) for k in range(3)],
                        [max(p[k] for p in list(inner.values())+list(outer.values())) for k in range(3)]]}
    return set(replaced)


def _arc(arc, s, straight=False):
    s = max(0., min(1., s))
    nodes = arc['nodes']
    idx = max(0, min(len(nodes)-2, bisect.bisect_right([n[0] for n in nodes], s)-1))
    ta, a = nodes[idx]
    tb, b = nodes[idx+1]
    t = (s-ta)/(tb-ta)
    if straight:
        return a.lerp(b, t)
    # Radial interpolation retains the small surveyed departures from a circle.
    # Exact end points preserve the two existing side walls' footprint.
    c = arc['center']
    ra, rb = math.hypot(a.x-c.x, a.y-c.y), math.hypot(b.x-c.x, b.y-c.y)
    angle = arc['angles'][0]+s*(arc['angles'][1]-arc['angles'][0])
    radius = ra+(rb-ra)*t
    return Vector((c.x+radius*math.cos(angle), c.y+radius*math.sin(angle), 0))


def _point(q, s, z):
    a = _arc(_DATA['inner'], s)
    b = _arc(_DATA['outer'], s)
    p = a.lerp(b, q)
    # At the courtyard edge use the exact survey polygon, not the fitted arc.
    # This prevents daylight gaps against the untouched patch-0 paving.
    c = _arc(_DATA['outer'], s, straight=True)
    p.x += (c.x-b.x)*q**8
    p.y += (c.y-b.y)*q**8
    p.z = z
    return p


def _height(row):
    if row == 0:
        return _DATA['base']
    return _DATA['inner_z'] + (_DATA['outer_z']-_DATA['inner_z'])*(row-1)/(ROWS-1)


def _halfwidth(q):
    a, b = _DATA['inner'], _DATA['outer']
    radius = a['radius']+(b['radius']-a['radius'])*q
    span = (a['angles'][1]-a['angles'][0])*(1-q)+(b['angles'][1]-b['angles'][0])*q
    return AISLE_WIDTH/(2*radius*span)


def _bands(q):
    half = _halfwidth(q)
    return ((0., AISLES[0]-half), (AISLES[0]+half, AISLES[1]-half), (AISLES[1]+half, 1.))


def _poly(g, mat, ps, normal=None):
    ps = [Vector(p) for p in ps]
    n = sum(((ps[i]-ps[0]).cross(ps[i+1]-ps[0]) for i in range(1, len(ps)-1)), Vector())
    if n.length_squared < 1e-13:
        return
    if normal is not None and n.dot(Vector(normal)) < 0:
        ps.reverse()
    g.polygon(mat, ps)


def _riser(g, q, sa, sb, low, high):
    if high-low < .0001:
        return
    inward = _point(max(0,q-.01), (sa+sb)/2, 0)-_point(min(1,q+.01), (sa+sb)/2, 0)
    _poly(g, 'brick', [_point(q, sa, low), _point(q, sa, high),
                       _point(q, sb, high), _point(q, sb, low)], inward)


def _tube(g, a, b, radius, count):
    a, b = Vector(a), Vector(b)
    axis = b-a
    if axis.length < .0001:
        return
    axis.normalize()
    u = axis.cross(Vector((0,0,1)))
    if u.length < .01:
        u = axis.cross(Vector((0,1,0)))
    u.normalize()
    v = axis.cross(u).normalized()
    rings = [[p+radius*(math.cos(i*math.tau/count)*u+math.sin(i*math.tau/count)*v)
              for i in range(count)] for p in (a,b)]
    for i in range(count):
        j=(i+1)%count
        _poly(g, 'frame', [rings[0][i],rings[0][j],rings[1][j],rings[1][i]])
    _poly(g, 'frame', list(reversed(rings[0])))
    _poly(g, 'frame', rings[1])


def add_amphitheater(g, mobile=False):
    """Append visible, collision-ready geometry using the existing materials.

    Call replaced_faces first. For runtime integration, top-facing triangles of
    paving/curb/brick need stataGround in addition to the separate wall collider;
    handrails (frame) are excluded from that walkable surface extraction.
    """
    if _DATA is None:
        raise RuntimeError('Call amphitheater.replaced_faces before building it')
    oldmapper = getattr(g, 'mapper', None)
    g.mapper = None
    count = 36 if mobile else 72
    band_nodes = []
    for band in range(3):
        lo, hi = _bands(1)[band]
        n = max(8, round(count*(hi-lo)))
        knots = {i/n for i in range(n+1)}
        # Preserve every courtyard-side source corner at the outer boundary.
        knots.update((s-lo)/(hi-lo) for s,_ in _DATA['outer']['nodes'] if lo<s<hi)
        band_nodes.append(sorted(knots))
    ground_stage_s = {0., 1.}
    outer_stair_corners = 0
    try:
        for row in range(ROWS):
            q0, q1 = row/ROWS, (row+1)/ROWS
            low, high = _height(row), _height(row+1)
            for band, nodes in enumerate(band_nodes):
                for step in range(SUBSTEPS):
                    qa, qb = (row+step/SUBSTEPS)/ROWS, (row+(step+1)/SUBSTEPS)/ROWS
                    b0, b1 = _bands(qa)[band], _bands(qb)[band]
                    for u, v in zip(nodes, nodes[1:]):
                        s00, s01 = b0[0]+u*(b0[1]-b0[0]), b0[0]+v*(b0[1]-b0[0])
                        s10, s11 = b1[0]+u*(b1[1]-b1[0]), b1[0]+v*(b1[1]-b1[0])
                        _poly(g, 'curb', [_point(qa,s00,high),_point(qb,s10,high),
                                           _point(qb,s11,high),_point(qa,s01,high)], (0,0,1))
                        if step==0:
                            _riser(g, qa, s00, s01, low, high)
                            if row==0:
                                ground_stage_s.update((s00,s01))
            for center in AISLES:
                for step in range(SUBSTEPS):
                    qa, qb = (row+step/SUBSTEPS)/ROWS, (row+(step+1)/SUBSTEPS)/ROWS
                    za, zb = low+(high-low)*step/SUBSTEPS, low+(high-low)*(step+1)/SUBSTEPS
                    a0,a1 = center-_halfwidth(qa),center+_halfwidth(qa)
                    b0,b1 = center-_halfwidth(qb),center+_halfwidth(qb)
                    # Two across-width subdivisions keep the curved stair
                    # footprint faithful beside the seating's arc mesh.
                    for k in range(2):
                        sa,sb=a0+(a1-a0)*k/2,a0+(a1-a0)*(k+1)/2
                        ta,tb=b0+(b1-b0)*k/2,b0+(b1-b0)*(k+1)/2
                        tread=[_point(qa,sa,zb),_point(qb,ta,zb)]
                        if row==ROWS-1 and step==SUBSTEPS-1:
                            # The final stair must follow every surveyed
                            # courtyard boundary corner, just as the seat
                            # bands do. A chord across an omitted corner left
                            # a 1.55cm gap in exported ground collision.
                            # Insert only into the outer edge: subdividing the
                            # inner curved edge would mismatch the preceding
                            # stair's existing two-segment chord.
                            corners=[s for s,_ in _DATA['outer']['nodes'] if ta+1e-8<s<tb-1e-8]
                            tread.extend(_point(qb,s,zb) for s in corners)
                            outer_stair_corners+=len(corners)
                        tread.extend((_point(qb,tb,zb),_point(qa,sb,zb)))
                        _poly(g, 'curb', tread, (0,0,1))
                        _riser(g, qa, sa, sb, za, zb)
                        if row==0 and step==0:
                            ground_stage_s.update((sa,sb))
                    for side in (-1,1):
                        sa,sb=center+side*_halfwidth(qa),center+side*_halfwidth(qb)
                        into_aisle=_point((qa+qb)/2,center,0)-_point((qa+qb)/2,(sa+sb)/2,0)
                        _poly(g, 'brick', [_point(qa,sa,zb),_point(qb,sb,zb),
                                            _point(qb,sb,high),_point(qa,sa,high)], into_aisle)
            # Exposed stepped retaining ends. The fixed endpoints agree with
            # source patches 212/215; the top now follows the seating levels.
            for s in (0.,1.):
                outward=_point((q0+q1)/2,s,0)-_point((q0+q1)/2,.001 if s==0 else .999,0)
                _poly(g, 'brick', [_point(q0,s,_DATA['base']),_point(q1,s,_DATA['base']),
                                    _point(q1,s,high),_point(q0,s,high)], outward)
        # Retain the surveyed outer boundary's varying bottom elevations.
        for ps in _DATA['outer_faces']:
            _poly(g, 'brick', ps)
        stage_center=_DATA['inner']['center'].copy()
        stage_center.z=_DATA['base']
        stage=[_point(0,s,_DATA['base']) for s in sorted(ground_stage_s)]
        for a,b in zip(stage,stage[1:]+stage[:1]):
            _poly(g, 'paving', [stage_center,a,b], (0,0,1))
        # Two edge handrails per aisle leave a clear 1.35m walking route.
        # Post positions follow the top of actual individual stair treads.
        tube_sides=6 if mobile else 8
        for center in AISLES:
            for side in (-1,1):
                rail=[]
                for row in range(ROWS+1):
                    q=row/ROWS
                    z=_height(row)+.92
                    s=center+side*(_halfwidth(q)+.002)
                    rail.append(_point(q,s,z))
                for a,b in zip(rail,rail[1:]):
                    _tube(g,a,b,.026,tube_sides)
                for row in range(0,ROWS+1,3):
                    q=(min(row,ROWS-1)+.5)/ROWS if row<ROWS else 1.
                    z=_height(min(row+1,ROWS)) if row==ROWS else _height(row)+(_height(row+1)-_height(row))*2/3
                    s=center+side*(_halfwidth(q)+.002)
                    topz=_height(row)+.92 if row==ROWS else (_height(row)+_height(row+1))/2+.92
                    _tube(g,_point(q,s,z),_point(q,s,topz),.026,tube_sides)
    finally:
        g.mapper=oldmapper
    return {
        'reference': REFERENCE, 'referenceCredit': 'A. Zahner Company',
        'coordinateFrame': 'Blender east/north/up metres; Three x,y,z = X,Z,-Y',
        'sourceReplacedFaceCount': len(_DATA['replaced']), 'sourceComponents': _DATA['source_counts'],
        'sourceReplacedFaces': sorted(_DATA['replaced']),
        'sourceBounds': _DATA['bounds'],
        'sourceArcFits': {name: {'center': list(_DATA[name]['center'])[:2],
                                'meanRadius': _DATA[name]['radius'],
                                'angleDegrees': [math.degrees(a) for a in _DATA[name]['angles']]}
                          for name in ('inner','outer')},
        'sourceElevations': {'stage': _DATA['base'],'innerRim': _DATA['inner_z'],'outerRim': _DATA['outer_z']},
        'photoEstimatedSeatingRows': ROWS, 'stairStepsPerAisle': ROWS*SUBSTEPS,
        'maximumStairRise': max((_height(i+1)-_height(i))/SUBSTEPS for i in range(ROWS)),
        'photoEstimatedAisleWidth': AISLE_WIDTH,
        'outerStairSourceCornersPreserved': outer_stair_corners,
        'aisleOuterEndpoints': [list(_point(1,s,_DATA['outer_z'])) for s in AISLES],
        'limitations': ['Tier count, aisle positions and railing detail are photo-guided estimates.',
                        'Trees and landscaping are handled by the courtyard site module.',
                        'The source outer polygon and existing patch-0 platform are preserved.'],
    }
