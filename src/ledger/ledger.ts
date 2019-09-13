// tslint:disable: max-classes-per-file
// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console
// tslint:disable: member-ordering

import { ArrayMap, ArraySet } from "array-map-set";
import { EventEmitter } from 'events';
import * as codes from '../codes/codes';
import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { CHUNK_LENGTH, DIFFICULTY, PIECE_SIZE, VERSION } from '../main/constants';
import { IFullBlockValue, IPiece} from '../main/interfaces';
import { Storage } from '../storage/storage';
import { areArraysEqual, bin2Hex, print, smallNum2Bin } from '../utils/utils';
import { Account } from './accounts';
import { Block } from './block';
import { Chain } from './chain';
import { Content } from './content';
import { Proof } from './proof';
import { State } from './state';
import { Tx } from './tx';

// ToDo
  // fix memory leak
  // run in farmer mode, pruning chain state after each new level
  // separate levels from state, such that state is constant sized
  // normalize level encoding
  // decode levels
  // handle chain forks
  // handle level forks
  // set minimum work difficulty
  // work difficulty resets
  // Refactor Level into a separate class
  // handle tx fees
  // handle validation where one farmer computes the next level and adds pieces before another
  // enforce a maximum block size of 4096 bytes

// Basic Modes
  // do I store the chain data (full node)
  // do I store the piece set (plotting)
  // do I store the state chain (light client, full node, farmer)

// Implementation
  // 1) Store the entire ledger in memory, create state blocks for each new level, encode and plot
  // 2) Only store the ledger in memory and create new state blocks
  // 3) Just store the state blocks, discard new blocks once they are created
  // 4) Store each chain state to disk after N levels are confirmed
  // 5) Discard each new block after N levels are confirmed

// modes of operation
  // light client -- only stores the state chain, discards all level data after it is compressed
  // full node -- stores the full tx and block history (in memory or on disk)
  // farmer -- only stores the state chain but  encodes each new level into their plot
  // gateway node -- answers rpc requests for records over the DHT
  // farmer -- answers rpc requests for pieces

export class Ledger extends EventEmitter {

  public readonly encodingRounds: number;
  public isFarming = true;
  public isServing = true;
  public isValidating: boolean;

  public previousLevelHash = new Uint8Array(32);
  public parentProofHash = new Uint8Array(32);

  // persistent state
  public chainCount = 0;
  public confirmedTxs = 0;
  public confirmedBlocks = 0;
  public confirmedLevels = 0;
  public confirmedState = 0;
  public lastConfirmedLevel = 0;
  public accounts: Account;
  public stateMap = ArrayMap<Uint8Array, Uint8Array>();

  // memory pool, may be cleared after each level is confirmed (if not serving)
  public compactBlockMap = ArrayMap<Uint8Array, Uint8Array>();
  private lastStateHash: Uint8Array = new Uint8Array(32);
  private chains: Chain[] = [];
  private readonly blsSignatures: BlsSignatures;
  // @ts-ignore TODO: Use it for something
  private storage: Storage;
  public proofMap = ArrayMap<Uint8Array, Uint8Array>();
  private contentMap = ArrayMap<Uint8Array, Uint8Array>();
  private txMap = ArrayMap<Uint8Array, Uint8Array>();
  private unconfirmedTxs: Set<Uint8Array> = ArraySet(); // has not been included in a block
  private unconfirmedBlocksByChain: Array<Set<Uint8Array>> = []; // has not been included in a level
  private unconfirmedChains: Set<number> = new Set(); // does not have any new blocks since last level was confirmed
  public earlyBlocks = ArrayMap<Uint8Array, IFullBlockValue>();

  constructor(
    blsSignatures: BlsSignatures,
    storage: Storage,
    chainCount: number,
    validateRecords: boolean,
    encodingRounds: number,
  ) {
    super();
    this.blsSignatures = blsSignatures;
    this.storage = storage;
    this.accounts = new Account();
    this.isValidating = validateRecords;
    this.encodingRounds = encodingRounds;

    // initialize chains
    this.chainCount = chainCount;
    for (let i = 0; i < this.chainCount; ++i) {
      // create each chain
      const chain = new Chain(i);
      this.chains.push(chain);

      // init each chain as unconfirmed
      this.unconfirmedBlocksByChain.push(ArraySet());
      this.unconfirmedChains.add(i);
    }
  }

