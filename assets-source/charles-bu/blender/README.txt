BU Blender quality samples
==========================

These are independent review samples, not a replacement for the playable campus.
Input geometry comes from the current authored project models, with the original
GIS envelope and existing door/window locations. No paid or downloaded textures
are used. input/manifest.json records source transforms and provenance.

Build (from the repository root, PowerShell):

& 'assets-source/tools/blender-4.5.9-windows-x64/blender.exe' --background --python-exit-code 1 --python assets-source/charles-bu/blender/build-samples.py -- --samples 16

Verify actual exported GLB buffers:

& 'assets-source/tools/blender-4.5.9-windows-x64/4.5/python/bin/python.exe' assets-source/charles-bu/blender/verify-samples.py

Use --reuse-textures to reuse PNGs only when the procedural texture recipe,
bake settings and resolutions match. Material-only tint edits do not rebake
unchanged images. --ids selects one sample; omit it to enforce the combined two-sample
10 MiB limit. --color-size and --detail-size default to 1024 and 512.

Outputs:
  public/assets/bu-quality/bay-state-192.glb
  public/assets/bu-quality/cds-ground.glb
  public/assets/bu-quality/manifest.json
  assets-source/charles-bu/blender/bay-state-192.blend
  assets-source/charles-bu/blender/cds-ground.blend
  assets-source/charles-bu/blender/build-manifest.json
  assets-source/charles-bu/blender/verification.json

What Blender does:
  * Merge coincident vertices within 0.01 mm and remove exact duplicate faces.
  * Bevel only closed, bounded trim/stone/frame/metal components; leave open
    facade sheets and glazing sheets intact. Recalculate closed-component normals.
  * Project metric UVs, with material families sharing repeatable texture images.
  * Actually bake procedural brick/stone/concrete/wood/metal maps using Cycles CPU:
    base color, tangent normal, and ORM (roughness in G).
  * Keep glass opaque, nonemissive, nontransmissive, with roughness 0.16.
  * Export PBR materials and pack used texture images in the editable .blend.
  * Preserve the original linear material color as glTF baseColorFactor, except
    CDS glass/glassShade: multiply their linear RGB by 0.2 to reduce diffuse wall
    appearance and retain environmental reflection. 192 glass stays unchanged.

glb_finish.py handles an exporter edge case: MikkTSpace may emit a zero tangent
at an extremely acute corner of a valid, long clipped triangle. Only zero
tangents are rebuilt from that triangle's actual UV derivative and the exported
normal. Geometry, UVs, valid tangents and source colors are not changed by this
step. The build manifest records every repair. Genuinely degenerate UVs fail.

Limits of this first sample:
  * It refines the existing authored geometry; it is not a new as-built survey.
  * Bond size, surface relief, patina and bevel dimensions are authored choices.
  * Box projection can change texture direction at curved-surface axis boundaries.
  * CDS crop edges are review boundaries, not proposed building walls.
  * Glass remains an opaque exterior surrogate; transparency/interior layers are
    not implemented. Darkening its diffuse tint does not create an interior.
  * The samples need the same scene lighting and camera for an honest comparison.
  * No application source, campus-wide GLB, routing, collision or deployment is
    modified by this pipeline.
