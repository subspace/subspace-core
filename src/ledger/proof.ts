// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { IProofData, IProofValue } from '../main/interfaces';
import { bin2Hex } from '../utils/utils';

/**
 * Record class for canonical proofs of storage used to create new blocks for the ledger.
 */
export class Proof {

  /**
   * Returns a new unsigned proof given correct inputs.
   * Proof must be passed to wallet for signing before being valid.
   */
  public static create(
    previousLevelHash: Uint8Array,
    previousProofHash: Uint8Array,
    solution: Uint8Array,
    pieceHash: Uint8Array,
    pieceStateHash: Uint8Array,
    pieceProof: Uint8Array,
    publicKey: Uint8Array,
  ): Proof {
    const proofValue: IProofValue = {
      previousLevelHash,
      previousProofHash,
      solution,
      pieceHash,
      pieceStateHash,
      pieceProof,
      publicKey,
      signature: new Uint8Array(),
    };
    const proof = new Proof(proofValue);
    return proof;
  }

  /**
   * Creates an empty proof for a new chain as part of the genesis level.
   * Does not need to be signed.
   */
  public static createGenesisProof(previousProofHash: Uint8Array = new Uint8Array()): Proof {
    const nullArray = new Uint8Array();
    const proof = Proof.create(nullArray, previousProofHash, nullArray, nullArray, nullArray, nullArray, nullArray);
    proof.setKey();
    return proof;
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
      pieceStateHash: proofData[4],
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
    const asBytes: Uint8Array = Uint8Array.from(Buffer.concat([
      this._value.previousLevelHash,
      this._value.previousProofHash,
      this._value.solution,
      this._value.pieceHash,
      this._value.pieceStateHash,
      this._value.pieceProof,
      this._value.publicKey,
      signed ? this._value.signature : new Uint8Array(),
    ]));
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
      this._value.pieceStateHash,
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
        pieceHash: bin2Hex(this._value.pieceHash),
        pieceStateHash: bin2Hex(this._value.pieceStateHash),
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

    // validate genesis proof
    if (this._value.previousLevelHash.length === 0) {

      // ensure fields are null
      if (this._value.solution.length > 0 ||
        this._value.pieceHash.length > 0 ||
        this._value.pieceStateHash.length > 0 ||
        this._value.pieceProof.length > 0 ||
        this._value.publicKey.length > 0 ||
        this._value.signature.length > 0) {
          throw new Error('Invalid genesis proof, includes values for empty properties');
        }

      // previous proof must be null or 32 byte hash
      if (this._value.previousProofHash.length !== 0 && this._value.previousProofHash.length !== 32) {
        throw new Error('Invalid genesis proof, must reference null or past proof');
      }
      return true;
    }

    // previous level hash is 32 bytes
    if (this._value.previousLevelHash.length !== 32) {
      throw new Error('Invalid proof, invalid length for previous level hash');
    }

    // previous proof hash is 32 bytes
    if (this._value.previousProofHash.length !== 32) {
      throw new Error('Invalid proof, invalid length for previous proof hash');
    }

    // solution is 8 bytes
    if (this._value.solution.length !== 8) {
      throw new Error('Invalid proof, invalid length for solution');
    }

    // piece hash is 32 bytes
    if (this._value.pieceHash.length !== 32) {
      throw new Error('Invalid proof, invalid length for piece hash');
    }

    // piece level is 4 bytes
    if (this._value.pieceStateHash.length !== 32) {
      throw new Error('Invalid proof, invalid length for piece level');
    }

    // // piece proof is greater than 0 bytes
    // if (this._value.pieceProof.length < 32) {
    //   // tslint:disable-next-line: no-console
    //   console.log(this.print());
    //   throw new Error('Invalid proof, invalid length for piece proof');
    // }

    // public key is 48 bytes
    if (this._value.publicKey.length !== 48) {
      throw new Error('Invalid proof, invalid length for public key');
    }

    // signature is 96 bytes
    if (this._value.signature.length !== 96) {
      throw new Error('Invalid proof, invalid length for signature');
    }

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
