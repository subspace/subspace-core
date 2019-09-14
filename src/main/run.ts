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
import { Storage } from '../storage/storage';
import { rmDirRecursiveSync } from '../utils/utils';
import { Wallet } from '../wallet/wallet';
import { INodeConfig, INodeSettings, IPeerContactInfo } from './interfaces';

const defaultContactInfo: IPeerContactInfo = {
  nodeId: new Uint8Array(),
  nodeType: 'full',
  address: 'localhost',
  udp4Port: 10888,
  tcp4Port: 10889,
  wsPort: 10890,
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
 * @param storageDir      The path on disk for where to store all persistent data, defaults to homedir
 * @param reset
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
  storageDir?: string,
  reset = true,
  contactInfo: IPeerContactInfo = defaultContactInfo,
  bootstrapPeers: IPeerContactInfo[] = defaultBootstrapPeers,
): Promise<Node> => {

  // initialize empty config params
  let env: 'browser' | 'node';
  let storageAdapter: 'rocks' | 'browser' | 'memory';
  let plotAdapter: 'mem-db' | 'disk-db' | 'indexed-db';
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
  env = typeof window === 'undefined' ? 'node' : 'browser';

  // are we persisting storage?
  const isPersistingStorage = plotMode === 'disk';

  // set storage path
  let storagePath: string;
  if (storageDir) {
    storagePath = path.normalize(storageDir);
  } else {
    switch (os.platform()) {
      case 'linux':
        storagePath = path.join(os.homedir(), '/.local/share/data/subspace');
        break;
      case 'darwin':
        storagePath = path.join(os.homedir(), '/subspace');
        break;
      case 'win32':
        storagePath = path.join(os.homedir(), '\\AppData\\Subspace');
        break;
      default:
        storagePath = path.join(os.homedir(), '/subspace');
        break;
    }
  }

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
  env === 'node' && config.farm && isPersistingStorage ? plotAdapter = 'disk-db' : plotAdapter = 'mem-db';
  env === 'browser' && config.farm && isPersistingStorage ? plotAdapter = 'indexed-db' : plotAdapter = 'mem-db';

  // instantiate a single storage instance
  // storage = new Storage(storageAdapter, 'storage', 'storage');

  const blsSignatures = await BlsSignatures.init();
  const storage = new Storage(storageAdapter, storagePath, 'storage');

  // reset indexed db path if resetting browser storage
  if (env === 'browser' && reset) {
    await storage.clear();
  }

  // instantiate a wallet
  if (config.wallet && !config.farm) {
    wallet = new Wallet(blsSignatures, storage);
  }

  // instantiate a farm & wallet
  if (config.farm && config.wallet) {

    // create wallet and addresses
    wallet = new  Wallet(blsSignatures, storage);

    const addresses: Uint8Array[] = [];
    for (let i = 0; i < numberOfPlots; ++i) {
      const account = await wallet.createAccount(`Plot-${i}`, `Wallet for plot ${i} from farm`);
      addresses.push(account.address);
    }

    // create farm
    farm = new Farm(plotAdapter, storage, storagePath, numberOfPlots, sizeOfFarm, encodingRounds, addresses);
  }

  // instantiate a ledger
  ledger = new Ledger(blsSignatures, storage, validateRecords, encodingRounds);

  // instantiate the network & rpc interface
  // TODO: replace with ECDSA network keys
  contactInfo.nodeId = crypto.randomBytes(32);
  // tslint:disable-next-line: no-console
  console.log('Launching network');
  const network = await Network.init(contactInfo, bootstrapPeers, env === 'browser');
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
