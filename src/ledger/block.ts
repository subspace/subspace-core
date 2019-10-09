// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { ICompactBlockValue, IFullBlockValue } from '../main/interfaces';
import { areArraysEqual, bin2Hex, smallBin2Num, smallNum2Bin } from '../utils/utils';
import { Content } from './content';
import { Proof } from './proof';
import { Tx } from './tx';

/**
 * Record class for a logical block that contains the proof, content header, and coinbase tx.
 */
export class Block {

  /**
   * Returns a new block record given correct inputs.
   */
  public static create(
    previousBlockHash: Uint8Array,
    proof: Proof,
    parentContentHash: Uint8Array,
    txIds: Uint8Array[],
    coinbase: Tx,
  ): Block {
    const content = Content.create(parentContentHash, proof.key, txIds);
    const fullBlockValue: IFullBlockValue = {
      previousBlockHash,
      proof,
      content,
      coinbase,
    };
    return new Block(fullBlockValue);
  }

  /**
   * Parse a full block from binary data received over the network
   *
   * @param data the block as binary
   *
   */
  public static fromFullBytes(data: Uint8Array): Block {

    // Parse a block received as binary
    // proof and content size is variable so we read their lengths (2 byte integer)
    const previousBlockHash = data.subarray(0, 32);
    const proofLength = smallBin2Num(data.subarray(32, 32 + 2));
    const proof = Proof.fromBytes(data.subarray(32 + 2, 32 + 2 + proofLength));
    const contentLength = smallBin2Num(data.subarray(32 + 2 + proofLength, 32 + 2 + proofLength + 2));
    const content = Content.fromBytes(data.subarray(32 + 2 + proofLength + 2, 32 + 2 + proofLength + 2 + contentLength));
    const coinbase = Tx.fromBytes(data.subarray(32 + 2 + proofLength + 2 + contentLength, 32 + 2 + proofLength + 2 + contentLength + 204));
    const fullBlockValue: IFullBlockValue = { previousBlockHash, proof, content, coinbase };
    const block = new Block(fullBlockValue);
    block.setKey();
    return block;
  }

  /**
   * Parse a compact block from binary data received over the network
   *
   * @param data the compact block as binary
   *
   */
  public static fromCompactBytes(data: Uint8Array): ICompactBlockValue {
    // content and proof hash are always 32 bytes
    const compactBlockValue: ICompactBlockValue = {
      previousBlockHash: data.subarray(0, 32),
      proofHash: data.subarray(32, 64),
      contentHash: data.subarray(64, 96),
      // coinbase: data.subarray(96),
    };
    return compactBlockValue;
  }

  private _key: Uint8Array;
  private _value: IFullBlockValue;

  constructor(value: IFullBlockValue) {
    this._value = value;
    this._key = this.setKey();
  }

  get key(): Uint8Array {
    return this._key;
  }

  get value(): IFullBlockValue {
    return this._value;
  }

  /**
   * Returns a compact binary representation of the block data for level encoding.
   */
  public toBytes(): Uint8Array {
    return Buffer.concat([
      this._value.proof.toBytes(),
      this._value.content.toBytes(),
    ]);
  }

  /**
   * Returns a full binary representation of the block data for sending over the network.
   */
  public toFullBytes(): Uint8Array {
    const proofData = this._value.proof.toBytes();
    const proofLength = smallNum2Bin(proofData.length);
    const contentData = this._value.content.toBytes();
    const contentLength = smallNum2Bin(contentData.length);
    const coinbaseData = this._value.coinbase.toBytes();
    return Buffer.concat([
      this._value.previousBlockHash,
      proofLength,
      proofData,
      contentLength,
      contentData,
      coinbaseData,
    ]);
  }

  /**
   * Returns a compact binary representation of the block data for sending over the network.
   */
  public toCompactBytes(): Uint8Array {
    return Uint8Array.from(Buffer.concat([
      this._value.previousBlockHash,
      this._value.proof.key,
      this._value.content.key,
      // this._value.coinbase ? this._value.coinbase.key : new Uint8Array(),
    ]));
  }

  /**
   * Returns a human readable serialization of the block object.
   */
  public print(): object {
    return {
      type: 'Block',
      key: bin2Hex(this._key),
      value: {
        previousBlockHash: bin2Hex(this.value.previousBlockHash),
        proof: this.value.proof.print(),
        content: this.value.content.print(),
        coinbase: this.value.coinbase.print(),
      },
    };
  }

  /**
   * Validates that block follows schema and is internally consistent, but not that block is correct.
   */
  public isValid(blsSignatures: BlsSignatures): boolean {

    if (!areArraysEqual(this._value.proof.key, this._value.content.value.proofHash)) {
      throw new Error('Invalid block, content does not point to proof');
    }

    // validate content, will throw if invalid
    this._value.proof.isValid(blsSignatures);

    // validate proof, will throw if invalid
    this._value.content.isValid();

    // genesis block

    // blocks on the genesis level

    // if the first genesis block
    if (areArraysEqual(this._value.proof.value.previousProofHash, new Uint8Array(32))) {

      // previous block hash should null
      if (!areArraysEqual(this._value.previousBlockHash, new Uint8Array(32))) {
        throw new Error('Invalid block, first genesis block must have a null previous block hash');
      }
    }

    if (!this.value.coinbase) {
      throw new Error('Invalid block, must have a coinbase tx');
    }

    // validate coinbase, will throw if invalid
    this.value.coinbase.isValid(blsSignatures);

    // validate the coinbase tx has same public key as proof
    if (!areArraysEqual(this.value.coinbase.value.receiver, this._value.proof.value.publicKey)) {
      throw new Error('Invalid block, coinbase tx receiver must be creator of the proof');
    }

    // ensure coinbase tx is the first tx in content tx set
    if (!areArraysEqual(this.value.coinbase.key, this.value.content.value.payload[0])) {
      throw new Error('Invalid block, coinbase tx must be first in content payload');
    }

    return true;
  }

  /**
   * Sets the block id as the content addressed hash of its value.
   */
  private setKey(): Uint8Array {
    return crypto.hash(this.toBytes());
  }
}
