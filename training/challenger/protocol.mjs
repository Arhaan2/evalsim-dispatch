import {FAMILIES} from '../../docs/lib/challenger.js';
export const SEEDS = [101,211,307];
export const CELLS_PER_BANK = 160;
export const VALIDATION = FAMILIES.flatMap(kind => Array.from({length:12}, (_, i) => ({kind, seed:5000000+i})));
export const UNSEEN = ['compound','network-shift'];
export const FINAL = [...FAMILIES,...UNSEEN].flatMap(kind =>
  Array.from({length:24}, (_, i) => ({kind, seed:6000000+i})));
export const BUDGET = 32768;
export const CHECK_EVERY = 4096;
export const COMPETENCE = 0.85;
export const CHALLENGER_RATE = 0.09;
export const ENTROPY_BONUS = 0.10;
export const BASELINE_RATE = 0.03;
