import {BufferGeometry,Float32BufferAttribute} from 'three';

// The six court-facing elevations of Maclaurin Buildings 3 and 4.
// Their anchors and extents are measured GIS inputs; opening sizes and profiles
// are a bounded visual approximation informed by the local MIT photographs.
export const courtyardFacadeIndices = [9, 10, 14, 17, 18, 20];

export const courtyardColors = {
  courtyardWall: '#c9c3b6', courtyardTrim: '#d4cfc1',
  courtyardGlass: '#637882', courtyardFrame: '#899084',
  courtyardInterior: '#263035', courtyardPlinth: '#afa99a',
  courtCurb: '#c5c0b2', pavingJoint: '#99978b',
};

export function buildCourtyardFacade({facade: f, index, worldBox, height}) {
  const box = (kind, x, y, depth, w, h, d) => worldBox(f, kind, x, y, depth, w, h, d);
  const wall = {front: .025, thickness: .64, bottom: f.bottom, top: f.top};
  const glassDepth = -.32;
  const ground = height(f.center[0] + f.normal[0], f.center[2] + f.normal[2]);
  const mainWing = f.width > 70;
  const cols = mainWing ? 27 : f.width > 25 ? 8 : 4;
  const pitch = (f.width - (mainWing ? 5.6 : 4.0)) / (cols - 1);
  const openingWidth = mainWing ? 1.65 : f.width > 25 ? 1.75 : 1.85;
  // Keep all six elevations' storeys aligned, independent of the GIS parapet.
  // Four distinct window proportions establish base, principal floors and attic.
  const levels = [
    // High local ground produces a shorter basement window, never a stone
    // string crossing the aperture. The sill remains above the raised plinth.
    {bottom: ground + .90, height: Math.min(1.65, 7.20 - (ground + .90)), width: openingWidth - .12, rows: 2},
    {bottom: 8.15, height: 3.05, width: openingWidth, rows: 4},
    {bottom: 12.45, height: 2.95, width: openingWidth, rows: 4},
    {bottom: 16.7, height: 2.55, width: openingWidth - .04, rows: 3},
  ];
  const openings = [];
  for (const [row, level] of levels.entries()) {
    if (level.bottom + level.height > f.top - 2.0) continue;
    for (let col = 0; col < cols; col++) {
      openings.push({id: `${index}-${row}-${col}`, x: (col - (cols - 1) / 2) * pitch,
        w: level.width, bottom: level.bottom, top: level.bottom + level.height,
        rows: level.rows, row});
    }
  }

  // Partition around the apertures. The original GIS cover is removed at load
  // time using the exact recorded facade below; every reveal is an actual face.
  const cuts = [...new Set([wall.bottom, wall.top, ...openings.flatMap(h => [h.bottom, h.top])])].sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const bottom = cuts[i], top = cuts[i + 1], mid = (bottom + top) / 2;
    const holes = openings.filter(h => mid > h.bottom && mid < h.top).sort((a, b) => a.x - b.x);
    let left = -f.width / 2;
    for (const hole of [...holes, {x: f.width / 2, w: 0}]) {
      const right = hole.x - hole.w / 2;
      if (right - left > .001) box('courtyardWall', (left + right) / 2, mid,
        wall.front - wall.thickness / 2, right - left, top - bottom, wall.thickness);
      left = hole.x + hole.w / 2;
    }
  }

  for (const h of openings) {
    const H = h.top - h.bottom, center = (h.bottom + h.top) / 2;
    box('courtyardGlass', h.x, center, glassDepth, h.w - .09, H - .09, .035);
    box('courtyardInterior', h.x, center, -.92, h.w, H, .05);
    // Reveal liners, deep sill and a modest stone hood remain readable sideways.
    for (const sign of [-1, 1]) {
      box('courtyardFrame', h.x + sign * (h.w / 2 - .055), center, glassDepth + .028, .085, H, .12);
      box('courtyardFrame', h.x, h.bottom + (sign + 1) * H / 2, glassDepth + .035, h.w, .09, .13);
      box('courtyardTrim', h.x + sign * (h.w / 2 + .065), center, .049, .13, H + .17, .12);
    }
    box('courtyardFrame', h.x, center, glassDepth + .055, .047, H, .09);
    for (let row = 1; row < h.rows; row++) {
      box('courtyardFrame', h.x, h.bottom + H * row / h.rows, glassDepth + .054, h.w, row === 2 ? .060 : .037, .085);
    }
    box('courtyardTrim', h.x, h.bottom - .095, .085, h.w + .39, .19, .53);
    box('courtyardPlinth', h.x, h.bottom - .184, .14, h.w + .30, .025, .26);
    box('courtyardTrim', h.x, h.top + .075, .045, h.w + .29, .15, .23);
    if (h.row === 1) {
      box('courtyardTrim', h.x, h.top + .20, .10, h.w + .54, .085, .39);
    }
  }

  // A raised base, projecting floor string and layered cornice lend the long
  // elevations a continuous horizontal order without decorating every stone.
  box('courtyardPlinth', 0, ground + .28, .065, f.width, .62, .24);
  for (const [y, h, d] of [[7.5, .20, .31], [7.66, .065, .39], [20.35, .12, .25]]) {
    box('courtyardTrim', 0, y, d / 2 - .015, f.width, h, d);
  }
  for (const [offset, h, d] of [[1.48, .16, .33], [1.29, .22, .48], [1.08, .14, .66], [.13, .18, .43]]) {
    box('courtyardTrim', 0, f.top - offset, d / 2 - .03, f.width + .09, h, d);
  }
  // Restrained end piers tie the elevation into its measured corners.
  for (const side of [-1, 1]) {
    const x = side * (f.width / 2 - .40);
    box('courtyardTrim', x, (7.78 + 20.20) / 2, .065, .60, 20.20 - 7.78, .16);
    box('courtyardTrim', x, 7.76, .105, .79, .18, .27);
    box('courtyardTrim', x, 20.19, .11, .86, .19, .30);
  }

  return {
    model: f.model, sourceFacadeIndex: index, center: f.center, normal: f.normal,
    width: f.width, bottom: f.bottom, top: f.top, wall, glassDepth, openings,
    construction: 'GIS-anchored replacement wall with real apertures, recessed glazing, sills and cornice',
    fidelity: 'Measured GIS anchor and massing; photo-informed approximate opening rhythm and profiles, not a measured elevation',
    references: ['assets-source/killian-reference/maclaurin-wide.webp', 'assets-source/killian-reference/killiancourt.jpg'],
  };
}