  /**
   * Creates a new genesis level.
   * Returns the initial erasure coded piece set with metadata.
   */
  public async createGenesisLevel(): Promise<[Uint8Array[], Uint8Array]> {

    // init level data
    let previousProofHash = new Uint8Array(32);
    const parentContentHash = new Uint8Array(32);
    const levelRecords: Uint8Array[] = [];
    const levelProofHashes: Uint8Array[] = [];

    // init each chain with a genesis block
    for (let i = 0; i < this.chainCount; ++i) {
      const chain =  this.chains[i];
      const block = Block.createGenesisBlock(previousProofHash, parentContentHash);
      console.log(`Created new genesis block for chain ${i}`);
      const encoding = new Uint8Array(4096);
      this.emit('block', block, encoding);
      // print(block.print());
      previousProofHash = block.value.proof.key;

      // save the proof, append to level data
      this.proofMap.set(block.value.proof.key, block.value.proof.toBytes());
      const binProof = block.value.proof.toBytes();
      levelRecords.push(binProof);
      levelProofHashes.push(binProof);

      // save the content, append to level data
      this.contentMap.set(block.value.content.key, block.value.content.toBytes());
      levelRecords.push(block.value.content.toBytes());

      // extend the chain and to ledger
      chain.addBlock(block.key);
      this.chains[i] = chain;

      // add compact block
      this.compactBlockMap.set(block.key, block.toCompactBytes());
    }

    const levelProofHashData = Buffer.concat(levelProofHashes);
    const levelHash = crypto.hash(levelProofHashData);
    this.parentProofHash = previousProofHash;
    this.lastConfirmedLevel ++;
    return [levelRecords, levelHash];
  }

  /**
   * Creates a subsequent level once a new level is confirmed (at least one new block for each chain).
   * Returns a canonical erasure coded piece set with metadata that will be the same across all nodes.
   */
  public createLevel(): [Uint8Array[], Uint8Array, Tx[]] {
    const levelRecords: Uint8Array[] = [];
    const levelProofHashes: Uint8Array[] = [];
    const uniqueTxSet: Set<Uint8Array> = new Set();
    for (const chain of this.unconfirmedBlocksByChain) {
      for (const blockId of chain.values()) {
        this.confirmedBlocks ++;
        const compactBlockData = this.compactBlockMap.get(blockId);
        if (!compactBlockData) {
          throw new Error('Cannot create level, cannot retrieve required compact block data');
        }
        const compactBlock = Block.fromCompactBytes(compactBlockData);
        const proofData = this.proofMap.get(compactBlock.proofHash);
        const contentData = this.contentMap.get(compactBlock.contentHash);
        if (!proofData || !contentData) {
          throw new Error('Cannot create new level, cannot fetch requisite proof or content data');
        }

        levelRecords.push(proofData);
        levelProofHashes.push(compactBlock.proofHash);
        const content = Content.fromBytes(contentData);
        levelRecords.push(contentData);

        for (const txId of content.value.payload) {
          uniqueTxSet.add(txId);
        }
      }
      chain.clear();
    }

    const confirmedTxs: Tx[] = [];

    for (const txId of uniqueTxSet) {
      this.confirmedTxs ++;
      const txData = this.txMap.get(txId);
      if (!txData) {
        throw new Error('Cannot create new level, cannot fetch requisite transaction data');
      }
      const tx = Tx.fromBytes(txData);
      confirmedTxs.push(tx);
      levelRecords.push(txData);
    }

    const levelProofHashesData = Buffer.concat(levelProofHashes);
    const levelHash = crypto.hash(levelProofHashesData);
    return [levelRecords, levelHash, confirmedTxs];
  }

  /**
   * Takes the source data for a level and applies padding, slices, erasure codes, and creates a piece index.
   * Compresses the encoded level into a state block.
   * Returns an erasure coded piece set with metadata.
   */
  public async encodeLevel(levelRecords: Uint8Array[], levelHash: Uint8Array): Promise<IPiece[]> {
    this.previousLevelHash = levelHash;
    let levelData = new Uint8Array();
    const levelElements: Uint8Array[] = [];

    for (const record of levelRecords) {
      levelElements.push(smallNum2Bin(record.length));
      levelElements.push(record);
    }

    levelData = Buffer.concat(levelElements);

    const paddedLevelData = codes.padLevel(levelData);

    const pieceDataSet = paddedLevelData.length <= 4096 ?
      this.encodeSmallLevel(paddedLevelData, levelHash) :
      await this.encodeLargeLevel(paddedLevelData, levelHash);

    this.confirmedLevels ++;
    this.confirmedState ++;

    if (!this.isServing) {
      // clear the pending state from memory
      this.compactBlockMap.clear();
      this.proofMap.clear();
      this.contentMap.clear();
      this.txMap.clear();
      this.chains.forEach((chain) => chain.reset());
    }

    return pieceDataSet;
  }

