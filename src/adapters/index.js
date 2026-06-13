import aiglare from './aiglare.js';
import bouncer from './bouncer.js';
import tieline from './tieline.js';
import repoctx from './repoctx.js';

// Order is the display order in the report: governance → compliance → contracts → merge.
export const ADAPTERS = [aiglare, bouncer, tieline, repoctx];

export const ADAPTERS_BY_TOOL = Object.fromEntries(ADAPTERS.map((a) => [a.tool, a]));
