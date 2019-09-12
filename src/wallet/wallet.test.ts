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
import { Tx } from '../ledger/tx';
import { Storage } from '../storage/storage';
import { rmDirRecursiveSync } from '../utils/utils';
import { IWalletAccount, Wallet } from './wallet';

let wallet: Wallet;
let account1: IWalletAccount;
let account2: IWalletAccount;
let account3: IWalletAccount;
const name = 'Test';
const description = 'A test account';
const seed = crypto.randomBytes(32);
let coinbaseTx: Tx;
let creditTx: Tx;

const storageDir = `${os.tmpdir()}/subspace/tests/wallet`;

if (fs.existsSync(storageDir)) {
  rmDirRecursiveSync(storageDir);
 }

fs.mkdirSync(storageDir, { recursive: true });

let blsSignatures: BlsSignatures;

beforeAll(async () => {
  blsSignatures = await BlsSignatures.init();
  const storage = new Storage('rocks', storageDir, 'wallet-test');
  wallet = new Wallet(blsSignatures, storage);
  account1 = await wallet.createAccount(name, description, seed);
  account2 = await wallet.createAccount();
  account3 = await wallet.createAccount();
});

test('create-account', async () => {
  expect(account1.name).toBe(name);
  expect(account1.description).toBe(description);
  expect(account1.createdAt).toBeGreaterThan(0);
  expect(account1.createdAt).toBeLessThan(Date.now());
  expect(account1.createdAt).toBe(account1.updatedAt);
  expect(account1.publicKey.length).toBe(48);
  expect(account1.privateKey.length).toBe(32);
  expect(account1.address.toString()).toBe(crypto.hash(account1.publicKey).toString());
  expect(account1.nonce).toBe(0);
  expect(account1.pendingBalance).toBe(0);
  expect(account1.confirmedBalance).toBe(0);
  expect(account1.credits.size).toBe(0);
  expect(account1.debits.size).toBe(0);
});

test('create-empty-account', async () => {
  expect(account2.name).toBe(undefined);
  expect(account2.description).toBe(undefined);
  expect(account2.createdAt).toBeGreaterThan(0);
  expect(account2.createdAt).toBeLessThan(Date.now());
  expect(account2.createdAt).toBe(account2.updatedAt);
  expect(account2.publicKey.length).toBe(48);
  expect(account2.privateKey.length).toBe(32);
  expect(account2.address.toString()).toBe(crypto.hash(account2.publicKey).toString());
  expect(account2.nonce).toBe(0);
  expect(account2.pendingBalance).toBe(0);
  expect(account2.confirmedBalance).toBe(0);
  expect(account2.credits.size).toBe(0);
  expect(account2.debits.size).toBe(0);
});

test('get-account', async () => {
  const retrievedAccount1 = wallet.getAccount(account1.address);
  expect(retrievedAccount1).toMatchObject(account1);

  const retrievedAccount2 = wallet.getAccount(account2.address);
  expect(retrievedAccount2).toMatchObject(account2);

  const retrievedAccount3 = wallet.getAccount(account3.address);
  expect(retrievedAccount3).toMatchObject(account3);
});

test('get-accounts', async () => {
  const accounts = wallet.getAccounts();
  expect(accounts[0]).toMatchObject(account1);
  expect(accounts[1]).toMatchObject(account2);
  expect(accounts[2]).toMatchObject(account3);
  expect(wallet.getAccounts().length).toBe(3);
  expect(wallet.addresses.size).toBe(3);
});

test('update-account', async () => {
  await wallet.updateAccount(account1);
  await wallet.updateAccount(account2);
  await wallet.updateAccount(account3);
  expect(wallet.getAccounts().length).toBe(3);
  expect(wallet.addresses.size).toBe(3);
});

test('delete-account', async () => {
  await wallet.deleteAccount(account1.address);
  expect(() => wallet.getAccount(account1.address)).toThrow();
  await expect(wallet.getAccountFromStorage(account1.address)).rejects.toThrow();
  expect(wallet.getAccounts().length).toBe(2);
  expect(wallet.addresses.size).toBe(2);
});

