if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}
// tslint:disable: object-literal-sort-keys

import { Node } from '../node/node';
import { IPeerContactInfo } from './interfaces';
import { rmDirRecursiveSync } from 'utils/utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const selfContactInfo: IPeerContactInfo = {
  nodeId: new Uint8Array(),
  address: 'localhost',
  udpPort: 10888,
  tcpPort: 10889,
  wsPort: 10890,
  protocolVersion: '4',
};

/**
 * Init Params
 * chainCount: 1 to 1024 -- number of chains in the ledger, the more chains the longer it will take to confirm new levels but the lower the probability of a fork on any given chain.
 * Calculate expected number of blocks to confirmation as chainCount * log(2) chainCount
 * plotMode: mem-db or disk-db -- where to store encoded pieces, memory is preferred for testing and security analysis, disk is the default mode for production farmers
 * validateRecords: true or false -- whether to validate new blocks and tx on receipt, default false for DevNet testing -- since BLS signature validation is slow, it takes a long time to plot
 *
 * @param nodeType        Functional configuration for this node (full node, farmer, validator, light client, gateway)
 * @param chainCount      Number of chains for the ledger (1 -- 1024)
 * @param plotMode        How encoded pieces are persisted (js-memory, rocks db, raw disk)
 * @param numberOfPlots   How many plots to create for // farming (1 -- 1024)
 * @param farmSize        How much space will be allocated to the plot in bytes (1 GB to 16 TB)
 * @param validateRecords If new records are validated (set to false for testing)
 * @param encodingRounds  How many rounds of encoding are applied when plotting (1 to 512)
 * @param storageDir      The path on disk for where to store all persistent data, defaults to homedir
 * @param contactInfo     IP and ports to expose for this node, defaults provided.
 * @param bootstrapPeers  Array of contact info for bootstrap peers, no defaults provided yet
 */
export const run = async (
  nodeType: 'full' | 'farmer' | 'validator' | 'client' | 'gateway',
  chainCount: number,
  plotMode: 'memory' | 'disk',
  numberOfPlots: number,
  farmSize: number,
  validateRecords: boolean,
  encodingRounds: number,
  storageDir?: string,
  reset = true,
  contactInfo: IPeerContactInfo = selfContactInfo,
  bootstrapPeers: IPeerContactInfo[] = [],
) => {

  let env: 'browser' | 'node';
  typeof window ? env = 'browser' : env = 'node';

  storageDir ? storageDir = path.normalize(storageDir) : storageDir = `${os.homedir()}/subspace/data/`;
  const isPersistingStorage = plotMode === 'disk' ? true : false;

  // check global environment
  if (typeof window === undefined && reset && isPersistingStorage) {
    // node js runtime
    rmDirRecursiveSync(storageDir);
  }

  if (typeof window && reset && isPersistingStorage) {
    // clear browser storage
  }

  let storageAdapter: 'memory' | 'browser' | 'rocks';
  let plotAdapter: 'mem-db' | 'disk-db';
  switch (plotMode) {
    case 'memory': {
      storageAdapter = 'memory';
      plotAdapter = 'mem-db';
      break;
    } case 'disk': {
      storageAdapter = 'rocks';
      plotAdapter = 'disk-db';
      break;
    } 
  }:

  const node = await Node.init(contactInfo, bootstrapPeers, nodeType, storageAdapter, plotAdapter, numberOfPlots, farmSize, validateRecords, encodingRounds, storageDir, reset);
  await node.getOrCreateAccount();
  await node.createLedgerAndFarm(chainCount);
};
