/** BU/MDS 2024 EPNF, existing photo Figure 1-3 and roof plan Figure 2-4.
 * The roof drawing has north downward: its Tower A/B/C run east to west.
 * Trace ratios are fitted to the retained GIS podium, not survey dimensions.
 * Narrow ends face Commonwealth/Cummington; the long east/west sides carry
 * nine vertical window bands. Do not copy the proposed 2024 metal cladding.
 */
export const BU_WARREN_TOWERS = [
  {id:'A',centreFraction:.340},
  {id:'B',centreFraction:.065},
  {id:'C',centreFraction:-.210},
] as const;
export const BU_WARREN_TOWER_SECTION = {
  widthFraction:.115, depthFraction:.98, levels:14,
  endWindowWidth:3.4, sideWindowWidth:2.05, sideBands:9,
  wallDepth:.48, glazingDepth:-.31, spandrelHeight:.85,
} as const;
