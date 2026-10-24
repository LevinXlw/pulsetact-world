import type {Material} from 'three';

export type BUGroundLayer='terrain'|'surface'|'marking';

/** BU has real, closely spaced terrain-draped surfaces. Applying the same
 * negative slope bias to its base grass and paving makes the grass occlude
 * ballast/paint at grazing angles. Keep physical surfaces at their geometry
 * depth; reserve a small bias for paint and push only the base terrain back.
 * Metadata is retained by the offline mobile bake. No depth tests are bypassed. */
export function configureBUGroundLayer<T extends Material>(material:T,layer:BUGroundLayer):T{
  material.polygonOffset=layer!=='surface';
  material.polygonOffsetFactor=layer==='terrain'?1:layer==='marking'?-.25:0;
  material.polygonOffsetUnits=layer==='terrain'?1:layer==='marking'?-1:0;
  material.depthTest=true;material.depthWrite=true;
  material.userData.buGroundLayer=layer;
  return material;
}
