export interface Position {
  x: number;
  y: number;
}
export interface Fish extends Position {
  vx: number;
  vy: number;
  z: number;
  s: number;
  ph: number;
  sc: 0 | 1;
  fear: number;
}
export interface Bubble extends Position {
  r: number;
  v: number;
  w: number;
}
export interface Glyph extends Position {
  g: string;
  v: number;
  a: number;
  sz: number;
}
export interface Food extends Position {
  e: number;
}
export interface Jelly extends Position {
  r: number;
  ph: number;
  sp: number;
  dx: number;
  z: number;
}
export interface Lantern extends Position {
  a: number;
  v: number;
  s: number;
  bl: number;
}
export interface Snow extends Position {
  r: number;
  v: number;
  w: number;
}
export interface Tuna extends Position {
  vx: number;
  vy: number;
  sp: number;
  s: number;
  ph: number;
  off: number;
  life: number;
}
export interface LargeAnimal extends Position {
  kind: 'turtle' | 'manta';
  dir: number;
  base: number;
  ph: number;
  k: number;
}
