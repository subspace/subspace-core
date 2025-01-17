// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { HASH_LENGTH } from '../main/constants';
import { IContentValue } from '../main/interfaces';
import { bin2Hex } from '../utils/utils';

/**
 * Record class for malleable block contents for the ledger.
 */
export class Content {

  /**
   * Returns a new content record given correct inputs.
   */
  public static create(
    parentContentHash: Uint8Array,
    proofHash: Uint8Array,
    payload: Uint8Array[],
  ): Content {
    const contentValue: IContentValue = {
      parentContentHash,
      proofHash,
      payload,
    };
    const content = new Content(contentValue);
    content.setKey();
    return content;
  }

  /**
   * Creates an empty content record for a new chain as part of the genesis level.
   */
  // public static createGenesisContent(parentContentHash: Uint8Array, proofHash: Uint8Array): Content {
  //   return Content.create(parentContentHash, proofHash, []);
  // }

  /**
   * Loads a content instance from binary data received over the network.
   *
   * @param data A Uint8Array of multiple of 32 bytes
   *
   */
  public static fromBytes(data: Uint8Array): Content {

    // minimum length is two hashes
    if (data.length < 64) {
      throw new Error('Cannot load content from bytes, data is less than 64 bytes long');
    }

    // contents may only be hashes, so multiple of 32
    if (data.length % 32) {
      throw new Error('Cannot load content from bytes, content is not a multiple of 32 bytes');
    }

    const contentValue: IContentValue = {
      parentContentHash: data.subarray(0, 32),
      proofHash: data.subarray(32, 64),
      payload: [],
    };

    // parse out the tx ids
    const rounds = (data.length / HASH_LENGTH) - 2;
    for (let i = 0; i < rounds; ++i) {
      const txId = data.subarray(64 + (HASH_LENGTH * i), 64 + (HASH_LENGTH * (i + 1)));
      contentValue.payload.push(txId);
    }

    const content = new Content(contentValue);
    content.setKey();
    return content;
  }

  private _key: Uint8Array;
  private _value: IContentValue;

  constructor(value: IContentValue) {
    this._value = value;
    this._key = crypto.hash(this.toBytes());
  }

  public get key(): Uint8Array {
    return this._key;
  }

  public get value(): IContentValue {
    return this._value;
  }

  /**
   * Returns a compact binary representation of the content data.
   */
  public toBytes(): Uint8Array {
    return Buffer.concat([
      this._value.parentContentHash,
      this._value.proofHash,
      ...this._value.payload,
    ]);
  }

  /**
   * Returns a human readable serialization of the content object.
   */
  public print(): object {
    return {
      type: 'Content',
      key: bin2Hex(this._key),
      value: {
        parentContentHash: bin2Hex(this._value.parentContentHash),
        proofHash: bin2Hex(this._value.proofHash),
        payload: this._value.payload.map((txId) => bin2Hex(txId)),
      },
    };
  }

  /**
   * Validates that content follows schema and is internally consistent, but not that content is correct.
   */
  public isValid(): boolean {

    // // genesis content
    // if (areArraysEqual(this._value.parentContentHash, new Uint8Array(32))) {
    //   if (areArraysEqual(this._value.proofHash, new Uint8Array(32)) || this._value.payload.length > 0) {
    //     throw new Error('Invalid genesis content, should have proof hash and content should be empty');
    //   }
    //   return true;
    // }

    // normal content

    // parent content hash is 32 bytes
    if (this._value.parentContentHash.length !== 32) {
      throw new Error('Invalid content, parent content hash must be 32 bytes');
    }

    // parent proof hash is 32 bytes
    if (this._value.proofHash.length !== 32) {
      throw new Error('Invalid content, proof hash must be 32 bytes');
    }

    // all tx id in payload must be 32 bytes
    for (const txId of this._value.payload) {
      if (txId.length !== 32) {
        throw new Error('Invalid payload, tx id must be 32 bytes');
      }
    }

    return true;
  }

  /**
   * Sets the content id as the content addressed hash of its value.
   */
  public setKey(): void {
    this._key = crypto.hash(this.toBytes());
  }
}
