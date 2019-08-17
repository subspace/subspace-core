import { Content } from './content';
import { Proof } from './proof';
import { Tx } from './tx';

// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { IBlockData, IContentData, IContentValue, IProofData, IProofValue } from '../main/interfaces';
import { bin2Hex } from '../utils/utils';

interface IBlockValue {
  proof: Proof;
  content: Content;
  txs: Tx[];
}

// generate a full genesis block instead of proof and content separately
// generate a single full block with proof, content, and tx on solve
// send full blocks back and forth via RPC
// eventually handle compact blocks
// generate a skeleton block for tracking pending blocks

// meta block -> for internal pointers (chain and pending blocks)
  // proof id
  // content id
  // chain assigned to
  // level for that chain
// compact block -> for efficient transmission over the network
// full block -> for convenience and inefficient transmission over the network

export class Block {

  public static createGenesisBlock(previousProofHash: Uint8Array, parentContentHash: Uint8Array): Block {
    const genesisProof = Proof.createGenesisProof(previousProofHash);
    const genesisContent = Content.createGenesisContent(parentContentHash);
    const genesisBlockValue: IBlockValue = {
      proof: genesisProof,
      content: genesisContent,
      txs: [],
    };
    return new Block(genesisBlockValue);
  }

  // public static create(proof: Proof, parentContentHash: Uint8Array, tx: Tx[]): void {
  //   return;
  // }

  // public static load(blockData: IBlockData): Block {
  //   const blockValue: IBlockValue = {
  //     proof: Proof
  //   };
  //   const content = new Content(contentValue);
  //   content.setKey();
  //   return content;
  // }

  private _key: Uint8Array;
  private _value: IBlockValue;

  constructor(value: IBlockValue) {
    this._value = value;
    this._key = this.setKey();
  }

  get key(): Uint8Array {
    return this._key;
  }

  get value(): IBlockValue {
    return this._value;
  }

  public toBytes(): Uint8Array {
    return Buffer.concat([
      this._value.proof.toBytes(),
      this._value.content.toBytes(),
      ...this._value.txs.map((tx) => tx.toBytes()),
    ]);
  }

  private setKey(): Uint8Array {
    return crypto.hash(this.toBytes());
  }
}
