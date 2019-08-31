/*
import * as crypto from '../crypto/crypto';
import { IPieceData } from 'main/interfaces';

export class Level {
  public static createGenesisLevel(): Level {
    return new Level();
  }

  public static create(): Level {
    return new Level();
  }

  public static fromPieces(pieces: IPieceData[]): Level {
    return new Level();
  }

  private _key: Uint8Array;
  private _value: Uint8Array;

  constructor(value: ILevelValue) {
    this._value = value;
    this._key = this.setKey();
  }

  get key(): Uint8Array {
    return this._key;
  }

  get value(): Uint8Array {
    return this._value;
  }

  public toBytes(): Uint8Array {
    return;
  }

  public setKey(): Uint8Array {
    return crypto.hash(this.toBytes());
  }

  public pad(): void {
    return;
  }

  public slice(): void {
    return;
  }

  public erasure_code(): void {
    return;
  }

  public encode(): void {
    return;
  }
}
*/
