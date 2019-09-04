// tslint:disable: variable-name
// tslint:disable: object-literal-sort-keys

import { ArrayMap, ArraySet } from "array-map-set";
import * as crypto from "../crypto/crypto";
import { Proof } from "../ledger/proof";
import { Tx } from "../ledger/tx";
import { Storage } from "../storage/storage";
import { bin2Hex, bin2JSON, hex2Bin, JSON2Bin, num2Date } from "../utils/utils";

  // link with parent modules
  // revise tests
  // have to know which account to load, would come from farm module or from user input

// ToDo
  // sync wallet on startup (in // w/ledger sync)
  // encrypt private keys at rest
  // recover from a seed
  // use a secure random number generator
  // HD Wallet Functions (child keys)

export interface IWalletAccount {
  name?: string;              // Optional account name
  description?: string;       // Optional account description
  createdAt: number;          // Unix timestamp for when account was created
  updatedAt: number;          // Unix timestamp for when account was last updated
  publicKey: Uint8Array;      // 48 byte binary BLS public key
  privateKey: Uint8Array;     // 32 byte binary BLS private key
  address: Uint8Array;        // 32 byte hash of BLS public key, used as the account identifier
  nonce: number;              // auto-incrementing nonce for txs created by this account, used to prevent replay attacks
  pendingBalance: number;     // balance for this account based on all confirmed and pending txs
  confirmedBalance: number;   // balance for this account based on all confirmed txs
  credits: Set<Uint8Array>;   // set of all tx ids that deposit funds to this account
  debits: Set<Uint8Array>;    // set of all tx ids that remove funds from this account
}

/**
 * Class for securely creating, managing, and persisting keys with associated metadata.
 */
export class Wallet {

  /**
   * Returns a new wallet instance, loading any stored accounts from disk.
   * Using memory storage backend is redundant here as the accounts are already handled in a map.
   *
   * @param storageAdapter The type of storage backend for persisting wallet accounts.
   *
   * @return A wallet instance with all accounts loaded.
   */
  public static async open(storageAdapter: string, namespace = 'wallet'): Promise<Wallet> {
    const storage = new Storage(storageAdapter, namespace);
    const wallet = new Wallet(storage);
    await wallet.loadAccounts();
    return wallet;
  }

  private accounts = ArrayMap<Uint8Array, IWalletAccount>();
  private storage: Storage;

  /**
   * Base constructor for Wallet, for internal use only
   *
   * @param storage The storage instance used to persist account data
   */
  constructor(storage: Storage) {
    this.storage = storage;
  }

  /**
   * Creates a new account for this node with optional params
   *
   * @param name Optional human readable name for the account
   * @param description Optional human readable description for the account
   * @param seed Optional 32 byte binary seed for this account
   *
   * @return the new Account value
   */
  public async createAccount(name?: string, description?: string, seed?: Uint8Array): Promise<IWalletAccount> {

    const keys = crypto.generateBLSKeys(seed);
    const address = crypto.hash(keys.binaryPublicKey);

    const account: IWalletAccount = {
      name,
      description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      publicKey: keys.binaryPublicKey,
      privateKey: keys.binaryPrivateKey,
      address,
      nonce: 0,
      pendingBalance: 0,
      confirmedBalance: 0,
      credits: ArraySet(),
      debits: ArraySet(),
    };

    this.accounts.set(address, account);
    await this.storage.put(address, JSON2Bin(account));
    return account;
  }

  /**
   * Retrieves an account for this node, given the account address
   *
   * @param address hash of the associated BLS public key
   *
   * @return the associated Account value
   */
  public getAccount(address: Uint8Array): IWalletAccount {
    const account = this.accounts.get(address);
    if (account === undefined) {
      throw new Error('Cannot get account from wallet, no account exists for the given address');
    }
    return account;
  }

