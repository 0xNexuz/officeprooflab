// A rule as a sentence. Kept apart from the checks so pages that only list rules stay small.
import { clip, show } from './collect.ts';
import type { Rule } from './types.ts';

export function describeRule(rule: Rule): string {
  if ('cell' in rule) {
    if ('equals' in rule) return `${rule.cell} equals ${show(rule.equals)}`;
    if ('sumOf' in rule) return `${rule.cell} is the sum of ${rule.sumOf}`;
    if ('between' in rule) return `${rule.cell} is between ${show(rule.between[0])} and ${show(rule.between[1])}`;
    return `${rule.cell} is ${rule.isFormula ? 'a formula' : 'a typed value'}`;
  }
  if ('range' in rule) return `${rule.range} ${'noBlanks' in rule ? 'has no blank cells' : 'allNumbers' in rule ? 'holds only numbers' : 'has no repeated values'}`;
  if ('headers' in rule) return `Headers in ${rule.headers} are ${rule.equal.join(', ')}`;
  if ('sheet' in rule) return `A sheet named "${rule.sheet}" exists`;
  if ('heading' in rule) return `A heading "${rule.heading}" exists`;
  if ('contains' in rule) return `The text "${clip(rule.contains, 60)}" appears`;
  if ('notContains' in rule) return `The text "${clip(rule.notContains, 60)}" does not appear`;
  const span = (value: number | { min?: number; max?: number }) => typeof value === 'number' ? `exactly ${value}` : [value.min !== undefined ? `at least ${value.min}` : '', value.max !== undefined ? `at most ${value.max}` : ''].filter(Boolean).join(' and ') || 'any number of';
  if ('words' in rule) return `The document has ${span(rule.words)} words`;
  if ('tables' in rule) return `The document has ${span(rule.tables)} tables`;
  if ('slides' in rule) return `The deck has ${span(rule.slides)} slides`;
  return `Slide ${rule.slide} is titled "${clip(rule.title, 60)}"`;
}

