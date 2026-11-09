// The functions Univer's formula engine implements. A formula that calls anything else is reported as "not verified", never as passed or failed.
import * as engine from '@univerjs/engine-formula';

const groups = ['functionArray', 'functionCompatibility', 'functionCube', 'functionDatabase', 'functionDate', 'functionEngineering', 'functionFinancial',
  'functionInformation', 'functionLogical', 'functionLookup', 'functionMath', 'functionMeta', 'functionStatistical', 'functionText', 'functionUniver', 'functionWeb'] as const;

export const SUPPORTED_FUNCTIONS: Set<string> = new Set();
for (const group of groups) {
  const list = (engine as unknown as Record<string, unknown>)[group];
  if (Array.isArray(list)) for (const entry of list) if (Array.isArray(entry) && typeof entry[1] === 'string') SUPPORTED_FUNCTIONS.add(entry[1].toUpperCase());
}
