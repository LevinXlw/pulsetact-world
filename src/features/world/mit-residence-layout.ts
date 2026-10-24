import type {WorldPoint} from './geo-coordinates';
/** Traced from Cambridge F4/G4 GISGroundplan/JGW, checked against the
 * registered orthophoto. Keep Memorial Drive's divided carriageways separate. */
export const MIT_RESIDENCE_SIDEWALK_WEST:WorldPoint[]=[[-350,321.7],[-325,310.6],[-300,299],[-275,287.8],[-250,275.8],[-240,271.1],[-235,269],[-232,267.6],[-230,266.4]];
export const MIT_RESIDENCE_CROSSWALK:WorldPoint[]=[[-230,266.4],[-220,262]];
export const MIT_RESIDENCE_SIDEWALK_EAST:WorldPoint[]=[[-220,262],[-218,261.2],[-210,257.6],[-190,249],[-170,239.9],[-150,230.7],[-130,221.6],[-110,212.3],[-90,202.9],[-75,196.1]];
export const MIT_RESIDENCE_SIDEWALK=[...MIT_RESIDENCE_SIDEWALK_WEST,...MIT_RESIDENCE_SIDEWALK_EAST];
export const MASEEH_COURTYARD_WALK:WorldPoint[]=[[-106,210.5],[-107.1,205],[-109.5,199.3],[-113.6,190],[-116.2,184],[-116.2,181.8],[-112.4,176.6],[-112.2,171.6]];
export const MIT_RESIDENCE_PLACES:Record<'baker'|'maseeh',WorldPoint>={baker:[-305,301.3],maseeh:[-106,210.5]};
// The eastern link crosses Massachusetts Avenue at the existing approach to
// the river walk; door interiors remain closed this round.
export const MIT_RESIDENCE_APPROACH:WorldPoint[]=[[14,208],[-51.9685,198],[-64,191],[-75,196.1]];
// Amherst's north-front approach is separate from the river frontage. Trace the
// service street and east-side sidewalk; do not route through the dorm itself.
export const MIT_AMHERST_STREET:WorldPoint[]=[[-360,266.4],[-340,257.2],[-320,248],[-300,238.9],[-280,229.7],[-263,222]];
export const MIT_AMHERST_SOUTH_WALK:WorldPoint[]=[[-360,270.3],[-340,261.1],[-320,251.9],[-300,242.8],[-286.5,236.6],[-280,233.6],[-263,225.9]];
export const MIT_BAKER_AMHERST_WALK:WorldPoint[]=[[-240,271.1],[-236.5,269],[-234.5,264],[-239,251],[-243.5,238],[-247,228],[-251,225],[-255,226],[-263,225.9],[-280,233.6],[-286.5,236.6]];
export const MIT_BAKER_ENTRY_WALK:WorldPoint[]=[[-286.5,236.6],[-287.6,239.5],[-289.9,244.1],[-291.5,247.2],[-293.1,250.2]];
export const MIT_BAKER_NORTH_ARRIVAL:WorldPoint=[-287.5,242];
export const MIT_RESIDENCE_WALK_ROUTES=[MIT_RESIDENCE_APPROACH,[...MIT_RESIDENCE_SIDEWALK].reverse(),MASEEH_COURTYARD_WALK,MIT_BAKER_AMHERST_WALK,MIT_BAKER_ENTRY_WALK];
export const MIT_MEMORIAL_SURFACE_RAMP:WorldPoint[]=[[-220,265.5],[-200,257.7],[-180,249.1],[-160,240.2],[-140,231.2],[-120,222.1],[-100,213],[-80,203.9],[-68,198.5]];
// Separate surveyed corridors descend toward Mass Ave. Drape each onto its
// existing terrain; never span the median with a single flat road surface.
export const MIT_MEMORIAL_CARRIAGEWAYS:WorldPoint[][]=[
 [[-360,336],[-340,327],[-320,318],[-300,309.8],[-280,300.6],[-260,291.3],[-240,281.6],[-220,273.6],[-200,268.5],[-180,263.3],[-160,257.8],[-140,251.2],[-120,242.9],[-100,233.7],[-80,224.5],[-60,215.4],[-40,206.3],[-20,197.1],[0,187.9],[20,178.7],[40,169.5]],
 [[-360,371],[-340,362],[-320,353],[-300,344],[-280,335],[-260,326],[-240,317],[-220,307.8],[-200,297.5],[-180,285.5],[-160,272.5],[-140,259.5],[-120,249.9],[-100,240.8],[-80,231.8],[-60,222.7],[-40,213.6],[-20,204.5],[0,195.4],[20,186.3],[40,177.2]],
];
// Orthophoto correction: each underpass carriageway narrows independently.
export const mitMemorialLaneWidth=(x:number)=>x<=-180?9.5:x<-160?9.5-(x+180)*.075:x<-140?8-(x+160)*.05:7;
