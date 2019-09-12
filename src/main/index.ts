// tslint:disable: no-console

import {run} from "./run";

/**
 * Default Args
 *
 * Full Node
 * 128 chains
 * Disk based plotting
 * 1024 plots
 * 1 GB Plot
 * Validation
 * 3 rounds of piece encoding
 * Storage Path (optional)
 */

run(
  'full',
  1,
  'memory',
  1,
  1000000000,
  false,
  3,
);
