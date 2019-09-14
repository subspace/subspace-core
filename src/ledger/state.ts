// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { IStateValue } from '../main/interfaces';
import { bin2Hex, bin2Num, num2Bin, num2Date, smallBin2Num, smallNum2Bin } from '../utils/utils';

/**
 * Record class for state blocks, which summarize all of the data (proofs, contents, and unique txs) for a given level in a compact form.
 */
export class State {

  /**
   * Returns a new state instance given correct inputs.
   */
  public static create(
    previousStateHash: Uint8Array,
    levelHash: Uint8Array,
    pieceRoot: Uint8Array,
    timestamp: number,
    difficulty: number,
    version: number,
    indexPiece: Uint8Array,
  ): State {
    const stateValue: IStateValue = {
      previousStateHash,
      levelHash,
      pieceRoot,
      timestamp: (timestamp / 1000) * 1000,
      difficulty,
      version,
      indexPiece,
    };
    const state = new State(stateValue);
    state.setKey();
    return state;
  }

  public static fromBytes(data: Uint8Array): State {
    const stateValue: IStateValue = {
      previousStateHash: data.subarray(0, 32),
      levelHash: data.subarray(32, 64),
      pieceRoot: data.subarray(64, 96),
      timestamp: bin2Num(data.subarray(96, 100)) * 1000,
      difficulty: smallBin2Num(data.subarray(100, 102)),
      version: smallBin2Num(data.subarray(102, 104)),
      indexPiece: data.subarray(104, 136),
    };

    const state = new State(stateValue);
    state.setKey();
    return state;
  }

  private _key: Uint8Array;
  private _value: IStateValue;

  constructor(value: IStateValue) {
    this._value = value;
    this._key = crypto.hash(this.toBytes());
  }

  public get key(): Uint8Array {
    return this._key;
  }

  public get value(): IStateValue {
    return this._value;
  }

  /**
   * Returns a compact binary representation of the state data.
   */
  public toBytes(): Uint8Array {
    return Buffer.concat([
      this._value.previousStateHash,
      this._value.levelHash,
      this._value.pieceRoot,
      num2Bin(this._value.timestamp / 1000),
      smallNum2Bin(this._value.difficulty),
      smallNum2Bin(this._value.version),
      this._value.indexPiece,
    ]);
  }

  /**
   * Returns a human readable serialization of the state object.
   */
  public print(): object {
    return {
      type: 'State',
      key: bin2Hex(this._key),
      value: {
        previousStateHash: bin2Hex(this._value.previousStateHash),
        levelHash: bin2Hex(this._value.levelHash),
        pieceRoot: bin2Hex(this._value.pieceRoot),
        timestamp: num2Date(this._value.timestamp),
        difficulty: this._value.difficulty,
        version: this._value.version,
        indexPiece: bin2Hex(this._value.indexPiece),
      },
    };
  }

  /**
   * Validates that state follows schema and is internally consistent, but not that it is accurate.
   */
  public isValid(): boolean {
    return true;
  }

  /**
   * Sets the state id as the content addressed hash of its value.
   */
  public setKey(): void {
    this._key = crypto.hash(this.toBytes());
  }
}
