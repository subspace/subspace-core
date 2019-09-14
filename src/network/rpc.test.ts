import {BlsSignatures} from "../crypto/BlsSignatures";

if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import * as crypto from '../crypto/crypto';
import { Block } from '../ledger/block';
import { Tx } from '../ledger/tx';
import { IPeerContactInfo } from '../main/interfaces';
import { Storage } from '../storage/storage';
import {allocatePort, parseContactInfo} from '../utils/utils';
import { Wallet } from '../wallet/wallet';
import { Network } from './Network';
import { RPC } from './rpc';

// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

const peer1: IPeerContactInfo = {
  nodeId: crypto.randomBytes(32),
  nodeType: 'full',
  address: 'localhost',
  udpPort: allocatePort(),
  tcpPort: allocatePort(),
  wsPort: allocatePort(),
  protocolVersion: '4',
};

const peer2: IPeerContactInfo = {
  nodeId: crypto.randomBytes(32),
  nodeType: 'validator',
  address: 'localhost',
  udpPort: allocatePort(),
  tcpPort: allocatePort(),
  wsPort: allocatePort(),
  protocolVersion: '4',
};

const networkOptions1 = parseContactInfo(peer1, [peer2]);
const networkOptions2 = parseContactInfo(peer2, [peer1]);

let network1: Network;
let network2: Network;

let rpc1: RPC;
let rpc2: RPC;

let tx: Tx;
let wallet: Wallet;

const block = Block.createGenesisBlock(crypto.randomBytes(32), crypto.randomBytes(32));

beforeAll(async () => {
  network1 = await Network.init(...networkOptions1);
  network2 = await Network.init(...networkOptions2);  const blsSignatures = await BlsSignatures.init();
  rpc1 = new RPC(network1, blsSignatures);
  rpc2 = new RPC(network2, blsSignatures);
  const storage = new Storage('memory', 'tests', 'rpc');
  wallet = new Wallet(blsSignatures, storage);
  wallet.createAccount();
  const publicKey = wallet.getAccounts()[0].publicKey;
  tx = await wallet.createCoinBaseTx(1, publicKey);
});

// test('ping-pong', async () => {
//   const sentPayload = crypto.randomBytes(32);
//   rpc2.on('ping', (payload, responseCallback: (response: Uint8Array) => void) => responseCallback(payload));
//   const receivedPayload = await rpc1.ping(peer2.nodeId, sentPayload);
//   expect(sentPayload.join(', ')).toEqual(receivedPayload.join(', '));
//
// });

test('gossip-tx', async () => {
  rpc2.on('tx-gossip', (payload: Uint8Array) => {
    expect(payload.join(',')).toEqual(tx.toBytes().join(','));
  });

  rpc1.gossipTx(tx);
 });

test('gossip-block', async () => {
  rpc2.on('block-gossip', (payload: Uint8Array) => {
    expect(payload.join(',')).toEqual(block.toBytes().join(','));
  });

  rpc1.gossipBlock(block);
});

test('request-tx', async () => {
  rpc1.on('tx-request', (txId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(txId.join(',')).toEqual(tx.key.join(','));
    responseCallback(tx.toBytes());
  });
  const payload = await rpc2.requestTx(tx.key);
  expect(payload.toBytes().join(',')).toEqual(tx.toBytes().join(','));

});

test('request-block', async () => {
  rpc1.on('block-request', (blockId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(blockId.join(',')).toEqual(block.key.join(','));
    responseCallback(block.toFullBytes());
  });
  const payload = await rpc2.requestBlock(block.key);
  expect(payload.toBytes().join(',')).toEqual(block.toBytes().join(','));
});

afterAll(async () => {
  await rpc1.destroy();
  await rpc2.destroy();
  await wallet.close();
});
