Questrom complete exterior: Blender finishing
============================================

Input is the complete explicitly owned Questrom/Rafik B. Hariri Building group,
not a crop or a stretched study. input/manifest.json records its exact toWorld:
original Questrom anchor/ground and yaw -0.145, without the CDS sample offset.
Canvas entrance lettering stays in the independent runtime extras group.

Rebuild from the repository root (Blender 4.5 LTS):

& 'assets-source/tools/blender-4.5.9-windows-x64/blender.exe' --background --python-exit-code 1 --python assets-source/charles-bu/blender/build-questrom-full.py

Validate exported buffers with bundled Python (no Blender process required):

& 'assets-source/tools/blender-4.5.9-windows-x64/4.5/python/bin/python.exe' assets-source/charles-bu/blender/questrom/verify-questrom-full.py

Outputs:
  public/assets/bu-questrom/questrom-full.glb   Complete embedded PBR exterior
  public/assets/bu-questrom/manifest.json      Build evidence and counts
  questrom/questrom-full.blend                Editable packed Blender source
  questrom/questrom-mobile-source.glb         Identical geometry, zero textures
  questrom/manifest.json                      Build evidence and source hashes
  questrom/verification.json                  Actual-buffer test results

Measured result:
  Source 44,262 triangles / 14 primitives.
  Final  51,610 triangles / 16 primitives; delta +7,348.
  PBR GLB 9,302,072 bytes; mobile source 7,402,532 bytes.
  Exact exterior envelope and 50.510 m source roofline retained.

Geometry changes:
  - 17 visible street-facing first-floor windows receive shallow metal pressure
    caps inside the existing 32 cm masonry recess. Existing panes/rings remain;
    two source office panes hidden by the broad entrance bays get no new detail.
  - The five existing entry-bay axes and pane widths remain. Thin outer stiles,
    door-head/transom rails, bottom/waist rail caps and hinge fixing plates give
    the former almost-flat entrance visible construction depth.
  - Exactly five old 0.055 x 0.080 x 0.550 m handle boxes (60 triangles total) are
    removed after full size/position/topology matching. Five round pull grips,
    stand-offs and small fixing rosettes replace them, with no duplicate handles.
  - 48 closed near-entry metal/stone/trim components get <=3 mm single-segment
    bevels (+1,536 triangles).
  - Exactly two existing dark entrance base boxes are widened 6 mm per X side
    (1.400 -> 1.412 m). Their original side faces were coplanar with the stone
    piers; the thin wrap resolves this overlap. No triangles are added, Y/Z and
    the two pier bodies stay unchanged. The other 48 roof triangles are kept.
    Every source face outside the explicit handles/bevels/two wraps is retained.
  - All four source ground meshes and every glazing surface remain coordinate-
    and topology-identical. Every source face above 7.5 m remains unchanged.

Material treatment:
  Actual prior Cycles tiles are reused; no downloads or rebake. Brick keeps its
  metre-density baked brick channels. Broad dressed stone uses the continuous
  baked concrete/mineral microtexture, retaining modeled large-panel joints
  instead of drawing a new small-block bond over the canopy. Metal and wood use
  their existing baked tiles. Normal/roughness/base maps are embedded in GLB.
  Glass is opaque, nonemissive, dielectric: roughness .16 / source linear tint
  scale .2. Three.js supplies the actual neighborhood reflection and daylight.
  The runtime restores source FrontSide color rendering and BackSide shadow
  casting. Blender's double-sided export caused thin-roof self-shadow stripes.
  Desktop campus integration retains the four original world-coordinate paving
  meshes and hides their GLB copies. Local-frame float round-tripping aggravated
  existing nearly coplanar road junctions; keeping the source buffers prevents
  that regression while the entire building uses the refined exterior.

The mobile source removes images, texture references and image bufferViews;
every remaining geometry accessor and node transform equals the PBR asset.
Original node flags and originalMaterial.color are retained for the mobile
baker, including the four ground flags. New detail batches also carry source
frame colors. Runtime collision continues to use the preserved existing data.

Validation includes 311 checks: actual GLB indices/UV/normal/tangent buffers,
all mobile accessor parity, bounded images/materials, 44 construction rays
through retained visible glazing, original bay widths, original ground flags,
old-handle removal, exact source-to-output roof triangle comparison (only the
two 6 mm wraps may change), four actual-buffer side rays confirming the wrap
occludes its stone pier, and prior CDS asset/source hashes. Runtime screenshots and
playable/mobile checks are performed by the integrating task.

Evidence / limits:
  Inspected output/questrom-reference-front.jpg and questrom-reference-wide.jpg.
  Official photo sources:
  https://www.bu.edu/online/files/2025/05/BUQ-externals-5712-2048x1365.jpg
  https://www.bu.edu/files/2013/04/h_97-2661B-6.jpg
  Source authored model: src/features/world/boston-university.ts Questrom block.
  These support thin frames, glass entrance/transoms, pull hardware, broad stone
  panels and brick facades. Section sizes, hardware dimensions and the 2.9 m
  door-head height remain authored estimates; this is not an as-built survey.
  The 6 mm base side wrap is a bounded construction/render correction, not a
  measured dimension. Source terrain, entrance axes and collision are retained.
  No new interiors, door openings, decorative stairs or campus geography.
