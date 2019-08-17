// tslint:disable: no-console
import * as crypto from './crypto';

console.log(Buffer.from(crypto.hash(Buffer.from('hello subspace'))).toString('hex'));

const treeData = [
  Buffer.from('acadda60a86d56e836b3df33c0bd3205d7e0f0ffb12733b44866917582286cde', 'hex'),
  Buffer.from('7f5f00f1199c45329d4e101bb8160f5c2d47998e87ec2520f7a8146250375a3d', 'hex'),
];

const {root, proofs} = crypto.buildMerkleTree(treeData);
console.log(Buffer.from(root).toString('hex'));

for (const proof of proofs) {
  console.log(Buffer.from(proof).toString('hex'));
}

console.log(crypto.jumpHash(crypto.hash(Buffer.from('hello subspace')), 1024));

console.log(crypto.generateBLSKeys());