  /**
   * Retrieves an account for this node, given the account address
   *
   * @param address hash of the associated BLS public key
   *
   * @return the associated Account value
   */
  public async getAccountFromStorage(address: Uint8Array): Promise<IWalletAccount> {
    const binaryAccount = await this.storage.get(address);
    if (binaryAccount === null) {
      throw new Error('Cannot get account from wallet, no account exists for the given address');
    }
    const account: IWalletAccount = this.fromBinary(binaryAccount);
    return account;
  }

  /**
   * Lists the accounts for this node
   *
   * @return An array of all account values stored on this node.
   */
  public getAccounts(): IWalletAccount[]  {
    return [...this.accounts.values()];
  }

  /**
   * Updates an account in both the in-memory map and persistent store
   *
   * @param account the account value being updated
   */
  public async updateAccount(account: IWalletAccount): Promise<void> {
    account.updatedAt = Date.now();
    this.accounts.set(account.address, account);
    await this.storage.put(account.address, this.toBinary(account));
  }

  /**
   * Deletes an account for this node, given the account address
   *
   * @param address hash of the associated BLS public key
   *
   */
  public async deleteAccount(address: Uint8Array): Promise<void> {
    const hasAccount = this.accounts.has(address);
    if (!hasAccount) {
      throw new Error('Cannot delete account, no account exists for the given address');
    }
    this.accounts.delete(address);
    await this.storage.del(address);
  }

  /**
   * Creates a coinbase (block reward) tx using a farmers keys and nonce.
   *
   * @param blockReward: the coinbase reward, a network constant
   * @param creatorPublicKey the BLS public key of the block creator
   *
   * @return the fully formed and signed Tx instance
   */
  public async createCoinBaseTx(blockReward: number, receiverPublicKey: Uint8Array): Promise<Tx> {
    const receiverAccount = this.getAccount(crypto.hash(receiverPublicKey));
    const coinbaseTx = Tx.createCoinbase(receiverAccount.publicKey, blockReward, receiverAccount.nonce, receiverAccount.privateKey);
    receiverAccount.nonce ++;
    receiverAccount.pendingBalance += blockReward;
    receiverAccount.credits.add(coinbaseTx.key);
    this.accounts.set(receiverAccount.address, receiverAccount);
    await this.updateAccount(receiverAccount);
    return coinbaseTx;
  }

  /**
   * Creates a simple credit tx using a farmers keys and nonce.
   *
   * @param amount
   * @param senderPublicKey
   * @param receiverPublicKey
   *
   * @return the fully formed and signed Tx instance
   */
  public async createCreditTx(amount: number, senderPublicKey: Uint8Array,  receiverPublicKey: Uint8Array): Promise<Tx> {
    const senderAccount = this.getAccount(crypto.hash(senderPublicKey));
    const tx = Tx.create(senderAccount.publicKey, receiverPublicKey, amount, senderAccount.nonce, senderAccount.privateKey);
    senderAccount.nonce ++;
    senderAccount.pendingBalance -= amount;
    senderAccount.debits.add(tx.key);
    await this.updateAccount(senderAccount);
    return tx;
  }

  /**
   * Signs a proof deliberately so as not to expose BLS Private Keys outside wallet module.
   *
   * @param proof the base proof with message (missing a signature)
   *
   * @return the fully formed and signed Proof instance
   */
  public signProof(proof: Proof): Proof {
    const account = this.getAccount(crypto.hash(proof.value.publicKey));
    proof.sign(account.privateKey);
    proof.setKey();
    return proof;
  }

  /**
   * Called from Node when a new tx is received via gossip that lists an account for this node as the recipient.
   *
   * @param tx the valid tx instance received over the network
   *
   */
  public async onTxReceived(tx: Tx): Promise<void> {
    const account = this.getAccount(tx.receiverAddress);
    account.pendingBalance += tx.value.amount;
    account.credits.add(tx.key);
    await this.updateAccount(account);
  }

