/**
 * @jest-environment node
 *
 */

// tslint:disable: no-unused-expression
// tslint:disable: no-console

if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import * as crypto from '../crypto/crypto';
import { bin2Num } from '../utils/utils';
import { Wallet } from '../wallet/wallet';
// import { Account } from './accounts';
import { Block } from './block';
// import { Chain } from './chain';
import { Content } from './content';
// import { Ledger } from './ledger';
import { Proof } from './proof';
// import { State } from './state';
// import { Tx } from './tx';

let wallet: Wallet;

beforeAll(async () => {
  wallet = await Wallet.init('rocks');
  const seed = crypto.randomBytes(32);
  await wallet.createKeyPair(seed);
  await wallet.setMasterKeyPair();
});

test('create-coinbase-tx', async () => {
  const reward = 1;
  const coinbaseTx = await wallet.createCoinBaseTx(reward);
  expect(coinbaseTx.isValid()).toBe(true);
  return;
});

test('create-credit-tx', async () => {
  const receiver = crypto.randomBytes(48);
  const amount = 100;
  const creditTx = await wallet.createCreditTx(amount, receiver);
  expect(creditTx.isValid()).toBe(true);
});

test('create-genesis-proof', () => {
  const previousProofHash = crypto.randomBytes(32);
  const unsignedGenesisProof = Proof.createGenesisProof(previousProofHash);
  const signedGenesisProof = wallet.signProof(unsignedGenesisProof);
  expect(signedGenesisProof.isValid()).toBe(true);
});

test('create-proof', () => {
  const previousLevelHash = crypto.randomBytes(32);
  const previousProofHash = crypto.randomBytes(32);
  const solution = crypto.randomBytes(8);
  const pieceHash = crypto.randomBytes(32);
  const pieceLevel = bin2Num(crypto.randomBytes(4));
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousLevelHash,
    previousProofHash,
    solution,
    pieceHash,
    pieceLevel,
    pieceProof,
    wallet.publicKey,
  );

  const signedProof = wallet.signProof(unsignedProof);
  expect(signedProof.isValid()).toBe(true);
});

test('create-genesis-content', () => {
  const parentContentHash = new Uint8Array();
  const proofHash = crypto.randomBytes(32);
  const genesisContent = Content.createGenesisContent(parentContentHash, proofHash);
  expect(genesisContent.isValid()).toBe(true);
});

test('create-content', () => {
  const parentContentHash = crypto.randomBytes(32);
  const proofHash = crypto.randomBytes(32);
  const payload: Uint8Array[] = [
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    crypto.randomBytes(32),
  ];
  const content = Content.create(parentContentHash, proofHash, payload);
  expect(content.isValid()).toBe(true);
  return;
});

test('create-genesis-block', () => {
  const previousProofHash =  crypto.randomBytes(32);
  const parentContentHash = crypto.randomBytes(32);
  const genesisBlock = Block.createGenesisBlock(previousProofHash, parentContentHash);
  expect(genesisBlock.isValid()).toBe(true);
});

test('create-block', async () => {

  // create the proof
  const previousLevelHash = crypto.randomBytes(32);
  const previousProofHash = crypto.randomBytes(32);
  const solution = crypto.randomBytes(8);
  const pieceHash = crypto.randomBytes(32);
  const pieceLevel = bin2Num(crypto.randomBytes(4));
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousLevelHash,
    previousProofHash,
    solution,
    pieceHash,
    pieceLevel,
    pieceProof,
    wallet.publicKey,
  );

  const signedProof = wallet.signProof(unsignedProof);

  // create parent content
  const parentContentHash = crypto.randomBytes(32);

  // create tx set
  const txIds: Uint8Array[] = [
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    crypto.randomBytes(32),
  ];

  // create coinbase tx and add to tx set
  const reward = 1;
  const coinbaseTx = await wallet.createCoinBaseTx(reward);
  txIds.unshift(coinbaseTx.key);

  const block = Block.create(signedProof, parentContentHash, txIds, coinbaseTx);
  expect(block.isValid()).toBe(true);
});

afterAll(async () => {
  await wallet.close();
});
