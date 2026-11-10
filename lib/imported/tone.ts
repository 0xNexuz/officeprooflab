// How a finding is coloured wherever it is marked: in a cell, a paragraph or around a box on a slide.
import type { Finding } from '../engine/types.ts';

export type Tone = 'fail' | 'warn' | 'info' | 'ai';
export const RANK: Record<Tone, number> = { fail: 4, warn: 3, ai: 2, info: 1 };
export const toneOf = (finding: Finding): Tone => finding.label === 'ai' ? 'ai' : finding.severity === 'fail' ? 'fail' : finding.severity === 'warn' ? 'warn' : 'info';
