import * as crypto from '../crypto/crypto';
import { Storage } from '../storage/storage';
import { Wallet } from './wallet';

const runTests = async () => {
  const wallet = await Wallet.init('rocks');
  const seed = Uint8Array.from([0, 1, 2]);
  const address = await wallet.createKeyPair(seed);

  await test('create-and-get-key-pair', async () => {
    const keyPair = await wallet.getKeyPair(address);
    if (keyPair) {
      expect(address.toString()).toBe(crypto.hash(keyPair.binaryPublicKey).toString());
    } else {
      fail(true);
    }
  });

  await test('delete-key-pair', async () => {
    await wallet.deleteKeyPair(address);
    expect(async () => {
      await wallet.getKeyPair(address);
    }).toThrow();
  });

  await test('create-and-get-many-key-pairs', async () => {
    for (let i = 0; i < 10; ++i) {
      const seed = Uint8Array.from([0 + i, 1 + i, 2 + i]);
      await wallet.createKeyPair(seed);
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

  await test('load-addresses', async () => {
    return;
  });

  test('clear-addresses', async () => {
    await wallet.clearAddresses();
  });
};

runTests();
