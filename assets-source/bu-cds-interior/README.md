# CDS independently loaded interior

The game version adapts the reviewed first-/second-floor design study. It is loaded as an independent interior mode through the existing CDS entrance; it is **not** a transparent insert into the current solid exterior. The complete exterior GLB, campus bake and existing exterior collisions are unchanged.

## Build and verify

From the repository root:

```powershell
& 'assets-source/tools/blender-4.5.9-windows-x64/blender.exe' --background --python-exit-code 1 --python 'assets-source/bu-cds-interior/build.py'
node assets-source/bu-cds-interior/verify.mjs
```

`source/study.py` is the adapted source fork. The builder imports the project's existing mesh/UV helpers and baked material PNGs read-only. It writes an editable `interior-desktop.blend`, this directory's manifest, and the following files in `public/assets/bu-cds-interior/`:

| File | Purpose |
| --- | --- |
| `interior-desktop.glb` | Embedded PBR material maps and full visual detail |
| `interior-mobile.glb` | No textures, fewer ceiling slats, simple furniture rods and un-bevelled small trim |
| `physics.glb` | Shared semantic collision proxies for both quality levels |
| `manifest.json` | Asset hashes, roles, frame, outline, exits, spawn, anchors and stair waypoints |

Desktop and mobile preserve the same exact walkable geometry. The builder checks source geometry and topology before export; the verifier separately compares actual exported support triangle positions. Fine visual furniture and slat detail can change without changing the floor, stairs or collisions.

## Coordinate and integration contract

All GLBs are in Three.js local metres: X east, Z south toward Commonwealth Avenue, Y up. Ground finish is Y=0, second-floor finish Y=5.6. The floor height is an authored approximation.

The original CDS exterior anchor is approximately `[-905.618379, 4.478491, 1009.527471]`, yaw `-.145`. Do **not** add the existing complete exterior GLB's sample offset `(35.75, 0, 21.15)` to the interior. Independent interior mode can retain the local origin and use an explicit transition rather than a world placement.

The preview's southwest extension was removed: the game floor is the union of the existing authored tower/podium ground envelopes. This removes 129.83 m² from the preview and returns the western south façade to Z=14.0208. Affected tables and benches were moved inside that boundary. The grand stair and butterfly step shapes were retained. Public door axes match the exterior's authored X=30.2 and X=44.2 at Z=19.068, with 2.9 m clear visual openings. These axes are not a measured door survey.

Spawn and exit positions are feet coordinates. The manifest places the normal spawn at `[44.2,0,16.8]`. Both exit triggers are inside the doors; narrow collision gates behind the openings prevent falling beyond the slab while an exit action is pending. Exiting should restore the outdoor mode and a valid exterior landing, not continue walking past those gates.

## Physics roles

Load only the explicit mesh-name lists in `manifest.physics`:

| Mesh | Extra flags | Use |
| --- | --- | --- |
| `interior-ground` | `ground: true`, `campusInteriorRole: "ground"` | Upward slab/tread/landing surfaces for support raycasts |
| `interior-walls` | `wall: true`, `campusInteriorRole: "wall"` | Perimeter, service core, café counter, furniture boxes and guardrail barriers |
| `interior-ceilings` | `ceiling: true`, `campusInteriorRole: "ceiling"` | Camera-only underside surfaces; do not add to ground or body movement pools |

Tables and decoration are never ground. Ground selection must use the current feet height plus the controller's allowed step, so an overhead second-floor slab cannot pull a first-floor player upward. Guard proxies close slender handrails for bodies while retaining the visual rail shapes. The butterfly exit and grand upper landing remain open.

`manifest.stairWaypoints` follows the walking lanes through actual tread centers, both rounded-turn tangencies and upper landings. The butterfly lower approach is deliberately before the first tread, not on its beveled boundary. Runtime tests should run both directions and finish at Y=0/5.6.

## Evidence and limits

Broad program relationships follow BU's 2019 DPIR Figures 2-12/2-13. Completed-building BU photographs support the gray collaborative stair terraces, timber benches/red pads, separate rounded black/timber butterfly stair, café timber slats and second-floor glazed teaching areas. Full URLs are in the manifest.

Detailed dimensions, room boundaries, furniture counts and placement, stair tread counts and PBR values remain authored approximations. No upper-floor offices, operating elevator or exact current café menu is claimed. The source preview stays separately editable under `output/cds-interior-design-20261019/model/`; this builder does not overwrite it.

`verification.json` reports actual GLB integrity, desktop/mobile walk-surface parity, two-way stair ray sampling, body-height obstruction probes, entry/exit boundaries and void guards. Runtime input, loading, quality switches and scene transitions require the separate integration tests.
