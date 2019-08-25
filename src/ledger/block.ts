// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { IBlockData, ICompactBlockData, IFullBlockValue } from '../main/interfaces';
import { Content } from './content';
import { Proof } from './proof';
import { Tx } from './tx';

export class Block {

  public static createGenesisBlock(previousProofHash: Uint8Array, parentContentHash: Uint8Array): Block {
    const genesisProof = Proof.createGenesisProof(previousProofHash);
    const genesisContent = Content.createGenesisContent(parentContentHash);
    const genesisBlockValue: IFullBlockValue = {
      proof: genesisProof,
      content: genesisContent,
    };
    return new Block(genesisBlockValue);
  }

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

  public static load(blockData: IBlockData): Block {
    const proof = Proof.load(blockData[0]);
    const content = Content.load(blockData[1]);
    const fullBlockValue: IFullBlockValue = { proof, content };
    return new Block(fullBlockValue);
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

  // convert to bytes for encoding as part of a level
  public toBytes(): Uint8Array {
    return Buffer.concat([
      this._value.proof.toBytes(),
      this._value.content.toBytes(),
    ]);
  }

  public toData(): IBlockData {
    return [
      this._value.proof.toData(),
      this._value.content.toData(),
      this._value.coinbase ? this._value.coinbase.toData() : undefined,
    ];
  }

  public toCompactData(): ICompactBlockData {
    return [
      this._value.proof.key,
      this._value.content.key,
    ];
  }

  public isValid(): boolean {
    return true;
  }

  private setKey(): Uint8Array {
    return crypto.hash(this.toBytes());
  }
}
