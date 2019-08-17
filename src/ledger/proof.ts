// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { IProofData, IProofValue } from '../main/interfaces';
import { bin2Hex, num2Bin, num2Date } from '../utils/utils';

/**
 * Record class for canonical proofs of storage used to create new blocks for the ledger.
 */
export class Proof {

  /**
   * Returns a new proof given correct inputs.
   */
  public static create(
    previousLevelHash: Uint8Array,
    previousProofHash: Uint8Array,
    solution: Uint8Array,
    pieceHash: Uint8Array,
    pieceLevel: number,
    pieceProof: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Proof {
    const proofValue: IProofValue = {
      previousLevelHash,
      previousProofHash,
      solution,
      pieceHash,
      pieceLevel,
      pieceProof,
      publicKey,
      signature: new Uint8Array(),
    };
    const proof = new Proof(proofValue);
    if (proof._value.publicKey.length > 0) {
      proof.sign(privateKey);
    }
    proof.setKey();
    return proof;
  }

  /**
   * Creates an empty proof for a new chain as part of the genesis level.
   */
  public static createGenesisProof(previousProofHash: Uint8Array = new Uint8Array()): Proof {
    const nullArray = new Uint8Array();
    return Proof.create(nullArray, previousProofHash, nullArray, nullArray, 0, nullArray, nullArray, nullArray);
  }

  /**
   * Returns a proof instance from existing data.
   */
  public static load(proofData: IProofData): Proof {
    const proofValue: IProofValue = {
      previousLevelHash: proofData[0],
      previousProofHash: proofData[1],
      solution: proofData[2],
      pieceHash: proofData[3],
      pieceLevel: proofData[4],
      pieceProof: proofData[5],
      publicKey: proofData[6],
      signature: proofData[7],
    };
    const proof = new Proof(proofValue);
    proof.setKey();
    return proof;
  }

  private _key: Uint8Array;
  private _value: IProofValue;

  constructor(value: IProofValue) {
    this._value = value;
    this._key = crypto.hash(this.toBytes());
  }

  public get key(): Uint8Array {
    return this._key;
  }

  public get value(): IProofValue {
    return this._value;
  }

  /**
   * Returns a compact binary representation of the proof data.
   */
  public toBytes(signed = true): Uint8Array {
    const asBytes: Uint8Array = Buffer.concat([
      this._value.previousLevelHash,
      this._value.previousProofHash,
      this._value.solution,
      this._value.pieceHash,
      num2Bin(this._value.pieceLevel),
      this._value.pieceProof,
      this._value.publicKey,
      signed ? this._value.signature : new Uint8Array(),
    ]);
    return asBytes;
  }

  /**
   * Returns a compact serialized representation of the proof data.
   */
  public toData(): IProofData {
    return [
      this._value.previousLevelHash,
      this._value.previousProofHash,
      this._value.solution,
      this._value.pieceHash,
      this._value.pieceLevel,
      this._value.pieceProof,
      this._value.publicKey,
      this._value.signature,
    ];
  }

  /**
   * Returns a human readable serialization of the proof object.
   */
  public print(): object {
    return {
      type: 'Proof',
      key: bin2Hex(this._key),
      value: {
        previousLevelHash: bin2Hex(this._value.previousLevelHash),
        previousProofHash: bin2Hex(this._value.previousProofHash),
        solution: bin2Hex(this._value.solution),
        pieceHash: bin2Hex(this._value.solution),
        pieceLevel: this._value.pieceLevel,
        pieceProof: bin2Hex(this._value.pieceProof),
        publicKey: bin2Hex(this._value.publicKey),
        signature: bin2Hex(this._value.signature),
      },
    };
  }

  /**
   * Validates that proof follows schema and is internally consistent, but not the proof is correct.
   */
  public isValid(): boolean {

    // is signature valid for message and public key
    if (this._value.signature.length > 0) {
      if (!crypto.verifySignature(this.toBytes(false), this._value.signature, this._value.publicKey)) {
        throw new Error('Invalid proof, invalid signature for message and public key');
      }
    }

    return true;
  }

  /**
   * Sets the proof id as the content addressed hash of its value.
   */
  public setKey(): void {
    this._key = crypto.hash(this.toBytes());
  }

  /**
   * Appends a detached BLS signature to a newly created proof.
   */
  public sign(privateKey: Uint8Array): void {
    this._value.signature = crypto.signMessage(this.toBytes(false), privateKey);
  }
}
