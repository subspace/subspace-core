// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name
import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { ITxData, ITxValue } from '../main/interfaces';
import { areArraysEqual, bin2Hex, bin2Num, num2Bin, num2Date, smallBin2Num, smallNum2Bin } from '../utils/utils';

// ToDo
  // fix dates to use greater than 4 byte integers

/**
 * Record class for credit transactions used to transfer funds between accounts on the ledger.
 */
export class Tx {

  /**
   * Returns a new signed tx instance given correct inputs.
   */
  public static create(
    senderPublicKey: Uint8Array,
    receiverPublicKey: Uint8Array,
    amount: number,
    nonce: number,
    senderPrivateKey: Uint8Array,
    blsSignatures: BlsSignatures,
  ): Tx {
    const txValue: ITxValue = {
      sender: senderPublicKey,
      receiver: receiverPublicKey,
      amount,
      nonce,
      timestamp: (Date.now() / 1000) * 1000,
      signature: new Uint8Array(),
    };
    const tx = new Tx(txValue);
    tx.sign(senderPrivateKey, blsSignatures);
    tx.setKey();
    return tx;
  }

  /**
   * Creates a coinbase tx to reward the farmer who creates a new block.
   */
  public static createCoinbase(
    creatorPublicKey: Uint8Array,
    amount: number,
    nonce: number,
    creatorPrivateKey: Uint8Array,
    blsSignatures: BlsSignatures,
  ): Tx {
    return Tx.create(
      new Uint8Array(48),
      creatorPublicKey,
      amount,
      nonce,
      creatorPrivateKey,
      blsSignatures,
    );
  }

  /**
   * Returns a tx instance from existing data.
   */
  public static load(txData: ITxData): Tx {
    const txValue: ITxValue = {
      sender: txData[0],
      receiver: txData[1],
      amount: txData[2],
      nonce: txData[3],
      timestamp: txData[4],
      signature: txData[5],
    };
    const tx = new Tx(txValue);
    tx.setKey();
    return tx;
  }

  /**
   * Loads a new tx from binary data received over the network
   *
   * @param data exactly 202 bytes of binary data
   */
  public static fromBytes(data: Uint8Array): Tx {

    if (data.length !== 202) {
      throw new Error('Cannot load tx from bytes, data is not 202 bytes long');
    }

    const txValue: ITxValue = {
      sender: data.subarray(0, 48),
      receiver: data.subarray(48, 96),
      amount: bin2Num(data.subarray(96, 100)),
      nonce: smallBin2Num(data.subarray(100, 102)),
      timestamp: bin2Num(data.subarray(102, 106)) * 1000,
      signature: data.subarray(106, 202),
    };

    const tx = new Tx(txValue);
    tx.setKey();
    return tx;
  }

  private _key: Uint8Array;
  private _value: ITxValue;

  constructor(value: ITxValue) {
    this._value = value;
    this._key = crypto.hash(this.toBytes());
  }

  public get key(): Uint8Array {
    return this._key;
  }

  public get value(): ITxValue {
    return this._value;
  }

  /**
   * Hashes the sender's public key, returning their address.
   */
  public get senderAddress(): Uint8Array {
    return crypto.hash(this._value.sender);
  }

  /**
   * Hashes the receiver's public key, returning their address.
   */
  public get receiverAddress(): Uint8Array {
    return crypto.hash(this._value.receiver);
  }

  /**
   * Returns a compact binary representation of the tx data.
   */
  public toBytes(signed = true): Uint8Array {
    return Uint8Array.from(Buffer.concat([
      this._value.sender,
      this._value.receiver,
      num2Bin(this._value.amount),
      smallNum2Bin(this._value.nonce),
      num2Bin(this._value.timestamp / 1000),
      signed ? this._value.signature : new Uint8Array(),
    ]));
  }

  /**
   * Returns a compact serialized representation of the tx data.
   */
  public toData(): ITxData {
    return [
      this._value.sender,
      this._value.receiver,
      this._value.amount,
      this._value.nonce,
      this._value.timestamp,
      this._value.signature,
    ];
  }

  /**
   * Returns a human readable serialization of the proof object.
   */
  public print(): object {
    return {
      type: 'Transaction',
      key: bin2Hex(this._key),
      value: {
        sender: bin2Hex(this._value.sender),
        receiver: bin2Hex(this._value.receiver),
        amount: this._value.amount,
        nonce: this._value.nonce,
        timestamp: num2Date(this._value.timestamp),
        signature: bin2Hex(this._value.signature),
      },
    };
  }

  /**
   * Validates that tx follows schema and is internally consistent, but not that it has sufficient funds.
   */
  public isValid(blsSignatures: BlsSignatures): boolean {

    // validate signature is 96 bytes (BLS signature)
    if (this._value.signature.length !== 96) {
      throw new Error('Invalid tx, invalid signature length');
    }

    // validate sender is 48 bytes (BLS public key or null array)
    if (this._value.receiver.length !== 48) {
      throw new Error('Invalid tx, invalid receiver key length');
    }

    // validate receiver is 48 bytes (BLS public key)
    if (this._value.sender.length !== 48) {
      throw new Error('Invalid tx, invalid sender key length');
    }

    // validate nonce is 4 bytes
    if (smallNum2Bin(this._value.nonce).length !== 2) {
      throw new Error('Invalid tx, incorrect nonce length');
    }

    // validate timestamp is 4 bytes
    if (num2Bin(this._value.timestamp).length !== 4) {
      throw new Error('Invalid tx, incorrect timestamp length');
    }

    // validate amount is 4 bytes
    if (num2Bin(this._value.amount).length !== 4) {
      throw new Error('Invalid tx, incorrect amount length');
    }

    // is date within +/- 10 minutes of now
    if (!crypto.isDateWithinRange(this._value.timestamp, 600000)) {
      throw new Error('Invalid tx, date is out of range');
    }

    let sender: Uint8Array;
    areArraysEqual(this._value.sender, new Uint8Array(48)) ? sender = this._value.receiver : sender = this._value.sender;

    if (!blsSignatures.verifySignature(this.toBytes(false), this._value.signature, sender)) {
      throw new Error('Invalid tx, invalid signature for message and public key');
    }

    if ((areArraysEqual(this._value.sender, new Uint8Array(48))) && this._value.amount !== 1) {
      throw new Error('Invalid coinbase tx, invalid amount');
    }

    return true;
  }

  /**
   * Sets the tx id as the content addressed hash of its value.
   */
  public setKey(): void {
    this._key = crypto.hash(this.toBytes());
  }

  /**
   * Appends a detached BLS signature to a newly created tx.
   */
  public sign(privateKey: Uint8Array, blsSignatures: BlsSignatures): void {
    this._value.signature = blsSignatures.signMessage(this.toBytes(false), privateKey);
  }
}