test('create-coinbase-tx', async () => {
  coinbaseTx = await wallet.createCoinBaseTx(1, account2.publicKey);
  expect(coinbaseTx.isValid(blsSignatures)).toBe(true);
  const account2FromMap = wallet.getAccount(account2.address);
  const account2FromStorage = await wallet.getAccountFromStorage(account2.address);
  expect(account2FromMap).toMatchObject(account2FromStorage);
  expect(account2FromStorage.pendingBalance).toBe(1);
  expect(account2FromMap.confirmedBalance).toBe(0);
  expect(account2.credits.size).toBe(1);
  expect(account2.nonce).toBe(1);
});

test('confirm-coinbase-tx', async () => {
  await wallet.onTxConfirmed(coinbaseTx);
  const confirmedAccount2 = wallet.getAccount(account2.address);
  expect(confirmedAccount2.confirmedBalance).toBe(1);
});

test('create-credit-tx', async () => {
  creditTx = await wallet.createCreditTx(1, account2.publicKey, account3.publicKey);
  expect(creditTx.isValid(blsSignatures)).toBe(true);
  await wallet.onTxReceived(creditTx);

  const account2FromMap = wallet.getAccount(account2.address);
  const account2FromStorage = await wallet.getAccountFromStorage(account2.address);
  expect(account2FromMap).toMatchObject(account2FromStorage);

  const account3FromMap = wallet.getAccount(account3.address);
  const account3FromStorage = await wallet.getAccountFromStorage(account3.address);
  expect(account3FromMap).toMatchObject(account3FromStorage);

  expect(account2FromMap.pendingBalance).toBe(0);
  expect(account2FromMap.confirmedBalance).toBe(1);
  expect(account2.nonce).toBe(2);
  expect(account2.debits.size).toBe(1);

  expect(account3FromMap.pendingBalance).toBe(1);
  expect(account3FromMap.confirmedBalance).toBe(0);
  expect(account3.credits.size).toBe(1);

});

test('confirm-credit-tx', async () => {
  await wallet.onTxConfirmed(creditTx);

  const account2FromMap = wallet.getAccount(account2.address);
  const account3FromMap = wallet.getAccount(account3.address);

  expect(account2FromMap.pendingBalance).toBe(0);
  expect(account2FromMap.confirmedBalance).toBe(0);

  expect(account3FromMap.pendingBalance).toBe(1);
  expect(account3FromMap.confirmedBalance).toBe(1);
});

test('close-load-clear', async () => {
  await wallet.close();
  const storage = new Storage('rocks', storageDir, 'wallet-test');
  const reopenedWallet = new Wallet(blsSignatures, storage);
  await reopenedWallet.loadAccounts();
  expect(reopenedWallet.getAccounts().length).toBe(2);
  expect(wallet.addresses.size).toBe(2);

  const account2FromMap = reopenedWallet.getAccount(account2.address);
  const account2FromStorage = await reopenedWallet.getAccountFromStorage(account2.address);
  expect(account2FromMap).toMatchObject(account2FromStorage);

  const account3FromMap = reopenedWallet.getAccount(account3.address);
  const account3FromStorage = await reopenedWallet.getAccountFromStorage(account3.address);
  expect(account3FromMap).toMatchObject(account3FromStorage);

  await reopenedWallet.clear();
  expect(reopenedWallet.getAccounts.length).toBe(0);
  expect(reopenedWallet.addresses.size).toBe(0);
  await expect(reopenedWallet.getAccountFromStorage(account2.address)).rejects.toThrow();
  expect(() => reopenedWallet.getAccount(account2.address)).toThrow();
  await expect(reopenedWallet.getAccountFromStorage(account3.address)).rejects.toThrow();
  expect(() => reopenedWallet.getAccount(account3.address)).toThrow();
  await reopenedWallet.close();
});

afterAll(async () => {
  await wallet.close();
});