  public encodeSmallLevel(paddedLevelData: Uint8Array, levelHash: Uint8Array): IPiece[] {

    const pieceHash = crypto.hash(paddedLevelData);

    const state = State.create(
      this.lastStateHash,
      levelHash,
      pieceHash,
      DIFFICULTY,
      VERSION,
      new Uint8Array(32),
    );

    const pieceData: IPiece = {
      piece: paddedLevelData,
      data: {
        pieceHash,
        stateHash: state.key,
        pieceIndex: 0,
        proof: new Uint8Array(),
      },
    };

    this.stateMap.set(state.key, state.toBytes());
    this.lastStateHash = state.key;
    return [pieceData];
  }

  public async encodeLargeLevel(paddedLevelData: Uint8Array, levelHash: Uint8Array): Promise<IPiece[]> {

    // this level has at least two source pieces, erasure code parity shards and add index piece
    // max pieces to erasure code in one go are 127
    const pieceCount = paddedLevelData.length / PIECE_SIZE;
    const erasureCodedLevelElements: Uint8Array[] = [];
    console.log(`Piece count is: ${pieceCount}`);
    if (pieceCount > 127) {
      const rounds = Math.ceil(pieceCount / 127);
      console.log(`Rounds of erasure coding are: ${rounds}`);
      for (let r = 0; r < rounds; ++r) {
        const roundData = paddedLevelData.subarray(r * 127 * PIECE_SIZE, (r + 1) * 127 * PIECE_SIZE);
        erasureCodedLevelElements.push(await codes.erasureCodeLevel(roundData));
      }
      // erasure code in multiples of 127

    } else {
      erasureCodedLevelElements.push(await codes.erasureCodeLevel(paddedLevelData));
    }

    const erasureCodedLevel = Buffer.concat(erasureCodedLevelElements);
    const pieces = codes.sliceLevel(erasureCodedLevel);

    // create the index piece
    const pieceHashes = pieces.map((piece) => crypto.hash(piece));
    const indexData = Uint8Array.from(Buffer.concat([...pieceHashes]));
    const indexPiece = codes.padPiece(indexData);
    const indexPieceId = crypto.hash(indexPiece);
    pieces.push(indexPiece);
    pieceHashes.push(indexPieceId);

    // build merkle tree
    const { root, proofs } = crypto.buildMerkleTree(pieceHashes);

    // create state
    const state = State.create(
      this.lastStateHash,
      levelHash,
      root,
      DIFFICULTY,
      VERSION,
      indexPieceId,
    );

    // compile piece data
    const pieceDataSet: IPiece[] = [];
    for (let i = 0; i < pieces.length; ++i) {
      pieceDataSet[i] = {
        piece: pieces[i],
        data: {
          pieceHash: pieceHashes[i],
          stateHash: state.key,
          pieceIndex: i,
          proof: proofs[i],
        },
      };
    }

    this.stateMap.set(state.key, state.toBytes());
    this.lastStateHash = state.key;

    return pieceDataSet;
  }

  /**
   * Called when a new Block solution is generated locally.
   * Emits a fully formed Block for gossip by Node.
   * Passes the Block on to be applied to Ledger
   */
  public async createBlock(proof: Proof, coinbaseTx: Tx, encoding: Uint8Array): Promise<Block> {

    // create the block
    const chainIndex = crypto.jumpHash(proof.key, this.chainCount);
    const parentBlockId = this.chains[chainIndex].head;
    const compactParentBlockData = this.compactBlockMap.get(parentBlockId);
    if (!compactParentBlockData) {
      throw new Error('Cannot get parent block when extending the chain.');
    }
    const compactParentBlock = Block.fromCompactBytes(compactParentBlockData);
    const parentContentHash = compactParentBlock.contentHash;
    const txIds = [coinbaseTx.key, ...this.unconfirmedTxs.values()];
    const block = Block.create(proof, parentContentHash, txIds, coinbaseTx);
    console.log(`Created new block ${bin2Hex(block.key).substring(0, 16)} for chain ${chainIndex}`);

    // pass up to node for gossip across the network
    this.emit('block', block, encoding);
    if (this.isValidating) {
      await this.isValidBlock(block, encoding);
    }
    console.log(`Validated new block ${bin2Hex(block.key).substring(0, 16)}`);
    await this.applyBlock(block);
    console.log(`Applied new block ${bin2Hex(block.key).substring(0, 16)} to ledger.`);
    return block;
  }

