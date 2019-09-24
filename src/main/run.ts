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
import { INodeContactInfo } from '../network/INetwork';
import { Network } from '../network/Network';
import { Node } from '../node/node';
import { RPC } from '../RPC/RPC';
import { Storage } from '../storage/storage';
import { allocatePort, createLogger, rmDirRecursiveSync } from '../utils/utils';
import { Wallet } from '../wallet/wallet';
import { INodeConfig, INodeSettings, IPeerContactInfo } from './interfaces';

/**
 * Init Params
 * chainCount: 1 to 1024 -- number of chains in the ledger, the more chains the longer it will take to confirm new levels but the lower the probability of a fork on any given chain.
 * Calculate expected number of blocks to confirmation as chainCount * log(2) chainCount
 * plotMode: mem-db or disk-db -- where to store encoded pieces, memory is preferred for testing and security analysis, disk is the default mode for production farmers
 * validateRecords: true or false -- whether to validate new blocks and tx on receipt, default false for DevNet testing -- since BLS signature validation is slow, it takes a long time to plot
 *
 * @param network         Which network the node is joining (local testing, cloud testing, production network)
 * @param nodeType        Functional configuration for this node (full node, farmer, validator, light client, gateway)
 * @param numberOfChains      Number of chains for the ledger (1 -- 1024)
 * @param plotMode        How encoded pieces are persisted (js-memory, rocks db, raw disk)
 * @param numberOfPlots   How many plots to create for // farming (1 -- 1024)
 * @param sizeOfFarm        How much space will be allocated to the plot in bytes (1 GB to 16 TB)
 * @param validateRecords If new records are validated (set to false for testing)
 * @param encodingRounds  How many rounds of encoding are applied when plotting (1 to 512)
 * @param storageDir      The path on disk for where to store all persistent data, defaults to homedir
 * @param genesis         If the node will create a new chain from genesis or sync an existing chain
 * @param reset           If to reset storage on the node after each run
 * @param contactInfo     IP and ports to expose for this node, defaults provided.
 * @param bootstrapPeers  Array of contact info for bootstrap peers, no defaults provided yet
 * @param autostart       Whether to start the node role automatically or explicitly, default true
 * @param delay           Random farm/solve delay (for local testing) in milliseconds, following a poisson distribution around provided value
 */
export default async function run(
  net: 'dev' | 'test' | 'main',
  nodeType: 'full' | 'farmer' | 'validator' | 'client' | 'gateway',
  farmMode: 'memory' | 'disk',
  storageDir: string | undefined,
  numberOfChains = 1,
  numberOfPlots = 1,
  sizeOfFarm = 1000000,
  encodingRounds = 3,
  delay = 0,
  genesis: boolean,
  reset: boolean,
  trustRecords: boolean,
  contactInfo: IPeerContactInfo | undefined,
  bootstrapPeers: IPeerContactInfo[] = [],
  logLevel: 'info' | 'warn' | 'debug' | 'error' | 'verbose' = 'info',
): Promise<Node> {

  // initialize empty config params
  let env: 'browser' | 'node';
  let storageAdapter: 'rocks' | 'browser' | 'memory';
  let plotAdapter: 'mem-db' | 'disk-db' | 'indexed-db';
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

  const nodeContactInfo: IPeerContactInfo = {
    nodeId: crypto.randomBytes(32),
    nodeType,
    address: 'localhost',
    udp4Port: allocatePort(),
    tcp4Port: allocatePort(),
    wsPort: allocatePort(),
  };

  const nodeId = Buffer.from(nodeContactInfo.nodeId).toString('hex');

  // are we persisting storage?
  const isPersistingStorage = farmMode === 'disk';

  // set storage path
  let storagePath: string;
  if (storageDir) {
    storagePath = path.normalize(storageDir);
  } else {
    switch (os.platform()) {
      case 'linux':
        storagePath = path.join(os.homedir(), `/.local/share/data/subspace/${nodeId}`);
        break;
      case 'darwin':
        storagePath = path.join(os.homedir(), `/subspace/${nodeId}`);
        break;
      case 'win32':
        storagePath = path.join(os.homedir(), `\\AppData\\Subspace\\${nodeId}`);
        break;
      default:
        storagePath = path.join(os.homedir(), `/subspace/${nodeId}`);
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

    // browser cannot have TCP or UDP ports
    nodeContactInfo.udp4Port = undefined;
    nodeContactInfo.tcp4Port = undefined;
  }

  // set plot adapter for farming
  env === 'node' && config.farm && isPersistingStorage ? plotAdapter = 'disk-db' : plotAdapter = 'mem-db';
  env === 'browser' && config.farm && isPersistingStorage ? plotAdapter = 'indexed-db' : plotAdapter = 'mem-db';

  const logger = createLogger(logLevel);

  const blsSignatures = await BlsSignatures.init();
  const storage = new Storage(storageAdapter, storagePath, 'storage');

  // reset indexed db path if resetting browser storage
  if (env === 'browser' && reset) {
    await storage.clear();
  }

  // instantiate a wallet for light clients
  if (config.wallet && !config.farm) {
    wallet = new Wallet(blsSignatures, storage);
  }

  // instantiate a farm & wallet for farmers
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

  // instantiate a ledger for all nodes
  ledger = new Ledger(blsSignatures, storage, numberOfChains, trustRecords, encodingRounds);

  // set the gateway node based on env
  let gatewayNodeId: string;
  let gatewayAddress: string;
  switch (net) {
    case 'dev':
      gatewayNodeId = 'devnet-gateway';
      gatewayAddress = 'localhost';
      break;
    case 'test':
      gatewayNodeId = 'testnet-gateway';
      gatewayAddress = 'ec2-54-191-145-133.us-west-2.compute.amazonaws.com';
      break;
    case 'main':
      gatewayNodeId = 'mainnet-gateway';
      gatewayAddress = '...';
      break;
    default:
      gatewayNodeId = 'devnet-gateway';
      gatewayAddress = 'localhost';
  }

  const gatewayContactInfo: INodeContactInfo = {
    nodeId: crypto.hash(Buffer.from(gatewayNodeId)),
    nodeType: 'gateway',
    address: gatewayAddress,
    udp4Port: 10888,
    tcp4Port: 10889,
    wsPort: 10890,
  };

  // if genesis, there is no gateway
  bootstrapPeers = genesis ? [] : [gatewayContactInfo];
  contactInfo = genesis ? gatewayContactInfo : nodeContactInfo;

  // instantiate the network & rpc interface for all nodes
  // TODO: replace with ECDSA network keys
  const network = await Network.init(contactInfo, bootstrapPeers, env === 'browser');
  rpc = new RPC(network, blsSignatures, logger);

  const settings: INodeSettings = {
    network: net,
    storagePath,
    numberOfChains,
    numberOfPlots,
    sizeOfFarm,
    encodingRounds,
    genesis,
    trustRecords,
    contactInfo,
    bootstrapPeers,
    delay,
  };

  return new Node(nodeType, config, settings, rpc, ledger, wallet, farm);
}
