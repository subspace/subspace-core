// tslint:disable: no-console
// tslint:disable: member-ordering

import { ArrayMap } from 'array-map-set';
import { EventEmitter } from 'events';
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';
import { Block } from '../ledger/block';
import { Content } from '../ledger/content';
import { Ledger } from '../ledger/ledger';
import { Proof } from '../ledger/proof';
import { State } from '../ledger/state';
import { Tx } from '../ledger/tx';
import { CHUNK_LENGTH, COINBASE_REWARD, PIECE_SIZE } from '../main/constants';
import { INodeConfig, INodeSettings, IPiece } from '../main/interfaces';
import { RPC } from '../RPC/RPC';
import { areArraysEqual, bin2Hex, measureProximity, randomWait, smallNum2Bin } from '../utils/utils';
import { Wallet } from '../wallet/wallet';

// ToDo
  // add time logging
  // sync an existing ledger

export class Node extends EventEmitter {

  public isGossiping = false;

  constructor(
    public readonly type: 'full' | 'validator' | 'farmer' | 'gateway' | 'client',
    public readonly config: INodeConfig,
    public readonly settings: INodeSettings,
    private rpc: RPC,
    private ledger: Ledger,
    private wallet: Wallet | undefined,
    private farm: Farm | undefined,
  ) {

    super();
    this.rpc.on('ping', (payload, responseCallback: (response: Uint8Array) => void) => responseCallback(payload));
    this.rpc.on('tx-gossip', (tx: Tx) => this.onTx(tx));
    this.rpc.on('block-gossip', (block: Block, encoding: Uint8Array) => this.onBlock(block, encoding));
    this.rpc.on('tx-request', (txId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onTxRequest(txId, responseCallback));
    this.rpc.on('block-request', (blockId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onBlockRequest(blockId, responseCallback));
    this.rpc.on('block-request-by-index', (index: number, responseCallback: (response: Uint8Array) => void) => this.onBlockRequestByIndex(index, responseCallback));
    this.rpc.on('piece-request', (pieceId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onPieceRequest(pieceId, responseCallback));
    this.rpc.on('proof-request', (proofId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onProofRequest(proofId, responseCallback));
    this.rpc.on('content-request', (contentId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onContentRequest(contentId, responseCallback));
    this.rpc.on('state-request', (stateId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onStateRequest(stateId, responseCallback));
    this.rpc.on('state-request-by-index', (index: number, responseCallback: (response: Uint8Array) => void) => this.onStateRequestByIndex(index, responseCallback));

    /**
     * A new level has been confirmed and encoded into a piece set.
     * Add each piece to the plot, if farming.
     */
    this.ledger.on('confirmed-level', async (levelRecords: Uint8Array[], levelHash: Uint8Array, confirmedTxs: Tx[], lastCoinBaseTxTime: number) => {
      // how do you prevent race conditions here, a piece maybe partially plotted before it can be evaluated...
      const pieceDataSet = await ledger.encodeLevel(levelRecords, levelHash, lastCoinBaseTxTime);
      console.log('Finished encoding a new level and updating state');
      if (this.farm) {
        for (const piece of pieceDataSet) {
          await this.farm.addPiece(piece.piece, piece.data);
        }
        this.ledger.emit('completed-plotting');
      }

      // update account for each tx that links to an account for this node
      if (this.wallet) {
        const addresses = this.wallet.addresses;
        for (const tx of confirmedTxs) {
          if (addresses.has(bin2Hex(tx.senderAddress)) || addresses.has(bin2Hex(tx.receiverAddress))) {
            await this.wallet.onTxConfirmed(tx);
          }
        }
      }
    });

    /**
     * A new block was created by this farmer from Ledger after solving the block challenge.
     * Encode the block as binary and gossip over the network.
     */
    this.ledger.on('block', async (block: Block, encoding: Uint8Array) => {
      console.log('New block created by this Node.');
      // print(block.print());
      if (this.ledger.isValidating) {
        await this.ledger.isValidBlock(block, encoding);
      }
      if (this.isGossiping) {
        this.rpc.gossipBlock(block, encoding);
      }
    });

    /**
     * A new credit tx was created by this node and applied to the local ledger.
     * Encode the tx as binary and gossip over the network.
     */
    this.ledger.on('tx', (tx: Tx) => {
      if (this.isGossiping) {
        this.rpc.gossipTx(tx);
      }
    });

    switch (this.type) {
      case 'full':
        this.settings.genesis ?
          this.createLedgerAndFarm() :
          this.syncLedgerAndFarm();
        break;
      case 'validator':
        this.syncLedgerAndValidate();
        break;
      case 'farmer':
        this.syncLedgerAndFarm();
        break;
    }
  }

  /**
   * Starts a new ledger from genesis and begins farming its own plot in isolation. Mostly for testing.
   * Retains both the original ledger data within storage and the encoded piece set in the plot.
   */
  public async createLedgerAndFarm(): Promise<void> {
    if (!this.farm || !this.wallet) {
      throw new Error('Cannot farm, this node is not configured as a farmer');
    }
    this.isGossiping = true;
    const account = this.wallet.getAccounts()[0];
    console.log('\nLaunching a new Subspace Full Node!');
    console.log('-----------------------------------\n');
    console.log(`Created a new node identity with address ${bin2Hex(account.address)}`);
    console.log(`Starting a new ledger from genesis with ${this.ledger.chainCount} chains.`);
    // const [levelRecords, levelHash] =
    await this.ledger.createGenesisLevel();
    // const pieceSet = await this.ledger.encodeLevel(levelRecords, levelHash);
    // console.log(`Created the genesis level and derived ${pieceSet.length} new pieces`);
    // for (const piece of pieceSet) {
    //   await this.farm.addPiece(piece.piece, piece.data);
    // }
    // console.log(`Completed plotting ${pieceSet.length} pieces for the genesis level.`);

    // start a farming evaluation loop
    while (this.config.farm) {
      await this.farmBlock();
    }
  }

  public async farmBlock(): Promise<void> {
    await randomWait(this.settings.delay);
    if (!this.farm || !this.wallet) {
      throw new Error('Cannot farm, this node is not configured as a farmer');
    }
    // find best encoding for challenge
    console.log('\nSolving a new block challenge');
    console.log('------------------------------');
    console.log(`State: ${this.ledger.stateMap.size} levels`);
    console.log(`Ledger; ${this.ledger.compactBlockMap.size} blocks`);
    const pieceCount = this.farm.getPieceCount();
    const plotSize = this.farm.getSize() / 1000000;
    console.log(`Farm: ${pieceCount} pieces comprising ${plotSize} MB across ${this.farm.plots.length} plots`);
    console.log(`Balance: ${this.wallet.getPendingBalanceOfAllAccounts()} credits`);
    console.log('------------------------------\n');

    const previousLevelHash = this.ledger.previousLevelHash;
    const parentProofHash = this.ledger.parentProofHash;
    const seed = Buffer.concat([previousLevelHash, parentProofHash]);
    const pieceTarget = crypto.hash(seed);
    const closestEncodings = await this.farm.getClosestEncodings(pieceTarget);
    if (!closestEncodings) {
      throw new Error('Cannot find a piece within plot for target');
    }
    console.log(`Closest piece to target: ${bin2Hex(pieceTarget).substr(0, 16)} is ${bin2Hex(closestEncodings.data.pieceHash).substring(0, 16)}`);

    let encodingIndex = 0;
    let bestChunkQuality = 0;
    let bestChunk = new Uint8Array();
    const chunkTarget = crypto.hash(pieceTarget).subarray(0, 8);

    // tslint:disable-next-line: prefer-for-of
    for (let p = 0; p < closestEncodings.encodings.length; ++p) {
      // find best chunk for challenge
      for (let i = 0; i < PIECE_SIZE / CHUNK_LENGTH; ++i) {
        const chunk = closestEncodings.encodings[p].subarray(i * CHUNK_LENGTH, (i + 1) * CHUNK_LENGTH);
        const quality = measureProximity(chunk, chunkTarget);
        if (quality > bestChunkQuality) {
          bestChunkQuality = quality;
          bestChunk = chunk;
          encodingIndex = p;
        }
      }
    }

    console.log(`Closest chunk to target: ${bin2Hex(chunkTarget)} is ${bin2Hex(bestChunk)} from plot ${encodingIndex}`);

    const encoding = closestEncodings.encodings[encodingIndex];
    const account = this.wallet.getAccount(this.farm.getPlotAddress(encodingIndex));

    // create proof of storage
    const unsignedProof = await Proof.create(
      previousLevelHash,
      parentProofHash,
      bestChunk,
      closestEncodings.data.pieceHash,
      closestEncodings.data.stateHash,
      closestEncodings.data.proof,
      account.publicKey,
    );
    const signedProof = this.wallet.signProof(unsignedProof);

    // create coinbase tx
    const coinbaseTx = await this.wallet.createCoinBaseTx(COINBASE_REWARD, account.publicKey);
    await this.ledger.createBlock(signedProof, coinbaseTx, encoding);
  }

  /**
   * Syncs the ledger from the network and begins farming. Default startup procedure for farmers.
   * Discards the original ledger data after several confirmed levels while retaining only the encoded pieces within its plot.
   */
  public async syncLedgerAndFarm(): Promise<void> {
    await this.syncLedgerAndValidate();
    while (this.config.farm) {
      await this.farmBlock();
    }
  }

  /**
   * Syncs the ledger from the network.
   * Validates and forwards new blocks and txs received over the network.
   */
  public async syncLedgerAndValidate(): Promise<void> {
    console.log('\nLaunching a new Subspace Validator Node!');
    console.log('-----------------------------------\n');

    // this.isGossiping = true;

    console.log('Syncing ledger state......');
    let blockIndex = 0;
    let hasChild = true;
    const piecePool: Map<Uint8Array, IPiece> = ArrayMap<Uint8Array, IPiece>();
    while (hasChild) {
      let encoding = new Uint8Array();
      console.log(`Requesting block at index: ${blockIndex}`);
      const block = await this.requestBlockByIndex(blockIndex);
      if (block) {
        console.log('Received block');
        // only get piece if not genesis piece
        if (areArraysEqual(block.value.proof.value.pieceHash, new Uint8Array(32))) {
          console.log('Genesis piece, use null encoding');
          encoding = new Uint8Array(4096);
        } else {
          console.log(`Requesting piece ${bin2Hex(block.value.proof.value.pieceHash).substring(0, 12)}`);
          let piece = piecePool.get(block.value.proof.value.pieceHash);
          if (!piece) {
            piece = await this.requestPiece(block.value.proof.value.pieceHash);
            piecePool.set(piece.data.pieceHash, piece);
          }
          console.log('Received piece');
          const proverAddress = crypto.hash(block.value.proof.value.publicKey);
          encoding = codes.encodePiece(piece.piece, proverAddress, this.settings.encodingRounds);
          console.log('Completing encoding piece');
        }
      }
      if (block && encoding.length) {
        console.log('Validating block and encoding...');
        if (await this.ledger.isValidBlock(block, encoding)) {
          this.ledger.applyBlock(block);
          ++ blockIndex;
        }
      } else {
        console.log('Completed syncing the ledger');
        hasChild = false;
        this.isGossiping = true;
      }
    }
  }

  /**
   * Syncs the ledger from existing nodes and serves RPC requests for structured data. Equivalent to a full validator node.
   * Retains the full unencoded ledger within persistent storage.
   */
  public async syncLedgerAndServe(): Promise<void> {
    return;
  }

  /**
   * Syncs the state chain from the network. Equivalent to a light client.
   * Listens for and validates new blocks, discarding them as they are compressed into new state blocks.
   */
  public async syncStateAndListen(): Promise<void> {
    return;
  }

  public async ping(): Promise<void> {
    await this.rpc.ping();
    console.log('Received a ping reply from gateway');
  }

  public async joinGossipNetwork(): Promise<void> {
    this.isGossiping = true;
  }

  /**
   * A new tx is received over the network from another node.
   * Filter the tx for duplicates or spam. Validate the tx.
   * Apply the tx to the ledger and gossip to all other peers.
   */
  public async onTx(tx: Tx): Promise<void> {
    if (this.isGossiping) {
      if (this.ledger.isValidTx(tx)) {
        this.ledger.applyTx(tx);
        this.rpc.gossipTx(tx);
        if (this.wallet) {
          const addresses = this.wallet.addresses;
          if (addresses.has(bin2Hex(tx.receiverAddress))) {
            this.wallet.onTxReceived(tx);
          }
        }
      }
    }
    // ToDo
      // filter duplicates and prevent re-gossip to sender
  }

  /**
   * A new block is received over the network from another farmer.
   * Filter the block for duplicates or spam. Validate the block.
   * Apply the block to the ledger and gossip to all other peers.
   */
  public async onBlock(block: Block, encoding: Uint8Array): Promise<void> {
    if (this.isGossiping) {
      console.log('New block received by node via gossip', bin2Hex(block.key));
      // check to ensure you have parent
      if (!this.ledger.proofMap.has(block.value.previousBlockHash)) {
        // we have received an early block who arrived before its parent
        this.ledger.earlyBlocks.set(block.key, block.value);
        // this.rpc.requestBlock()
        // request the block from network while waiting to possibly receive via gossip
        // once a new block is received and applied, check to see if it is parent of an orphan
      }

      // filter duplicates or my own block
      if (!this.ledger.compactBlockMap.has(block.key)) {
        // console.log('Proofs in my proof map', this.ledger.proofMap.keys());
        // console.log(block.key);
        if (await this.ledger.isValidBlock(block, encoding)) {
          this.ledger.applyBlock(block);
          this.rpc.gossipBlock(block, encoding);
        }
      }
    }
  }

  /**
   * Request a tx over the network from an existing peer.
   *
   * @param txId
   *
   * @return tx instance or not found
   */
  public async requestTx(txId: Uint8Array): Promise<Tx> {
    return this.rpc.requestTx(txId);
    // TODO
      // apply tx, error specify error callback
  }

  /**
   * Received a tx request over the network, reply with tx or not found.
   *
   * @param txId
   * @param responseCallback
   *
   */
  private async onTxRequest(txId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const txData = await this.ledger.getTx(txId);
    if (txData) {
      responseCallback(txData);
    } else {
      responseCallback(new Uint8Array());
    }
  }

  /**
   * Request a block over the network from an existing peer.
   *
   * @param blockId
   *
   * @return block instance or not found
   */
  public async requestBlock(blockId: Uint8Array): Promise<Block> {
    return this.rpc.requestBlock(blockId);
    // TODO
      // apply block, error specify error callback
  }

  /**
   * Received a block request over the network, reply with block or not found.
   *
   * @param blockId
   * @param responseCallback
   *
   */
  private async onBlockRequest(blockId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const blockData = await this.ledger.getBlock(blockId);
    if (blockData) {
      responseCallback(blockData);
    } else {
      responseCallback(new Uint8Array());
    }
  }

  /**
   * Request a block by index from an existing peer, used to sync the chain (from 0)
   *
   * @param index the sequence number the block appears in the ledger
   *
   * @return block instance or not found
   */
  public async requestBlockByIndex(index: number): Promise<Block | void> {
    const block = await this.rpc.requestBlockByIndex(index);
    if (block) {
      console.log('Received block at index', index);
    }
    return block;
  }

  /**
   * Received a block request over the network, reply with block or not found.
   *
   * @param blockIndex
   * @param responseCallback
   *
   */
  private async onBlockRequestByIndex(index: number, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const blockData = await this.ledger.getBlockByIndex(index);
    if (blockData) {
      responseCallback(blockData);
    } else {
      responseCallback(new Uint8Array());
    }
  }

  /**
   * Request a proof over the network from an existing peer.
   *
   * @param proofId
   *
   * @return proof instance or not found
   */
  public async requestProof(proofId: Uint8Array): Promise<Proof> {
    return this.rpc.requestProof(proofId);
    // TODO
      // apply tx, error specify error callback
  }

  /**
   * Received a proof request over the network, reply with proof or not found.
   *
   * @param proofId
   * @param responseCallback
   *
   */
  private async onProofRequest(proofId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const proofData = await this.ledger.getProof(proofId);
    if (proofData) {
      responseCallback(proofData);
    } else {
      responseCallback(new Uint8Array());
    }
  }

  /**
   * Request a content record over the network from an existing peer.
   *
   * @param contentId
   *
   * @return content instance or not found
   */
  public async requestContent(contentId: Uint8Array): Promise<Content> {
    return this.rpc.requestContent(contentId);
    // TODO
      // apply content, error specify error callback
  }

  /**
   * Received a content request over the network, reply with content or not found.
   *
   * @param contentId
   * @param responseCallback
   *
   */
  private async onContentRequest(contentId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const contentData = await this.ledger.getContent(contentId);
    if (contentData) {
      responseCallback(contentData);
    } else {
      responseCallback(new Uint8Array());
    }
  }

  /**
   * Request a state record over the network from an existing peer.
   *
   * @param stateId
   *
   * @return state instance or not found
   */
  public async requestState(stateId: Uint8Array): Promise<State> {
    return this.rpc.requestState(stateId);
    // TODO
      // apply state, error specify error callback
  }

  /**
   * Received a state request over the network, reply with state or not found.
   *
   * @param stateId
   * @param responseCallback
   *
   */
  private async onStateRequest(stateId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const stateData = await this.ledger.getContent(stateId);
    if (stateData) {
      responseCallback(stateData);
    } else {
      responseCallback(new Uint8Array());
    }
  }

  /**
   * Request a state record by index from an existing peer, used to sync the state chain (from 0)
   *
   * @param index the sequence number the state appears in the state chain
   *
   * @return state instance or not found
   */
  public async requestStateByIndex(index: number): Promise<State | void> {
    const state = await this.rpc.requestStateByIndex(index);
    if (state) {
      console.log('Received state at index', index);
    }
    return state;
  }

  /**
   * Received a state request over the network, reply with state or not found.
   *
   * @param stateIndex
   * @param responseCallback
   *
   */
  private async onStateRequestByIndex(index: number, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const stateData = await this.ledger.getStateByIndex(index);
    if (stateData) {
      responseCallback(stateData);
    } else {
      responseCallback(new Uint8Array());
    }
  }

  /**
   * Request a piece and metadata over the network from an existing peer.
   *
   * @param pieceId
   *
   * @return piece instance or not found
   */
  public async requestPiece(pieceId: Uint8Array): Promise<IPiece> {
    return this.rpc.requestPiece(pieceId);
  }

  /**
   * Received a piece request over the network, reply with piece or not found.
   *
   * @param pieceId
   * @param responseCallback
   *
   */
  private async onPieceRequest(pieceId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    if (this.farm) {
      // console.log('\n\n *** New Piece Request Received *** \n\n');
      const piece = await this.farm.getExactPiece(pieceId);
      if (piece) {
        const pieceData = Buffer.concat([
          piece.piece,
          piece.data.pieceHash,
          piece.data.stateHash,
          smallNum2Bin(piece.data.pieceIndex),
          piece.data.proof,
        ]);
        // console.log(piece);
        responseCallback(pieceData);
      }
      responseCallback(new Uint8Array());
    }
  }
}
