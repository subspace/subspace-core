
// tslint:disable: no-console

if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import { BlsSignatures } from '../crypto/BlsSignatures';
import * as crypto from '../crypto/crypto';
import { CHUNK_LENGTH, HASH_LENGTH } from '../main/constants';
import { Storage } from '../storage/storage';
import { areArraysEqual } from '../utils/utils';
import { Wallet } from '../wallet/wallet';
import { Block } from './block';
import { Proof } from './proof';

const test = async () => {
  const blsSignatures = await BlsSignatures.init();
  const storage = new Storage('memory', '/', 'block-tests');
  const ledgerWallet = new Wallet(blsSignatures, storage);
  const receiverAccount = await ledgerWallet.createAccount('block-test-receiver', 'a receiver account for block tests');

  const encoding = new Uint8Array(4096);

  // create the proof
  const previousLevelHash = crypto.randomBytes(HASH_LENGTH);
  const previousProofHash = crypto.randomBytes(HASH_LENGTH);
  const solution = crypto.randomBytes(CHUNK_LENGTH);
  const pieceHash = crypto.randomBytes(HASH_LENGTH);
  const pieceStateHash = crypto.randomBytes(HASH_LENGTH);
  const pieceProof = crypto.randomBytes(100);

  const unsignedProof = Proof.create(
    previousLevelHash,
    previousProofHash,
    solution,
    pieceHash,
    pieceStateHash,
    pieceProof,
    receiverAccount.publicKey,
  );

  const signedProof = ledgerWallet.signProof(unsignedProof);
  const parentContentHash = crypto.randomBytes(HASH_LENGTH);

  // create coinbase tx and add to tx set
  const reward = 1;
  const coinbaseTx = await ledgerWallet.createCoinBaseTx(reward, receiverAccount.publicKey);
  const previousBlockHash = crypto.randomBytes(32);
  const block = Block.create(previousBlockHash, signedProof, parentContentHash, [coinbaseTx.key], coinbaseTx);

  const blockData = block.toFullBytes();
  const payload = Buffer.concat([encoding, blockData]);

  // const encoding1 = payload.subarray(0, 4096);
  const blockData1 = payload.subarray(4096);

  const block1 = Block.fromFullBytes(new Uint8Array(blockData1));
  console.log(block1.key);
  if (areArraysEqual(blockData, blockData1)) {
    console.log('Decoded correctly');
  } else {
    console.log('Incorrect decoding');
  }
};

test();
