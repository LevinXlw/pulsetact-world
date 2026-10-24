import {ARIZONA_ORIGIN} from './arizona-geography';

/** WGS84 longitude / latitude. These are geographic overview extents, not
 * property boundaries or the footprint of the playable reconstruction.
 * References and derivation are recorded in assets-source/world-atlas. */
export type AtlasSchoolId = 'mit' | 'harvard' | 'bu' | 'umd' | 'upenn' | 'arizona';
export type AtlasLocation = [longitude: number, latitude: number];
export type AtlasSchool = {
  id: AtlasSchoolId;
  campusId?: 'boston' | 'umd' | 'upenn' | 'arizona';
  name: string;
  short: string;
  city: string;
  state: string;
  location: AtlasLocation;
  outline: AtlasLocation[];
  status: 'open' | 'planned';
  scope: string;
  source: {title: string; url: string}[];
};

export const ATLAS_SCHOOLS: AtlasSchool[] = [
  {
    id: 'mit', campusId: 'boston', name: 'Massachusetts Institute of Technology', short: 'MIT',
    city: 'Cambridge', state: 'Massachusetts', location: [-71.09205, 42.35915], status: 'open',
    scope: 'Cambridge 主校区 · 从 Killian Court 开始探索',
    outline: [[-71.1077,42.3540],[-71.1067,42.3575],[-71.1034,42.3594],[-71.0969,42.3616],[-71.0890,42.3631],[-71.0820,42.3618],[-71.0808,42.3591],[-71.0879,42.3576],[-71.0948,42.3555],[-71.1031,42.3534],[-71.1077,42.3540]],
    source: [
      {title: 'MIT official campus map', url: 'https://whereis.mit.edu/'},
      {title: 'MIT visit and location', url: 'https://www.mit.edu/visit/'},
    ],
  },
  {
    id: 'harvard', name: 'Harvard University', short: 'Harvard',
    city: 'Cambridge', state: 'Massachusetts', location: [-71.1167, 42.3745], status: 'planned',
    scope: 'Harvard Yard 与 Cambridge 核心校区 · 世界漫游尚未开放',
    outline: [[-71.1216,42.3701],[-71.1216,42.3755],[-71.1206,42.3799],[-71.1170,42.3821],[-71.1132,42.3808],[-71.1105,42.3764],[-71.1112,42.3726],[-71.1158,42.3701],[-71.1216,42.3701]],
    source: [
      {title: 'Harvard official campus map', url: 'https://map.harvard.edu/'},
      {title: 'Harvard maps and directions', url: 'https://www.harvard.edu/visit/maps-directions/'},
    ],
  },
  {
    id: 'bu', campusId: 'boston', name: 'Boston University', short: 'BU',
    city: 'Boston', state: 'Massachusetts', location: [-71.1069, 42.3505], status: 'open',
    scope: 'Charles River Campus · East、Central、West 与 South',
    outline: [[-71.1297,42.3538],[-71.1187,42.3541],[-71.1156,42.3524],[-71.1116,42.3524],[-71.1051,42.3516],[-71.0991,42.3506],[-71.0918,42.3512],[-71.0918,42.3499],[-71.1008,42.3478],[-71.1033,42.3464],[-71.1094,42.3453],[-71.1122,42.3474],[-71.1180,42.3514],[-71.1297,42.3520],[-71.1297,42.3538]],
    source: [
      {title: 'Boston University official campus map', url: 'https://maps.bu.edu/?id=647'},
      {title: 'BU Charles River Campus overview', url: 'https://www.bumc.bu.edu/citylab/files/2023/06/BU-Charles-River-Campus-Map.pdf'},
    ],
  },
  {
    id: 'umd', campusId: 'umd', name: 'University of Maryland, College Park', short: 'UMD',
    city: 'College Park', state: 'Maryland', location: [-76.9432, 38.9865], status: 'open',
    scope: 'College Park 主校区 · 从 McKeldin Mall 开始探索',
    outline: [[-76.9516,38.9810],[-76.9543,38.9881],[-76.9490,38.9923],[-76.9461,38.9970],[-76.9368,38.9970],[-76.9335,38.9892],[-76.9345,38.9820],[-76.9397,38.9816],[-76.9425,38.9788],[-76.9502,38.9794],[-76.9516,38.9810]],
    source: [
      {title: 'University of Maryland official campus map', url: 'https://maps.umd.edu/map/'},
      {title: 'UMD campus visitor map', url: 'https://umdconf.umd.edu/drupal/current_map.pdf'},
      {title: 'MD iMAP / UMD Facilities Management building footprints', url: 'https://mdgeodata.md.gov/imap/rest/services/Structure/MD_CampusFacilities/FeatureServer/2'},
    ],
  },
  {
    id: 'upenn', campusId: 'upenn', name: 'University of Pennsylvania', short: 'UPenn',
    city: 'Philadelphia', state: 'Pennsylvania', location: [-75.193802, 39.9515], status: 'open',
    scope: 'West Philadelphia 校园 · 当前可探索 College Green 核心区域',
    outline: [[-75.2112,39.9502],[-75.2111,39.9559],[-75.1998,39.9561],[-75.1914,39.9546],[-75.1860,39.9518],[-75.1844,39.9478],[-75.1914,39.9460],[-75.1980,39.9471],[-75.2024,39.9496],[-75.2112,39.9502]],
    source: [
      {title: 'Penn official campus map', url: 'https://facilities.upenn.edu/maps'},
      {title: 'Penn Facilities: College Hall (coordinate anchor)', url: 'https://facilities.upenn.edu/maps/locations/college-hall'},
    ],
  },
  {
    id:'arizona',campusId:'arizona',name:'University of Arizona',short:'Arizona',
    city:'Tucson',state:'Arizona',location:[ARIZONA_ORIGIN.longitude,ARIZONA_ORIGIN.latitude],status:'open',
    scope:'Tucson 主校区 · Old Main、University Mall、Eller 与 ENR2 周边户外探索',
    outline:[[-110.95737,32.22683],[-110.95737,32.2358],[-110.9566,32.23783],[-110.9538,32.23783],[-110.9538,32.2358],[-110.9425,32.2358],[-110.9425,32.22683],[-110.95737,32.22683]],
    source:[
      {title:'University of Arizona official campus map',url:'https://maps.arizona.edu/'},
      {title:'University of Arizona Enterprise GIS building footprints',url:'https://services.maps.arizona.edu/pdc/rest/services/SubtleCanvasTilesBridgesTechPark/MapServer/21'},
      {title:'Arizona campus visitor map',url:'https://poetry.arizona.edu/files/visitormap.pdf'},
    ],
  },
];
