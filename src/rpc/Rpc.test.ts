import {BlsSignatures} from "../crypto/BlsSignatures";

if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import * as crypto from '../crypto/crypto';
import { Block } from '../ledger/block';
import { Content } from "../ledger/content";
import { Proof } from "../ledger/proof";
import { State } from '../ledger/state';
import { Tx } from '../ledger/tx';
import { CHUNK_LENGTH, HASH_LENGTH } from "../main/constants";
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
  nodeType: 'gateway',
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
let proof: Proof;
let content: Content;
let state: State;
let encoding: Uint8Array;
let block: Block;
let blsSignatures: BlsSignatures;

beforeAll(async () => {
  blsSignatures = await BlsSignatures.init();
  const storage = new Storage('memory', 'tests', 'rpc');
  wallet = new Wallet(blsSignatures, storage);
  const account = await wallet.createAccount();
  tx = await wallet.createCoinBaseTx(1, account.publicKey);

  // create the proof
  const previousProofHash = crypto.randomBytes(HASH_LENGTH);
  const solution = crypto.randomBytes(CHUNK_LENGTH);
  const pieceHash = crypto.randomBytes(HASH_LENGTH);
  const pieceStateHash = crypto.randomBytes(HASH_LENGTH);
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousProofHash,
    solution,
    pieceHash,
    pieceStateHash,
    pieceProof,
    account.publicKey,
  );

  const signedProof = wallet.signProof(unsignedProof);

  // create parent content
  const parentContentHash = crypto.randomBytes(HASH_LENGTH);

  // create tx set
  const txIds: Uint8Array[] = [
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
  ];

  // create coinbase tx and add to tx set
  const reward = 1;
  const coinbaseTx = await wallet.createCoinBaseTx(reward, account.publicKey);
  txIds.unshift(coinbaseTx.key);

  const previousBlockHash = crypto.randomBytes(32);

  block = Block.create(previousBlockHash, signedProof, parentContentHash, txIds, coinbaseTx);
  proof = block.value.proof;
  content = block.value.content;
  state = State.create(
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    Date.now(),
    1,
    1,
  );
  encoding = crypto.randomBytes(4096);
});

beforeEach(async () => {
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
