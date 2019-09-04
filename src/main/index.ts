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
 */

const run = async (
  chainCount: number,
  plotMode = 'memory',
  validateRecords = true,
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

    const node = await Node.init(storageAdapter, plotAdapter, validateRecords);
    await node.getOrCreateAccount();
    await node.createLedgerAndFarm(chainCount);
};

/**
 * Default Args
 * 16 chains
 * In memory plotting and storage
 * No validation
 */

run(1, 'memory', false);
