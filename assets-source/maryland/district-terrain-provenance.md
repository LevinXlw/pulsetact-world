# UMD business and engineering terrain detail

The terrain patches are sampled from Maryland iMAP's public Prince George's
County bare-earth DEM, collected in late 2020–early 2021:

https://mdgeodata.md.gov/lidar/rest/services/PrinceGeorges/MD_princegeorges_dem_m/ImageServer

The service describes ground-classified LiDAR and a NAVD88 vertical datum. The
existing whole-campus acquisition independently compared this service's numeric
heights against USGS EPQS in metres; that verification and the exact transform
are retained in `umd-district-terrain-samples.json`. The service's native CRS
metadata mentions feet, so the `_m` filename alone is not used as unit evidence.

Rebuild with `node scripts/prepare-maryland-district-terrain.mjs`. The script
queries `getSamples` with WGS84 multipoints and bilinear raster interpolation.
It saves the actual returned elevations; there are no authored hill offsets.

| Patch | World bounds (x; z) | Grid spacing | Samples |
| --- | --- | --- | --- |
| Van Munching / Mowatt Lane | -700 to -225; 225 to 650 | 6.25 | 5,313 |
| Clark School / Paint Branch Drive | 150 to 850; -1050 to -250 | 6.25 | 14,577 |

World coordinates retain the game's prior anisotropic plan transformation
(the library/administration anchors, 0.6957346865 scale, 1.65 x stretch and 1.7 z
stretch). Thus 6.25 world units represent approximately 5.3–5.4 geographic
metres. Heights remain metres with the existing 14m local datum subtracted.
Coincident 25m samples are checked against the earlier whole-campus acquisition.

Runtime processing uses a small weighted 3×3 filter over these 6.25-unit samples,
instead of the prior 3×3 filter over 25-unit samples. A 37.5-unit margin blends
each patch into the existing field. The two districts use 6.25-unit triangular
terrain cells, while the remaining campus stays at 12.5. Boundary midpoints are
constrained to the neighbouring coarse triangle to avoid terrain seams. Road,
pavement, grass and walking queries all use this same piecewise-linear field.

Building foundations in the two districts follow their runtime footprint,
including concavities and interior rings, and blend over a 16-unit exterior margin. The former
axis-aligned bounding-box pads remain for legacy central landmarks, other
districts and the exposed parking-garage decks. Foundations are a gameplay
adaptation: they do not claim to reproduce individual surveyed entry thresholds,
basement floors, steps or post-2021 construction grading. Buildings must still
use an appropriate visible foundation to meet adjacent grades.

Validation in `tests/maryland-district-terrain.test.ts` covers source-frame
consistency, all local grid slopes against the player step limit, shared-road
height agreement and height continuity across all four sides of each patch.
