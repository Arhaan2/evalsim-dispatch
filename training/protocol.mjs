// Fixed before evaluating any final-test episode.
export const TRAIN = ['normal', 'route-closure', 'supplier-delay', 'capacity-cut', 'demand-surge'];
export const HELD_OUT = ['compound', 'network-shift'];
export const REPLICATES = [13, 37, 73];
export const BATCH = 24;
export const CHECKPOINTS = [0, 96, 288, 576, 1152, 1728, 2304];
export const TARGET = 0.85;
export const LEARNING_RATE = 0.055;
export const GAMMA = 0.99;
export const VALIDATION = TRAIN.flatMap(kind => Array.from({length: 12}, (_, i) => ({kind, seed: 2000000 + i})));
export const FINAL_TEST = [...TRAIN, ...HELD_OUT].flatMap(kind =>
  Array.from({length: 24}, (_, i) => ({kind, seed: 3000000 + i})));
export const PILOT = TRAIN.flatMap(kind => Array.from({length: 20}, (_, i) => ({kind, seed: 100 + i})));

export function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let z = Math.imul(state ^ (state >>> 15), state | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
