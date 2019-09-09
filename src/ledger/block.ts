// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { NULL_32_BYTE_ARRAY } from '../main/constants';
import { IBlockData, ICompactBlockData, ICompactBlockValue, IFullBlockValue } from '../main/interfaces';
import { bin2Hex, smallBin2Num, smallNum2Bin } from '../utils/utils';
import { Content } from './content';
import { Proof } from './proof';
import { Tx } from './tx';

/**
 * Record class for a logical block that contains the proof, content header, and coinbase tx.
 */
export class Block {

  /**
   * Creates an empty block record for a new chain as part of the genesis level.
   */
  public static createGenesisBlock(previousProofHash: Uint8Array, parentContentHash: Uint8Array): Block {
    const genesisProof = Proof.createGenesisProof(previousProofHash);
    const genesisContent = Content.createGenesisContent(parentContentHash, genesisProof.key);
    const genesisBlockValue: IFullBlockValue = {
      proof: genesisProof,
      content: genesisContent,
    };
    return new Block(genesisBlockValue);
  }

  /**
   * Returns a new block record given correct inputs.
   */
  public static create(
    proof: Proof,
    parentContentHash: Uint8Array,
    txIds: Uint8Array[],
    coinbase: Tx,
  ): Block {
    const content = Content.create(parentContentHash, proof.key, txIds);
    const fullBlockValue: IFullBlockValue = {
      proof,
      content,
      coinbase,
    };
    return new Block(fullBlockValue);
  }

  /**
   * Returns a record instance from existing data.
   */
  public static load(blockData: IBlockData): Block {
    const proof = Proof.load(blockData[0]);
    const content = Content.load(blockData[1]);
    const fullBlockValue: IFullBlockValue = { proof, content };
    return new Block(fullBlockValue);
  }

  public static fromFullBytes(data: Uint8Array): Block {

    const proofLength = smallBin2Num(data.subarray(0, 2));
    const proof = Proof.fromBytes(data.subarray(2, proofLength + 2));
    const contentLength = smallBin2Num(data.subarray(2 + proofLength, 2 + proofLength + 2));
    const content = Content.fromBytes(data.subarray(2 + proofLength + 2, 2 + proofLength + 2 + contentLength));

    if (data.length > 2 + proofLength + 2 + contentLength) {
      const coinbase = Tx.fromBytes(data.subarray(2 + proofLength + 2 + contentLength, 2 + proofLength + 2 + contentLength + 204));
      const fullBlockValue: IFullBlockValue = { proof, content, coinbase };
      const block = new Block(fullBlockValue);
      block.setKey();
      return block;
    }

    const fullBlockValue: IFullBlockValue = { proof, content };
    const block = new Block(fullBlockValue);
    block.setKey();
    return block;
  }

  public static fromCompactBytes(data: Uint8Array): ICompactBlockValue {
    const compactBlockValue: ICompactBlockValue = {
      proofHash: data.subarray(0, 32),
      contentHash: data.subarray(32, 64),
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
    return Uint8Array.from(Buffer.concat([
      this._value.proof.toBytes(),
      this._value.content.toBytes(),
    ]));
  }

  public toFullBytes(): Uint8Array {
    const proofData = this._value.proof.toBytes();
    const proofLength = smallNum2Bin(proofData.length);
    const contentData = this._value.content.toBytes();
    const contentLength = smallNum2Bin(contentData.length);
    const coinbaseData = this._value.coinbase ? this._value.coinbase.toBytes() : new Uint8Array();
    return Uint8Array.from(Buffer.concat([
      proofLength,
      proofData,
      contentLength,
      contentData,
      coinbaseData,
    ]));
  }

  public toCompactBytes(): Uint8Array {
    return Uint8Array.from(Buffer.concat([
      this._value.proof.key,
      this._value.content.key,
      this._value.coinbase ? this._value.coinbase.key : new Uint8Array(),
    ]));
  }

  /**
   * Returns a compact serialized representation of the block data.
   */
  public toData(): IBlockData {
    return [
      this._value.proof.toData(),
      this._value.content.toData(),
      this._value.coinbase ? this._value.coinbase.toData() : undefined,
    ];
  }

  /**
   * Returns a tiny pointer to the proof and content for storage within in-memory chain objects.
   */
  public toCompactData(): ICompactBlockData {
    return [
      this._value.proof.key,
      this._value.content.key,
    ];
  }

  /**
   * Returns a human readable serialization of the block object.
   */
  public print(): object {
    return {
      type: 'Block',
      key: bin2Hex(this._key),
      value: {
        proof: this.value.proof.print(),
        content: this.value.content.print(),
        coinbase: this.value.coinbase ? this.value.coinbase.print() : undefined,
      },
    };
  }

  /**
   * Validates that block follows schema and is internally consistent, but not that block is correct.
   */
  public isValid(): boolean {

    if (this._value.proof.key.toString() !== this._value.content.value.proofHash.toString()) {
      throw new Error('Invalid block, content does not point to proof');
    }

    // validate content, will throw if invalid
    this._value.proof.isValid();

    // validate proof, will throw if invalid
    this._value.content.isValid();

    // if genesis block
    if (this._value.proof.value.previousLevelHash.toString() === NULL_32_BYTE_ARRAY) {

      // content record must be genesis type
      if (this._value.content.value.proofHash.length === 0) {
        throw new Error('Invalid genesis block, must have a genesis content record');
      }

      // coinbase should be missing
      if (this._value.coinbase) {
        throw new Error('Invalid genesis block, cannot have a coinbase transaction');
      }

      return true;
    }

    // else if normal block

    if (!this.value.coinbase) {
      throw new Error('Invalid block, must have a coinbase tx');
    }

    // validate coinbase, will throw if invalid
    this.value.coinbase.isValid();

    // validate the coinbase tx has same public key as proof
    if (this.value.coinbase.value.receiver.toString() !== this._value.proof.value.publicKey.toString()) {
      throw new Error('Invalid block, coinbase tx receiver must be creator of the proof');
    }

    // ensure coinbase tx is the first tx in content tx set
    if (this.value.coinbase.key.toString() !== this._value.content.value.payload[0].toString()) {
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