  /**
   * Called from Node when a new tx is confirmed within a level that lists an account for this node as the recipient or sender.
   *
   * @param tx the valid tx instance that was just confirmed
   */
  public async onTxConfirmed(tx: Tx): Promise<void> {
    let isSender = false;
    let isReceiver = false;
    if (this.accounts.has(tx.senderAddress)) {
      const account = this.getAccount(tx.senderAddress);
      account.confirmedBalance -= tx.value.amount;
      await this.updateAccount(account);
      isSender = true;
    }

    if (this.accounts.has(tx.receiverAddress)) {
      const account = this.getAccount(tx.receiverAddress);
      account.confirmedBalance += tx.value.amount;
      await this.updateAccount(account);
      isReceiver = true;
    }

    if (!(isSender || isReceiver)) {
      throw new Error('Cannot apply confirmed tx to account, no account exists for sender or recipient');
    }
  }

  /**
   * Deletes all key pairs and associated addresses from disk.
   */
  public async clear(): Promise<void> {
    await this.storage.clear();
    this.accounts.clear();
  }

  /**
   * Closes the underlying storage adapter. Should be called on shutdown to prevent IO lock errors.
   */
  public async close(): Promise<void> {
    await this.storage.close();
  }

  /**
   * Returns a human readable serialization of the account object.
   *
   * @param account the account instance to be printed
   *
   * @return an object representation of the account instance
   */
  public print(account: IWalletAccount): object {
    return {
      type: 'Account',
      value: {
        name: account.name,
        description: account.description,
        createdAt: num2Date(account.createdAt),
        updatedAt: num2Date(account.updatedAt),
        publicKey: bin2Hex(account.privateKey),
        privateKey: bin2Hex(account.publicKey),
        address: bin2Hex(account.address),
        nonce: account.nonce,
        pendingBalance: account.pendingBalance,
        confirmedBalance: account.confirmedBalance,
        credits: [...account.credits.values()].map((txId) => bin2Hex(txId)),
        debits: [...account.debits.values()].map((txId) => bin2Hex(txId)),
      },
    };
  }

  /**
   * Loads all stored accounts into memory when the Wallet is opened.
   */
  private async loadAccounts(): Promise<void> {
    const addresses = await this.storage.getKeys();
    for (const address of addresses) {
      const binaryAccount = await this.storage.get(address);
      if (!binaryAccount) {
        throw new Error('Cannot load wallet, cannot retrieve stored accounts');
      }
      const account: IWalletAccount = this.fromBinary(binaryAccount);
      this.accounts.set(account.address, account);
    }
  }

  /**
   * Serializes an account value to binary form for persisting on disk.
   *
   * @param account a wallet account as JSON
   *
   * @return binary representation of account
   */
  private toBinary(account: IWalletAccount): Uint8Array {

    const safeAccount = {
      name: account.name,
      description: account.description,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      publicKey: bin2Hex(account.publicKey),
      privateKey: bin2Hex(account.privateKey),
      address: bin2Hex(account.address),
      nonce: account.nonce,
      pendingBalance: account.pendingBalance,
      confirmedBalance: account.confirmedBalance,
      credits: [...account.credits.values()].map((txId) => bin2Hex(txId)),
      debits: [...account.debits.values()].map((txId) => bin2Hex(txId)),
    };

    return JSON2Bin(safeAccount);
  }

  /**
   * Deserializes a binary account value back into JSON form.
   *
   * @param data binary representation of an account
   *
   * @return A JSON account value
   */
  private fromBinary(data: Uint8Array): IWalletAccount {
    const safeAccount = bin2JSON(data);

    return {
      name: safeAccount.name,
      description: safeAccount.description,
      createdAt: safeAccount.createdAt,
      updatedAt: safeAccount.updatedAt,
      publicKey: hex2Bin(safeAccount.publicKey),
      privateKey: hex2Bin(safeAccount.privateKey),
      address: hex2Bin(safeAccount.address),
      nonce: safeAccount.nonce,
      pendingBalance: safeAccount.pendingBalance,
      confirmedBalance: safeAccount.confirmedBalance,
      credits: ArraySet(safeAccount.credits.map((txId: string) => hex2Bin(txId))),
      debits: ArraySet(safeAccount.debits.map((txiId: string) => hex2Bin(txiId))),
    };
  }
}
