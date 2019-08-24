// tslint:disable: no-console
import * as crypto from '../crypto/crypto';
import { Content } from './content';
import { Proof } from './proof';
import { State } from './state';
import { Tx } from './tx';

const { binaryPrivateKey, binaryPublicKey } = crypto.generateBLSKeys();
const cbTx = Tx.createCoinbase(binaryPublicKey, 1, 1, binaryPrivateKey);
cbTx.isValid();
console.log(cbTx.print());

const receiver = crypto.randomBytes(48);

// tx tests
const tx = Tx.create(binaryPublicKey, receiver, 1, 1, binaryPrivateKey);
tx.isValid();
console.log(tx.print());
console.log(tx.toBytes());
const data = tx.toData();
const fromTx = Tx.load(data);
fromTx.isValid();

// proof tests
const previousProofHash = crypto.randomBytes(32);
const genProof = Proof.createGenesisProof(previousProofHash);
genProof.isValid();
console.log(genProof.print());
genProof.toBytes();
const proofData = genProof.toData();
const fromProof = Proof.load(proofData);
fromProof.isValid();

// content tests
const parentContentHash = crypto.randomBytes(32);
const content = Content.createGenesisContent(parentContentHash);
content.isValid();
console.log(content.print());
const contentData = content.toData();
const fromContent = Content.load(contentData);
console.log(content.print());
fromContent.toData();

// block tests ...

// state tests
const previousStateHash = crypto.randomBytes(32);
const indexPiece = crypto.randomBytes(32);
const state = State.create(previousStateHash, parentContentHash, previousProofHash, 64, 1, indexPiece);
state.isValid();
console.log(state.print());
const stateData = state.toData();
const fromState = State.load(stateData);
console.log(state.print());
fromState.toData();

// create genesis level

// encode level