  /**
   * Validates a Block against the Ledger.
   * Ensures the Proof and Content are well-formed.
   * Ensures all included Txs are valid against the Ledger and well-formed.
   */
  public async isValidBlock(block: Block, encoding: Uint8Array): Promise<boolean> {

    // console.log(`Got block and encoding in Block.isValidBlock():`);
    // console.log(encoding);

    // validate the block, proof, content, and coinbase tx are all well formed, will throw if not
    block.isValid(this.blsSignatures);

    // handle genesis blocks ...
    if (areArraysEqual(block.value.proof.value.previousLevelHash, new Uint8Array(32))) {

      // previous proof hash should be null or in proof map
      if (areArraysEqual(block.value.proof.value.previousProofHash, new Uint8Array(32))) {
        const genesisProof = this.proofMap.get(block.value.proof.key);
        if (!genesisProof && this.proofMap.size) {
          throw new Error('Invalid genesis block, already have a first genesis proof');
        }
      } else {
        // check in proof map
        const previousProofData = this.proofMap.get(block.value.proof.value.previousProofHash);
        if (!previousProofData) {
          throw new Error('Invalid genesis block, does not reference a known proof');
        }
      }

      // encoding should be null
      if (!areArraysEqual(encoding, new Uint8Array(4096))) {
        throw new Error('Invalid genesis block, should not have an attached encoding');
      }

      return true;
    }

    // verify the proof ...

    // previous level hash is last seen level
    if (!areArraysEqual(block.value.proof.value.previousLevelHash, this.previousLevelHash)) {
      print(block.print());
      throw new Error('Invalid block proof, points to incorrect previous level');
    }

    // previous proof hash is in proof map
    if (!this.proofMap.has(block.value.proof.value.previousProofHash)) {
      throw new Error('Invalid block proof, points to an unknown previous proof');
    }

    // solution is part of encoded piece
    let hasSolution = false;
    for (let i = 0; i < PIECE_SIZE / CHUNK_LENGTH; ++i) {
      const chunk = encoding.subarray((i * CHUNK_LENGTH), (i + 1) * CHUNK_LENGTH);
      if (areArraysEqual(chunk, block.value.proof.value.solution)) {
        hasSolution = true;
        break;
      }
    }

    if (!hasSolution) {
      throw new Error('Invalid block proof, solution is not present in encoding');
    }

    // piece level is seen in state
    if (!this.stateMap.has(block.value.proof.value.pieceStateHash) && areArraysEqual(block.value.proof.value.pieceStateHash, new Uint8Array(32))) {
      throw new Error('Invalid block proof, referenced piece level is unknown');
    }

    // piece proof is valid for a given state level, assuming their is more than one piece in the level
    if (!areArraysEqual(block.value.proof.value.previousLevelHash, block.value.proof.value.previousProofHash)) {
      const pieceStateData = this.stateMap.get(block.value.proof.value.pieceStateHash);
      if (!pieceStateData) {
        throw new Error('Invalid block proof, referenced state data is not in state map');
      }
      const state = State.fromBytes(pieceStateData);
      const validPieceProof = crypto.isValidMerkleProof(state.value.pieceRoot, block.value.proof.value.pieceProof, block.value.proof.value.pieceHash);
      if (!validPieceProof) {
        throw new Error('Invalid block proof, piece proof is not a valid merkle path');
      }
    }

    // encoding decodes pack to piece
    const proverAddress = crypto.hash(block.value.proof.value.publicKey);
    const piece = codes.decodePiece(encoding, proverAddress, this.encodingRounds);
    const pieceHash = crypto.hash(piece);
    if (!areArraysEqual(pieceHash, block.value.proof.value.pieceHash)) {
      throw new Error('Invalid block proof, encoding does not decode back to parent piece');
    }

    // verify the content points to the correct chain
    // if parent block is the genesis block then the proof hash will hash to different a chain
    const correctChainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
    const parentContentData = this.contentMap.get(block.value.content.value.parentContentHash);
    if (!parentContentData) {
      throw new Error('Invalid block content, cannot retrieve parent content block');
    }
    const parentContent = Content.fromBytes(parentContentData);
    if (areArraysEqual(parentContent.value.parentContentHash, new Uint8Array(32))) {
      const parentChainIndex = crypto.jumpHash(parentContent.value.proofHash, this.chainCount);
      if (parentChainIndex !== correctChainIndex) {
        throw new Error('Invalid block content, does not hash to the same chain as parent');
      }
    }

    // validate the coinbase tx (since not in mempool)
    if (!block.value.coinbase) {
      throw new Error('Invalid block, does not have a coinbase tx');
    }
    this.isValidTx(block.value.coinbase);

    // verify each tx in the content (including coinbase)
    const txIds = block.value.content.value.payload;
    for (let i = 1; i < txIds.length; ++i) {
      const txData = this.txMap.get(txIds[i]);
      if (!txData) {
        throw new Error('Invalid block content, cannot retrieve referenced tx id');
      }
      const tx = Tx.fromBytes(txData);
      this.isValidTx(tx);
    }

    return true;
  }

