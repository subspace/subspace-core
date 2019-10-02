// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { IProofValue } from '../main/interfaces';
import { areArraysEqual, bin2Hex } from '../utils/utils';

// ToDo
  // Make merkle proofs constant sized

/**
 * Record class for canonical proofs of storage used to create new blocks for the ledger.
 */
export class Proof {

  /**
   * Returns a new unsigned proof given correct inputs.
   * Proof must be passed to wallet for signing before being valid.
   */
  public static create(
    // previousLevelHash: Uint8Array,
    previousProofHash: Uint8Array,
    solution: Uint8Array,
    pieceHash: Uint8Array,
    pieceStateHash: Uint8Array,
    pieceProof: Uint8Array,
    publicKey: Uint8Array,
  ): Proof {
    const proofValue: IProofValue = {
      // previousLevelHash,
      previousProofHash,
      solution,
      pieceHash,
      pieceStateHash,
      publicKey,
      signature: new Uint8Array(96),
      pieceProof,
    };
    const proof = new Proof(proofValue);
    return proof;
  }

  /**
   * Loads a new proof from binary data received over the network
   *
   * @param data a 280+ byte Uint8Array
   *
   */
  public static fromBytes(data: Uint8Array): Proof {

    // all proofs are at least 280 bytes
    if (data.length < 280) {
      throw new Error('Cannot load proof from bytes, data is less than 280 bytes long');
    }

    const proofValue: IProofValue = {
      // previousLevelHash: data.subarray(0, 32),
      previousProofHash: data.subarray(0, 32),
      solution: data.subarray(32, 40),
      pieceHash: data.subarray(40, 72),
      pieceStateHash: data.subarray(72, 104),
      publicKey: data.subarray(104, 152),
      signature: data.subarray(152, 248),
      pieceProof: data.subarray(248),
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
    return Buffer.concat([
      // this._value.previousLevelHash,
      this._value.previousProofHash,
      this._value.solution,
      this._value.pieceHash,
      this._value.pieceStateHash,
      this._value.publicKey,
      signed ? this._value.signature : new Uint8Array(),
      this._value.pieceProof,
    ]);
  }

  /**
   * Returns a human readable serialization of the proof object.
   */
  public print(): object {
    return {
      type: 'Proof',
      key: bin2Hex(this._key),
      value: {
        // previousLevelHash: bin2Hex(this._value.previousLevelHash),
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
  public isValid(blsSignatures: BlsSignatures): boolean {

    // validate genesis proof
    // if (areArraysEqual(this._value.previousLevelHash, new Uint8Array(32))) {
    //   // ensure fields are null
    //   if (!areArraysEqual(this._value.solution, new Uint8Array(8)) ||
    //       !areArraysEqual(this._value.pieceHash, new Uint8Array(832) ||
    //       !areArraysEqual(this._value.pieceStateHash, new Uint8Array(32)) ||
    //       // !areArraysEqual(this._value.pieceProof, new Uint8Array(32)) ||
    //       !areArraysEqual(this._value.publicKey, new Uint8Array(48)) ||
    //       !areArraysEqual(this._value.signature, new Uint8Array(96)))) {
    //     throw new Error('Invalid genesis proof, includes values for null properties');
    //   }

    //   return true;
    // }

    // genesis proof
    // if (areArraysEqual(this.value.previousProofHash, new Uint8Array(32))) {
    //   if (!areArraysEqual(this.value.previousLevelHash, new Uint8Array(32))) {
    //     throw new Error('Invalid genesis proof, both previous proof hash and previous level hash must be null');
    //   }
    // }

    // // previous level hash is 32 bytes
    // if (this._value.previousLevelHash.length !== 32) {
    //   throw new Error('Invalid proof, invalid length for previous level hash');
    // }

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
    if (!areArraysEqual(this._value.signature, new Uint8Array(96))) {
      if (!blsSignatures.verifySignature(this.toBytes(false), this._value.signature, this._value.publicKey)) {
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
  public sign(privateKey: Uint8Array, blsSignatures: BlsSignatures): void {
    this._value.signature = blsSignatures.signMessage(this.toBytes(false), privateKey);
  }
}
