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
import * as crypto from '../crypto/crypto';
import { CHUNK_LENGTH, HASH_LENGTH } from '../main/constants';
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

const storageDir = `${os.homedir()}/subspace/tests/ledger`;

if (fs.existsSync(storageDir)) {
  rmDirRecursiveSync(storageDir);
 }

fs.mkdirSync(storageDir, { recursive: true });

beforeAll(async () => {
  ledgerWallet = await Wallet.open('rocks', storageDir, 'ledger-test');
  const senderSeed = crypto.randomBytes(32);
  senderAccount = await ledgerWallet.createAccount('ledger-test-sender', 'a sender account for ledger tests', senderSeed);
  receiverAccount = await ledgerWallet.createAccount('ledger-test-receiver', 'a receiver account for ledger tests');
});

test('create-coinbase-tx', async () => {
  const reward = 1;
  const coinbaseTx = await ledgerWallet.createCoinBaseTx(reward, senderAccount.publicKey);
  expect(coinbaseTx.isValid()).toBe(true);

  const data = coinbaseTx.toBytes();
  const fromBytes = Tx.fromBytes(data);
  expect(fromBytes.key.toString()).toBe(coinbaseTx.key.toString());
  return;
});

test('create-credit-tx', async () => {
  const amount = 1;
  const creditTx = await ledgerWallet.createCreditTx(amount, receiverAccount.publicKey, senderAccount.publicKey);
  expect(creditTx.isValid()).toBe(true);
});

test('create-genesis-proof', () => {
  const previousProofHash = crypto.randomBytes(HASH_LENGTH);
  const genesisProof = Proof.createGenesisProof(previousProofHash);
  expect(genesisProof.isValid()).toBe(true);
});

test('create-proof', () => {
  const previousLevelHash = crypto.randomBytes(HASH_LENGTH);
  const previousProofHash = crypto.randomBytes(HASH_LENGTH);
  const solution = crypto.randomBytes(8);
  const pieceHash = crypto.randomBytes(HASH_LENGTH);
  const pieceStateHash = crypto.randomBytes(HASH_LENGTH);
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousLevelHash,
    previousProofHash,
    solution,
    pieceHash,
    pieceStateHash,
    pieceProof,
    receiverAccount.publicKey,
  );

  const signedProof = ledgerWallet.signProof(unsignedProof);
  expect(signedProof.isValid()).toBe(true);
});

test('create-genesis-content', () => {
  const parentContentHash = new Uint8Array();
  const proofHash = crypto.randomBytes(32);
  const genesisContent = Content.createGenesisContent(parentContentHash, proofHash);
  expect(genesisContent.isValid()).toBe(true);
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
  return;
});

test('create-genesis-block', () => {
  const previousProofHash =  crypto.randomBytes(HASH_LENGTH);
  const parentContentHash = crypto.randomBytes(HASH_LENGTH);
  const genesisBlock = Block.createGenesisBlock(previousProofHash, parentContentHash);
  expect(genesisBlock.isValid()).toBe(true);
});

test('create-block', async () => {

  // create the proof
  const previousLevelHash = crypto.randomBytes(HASH_LENGTH);
  const previousProofHash = crypto.randomBytes(HASH_LENGTH);
  const solution = crypto.randomBytes(CHUNK_LENGTH);
  const pieceHash = crypto.randomBytes(HASH_LENGTH);
  const pieceStateHash = crypto.randomBytes(HASH_LENGTH);
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousLevelHash,
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

  const block = Block.create(signedProof, parentContentHash, txIds, coinbaseTx);
  expect(block.isValid()).toBe(true);
});

afterAll(async () => {
  await ledgerWallet.close();
});
