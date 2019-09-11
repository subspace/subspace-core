if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}
// tslint:disable: object-literal-sort-keys

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BlsSignatures } from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';
import { Ledger } from '../ledger/ledger';
import { Network } from '../network/Network';
import { RPC } from '../network/rpc';
import { Node } from '../node/node';
// import { Storage } from '../storage/storage';
import { parseContactInfo, rmDirRecursiveSync } from '../utils/utils';
import { Wallet } from '../wallet/wallet';
import { INodeConfig, INodeSettings, IPeerContactInfo } from './interfaces';

const defaultContactInfo: IPeerContactInfo = {
  nodeId: new Uint8Array(),
  address: 'localhost',
  udpPort: 10888,
  tcpPort: 10889,
  wsPort: 10890,
  protocolVersion: '4',
};

const defaultBootstrapPeers: IPeerContactInfo[] = [];

/**
 * Init Params
 * chainCount: 1 to 1024 -- number of chains in the ledger, the more chains the longer it will take to confirm new levels but the lower the probability of a fork on any given chain.
 * Calculate expected number of blocks to confirmation as chainCount * log(2) chainCount
 * plotMode: mem-db or disk-db -- where to store encoded pieces, memory is preferred for testing and security analysis, disk is the default mode for production farmers
 * validateRecords: true or false -- whether to validate new blocks and tx on receipt, default false for DevNet testing -- since BLS signature validation is slow, it takes a long time to plot
 *
 * @param nodeType        Functional configuration for this node (full node, farmer, validator, light client, gateway)
 * @param numberOfChains      Number of chains for the ledger (1 -- 1024)
 * @param plotMode        How encoded pieces are persisted (js-memory, rocks db, raw disk)
 * @param numberOfPlots   How many plots to create for // farming (1 -- 1024)
 * @param sizeOfFarm        How much space will be allocated to the plot in bytes (1 GB to 16 TB)
 * @param validateRecords If new records are validated (set to false for testing)
 * @param encodingRounds  How many rounds of encoding are applied when plotting (1 to 512)
 * @param storagePath      The path on disk for where to store all persistent data, defaults to homedir
 * @param contactInfo     IP and ports to expose for this node, defaults provided.
 * @param bootstrapPeers  Array of contact info for bootstrap peers, no defaults provided yet
 */
