import {BlsSignatures} from "../crypto/BlsSignatures";

if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import * as crypto from '../crypto/crypto';
import { Block } from '../ledger/block';
import { State } from '../ledger/state';
import { Tx } from '../ledger/tx';
import { IPeerContactInfo, IPiece } from '../main/interfaces';
import { Network } from '../network/Network';
import { Storage } from '../storage/storage';
import { allocatePort, createLogger, smallNum2Bin } from '../utils/utils';
import { Wallet } from '../wallet/wallet';
import { Rpc } from './Rpc';

// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

const logger = createLogger('warn');

const peer1: IPeerContactInfo = {
  nodeId: crypto.randomBytes(32),
  nodeType: 'full',
  address: 'localhost',
  udp4Port: allocatePort(),
  tcp4Port: allocatePort(),
  wsPort: allocatePort(),
};

const peer2: IPeerContactInfo = {
  nodeId: crypto.randomBytes(32),
  nodeType: 'validator',
  address: 'localhost',
  udp4Port: allocatePort(),
  tcp4Port: allocatePort(),
  wsPort: allocatePort(),
};

let network1: Network;
let network2: Network;

let rpc1: Rpc;
let rpc2: Rpc;

let tx: Tx;
let wallet: Wallet;

let blsSignatures: BlsSignatures;

const block = Block.createGenesisBlock(
  crypto.randomBytes(32),
  crypto.randomBytes(32),
);
const proof = block.value.proof;
const content = block.value.content;
const state = State.create(
  crypto.randomBytes(32),
  crypto.randomBytes(32),
  crypto.randomBytes(32),
  Date.now(),
  1,
  1,
  crypto.randomBytes(32),
);
const encoding = crypto.randomBytes(4096);

beforeAll(async () => {
  blsSignatures = await BlsSignatures.init();
});

beforeEach(async () => {
  const storage = new Storage('memory', 'tests', 'rpc');
  wallet = new Wallet(blsSignatures, storage);
  const account = await wallet.createAccount();
  tx = await wallet.createCoinBaseTx(1, account.publicKey);
  network1 = await Network.init(peer1, [], false, logger); // gateway
  network2 = await Network.init(peer2, [peer1], false, logger); // client
  rpc1 = new Rpc(network1, blsSignatures, logger); // gateway
  rpc2 = new Rpc(network2, blsSignatures, logger); // client
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
    const sentPayload = Buffer.concat([encoding, block.toFullBytes()]);
    expect(payload.join(',')).toEqual(sentPayload.join(','));
  });

  rpc1.gossipBlock(block, encoding);
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

test('request-block-by-index', async () => {
  rpc1.on('block-request-by-index', (blockIndex: number, responseCallback: (response: Uint8Array) => void) => {
    expect(blockIndex).toEqual(0);
    responseCallback(block.toFullBytes());
  });
  const payload = await rpc2.requestBlockByIndex(0);
  if (payload) {
    expect(payload.toBytes().join(',')).toEqual(block.toBytes().join(','));
  } else {
    fail(true);
  }
});

test('request-proof', async () => {
  rpc1.on('proof-request', (proofId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(proofId.join(',')).toEqual(proof.key.join(','));
    responseCallback(proof.toBytes());
  });
  const payload = await rpc2.requestProof(proof.key);
  expect(payload.toBytes().join(',')).toEqual(proof.toBytes().join(','));

});

test('request-content', async () => {
  rpc1.on('content-request', (contentId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(contentId.join(',')).toEqual(content.key.join(','));
    responseCallback(content.toBytes());
  });
  const payload = await rpc2.requestContent(content.key);
  expect(payload.toBytes().join(',')).toEqual(content.toBytes().join(','));

});

test('request-state', async () => {
  rpc1.on('state-request', (stateId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(stateId.join(',')).toEqual(state.key.join(','));
    responseCallback(state.toBytes());
  });
  const payload = await rpc2.requestState(state.key);
  expect(payload.toBytes().join(',')).toEqual(state.toBytes().join(','));
});

test('request-state-by-index', async () => {
  rpc1.on('state-request-by-index', (stateIndex: number, responseCallback: (response: Uint8Array) => void) => {
    expect(stateIndex).toEqual(0);
    responseCallback(state.toBytes());
  });
  const payload = await rpc2.requestStateByIndex(0);
  if (payload) {
    expect(payload.toBytes().join(',')).toEqual(state.toBytes().join(','));
  } else {
    fail(true);
  }
});

test('request-piece', async () => {
  const binaryPiece = crypto.randomBytes(4096);
  const piece: IPiece = {
    piece: binaryPiece,
    data: {
      pieceHash: crypto.hash(binaryPiece),
      stateHash: crypto.randomBytes(32),
      pieceIndex: 256,
      proof: crypto.randomBytes(256),
    },
  };

  const pieceData = Buffer.concat([
    piece.piece,
    piece.data.pieceHash,
    piece.data.stateHash,
    smallNum2Bin(piece.data.pieceIndex),
    piece.data.proof,
  ]);

  rpc1.on('piece-request', (pieceId: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
    expect(pieceId.join(',')).toEqual(piece.data.pieceHash.join(','));
    responseCallback(pieceData);
  });

  const pieceResponse = await rpc2.requestPiece(piece.data.pieceHash);
  const pieceResponseData = Buffer.concat([
    pieceResponse.piece,
    pieceResponse.data.pieceHash,
    pieceResponse.data.stateHash,
    smallNum2Bin(pieceResponse.data.pieceIndex),
    pieceResponse.data.proof,
  ]);
  expect(pieceResponseData.join(',')).toEqual(pieceData.join(','));
});

test('get-peers', async () => {
  return new Promise((resolve) => {
    network1.on('peer-connected', async () => {
      const rpc1Peers = await rpc1.getPeers();
      const rpc2Peers = await rpc2.getPeers();
      expect(rpc1Peers.length).toBe(1);
      expect(rpc2Peers.length).toBe(1);
      resolve();
    });
  });
});

afterEach(async () => {
  await rpc1.destroy();
  await rpc2.destroy();
  await wallet.close();
});
