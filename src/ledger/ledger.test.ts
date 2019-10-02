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

import * as fs from 'fs';
import * as os from 'os';
import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { CHUNK_LENGTH, HASH_LENGTH } from '../main/constants';
import { Storage } from '../storage/storage';
import { rmDirRecursiveSync } from '../utils/utils';
import { IWalletAccount, Wallet } from '../wallet/wallet';
// import { Account } from './accounts';
import { Block } from './block';
// import { Chain } from './chain';
import { Content } from './content';
// import { Ledger } from './ledger';
import { Proof } from './proof';
// import { State } from './state';
import { Tx } from './tx';

let ledgerWallet: Wallet;
let senderAccount: IWalletAccount;
let receiverAccount: IWalletAccount;

const storageDir = `${os.tmpdir()}/subspace/tests/ledger`;

if (fs.existsSync(storageDir)) {
  rmDirRecursiveSync(storageDir);
 }

fs.mkdirSync(storageDir, { recursive: true });

let blsSignatures: BlsSignatures;

beforeAll(async () => {
  blsSignatures = await BlsSignatures.init();
  const storage = new Storage('rocks', storageDir, 'ledger-tests');
  ledgerWallet = new Wallet(blsSignatures, storage);
  const senderSeed = crypto.randomBytes(32);
  senderAccount = await ledgerWallet.createAccount('ledger-test-sender', 'a sender account for ledger tests', senderSeed);
  receiverAccount = await ledgerWallet.createAccount('ledger-test-receiver', 'a receiver account for ledger tests');
});

test('create-coinbase-tx', async () => {
  const reward = 1;
  const coinbaseTx = await ledgerWallet.createCoinBaseTx(reward, senderAccount.publicKey);
  expect(coinbaseTx.isValid(blsSignatures)).toBe(true);

  const data = coinbaseTx.toBytes();
  const fromBytes = Tx.fromBytes(data);
  fromBytes.isValid(blsSignatures);
  expect(fromBytes.key.toString()).toBe(coinbaseTx.key.toString());
});

test('create-credit-tx', async () => {
  const amount = 1;
  const creditTx = await ledgerWallet.createCreditTx(amount, receiverAccount.publicKey, senderAccount.publicKey);
  expect(creditTx.isValid(blsSignatures)).toBe(true);

  const data = creditTx.toBytes();
  const fromBytes = Tx.fromBytes(data);
  fromBytes.isValid(blsSignatures);
  expect(fromBytes.key.toString()).toBe(creditTx.key.toString());
});

test('create-genesis-proof', () => {
  const previousProofHash = new Uint8Array(HASH_LENGTH);
  const solution = crypto.randomBytes(8);
  const pieceHash = crypto.randomBytes(HASH_LENGTH);
  const pieceStateHash = crypto.randomBytes(HASH_LENGTH);
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousProofHash,
    solution,
    pieceHash,
    pieceStateHash,
    pieceProof,
    receiverAccount.publicKey,
  );

  const signedProof = ledgerWallet.signProof(unsignedProof);
  expect(signedProof.isValid(blsSignatures)).toBe(true);

  const data = signedProof.toBytes();
  const fromBytes = Proof.fromBytes(data);
  fromBytes.isValid(blsSignatures);
  expect(fromBytes.key.toString()).toBe(signedProof.key.toString());
});

test('create-proof', () => {
  const previousProofHash = crypto.randomBytes(HASH_LENGTH);
  const solution = crypto.randomBytes(8);
  const pieceHash = crypto.randomBytes(HASH_LENGTH);
  const pieceStateHash = crypto.randomBytes(HASH_LENGTH);
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousProofHash,
    solution,
    pieceHash,
    pieceStateHash,
    pieceProof,
    receiverAccount.publicKey,
  );

  const signedProof = ledgerWallet.signProof(unsignedProof);
  expect(signedProof.isValid(blsSignatures)).toBe(true);

  const data = signedProof.toBytes();
  const fromBytes = Proof.fromBytes(data);
  fromBytes.isValid(blsSignatures);
  expect(fromBytes.key.toString()).toBe(signedProof.key.toString());
});

test('create-genesis-content', () => {
  const parentContentHash = new Uint8Array(HASH_LENGTH);
  const proofHash = crypto.randomBytes(HASH_LENGTH);
  const payload: Uint8Array[] = [
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
  ];
  const content = Content.create(parentContentHash, proofHash, payload);
  expect(content.isValid()).toBe(true);

  const data = content.toBytes();
  const fromBytes = Content.fromBytes(data);
  fromBytes.isValid();
  expect(fromBytes.key.toString()).toBe(content.key.toString());
});

test('create-content', () => {
  const parentContentHash = crypto.randomBytes(HASH_LENGTH);
  const proofHash = crypto.randomBytes(HASH_LENGTH);
  const payload: Uint8Array[] = [
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
  ];
  const content = Content.create(parentContentHash, proofHash, payload);
  expect(content.isValid()).toBe(true);

  const data = content.toBytes();
  const fromBytes = Content.fromBytes(data);
  fromBytes.isValid();
  expect(fromBytes.key.toString()).toBe(content.key.toString());
});

test('create-genesis-block', async () => {

  // create the proof
  const previousProofHash = new Uint8Array(HASH_LENGTH);
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
    receiverAccount.publicKey,
  );

  const signedProof = ledgerWallet.signProof(unsignedProof);

  // create parent content
  const parentContentHash = new Uint8Array(HASH_LENGTH);

  // create tx set
  const txIds: Uint8Array[] = [
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
    crypto.randomBytes(HASH_LENGTH),
  ];

  // create coinbase tx and add to tx set
  const reward = 1;
  const coinbaseTx = await ledgerWallet.createCoinBaseTx(reward, receiverAccount.publicKey);
  txIds.unshift(coinbaseTx.key);

  const previousBlockHash = new Uint8Array(32);

  const block = Block.create(previousBlockHash, signedProof, parentContentHash, txIds, coinbaseTx);
  expect(block.isValid(blsSignatures)).toBe(true);

  const data = block.toFullBytes();
  const fromBinaryBlock = Block.fromFullBytes(data);
  block.isValid(blsSignatures);
  expect(fromBinaryBlock.key.toString()).toBe(block.key.toString());

  const compactBlockData = block.toCompactBytes();
  const compactBlock = Block.fromCompactBytes(compactBlockData);
  expect(compactBlock.proofHash.toString()).toBe(block.value.proof.key.toString());
  expect(compactBlock.contentHash.toString()).toBe(block.value.content.key.toString());
});

test('create-block', async () => {

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
    receiverAccount.publicKey,
  );

  const signedProof = ledgerWallet.signProof(unsignedProof);

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
  const coinbaseTx = await ledgerWallet.createCoinBaseTx(reward, receiverAccount.publicKey);
  txIds.unshift(coinbaseTx.key);

  const previousBlockHash = crypto.randomBytes(32);

  const block = Block.create(previousBlockHash, signedProof, parentContentHash, txIds, coinbaseTx);
  expect(block.isValid(blsSignatures)).toBe(true);

  const data = block.toFullBytes();
  const fromBinaryBlock = Block.fromFullBytes(data);
  block.isValid(blsSignatures);
  expect(fromBinaryBlock.key.toString()).toBe(block.key.toString());

  const compactBlockData = block.toCompactBytes();
  const compactBlock = Block.fromCompactBytes(compactBlockData);
  expect(compactBlock.proofHash.toString()).toBe(block.value.proof.key.toString());
  expect(compactBlock.contentHash.toString()).toBe(block.value.content.key.toString());
});

afterAll(async () => {
  await ledgerWallet.close();
});
