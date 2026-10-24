BU quality study 02 - geometry refinement

This pass loads the frozen first-pass .blend files and produces a separate pair
of review assets. The first-pass GLB and .blend files remain the comparison base.

Build both samples from the repository root (PowerShell):
& 'assets-source/tools/blender-4.5.9-windows-x64/blender.exe' --background --python-exit-code 1 --python assets-source/charles-bu/blender/build-refined-samples.py

Validate the exported GLB buffers:
& 'assets-source/tools/blender-4.5.9-windows-x64/4.5/python/bin/python.exe' assets-source/charles-bu/blender/verify-samples.py --directory public/assets/bu-quality-pass2 --report assets-source/charles-bu/blender/pass2/verification.json

With the local app server on port 5186, render the comparison and check controls:
node scripts/check-bu-refined-samples.mjs

Review:
http://127.0.0.1:5186/output/bu-quality-20261019-pass2/review.html

192 Bay State:
  Nine existing curved glass openings drive continuous frame and sash sweeps.
  Solid meeting rails occupy the existing rail axes; sloped sill inserts stay
  within the existing window reveals. All old meshes and UVs are preserved.
  New parts share two existing material batches. Clear-pane rays are checked.

CDS ground excerpt:
  Curtain-wall pressure caps, door stiles/rails, round pulls and fixings, column
  joints, flush threshold caps, and source-ground-fitted short column extensions.
  Exactly four old handle islands are replaced. All other old surfaces and UVs,
  including door glass and sloping paving, are retained and checked.

Export:
  New parts are batched by existing PBR material. No texture rebake or new image.
  Only new ngon caps are triangulated for glTF tangent export. Original meshes
  are not bevelled again. Selection is reset before export to include every part.
  The builder checks source hashes, protected surfaces and bounded mesh budgets.

Scope and evidence:
  This is a local construction-detail study, not a new campus survey or runtime
  deployment. Frame profiles, hardware and joinery dimensions are authored.
  The existing building envelope and approximate doors/windows remain the basis.
  Glazing is still the prior opaque PBR surrogate, with no interior/transmission.
  Existing source notes: assets-source/charles-bu/cds-entry-refinement-20261018.json
  Street-type reference: output/bu-implementation-20261018-pass3/bay-state-reference.jpg
  Official address context: https://www.bu.edu/housing/residence/central-campus-traditional-brownstones/192-bay-state-road/
  CDS completed-building context: https://www.kpmb.com/news/boston-university-previews-the-new-center-for-computing-data-sciences/

Both versions in the viewer use the same PBR material parameters, camera, sun
and environment reflection. The lower display floor is not real campus terrain.