  /**
   * Called when a new valid block is received over the network or generated locally.
   * Assumes the block has been validated on receipt over the network or correctly formed locally.
   * Applies the block to ledger state.
   */
  public async applyBlock(block: Block): Promise<void> {
    return new Promise(async (resolve) => {
      // extend the correct chain with block id and add to compact block map
      const chainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
      this.chains[chainIndex].addBlock(block.key);
      this.compactBlockMap.set(block.key, block.toCompactBytes());
      this.unconfirmedBlocksByChain[chainIndex].add(block.key);

      // add proof to proof map and update last proof seen
      this.proofMap.set(block.value.proof.key, block.value.proof.toBytes());
      this.parentProofHash = block.value.proof.key;

      // add content to content map
      this.contentMap.set(block.value.content.key, block.value.content.toBytes());

      if (block.value.coinbase) {
        // apply the coinbase tx (skip unconfirmed)
        const coinbase = block.value.coinbase;
        this.txMap.set(coinbase.key, coinbase.toBytes());
        this.applyTx(coinbase);
      }

      if (!this.lastConfirmedLevel && block.value.coinbase) {
        throw new Error('Invalid genesis block, genesis level has already been confirmed');
      }

      // for each credit tx, apply and remove from unconfirmed set, skipping the coinbase tx
      const txIds = block.value.content.value.payload;
      for (let i = 1; i < txIds.length; ++i) {
        const txId = txIds[i];
        const txData = this.txMap.get(txId);
        if (!txData) {
          throw new Error('Cannot apply tx that is not in the mempool');
        }
        const tx = Tx.fromBytes(txData);
        this.applyTx(tx);
        this.unconfirmedTxs.delete(txId);
      }

      console.log('Checking if pending level has confirmed during applyBlock()');

      // update level confirmation cache and check if level is confirmed
      this.unconfirmedChains.delete(chainIndex);
      if (!this.unconfirmedChains.size) {
        const [levelRecords, levelHash, confirmedTxs] = this.createLevel();
        this.emit('confirmed-level', levelRecords, levelHash, confirmedTxs);
        this.lastConfirmedLevel ++;
        console.log('New level has been confirmed.');
        console.log('Chain lengths:');
        console.log('--------------');
        for (const chain of this.chains) {
          console.log(`Chain ${chain.index}: ${chain.size}`);
        }

        for (let i = 0; i < this.chainCount; ++i) {
          this.unconfirmedChains.add(i);
        }

        if (this.isFarming) {
          this.once('completed-plotting', () => {
            console.log('Completed plotting piece set for last confirmed level');
            resolve();
          });
        } else {
          resolve();
        }
      }
      resolve();
    });
  }

  /**
   * Validates a Tx against the Ledger and ensures it is well-formed.
   * Validates schema.
   * Ensures the sender has funds to cover.
   * Ensures the nonce has been incremented.
   */
  public async isValidTx(tx: Tx): Promise<boolean> {
    // validate schema, will throw if invalid
    // tx.isValid();

    // does sender have funds to cover tx (if not coinbase)
    if (!areArraysEqual(tx.value.sender, new Uint8Array(48))) {
      const senderBalance = this.accounts.get(tx.senderAddress);
      if (!senderBalance) {
        throw new Error('Invalid tx, sender has no account on the ledger!');
      }
      if (senderBalance - tx.value.amount < 0) {
        throw new Error('Invalid tx, sender does not have funds to cover the amount!');
      }
    }

    // has nonce been incremented? (prevent replay attack)
      // how to get the last tx for this account?
        // create secondary index in rocks for address and compile...
        // track the nonce in each address field in accounts

    console.log(`Validated new ${areArraysEqual(tx.value.sender, new Uint8Array(48)) ? "credit" : "coinbase"} tx ${bin2Hex(tx.key).substring(0, 16)}`);

    return true;
  }