export const run = async (
  nodeType: 'full' | 'farmer' | 'validator' | 'client' | 'gateway',
  numberOfChains: number,
  plotMode: 'memory' | 'disk',
  numberOfPlots: number,
  sizeOfFarm: number,
  validateRecords: boolean,
  encodingRounds: number,
  storagePath?: string,
  reset = true,
  contactInfo: IPeerContactInfo = defaultContactInfo,
  bootstrapPeers: IPeerContactInfo[] = defaultBootstrapPeers,
): Promise<Node> => {

  // initialize empty config params
  let env: 'browser' | 'node';
  let storageAdapter: 'rocks' | 'browser' | 'memory';
  let plotAdapter: 'mem-db' | 'disk-db';
  // let storage: Storage;
  let rpc: RPC;
  let ledger: Ledger;
  let wallet: Wallet | undefined;
  let farm: Farm | undefined;

  let config: INodeConfig = {
    storage: false,
    wallet: false,
    farm: false,
    archive: false,
    state: false,
    accounts: false,
    head: false,
    relay: false,
    krpc: false,
    srpc: false,
    jrpc: false,
  };

  // determine the basic system env
  typeof window ? env = 'node' : env = 'browser';

  // are we persisting storage?
  const isPersistingStorage = plotMode === 'disk';

  // set storage path
  storagePath ? storagePath = path.normalize(storagePath) : storagePath = `${os.homedir()}/subspace/data/`;

  // configure persistent storage
  if (env === 'node' && isPersistingStorage) {
    // setup node persistent storage
    storageAdapter = 'rocks';

    // if reset, delete the directory on startup
    if (reset && fs.existsSync(storagePath)) {
      rmDirRecursiveSync(storagePath);
    }

    // if first time, ensure the storage path exists
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  } else if (env === 'browser' && isPersistingStorage) {
     // setup browser persistent storage
    storageAdapter = 'browser';
  } else {
    // set default storage to memory
    storageAdapter = 'memory';
  }

  // set node config based on type
  switch (nodeType) {
    case 'full':
      // check to ensure ip addr is public and we have all three ports
      config = {
        storage: isPersistingStorage,
        wallet: true,
        farm: true,
        archive: true,
        state: true,
        accounts: true,
        head: true,
        relay: true,
        krpc: true,
        srpc: true,
        jrpc: true,
      };
      break;
    case 'validator':
      config = {
        storage: isPersistingStorage,
        wallet: false,
        farm: false,
        archive: true,
        state: true,
        accounts: true,
        head: true,
        relay: true,
        krpc: false,
        srpc: true,
        jrpc: false,
      };
      break;
    case 'farmer':
      config = {
        storage: isPersistingStorage,
        wallet: true,
        farm: true,
        archive: false,
        state: true,
        accounts: true,
        head: true,
        relay: true,
        krpc: true,
        srpc: false,
        jrpc: false,
      };
      break;
    case 'gateway':
      // check to ensure ip addr is public and we have all three ports
      config = {
        storage: isPersistingStorage,
        wallet: false,
        farm: false,
        archive: true,
        state: true,
        accounts: true,
        head: true,
        relay: true,
        krpc: false,
        srpc: true,
        jrpc: true,
      };
      break;
    case 'client':
      config = {
        storage: isPersistingStorage,
        wallet: true,
        farm: false,
        archive: false,
        state: true,
        accounts: true,
        head: true,
        relay: true,
        krpc: false,
        srpc: false,
        jrpc: false,
      };
      break;
  }

  if (env === 'node') {
    // node specific stuff
  }

  // browser specific params
  if (env === 'browser') {

    // browsers cannot serve rpc requests (yet...)
    config.krpc = false;
    config.srpc = false;
    config.jrpc = false;
  }

  // set plot adapter for farming
  config.farm && isPersistingStorage ? plotAdapter = 'disk-db' : plotAdapter = 'mem-db';

  // instantiate a single storage instance
  // storage = new Storage(storageAdapter, 'storage', 'storage');

  const blsSignatures = await BlsSignatures.init();

  // instantiate a wallet
  if (config.wallet && !config.farm) {
    wallet = await Wallet.open(blsSignatures, storageAdapter, storagePath, 'wallet');
  }

  // instantiate a farm
  if (config.farm && config.wallet) {

    // create wallet and addresses
    wallet = await Wallet.open(blsSignatures, storageAdapter, storagePath, 'wallet');

    const addresses: Uint8Array[] = [];
    for (let i = 0; i < numberOfPlots; ++i) {
      const account = await wallet.createAccount(`Plot-${i}`, `Wallet for plot ${i} from farm`);
      addresses.push(account.address);
    }

    // create farm
    farm = new Farm(plotAdapter, storagePath, numberOfPlots, sizeOfFarm, encodingRounds, addresses);
  }

  // instantiate a ledger
  ledger = await Ledger.init(blsSignatures, storageAdapter, storagePath, validateRecords, encodingRounds);

  // instantiate the network & rpc interface
  contactInfo.nodeId = crypto.randomBytes(32);
  const networkOptions = parseContactInfo(contactInfo, bootstrapPeers);
  const network = new Network(...networkOptions);
  rpc = new RPC(network, blsSignatures);

  const settings: INodeSettings = {
    storagePath,
    numberOfChains,
    numberOfPlots,
    sizeOfFarm,
    encodingRounds,
    validateRecords,
    contactInfo,
    bootstrapPeers,
  };

  return new Node(nodeType, config, settings, rpc, ledger, wallet, farm);
};
