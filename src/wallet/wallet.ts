// tslint:disable: variable-name

import * as crypto from "../crypto/crypto";
import { Proof } from "../ledger/proof";
import { Tx } from "../ledger/tx";
import { HASH_LENGTH } from '../main/constants';
import { IKeyPair } from "../main/interfaces";
import { Storage } from "../storage/storage";
import { bin2Num, num2Bin, str2Bin } from "../utils/utils";

// ToDo
  // address should be loaded on init or created
  // each address should have its own nonce
  // encrypt private keys at rest
  // create from user generated seeds
  // HD Wallet Functions (child keys)

const STORAGE_ADDRESS = crypto.hash(str2Bin('address'));
const NONCE_ADDRESS = crypto.hash(str2Bin('nonce'));

/**
 * Class for securely creating, managing, and persisting keys.
 */
export class Wallet {

  /**
   * Returns a new wallet instance, loading any stored keys and nonce from disk.
   */
  public static async init(storageAdapter: string): Promise<Wallet> {
    const storage = new Storage(storageAdapter, 'wallet');
    const wallet = new Wallet(storage);
    await wallet.loadAddresses();
    await wallet.loadNonce();
    return wallet;
  }

  public readonly addresses: Set<Uint8Array> = new Set();
  public address = new Uint8Array();
  public publicKey = new Uint8Array();
  public privateKey = new Uint8Array();
  private storage: Storage;
  private _nonce: number;

  constructor(storage: Storage, nonce = 0) {
    this.storage = storage;
    this._nonce = nonce;
  }

  get nonce(): number {
    return this._nonce;
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
    return;
  }

  /**
   * Sets the default (master) address, private key, and public key from persistent storage.
   */
  public async setMasterKeyPair(): Promise<boolean> {
    if (this.addresses.size > 0) {
      this.address = [...this.addresses.values()][0];
      const keyPair = await this.getKeyPair(this.address);
      if (keyPair) {
        this.privateKey = keyPair.binaryPrivateKey;
        this.publicKey = keyPair.binaryPublicKey;
        return true;
      } else {
        throw new Error('Could not retrieve keys from storage');
      }
    }
    return false;
  }

  /**
   * Deletes an existing key pair from disk by address.
   */
  public async deleteKeyPair(address: Uint8Array): Promise<void> {
    if (await this.storage.get(address)) {
      await this.storage.del(address);
      this.addresses.delete(address);
      const binaryAddresses = Buffer.concat([...this.addresses]);
      await this.storage.put(STORAGE_ADDRESS, binaryAddresses);

      if (this.address.toString() === address.toString()) {
        this.address = new Uint8Array();
        this.publicKey = new Uint8Array();
        this.privateKey = new Uint8Array();
      }
    } else {
      throw new Error('Cannot delete keys, no keys for this address');
    }
  }

  /**
   * Deletes all key pairs and associated addresses from disk.
   */
  public async clear(): Promise<void> {
    for (const address of this.addresses) {
      await this.deleteKeyPair(address);
    }
    await this.storage.del(STORAGE_ADDRESS);
    await this.storage.del(NONCE_ADDRESS);
    this._nonce = 0;
  }

  public async close(): Promise<void> {
    await this.storage.close();
  }

  /**
   * Creates a simple credit tx using a farmers keys and nonce.
   */
  public async createCreditTx(amount: number, receiver: Uint8Array): Promise<Tx> {
    const tx = Tx.create(this.publicKey, receiver, amount, this.nonce, this.privateKey);
    await this.incrementNonce();
    return tx;
  }

  /**
   * Creates a coinbase (block reward) tx using a farmers keys and nonce.
   */
  public async createCoinBaseTx(reward: number): Promise<Tx> {
    const coinbaseTx = Tx.createCoinbase(this.publicKey, reward, this.nonce, this.privateKey);
    await this.incrementNonce();
    return coinbaseTx;
  }

  /**
   * Signs a proof deliberately so as not to expose BLS Private Keys outside wallet module.
   */
  public signProof(proof: Proof): Proof {
    if (proof.value.publicKey.length > 0) {
      proof.sign(this.privateKey);
    }
    proof.setKey();
    return proof;
  }

  /**
   * Loads all addresses from disk on initialization.
   */
  private async loadAddresses(): Promise<void> {
    const binaryAddresses = await this.storage.get(STORAGE_ADDRESS);
    if (binaryAddresses) {
      for (let i = 0; i < binaryAddresses.length / HASH_LENGTH; ++i) {
        const address = binaryAddresses.subarray(i * HASH_LENGTH, (i + 1) * HASH_LENGTH);
        this.addresses.add(Uint8Array.from(address));
      }
    }
  }

  private async loadNonce(): Promise<void> {
    const nonce = await this.storage.get(NONCE_ADDRESS);
    if (nonce) {
      this._nonce = bin2Num(nonce);
    }
  }

  /**
   * Increments the nonce for the master address to prevent replay attacks.
   */
  private async incrementNonce(): Promise<void> {
    this._nonce ++;
    await this.storage.put(NONCE_ADDRESS, num2Bin(this._nonce));
  }
}
