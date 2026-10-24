/** A touch device uses bounded scene assets, independently of an older saved quality setting. */
export function isMobileWorld(){
  return typeof window!=='undefined'&&window.matchMedia('(any-pointer: coarse)').matches;
}
