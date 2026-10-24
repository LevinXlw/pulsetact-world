Complete CDS exterior PBR asset
==============================

This pipeline finishes the complete source building exported from the explicit
CDS ownership group. It does not stretch the earlier first-floor study or replace
the source tower/terraces with a generic shell. Coordinates use the SAME local
metre frame as cds-ground; input/manifest.json provides its Three.js toWorld.

From the repository root, after scripts/export-cds-full.mjs has produced input:

& 'assets-source/tools/blender-4.5.9-windows-x64/blender.exe' --background --python-exit-code 1 --python assets-source/charles-bu/blender/build-cds-full.py -- --inspect-only

& 'assets-source/tools/blender-4.5.9-windows-x64/blender.exe' --background --python-exit-code 1 --python assets-source/charles-bu/blender/build-cds-full.py

& 'assets-source/tools/blender-4.5.9-windows-x64/4.5/python/bin/python.exe' assets-source/charles-bu/blender/full/verify-cds-full.py

Outputs:
  public/assets/bu-cds/cds-full.glb           Complete embedded PBR model
  public/assets/bu-cds/manifest.json         Build evidence and counts
  full/cds-full.blend                       Editable, packed Blender source
  full/cds-mobile-source.glb                Identical geometry without textures
  full/manifest.json                        Same build evidence
  full/verification.json                    Actual exported-buffer verification

The existing baked tile images in ../textures are reused. No image generation,
downloads, texture rebake, or edits to the old two sample GLBs/Blends occur.

The accepted pass2/cds-ground.blend contributes ONLY its two explicitly tagged
construction-detail batches (4,040 triangles). The source's four matching box
handles are removed after exact position/dimension/12-triangle verification;
other source faces are retained except for explicit small near-ground bevels.
Every source face above 7.5 m, all glass and all terrain/paving are protected.
Near-ground closed trim/metal bevels are capped at 96 components / 6,000 extra
triangles. Each is at most 3 mm and does not expand the site's source envelope.

UVs use metre-density box projection, with the reviewed .2 linear glass tint and
.16 dielectric roughness. Three.js supplies scene lighting and reflection; this
asset has no emissive walls, invented interior, or glass transmission.

Runtime doors (2026-10-20)
-------------------------
build-cds-full.py now runs prepare_cds_doors.py after its normal finishing export.
The .blend remains the editable closed-door source. The final desktop GLB and
texture-free mobile source omit four static door leaves, their 36 moving metal
parts and two central posts. Only the podium backing's two south-facing source
triangles are split around 2.825 m clear openings. Jambs, heads, sills, paving,
upper floors, all other materials/texture pixels and original collisions remain.
Three.js supplies the animated doors; entering uses an independent interior
transition before the unchanged exterior collision block.

The standalone postprocess can also prepare an existing closed-door export:
  .../4.5/python/bin/python.exe assets-source/charles-bu/blender/prepare_cds_doors.py
It is idempotent for the recorded output hash. door-preparation.json records all
selected geometry. The source protected-glass hashes describe the preceding
closed-door Blender stage; runtimeDoorPreparation explicitly records its narrow
exception. Rebuild public/data/mobile/boston.glb with:
  node scripts/prepare-mobile-campus.mjs boston
Other campus bakes are not part of this operation.

cds-mobile-source.glb keeps all geometry accessors and transforms exactly equal
to the PBR asset, and retains base tints/material names. Image data, texture
references and unused image bufferViews are removed so Node's offline mobile
baker does not invoke a browser image loader. It is not the runtime HD asset.

Enforced export budgets: <=20 glTF primitives and <10 MiB PBR GLB. The validation
script reads actual indices, normal/tangent frames, UVs, embedded PNGs, material
channels, and every mobile-source geometry accessor; it also checks previous
review-asset hashes. It does not replace visual verification in the application.

Provenance boundary: building massing, source geography and existing approximate
entrance axes remain the prior model. The fine construction details, local bevel
sizes and procedural surface pattern are authored estimates, not a new survey.
See ../pass2/manifest.json and ../../cds-entry-refinement-20261018.json.
