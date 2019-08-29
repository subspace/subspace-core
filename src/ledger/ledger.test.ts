import * as crypto from '../crypto/crypto';
import { Block } from './block';
import { Ledger } from './ledger';

test('create-genesis-block', () => {
  const previousProofHash =  crypto.randomBytes(32);
  const parentContentHash = crypto.randomBytes(32);
  const genesisBlock = Block.createGenesisBlock(previousProofHash, parentContentHash);
  expect(genesisBlock.isValid).toBe(true);
});

test('create-genesis-level-1', async () => {
  const ledger = await Ledger.init('rocks');
  const pieceSet = await ledger.createGenesisLevel(1);
});

test('create-genesis-level-16', async () => {
  const ledger = await Ledger.init('rocks');
  const pieceSet = await ledger.createGenesisLevel(16);
});

test('create-genesis-level-256', async () => {
  const ledger = await Ledger.init('rocks');
  const pieceSet = await ledger.createGenesisLevel(256);
});

test('create-genesis-level-1024', async () => {
  const ledger = await Ledger.init('rocks');
  const pieceSet = await ledger.createGenesisLevel(1024);
});

test('create-block', () => {
  return;
});

test('create-level', async () => {
  const ledger = await Ledger.init('rocks');
  const pieceSet = await ledger.createGenesisLevel(16);
});
