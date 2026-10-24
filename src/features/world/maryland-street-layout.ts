import type {WorldPoint} from './charles-geography';

export type MarylandDetailStreet={name:string;points:WorldPoint[];width:number};

/** School directions establish these connections and the Campus Drive hill.
 * Coordinates fit the compressed game campus, not surveyed street centre lines.
 * Source: assets-source/maryland/streetscape-references.json. */
export const MARYLAND_DETAIL_STREETS:MarylandDetailStreet[]=[
  {name:'Campus Drive',points:[[-370,-165],[-282,-165],[-185,-165],[-116,-165],[116,-165],[170,-184],[208,-201],[282,-201]],width:10.5},
  {name:'Union Lane',points:[[-282,-165],[-282,-222],[-282,-300],[-282,-402]],width:8.5},
  {name:'Fieldhouse Drive',points:[[-282,-402],[-335,-402],[-390,-402]],width:8.5},
];