  /**
   * Called when a new valid tx is received over the network or generated locally.
   * Assumes the tx has been validated on receipt over the network or correctly formed locally.
   * Applies the tx to ledger state by adjust account balances.
   */
  public applyTx(tx: Tx): void {
      // debit the sender, if not coinbase tx
      if (!areArraysEqual(tx.value.sender, new Uint8Array(48))) {
        this.accounts.update(tx.senderAddress, -tx.value.amount);
      }

      // always credit the receiver
      this.accounts.update(tx.receiverAddress, tx.value.amount);

      console.log(`Applied new ${areArraysEqual(tx.value.sender, new Uint8Array(48)) ? "credit" : "coinbase"} tx ${bin2Hex(tx.key).substring(0, 16)} to ledger.`);

      // apply the fee to the farmer?
      // note when tx is referenced (added to a block)
      // note when tx is confirmed (a block referencing is captured in a level)
      // note when tx is deep confirmed (N other levels have also been confirmed, 6?)
  }

  /**
   * Searches memory and disk for a tx matching query.
   *
   * @param txId hash of tx data
   *
   * @return binary tx data or not found
   */
  public async getTx(txId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let txData: Uint8Array | undefined | null;
    txData = this.txMap.get(txId);
    if (!txData) {
      txData = await this.storage.get(txId);
    }
    return txData;
  }

  /**
   * Searches memory and disk for block metadata matching query.
   *
   * @param blockId hash of block data
   *
   * @return binary block metadata or not found
   */
  public async getCompactBlock(blockId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let blockData: Uint8Array | undefined | null;
    blockData = this.compactBlockMap.get(blockId);
    if (!blockData) {
      blockData = await this.storage.get(blockId);
    }
    return blockData;
  }

  /**
   * Searches memory and disk for a proof matching query.
   *
   * @param proofId hash of proof data
   *
   * @return binary proof data or not found
   */
  public async getProof(proofId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let proofData: Uint8Array | undefined | null;
    proofData = this.proofMap.get(proofId);
    if (!proofData) {
      proofData = await this.storage.get(proofId);
    }
    return proofData;
  }

  /**
   * Searches memory and disk for a content matching query.
   *
   * @param contentId   hash of content data
   *
   * @return binary content data or not found
   */
  public async getContent(contentId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let contentData: Uint8Array | undefined | null;
    contentData = this.contentMap.get(contentId);
    if (!contentData) {
      contentData = await this.storage.get(contentId);
    }
    return contentData;
  }

  /**
   * Searches memory and disk for a block matching query. Returns full block with proof, content, and all txs.
   *
   * @param blockId hash of block data
   *
   * @return binary block data or not found
   */
  public async getBlock(blockId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let compactBlockData: Uint8Array | undefined | null;
    compactBlockData = this.compactBlockMap.get(blockId);
    if (!compactBlockData) {
      compactBlockData = await this.storage.get(blockId);
    }

    if (!compactBlockData) {
      return;
    }

    const compactBlock = Block.fromCompactBytes(compactBlockData);
    const proofData = await this.getProof(compactBlock.proofHash);
    if (!proofData) {
      return;
    }

    const contentData = await this.getContent(compactBlock.contentHash);
    if (!contentData) {
      return;
    }

    const content = Content.fromBytes(contentData);
    const txDataArray: Uint8Array[] = [];
    for (const txId of content.value.payload) {
      const txData = await this.getTx(txId);
      if (!txData) {
        return;
      }
      txDataArray.push(txData);
    }

    return Buffer.concat([proofData, contentData, ...txDataArray]);
  }

  /**
   * Searches memory and disk for a state block matching query.
   *
   * @param stateId hash of state data
   *
   * @return binary state data or not found
   */
  public async getState(stateId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let stateData: Uint8Array | undefined | null;
    stateData = this.stateMap.get(stateId);
    if (!stateData) {
      stateData = await this.storage.get(stateId);
    }
    return stateData;
  }
}
