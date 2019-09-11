import createBlsSignaturesModule = require('@subspace/bls-signatures');
import * as crypto from 'crypto';
import {IKeyPair} from "../main/interfaces";
import {hash} from "./crypto";

type ModuleInstance = ReturnType<typeof createBlsSignaturesModule>;

export class BlsSignatures {
  public static async init(): Promise<BlsSignatures> {
    const blsSignatures = createBlsSignaturesModule();
    await new Promise((resolve) => {
      blsSignatures.then(() => {
        resolve();
      });
    });

    return new BlsSignatures(blsSignatures);
  }

  private constructor(private readonly blsSignatures: ModuleInstance) {
  }

  /**
   * Returns a BLS-381 public/private key pair from a binary seed.
   */
  public generateBLSKeys(seed?: Uint8Array): IKeyPair {
    if (!seed) {
      seed = crypto.randomBytes(32);
    }
    const privateKey = this.blsSignatures.PrivateKey.fromSeed(seed);
    const publicKey = privateKey.getPublicKey();
    const binaryPrivateKey = privateKey.serialize();
    const binaryPublicKey = publicKey.serialize();
    privateKey.delete();
    publicKey.delete();
    return {binaryPrivateKey, binaryPublicKey};
  }

  /**
   * Signs the hash of a binary message given a BLS private key.
   */
  public signMessage(binaryMessage: Uint8Array, binaryPrivateKey: Uint8Array): Uint8Array {
    const messageHash = hash(binaryMessage);
    const privateKey = this.blsSignatures.PrivateKey.fromBytes(binaryPrivateKey, false);
    const signature = privateKey.sign(messageHash);
    const binarySignature = signature.serialize();
    signature.delete();
    privateKey.delete();
    return binarySignature;
  }

  /**
   * Verifies a BLS signature given a binary message and BLS public key.
   */
  public verifySignature(binaryMessage: Uint8Array, binarySignature: Uint8Array, binaryPublicKey: Uint8Array): boolean {
    const signature = this.blsSignatures.Signature.fromBytes(binarySignature);
    const publicKey = this.blsSignatures.PublicKey.fromBytes(binaryPublicKey);
    const messageHash = hash(binaryMessage);
    const aggregationInfo = this.blsSignatures.AggregationInfo.fromMsg(publicKey, messageHash);
    signature.setAggregationInfo(aggregationInfo);
    const isValid = signature.verify();
    signature.delete();
    publicKey.delete();
    aggregationInfo.delete();
    return isValid;
  }
}
