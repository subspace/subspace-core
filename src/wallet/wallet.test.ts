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
import { Wallet } from './wallet';

let wallet: Wallet;

beforeAll(async () => {
  wallet = await Wallet.init('rocks');
});

test('create-and-get-key-pair', async () => {
  const seed = Uint8Array.from([0, 1, 2]);
  const address = await wallet.createKeyPair(seed);
  const keyPair = await wallet.getKeyPair(address);
  if (keyPair) {
    expect(address.toString()).toBe(crypto.hash(keyPair.binaryPublicKey).toString());
    expect(wallet.addresses.has(address)).toBe(true);
  } else {
    fail(true);
  }
});

test('get-master-account-early', () => {
  expect(wallet.address.length).toBe(0);
  expect(wallet.publicKey.length).toBe(0);
  expect(wallet.privateKey.length).toBe(0);
});

test('set-master-key-pair', async () => {
  const masterAddress = [...wallet.addresses.values()][0];
  const keyPair = await wallet.getKeyPair(masterAddress);
  if (keyPair) {
    await wallet.setMasterKeyPair();
    expect(wallet.address.toString()).toBe(masterAddress.toString());
    expect(wallet.publicKey.toString()).toBe(keyPair.binaryPublicKey.toString());
    expect(wallet.privateKey.toString()).toBe(keyPair.binaryPrivateKey.toString());
  } else {
    fail(true);
  }
});

test('delete-key-pair', async () => {
  const address = wallet.address;
  await wallet.deleteKeyPair(address);
  const retrievedAddress = await wallet.getKeyPair(address);

  if (retrievedAddress) {
    fail(true);
  }

  if (wallet.addresses.has(address)) {
    fail(true);
  }
});

test('get-master-account-late', () => {
  expect(wallet.address.length).toBe(0);
  expect(wallet.publicKey.length).toBe(0);
  expect(wallet.privateKey.length).toBe(0);
});

test('create-and-get-many-key-pairs', async () => {
  for (let i = 0; i < 10; ++i) {
    const seed = Uint8Array.from([0 + i, 1 + i, 2 + i]);
    const address = await wallet.createKeyPair(seed);
    expect(wallet.addresses.has(address)).toBe(true);
  }
  for (const address of wallet.addresses) {
    const keyPair = await wallet.getKeyPair(address);
    if (keyPair) {
      expect(address.toString()).toBe(crypto.hash(keyPair.binaryPublicKey).toString());
    } else {
      fail(true);
    }
  }
});

test('load-addresses', async () => {
  const addressCount = wallet.addresses.size;
  await wallet.close();
  const newWallet = await Wallet.init('rocks');
  expect(addressCount).toBe(newWallet.addresses.size);
  await newWallet.close();
});

test('clear-wallet', async () => {
  const newWallet = await Wallet.init('rocks');
  await newWallet.clear();
  expect(newWallet.addresses.size).toBe(0);
  expect(wallet.address.length).toBe(0);
  expect(wallet.publicKey.length).toBe(0);
  expect(wallet.privateKey.length).toBe(0);
  expect(newWallet.nonce).toBe(0);
  await newWallet.close();
});
