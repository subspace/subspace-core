if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import * as crypto from '../crypto/crypto';
import { Block } from '../ledger/block';
import { Tx } from '../ledger/tx';
import { IPeerContactInfo } from '../main/interfaces';
import { areArraysEqual, parseContactInfo } from '../utils/utils';
import { Wallet } from '../wallet/wallet';
import { Network } from './Network';
import { RPC } from './rpc';

// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

const peer1: IPeerContactInfo = {
  nodeId: crypto.randomBytes(32),
  address: 'localhost',
  udpPort: 11888,
  tcpPort: 11889,
  wsPort: 11890,
  protocolVersion: '4',
};

const peer2: IPeerContactInfo = {
  nodeId: crypto.randomBytes(32),
  address: 'localhost',
  udpPort: 12888,
  tcpPort: 12889,
  wsPort: 12890,
  protocolVersion: '4',
};

const networkOptions1 = parseContactInfo(peer1, [peer2]);
const networkOptions2 = parseContactInfo(peer2, [peer1]);

const network1 = new Network(...networkOptions1);
const network2 = new Network(...networkOptions2);

const rpc1 = new RPC(network1);
const rpc2 = new RPC(network2);

let tx: Tx;

const block = Block.createGenesisBlock(crypto.randomBytes(32), crypto.randomBytes(32));

beforeAll(async () => {
  const wallet = await Wallet.open('memory', 'rpc-test');
  wallet.createAccount();
  const publicKey = wallet.getAccounts()[0].publicKey;
  tx = await wallet.createCoinBaseTx(1, publicKey);
});

test('ping-pong', async () => {
  const sentPayload = crypto.randomBytes(32);
  rpc2.on('ping', (payload, responseCallback: (response: Uint8Array) => void) => responseCallback(payload));
  const receivedPayload = await rpc1.ping(peer2.nodeId, sentPayload);
  expect(areArraysEqual(sentPayload, receivedPayload)).toBe(true);
});

test('gossip-tx', async () => {
  rpc2.on('tx-gossip', (payload: Uint8Array) => {
    expect(areArraysEqual(payload, tx.toBytes())).toBe(true);
  });

  rpc1.gossipTx(tx);
 });

test('gossip-block', async () => {
  rpc2.on('block-gossip', (payload: Uint8Array) => {
    expect(areArraysEqual(payload, block.toFullBytes())).toBe(true);
  });

  rpc1.gossipBlock(block);
});

test('request-tx', async () => {
  rpc2.on('tx-request', (txId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(areArraysEqual(txId, tx.key)).toBe(true);
    responseCallback(tx.toBytes());
  });
  const payload = await rpc1.requestTx(peer2.nodeId, tx.key);
  expect(areArraysEqual(payload.toBytes(), tx.toBytes())).toBe(true);
});

test('request-block', async () => {
  rpc2.on('block-request', (blockId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(areArraysEqual(blockId, block.key)).toBe(true);
    responseCallback(block.toFullBytes());
  });
  const payload = await rpc1.requestBlock(peer2.nodeId, block.key);
  expect(areArraysEqual(payload.toBytes(), block.toBytes())).toBe(true);
});

afterAll(async () => {
  await rpc1.destroy();
  await rpc2.destroy();
});
