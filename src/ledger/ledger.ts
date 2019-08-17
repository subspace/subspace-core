// tslint:disable: max-classes-per-file
// tslint:disable: object-literal-sort-keys

import { EventEmitter } from 'events';
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import {IBlockData, IBlockValue, ICompactBlockData, ICompactBlockValue, IContentData, IPieceData, IProofData, IStateData, ITxData} from '../main/interfaces';
import { Storage } from '../storage/storage';
import { Account } from './accounts';
import { Block } from './block';
import { Chain } from './chain';
import { Content } from './content';
import { Proof } from './proof';
import { State } from './state';
import { Tx } from './tx';

// ToDo
  // simple implementation in memory
  // define other classes
    // block
    // level?

const DIFFICULTY = 64;
const VERSION = 1;

export class Ledger extends EventEmitter {

  public static async init(storageAdapter: string, chainCount: number): Promise<Ledger> {
    const ledger = new Ledger(storageAdapter, 'ledger', chainCount);
    return ledger;
  }

  // persistent state
  public readonly chainCount: number;
  public readonly lastConfirmedLevel = 0;
  public accounts: Account;
  public state: Map<Uint8Array, IStateData> = new Map();
  private lastStateBlockId: Uint8Array = new Uint8Array();
  private chains: Chain[] = [];
  private storage: Storage;

  // memory pool, cleared after each level is confirmed
  private compactBlockMap: Map<Uint8Array, ICompactBlockData> = new Map();
  private proofMap: Map<Uint8Array, IProofData> = new Map();
  private contentMap: Map<Uint8Array, IContentData> = new Map();
  private txMap: Map<Uint8Array, ITxData> = new Map();

  constructor(storageAdapter: string, path: string, chainCount: number) {
    super();
    this.storage = new Storage(storageAdapter, path);
    this.accounts = new Account();
    this.chainCount = chainCount;
    for (let i = 0; i < chainCount; ++i) {
      const chain = new Chain(i);
      this.chains.push(chain);
    }
  }

  public createGenesisLevel(): IPieceData[] {
    let previousProofHash = new Uint8Array();
    const parentContentHash = new Uint8Array();
    const level = new Uint8Array();
    for (let i = 0; i < this.chainCount; ++i) {
      const block = Block.createGenesisBlock(previousProofHash, parentContentHash);
      previousProofHash = block.value.proof.key;
      this.proofMap.set(block.value.proof.key, block.value.proof.toData());
      this.contentMap.set(block.value.content.key, block.value.content.toData());
      const chainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
      this.chains[chainIndex].addBlock(block.key);
      Buffer.concat([level, block.toBytes()]);
    }

    return this.encodeLevel(level);
  }

  public createLevel(): void {
    // have at least one confirmed block at each level
    // have to compile into level data in a canonical manner
    const level = new Uint8Array();
    for (let i = 0; i < this.chainCount; ++i) {
      this.chains[i].blocks.forEach((blockId) => {
        const compactBlockData = this.compactBlockMap.get(blockId);
        if (compactBlockData) {
          const proofData = this.proofMap.get(compactBlockData[0]);
          const contentData = this.contentMap.get(compactBlockData[1]);
          if (proofData && contentData) {
            // const block = Block.load()
          }
        }
      });

    }
      // chain by chain
      // all the proofs
      // all the contents
      // all the unique txs
    return;
  }

  public encodeLevel(level: Uint8Array): IPieceData[] {
    // encode level and generate the piece set
    const pieceDataSet: IPieceData[] = [];
    const paddedLevel = codes.padLevel(level);
    const erasureCodedLevel = codes.erasureCodeLevel(paddedLevel);
    const pieces = codes.sliceLevel(erasureCodedLevel);

    // create the piece index
    const pieceHashes = pieces.map((piece) => crypto.hash(piece));
    const indexData: Uint8Array = Buffer.concat([...pieceHashes]);
    const indexPiece = codes.padPiece(indexData);
    const indexPieceId = crypto.hash(indexPiece);
    pieces.push(indexPiece);
    pieceHashes.push(indexPieceId);

    // build merkle tree and create state block
    const { root, proofs } = crypto.buildMerkleTree(pieceHashes);
    const levelHash = crypto.hash([...this.proofMap.keys()]
      .reduce((sum, id) => Buffer.concat([sum, id])));

    const state = State.create(
      this.lastStateBlockId,
      levelHash,
      root,
      DIFFICULTY,
      VERSION,
      indexPieceId,
    );

    this.state.set(state.key, state.toData());
    this.lastStateBlockId = state.key;
    const stateIndex = this.state.size;

    // compile the piece data set for plotting
    for (let i = 0; i < pieces.length; ++i) {
      pieceDataSet[i] = {
        piece: pieces[i],
        proof: proofs[i],
        index: stateIndex,
      };
    }

    // clear the pending state from memory
    this.proofMap.clear();
    this.contentMap.clear();
    this.txMap.clear();
    this.chains.forEach((chain) => chain.reset());

    return pieceDataSet;
  }

  private onTx(txData: ITxData): void {
    const tx = Tx.load(txData);
    if (tx.isValid()) {
      this.txMap.set(tx.key, txData);
      this.accounts.update(tx.receiverAddress, tx.value.amount);
      this.emit('applied-tx', Tx);

      // note when tx is referenced (added to a block)
      // note when tx is confirmed (a block referencing is captured in a level)
      // note when tx is deep confirmed (N other levels have also been confirmed, 6?)
    }
  }

  private onBlock(): void {

    // parse proof, content, and txs
    // validate
      // validate proof
      // validate content
      // validate each tx

    // if valid
      // add proof to proof map
      // add content to content map
      // add all tx to mempool
      // add block to correct chain

    // check if level is confirmed

    // solve if farmer

    // emit applied-block
    return;
  }

  private onLevelConfirmed(): void {

    this.emit('level-confirmed');
  }

  private onChainFork(): void {
    // revert ...
    return;
  }

  private onLevelFork(): void {
    // revert...
    return;
  }
}
