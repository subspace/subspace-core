import * as crypto from "../crypto/crypto";
import { HASH_LENGTH } from '../main/constants';
import { IKeyPair } from "../main/interfaces";
import { Storage } from "../storage/storage";

// ToDo
  // create from user generated seeds
  // encrypt private keys at rest
  // HD Wallet Functions (child keys)

const STORAGE_ADDRESS = crypto.hash(Buffer.from('address'));

/**
 * Class for securely creating, managing, and persisting keys.
 */
export class Wallet {

  /**
   * Returns a nee wallet instance, loading any stored keys from disk.
   */
  public static async init(storageAdapter: string): Promise<Wallet> {
    const storage = new Storage(storageAdapter, 'wallet');
    const wallet = new Wallet(storage);
    await wallet.loadAddresses();
    return wallet;
  }

  public readonly addresses: Set<Uint8Array> = new Set();
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /**
   * Creates a new key pair and address before storing to disk.
   */
  public async createKeyPair(seed: Uint8Array): Promise<Uint8Array> {
    const keys = crypto.generateBLSKeys(seed);
    const address = crypto.hash(keys.binaryPublicKey);
    const binaryKeys = Buffer.concat([keys.binaryPrivateKey, keys.binaryPublicKey]);
    await this.storage.put(address, binaryKeys);
    this.addresses.add(address);
    const binaryAddresses = Buffer.concat([...this.addresses]);
    await this.storage.put(STORAGE_ADDRESS, binaryAddresses);
    return address;
  }

  /**
   * Retrieves an existing key pair from disk by address.
   */
  public async getKeyPair(address: Uint8Array): Promise<IKeyPair | void> {
    if (this.addresses.has(address)) {
      const binaryKeys = await this.storage.get(address);
      if (!binaryKeys) {
        return;
      }
      const binaryPrivateKey = binaryKeys.subarray(0, 32);
      const binaryPublicKey = binaryKeys.subarray(32, 80);
      if (crypto.hash(binaryPublicKey).toString() !== address.toString()) {
        throw new Error('Cannot get keys, public key does not match address');
      }
      return {
        binaryPrivateKey,
        binaryPublicKey,
      };
    }
  }

  /**
   * Deletes an existing key pair from disk by address.
   */
  public async deleteKeyPair(address: Uint8Array): Promise<void> {
    if (await this.storage.get(address)) {
      await this.storage.del(address);
      this.addresses.delete(address);
    } else {
      throw new Error('Cannot delete keys, no keys for this address');
    }
  }

  /**
   * Deletes all key pairs and associated addresses from disk.
   */
  public async clearAddresses(): Promise<void> {
    for (const address of this.addresses) {
      await this.deleteKeyPair(address);
    }
    await this.storage.del(STORAGE_ADDRESS);
  }

  /**
   * Loads all addresses from disk on initialization.
   */
  private async loadAddresses(): Promise<void> {
    const binaryAddresses = await this.storage.get(STORAGE_ADDRESS);
    if (binaryAddresses) {
      for (let i = 0; i < binaryAddresses.length / HASH_LENGTH; ++i) {
        const address = binaryAddresses.subarray(i * HASH_LENGTH, (i + 1) * HASH_LENGTH);
        this.addresses.add(address);
      }
    }
  }
}
