// tslint:disable: no-console

if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import { Node } from '../node/node';

/**
 * Init Params
 * chainCount: 1 to 1024 -- number of chains in the ledger, the more chains the longer it will take to confirm new levels but the lower the probability of a fork on any given chain.
 * Calculate expected number of blocks to confirmation as chainCount * log(2) chainCount
 * plotMode: mem-db or disk-db -- where to store encoded pieces, memory is preferred for testing and security analysis, disk is the default mode for production farmers
 * validateRecords: true or false -- whether to validate new blocks and tx on receipt, default false for DevNet testing -- since BLS signature validation is slow, it takes a long time to plot
 *
 */
/**
 *
 * @param bootstrapServers Array of IP/port tuples of several known subspace gateways
 * @param seed optional 32 byte seed for generating a BLS public/private key pair
 * @param nodeType Functional configuration for this node (full node, farmer, validator, light client, gateway)
 * @param chainCount Number of chains for the ledger (1 -- 1024)
 * @param encodingRounds How many rounds of encoding are applied when plotting (1 to 512)
 * @param plotMode How encoded pieces are persisted (js-memory, rocks db, raw disk)
 * @param numberOfPlots How many plots to create for // farming
 * @param plotSize How much space will be allocated to the plot in bytes (1 GB to 16 TB)
 * @param plotLocation The path on disk for where to place the plots
 * @param validateRecords If new records are validated (set to false for testing)
 */
const run = async (
  nodeType: 'full' | 'farmer' | 'validator' | 'light',
  chainCount: number,
  plotMode: 'memory' | 'disk',
  numberOfPlots: number,
  farmSize: number,
  validateRecords: boolean,
  encodingRounds: number,
  storageDir?: string,
  ) => {

    let storageAdapter: 'memory' | 'browser' | 'rocks';
    let plotAdapter: 'mem-db' | 'disk-db';
    switch (plotMode) {
      case 'memory':
        storageAdapter = 'memory';
        plotAdapter = 'mem-db';
        break;
      case 'disk':
        storageAdapter = 'rocks';
        plotAdapter = 'disk-db';
        break;
      default:
        storageAdapter = 'memory';
        plotAdapter = 'mem-db';
        break;
    }

    const node = await Node.init(nodeType, storageAdapter, plotAdapter, numberOfPlots, farmSize, validateRecords, encodingRounds, storageDir);
    await node.getOrCreateAccount();
    await node.createLedgerAndFarm(chainCount);
};

/**
 * Default Args
 *
 * Full Node
 * 128 chains
 * Disk based plotting
 * 1024 plots
 * 1 GB Plot
 * os.homedir()
 * Validation
 * 3 rounds of piece encoding
 * Storage Path (optional)
 */

run(
  'full',
  1,
  'disk',
  100,
  1000000000,
  false,
  3,
);
