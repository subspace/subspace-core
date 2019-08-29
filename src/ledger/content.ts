// tslint:disable: object-literal-sort-keys
// tslint:disable: variable-name

import * as crypto from '../crypto/crypto';
import { IContentData, IContentValue } from '../main/interfaces';
import { bin2Hex } from '../utils/utils';

export class Content {

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

  public static createGenesisContent(parentContentHash: Uint8Array, proofHash: Uint8Array): Content {
    return Content.create(parentContentHash, proofHash, []);
  }

  public static load(contentData: IContentData): Content {
    const contentValue: IContentValue = {
      parentContentHash: contentData[0],
      proofHash: contentData[1],
      payload: contentData[2],
    };
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

  public toBytes(): Uint8Array {
    return Uint8Array.from(Buffer.concat([
      this._value.parentContentHash,
      this._value.proofHash,
      ...this._value.payload,
    ]));
  }

  public toData(): IContentData {
    return [
      this._value.parentContentHash,
      this._value.proofHash,
      this._value.payload,
    ];
  }

  public print(): object {
    return {
      type: 'Content',
      key: bin2Hex(this._key),
      value: {
        parentContentHash: bin2Hex(this._value.parentContentHash),
        proofHash: bin2Hex(this._value.proofHash),
        payload: this._value.payload.forEach((txId) => bin2Hex(txId)),
      },
    };
  }

  public isValid(): boolean {
    return true;
  }

  public setKey(): void {
    this._key = crypto.hash(this.toBytes());
  }
}