// Small, solid edging follows the actual interpolated paving mesh. Its top
// rises only 25 mm above adjacent paths, leaving the walking route continuous.
export function buildCourtyardGround({xy, pavingHeight, put}) {
  const segments = [];
  const ribbon = (u0, s0, u1, s1, width, top, material, length = .4) => {
    const distance = Math.hypot(u1 - u0, s1 - s0), count = Math.ceil(distance / length);
    for (let i = 0; i < count; i++) {
      const gap = material === 'courtCurb' ? .002 / distance : 0;
      const t0 = i / count + gap, t1 = (i + 1) / count - gap;
      const a = xy(u0 + (u1 - u0) * t0, s0 + (s1 - s0) * t0);
      const b = xy(u0 + (u1 - u0) * t1, s0 + (s1 - s0) * t1);
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (b[1] - a[1]) / d * width / 2, nz = -(b[0] - a[0]) / d * width / 2;
      const h = material === 'courtCurb' ? .14 : .009;
      const corners = [[a[0] - nx, a[1] - nz], [a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz]];
      const vertices = corners.map(([x, z]) => [x, pavingHeight(x, z) + top, z]);
      vertices.push(...vertices.map(([x, y, z]) => [x, y - h, z]));
      const positions = [], uv = [];
      // Sloped top and bottom, with solid side faces. Each top corner samples
      // the paving independently, avoiding flat boxes that dip into a ramp.
      for (const face of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
        for (const corner of [0, 1, 2, 0, 2, 3]) {
          const [x, y, z] = vertices[face[corner]];
          positions.push(x, y, z);uv.push(x / 2, z / 2 + y / 2);
        }
      }
      const g = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)).setAttribute('uv', new Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();put(g, material);
    }
    if (material === 'courtCurb') segments.push({from: [u0, s0], to: [u1, s1], width, top});
  };
  for (const side of [-1, 1]) {
    // Two-millimetre inset keeps every corner within the paving despite GIS
    // float precision at its shared grass boundary.
    ribbon(side * 46.102, 7, side * 46.102, 92, .20, .025, 'courtCurb');
    for (const [s0, s1] of [[95, 128], [131, 152]]) {
      ribbon(side * 46.102, s0, side * 46.102, s1, .20, .025, 'courtCurb');
      ribbon(side * 1.938, s0, side * 1.938, s1, .12, .025, 'courtCurb');
    }
    // Cross joints follow the path's width; fine cuts, not a giant tiled grid.
    for (let s = 8.8; s < 91; s += 2.4) ribbon(side * 46.24, s, side * 54.1, s, .012, .006, 'pavingJoint');
    for (let s = 97.2; s < 151; s += 2.4) {
      if (s > 127.9 && s < 131.1) continue;
      ribbon(side * 46.23, s, side * 48.98, s, .012, .006, 'pavingJoint');
    }
  }
  ribbon(-46.1, 6.908, 46.1, 6.908, .18, .025, 'courtCurb');
  ribbon(-46.1, 92.092, 46.1, 92.092, .18, .025, 'courtCurb');
  for (const s of [94.918, 128.082, 130.918, 152.082]) {
    ribbon(-45.998, s, -2, s, .16, .025, 'courtCurb');
    ribbon(2, s, 45.998, s, .16, .025, 'courtCurb');
  }
  for (let s = 96.4; s < 152; s += 1.6) ribbon(-1.88, s, 1.88, s, .012, .006, 'pavingJoint');
  return {segments, heightReference: 'raycast actual interpolated pavement mesh; terrain + 60 mm only when no pavement hit',
    edging: 'Sloped solid stone units up to 0.4 m long; 25 mm upstand sampled at all four corners above paving',
    paving: 'Fine 12 mm cross joints over the existing continuous walkable paving',
    basis: 'Existing aerial-aligned approximate route retained; no new surveyed path claim'};
}
