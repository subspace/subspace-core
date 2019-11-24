import supercop = require('supercop.wasm');
import {IKeyPair} from "../main/interfaces";

export class Ed25519Signatures {
  public static async init(): Promise<Ed25519Signatures> {
    await new Promise((resolve) => {
      supercop.ready(() => {
        resolve();
      });
    });

    return new Ed25519Signatures();
  }

  private constructor() {
  }

  public generateKeypair(seed?: Uint8Array): IKeyPair {
    if (!seed) {
      seed = supercop.createSeed();
    }
    const {publicKey, secretKey} = supercop.createKeyPair(seed);
    return {
      binaryPrivateKey: secretKey,
      binaryPublicKey: publicKey,
    };
  }

  public sign(message: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array {
    return supercop.sign(message, publicKey, privateKey);
  }

  public verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    return supercop.verify(signature, message, publicKey);
  }
}
