// tslint:disable: member-ordering

import { ArrayMap } from 'array-map-set';
import { EventEmitter } from 'events';
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/Farm';
import { Block } from '../ledger/block';
import { Content } from '../ledger/content';
import { Ledger } from '../ledger/ledger';
import { Proof } from '../ledger/proof';
import { State } from '../ledger/state';
import { Tx } from '../ledger/tx';
import { CHUNK_LENGTH, COINBASE_REWARD, PIECE_SIZE } from '../main/constants';
import { INodeConfig, INodeSettings, IPiece } from '../main/interfaces';
import { Rpc } from '../rpc/Rpc';
import { bin2Hex, ILogger, measureProximity, randomWait, smallNum2Bin } from '../utils/utils';
import { Wallet } from '../wallet/wallet';

// ToDo
//  Add ability to sync only the state chain
//  Add farmer mode -- discards the confirmed state and farms
//  Add client mode -- discards the confirmed state and does not serve requests
//  sync state without having to decode/recode the piece

export class Node extends EventEmitter {

  public isGossiping = false;
  public readonly logger: ILogger;

  constructor(
    public readonly type: 'full' | 'validator' | 'farmer' | 'gateway' | 'client',
    public readonly config: INodeConfig,
    public readonly settings: INodeSettings,
    public rpc: Rpc,
    private ledger: Ledger,
    private wallet: Wallet | undefined,
    private farm: Farm | undefined,
    parentLogger: ILogger,
  ) {

    super();
    this.logger = parentLogger.child({subsystem: 'node'});
    this.rpc.on('ping', (payload, responseCallback: (response: Uint8Array) => void) => responseCallback(payload));
    this.rpc.on('tx-gossip', (tx: Tx) => this.onTx(tx));
    this.rpc.on('block-gossip', (block: Block, encoding: Uint8Array) => this.onBlock(block, encoding));
    this.rpc.on('tx-request', (txId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onTxRequest(txId, responseCallback));
    this.rpc.on('block-request', (blockId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onBlockRequest(blockId, responseCallback));
    this.rpc.on('blocks-request-for-index', (index: number, responseCallback: (response: Uint8Array) => void) => this.onBlocksForIndexRequest(index, responseCallback));
    this.rpc.on('block-request-by-index', (index: number, responseCallback: (response: Uint8Array) => void) => this.onBlockRequestByIndex(index, responseCallback));
    this.rpc.on('piece-request', (pieceId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onPieceRequest(pieceId, responseCallback));
    this.rpc.on('proof-request', (proofId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onProofRequest(proofId, responseCallback));
    this.rpc.on('content-request', (contentId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onContentRequest(contentId, responseCallback));
    this.rpc.on('state-request', (stateId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onStateRequest(stateId, responseCallback));
    this.rpc.on('state-request-by-index', (index: number, responseCallback: (response: Uint8Array) => void) => this.onStateRequestByIndex(index, responseCallback));

    this.ledger.on('applied-block', (block: Block) => this.emit('applied-block', block));
    /**
     * A new state block has been confimred, if farming, plot the new piece set within farm.
     */
    this.ledger.on('confirmed-state', async (stateHash: Uint8Array, pieceDataSet: IPiece[]) => {
      this.logger.info(`Confimred new state block with statehash: ${bin2Hex(stateHash).substring(0, 12)}`);
      if (this.farm) {
        for (const piece of pieceDataSet) {
          await this.farm.addPiece(piece.piece, piece.data);
        }
        this.logger.info(`Completed plotting piece set for newly confirmed state.`);
      }
      this.ledger.emit('completed-plotting', stateHash);
    });

    // initialize node based on provided type
    switch (this.type) {
      case 'full':
        this.settings.genesis ?
          this.createLedgerAndFarm() :
          this.syncLedgerAndFarm();
        break;
      case 'farmer':
        this.syncLedgerAndFarm();
        break;
      case 'validator':
        this.syncLedgerAndValidate();
        break;
      case 'client':
        this.syncStateAndListen();
        break;
    }
  }

  /**
   * Starts a new ledger from genesis and begins farming its own plot in isolation. Mostly for testing.
   * Retains both the original ledger data within storage and the encoded piece set in the plot.
   */
  public async createLedgerAndFarm(): Promise<void> {
    if (!this.farm || !this.wallet) {
      this.logger.error('Cannot farm, this node is not configured as a farmer');
      throw new Error('Cannot farm, this node is not configured as a farmer');
    }
    this.isGossiping = true;
    const account = this.wallet.getAccounts()[0];
    this.logger.verbose('Launching a new Subspace Full Node from Genesis!');
    this.logger.verbose(`Created a new node identity with address ${bin2Hex(account.address).substring(0, 12)}`);
    this.logger.verbose(`Starting a new ledger from genesis with ${this.ledger.chainCount} chains.`);
    const pieceDataSet = await this.ledger.createGenesisState();
    this.logger.verbose(`Created genesis piece set and state block with id: ${bin2Hex([...this.ledger.stateMap.keys()][0]).substring(0, 12)}`);
    await this.farm.seedPlot(pieceDataSet);
    while (this.config.farm) {
      await this.farmBlock();
    }
  }

  /**
   * Syncs the ledger from the network and begins farming. Default startup procedure for farmers.
   * Discards the original ledger data after several confirmed levels while retaining only the encoded pieces within its plot.
   */
  public async syncLedgerAndFarm(): Promise<void> {
    if (!this.farm) {
      this.logger.error(`Cannot farm in this mode`);
      throw new Error(`Cannot farm in this mode`);
    }

    this.logger.info('Lauching a new subpace farmer node');
    const pieceDataSet = await this.ledger.createGenesisState();
    await this.farm.seedPlot(pieceDataSet);
    await this.syncLedger();
    while (this.config.farm) {
      await this.farmBlock();
    }
  }

  /**
   * Syncs the ledger from the network. Listens for new blocks -- validating, applying, and relaying them.
   */
  public async syncLedgerAndValidate(): Promise<void> {
    this.logger.info(`Launching a new subspace validator node`);
    await this.ledger.createGenesisState();
    await this.syncLedger();
  }

  /**
   * Syncs the ledger from the network.
   * Validates and forwards new blocks and txs received over the network.
   * Answers RPC requests sent over the network
   */
  public async syncLedger(): Promise<void> {
    this.logger.verbose(`Syncing ledger state...`);
    let levelIndex = 0;
    let hasChildLevel = true;
    const piecePool: Map<Uint8Array, IPiece> = ArrayMap<Uint8Array, IPiece>();
    while (hasChildLevel) {
      let encoding = new Uint8Array();
      this.logger.verbose(`Requesting all blocks at index: ${levelIndex}`);
      const blockIds = await this.requestBlocksForIndex(levelIndex);
      if (blockIds) {
        this.logger.verbose(`Received ${blockIds.length} block ids for new level`);

        // for each block in the level
        for (const blockId of blockIds) {

          if (blockId.length !== 32) {
            continue;
          }

          // retrieve the block
          const block = await this.rpc.requestBlock(blockId);

          // retrieve the piece
          let piece: IPiece | void;

          // if farmer or full node, should have already stored the piece
          if (this.farm) {
            piece = await this.farm.getExactPiece(block.value.proof.value.pieceHash);
            if (piece) {
              this.logger.verbose(`Retrieve piece from farm`);
            }
          }

          // else retrieve from the network
          if (!piece) {
            piece = piecePool.get(block.value.proof.value.pieceHash);
            if (!piece) {
              this.logger.verbose(`Requesting piece ${bin2Hex(block.value.proof.value.pieceHash).substring(0, 12)}`);
              piece = await this.requestPiece(block.value.proof.value.pieceHash);
              piecePool.set(piece.data.pieceHash, piece);
            } else {
              this.logger.verbose(`Retrieved piece from cache`);
            }
          }

          // encode the piece
          const proverAddress = crypto.hash(block.value.proof.value.publicKey);
          encoding = codes.encodePiece(piece.piece, proverAddress, this.settings.encodingRounds);
          this.logger.verbose(`Completed encoding piece`);

          // verify the block and encoding
          if (block && encoding.length) {
            if (await this.ledger.isValidBlock(block, encoding)) {
              this.logger.verbose('Block and Encoding are valid');
              this.ledger.applyBlock(block);
            }
          }
        }

        // once all blocks for this level have been retrieved and applied
        this.logger.verbose('Received all pieces for level');
        ++ levelIndex;
      } else {
        this.logger.verbose(`Completed syncing the ledger`);
        hasChildLevel = false;
        this.isGossiping = true;
      }
    }
  }

  /**
   * Starts applying and re-transmitting any gossip received.
   */
  public async joinGossipNetwork(): Promise<void> {
    this.isGossiping = true;
  }

  /**
   * Syncs the state chain from the network. Equivalent to a light client.
   * Listens for and validates new blocks, discarding them as they are compressed into new state blocks.
   */
  public async syncStateAndListen(): Promise<void> {
    return;
  }

  /**
   * Starts an evaluation loop that attempts to solve each new valid block recieved over the network or generated locally.
   * Validates, gossips, applies, and emits the block (if created).
   */
  public async farmBlock(): Promise<void> {
    await randomWait(this.settings.delay);
    if (!this.farm || !this.wallet) {
      throw new Error('Cannot farm, this node is not configured as a farmer');
    }
    // find best encoding for challenge
    this.logger.verbose('Solving a new block challenge');
    this.logger.verbose('------------------------------');
    this.logger.verbose(`State: ${this.ledger.stateMap.size} levels`);
    this.logger.verbose(`Ledger; ${this.ledger.compactBlockMap.size} blocks`);
    const pieceCount = this.farm.getPieceCount();
    const plotSize = this.farm.getSize() / 1000000;
    this.logger.verbose(`Farm: ${pieceCount} pieces comprising ${plotSize} MB across ${this.farm.plots.length} plots`);
    this.logger.verbose(`Balance: ${this.wallet.getPendingBalanceOfAllAccounts()} credits`);
    this.logger.verbose('------------------------------');

    const parentProofHash = this.ledger.parentProofHash;
    const pieceTarget = crypto.hash(parentProofHash);
    const closestEncodings = await this.farm.getClosestEncodings(pieceTarget);
    if (!closestEncodings) {
      this.logger.error('Cannot find a piece within plot for target');
      throw new Error('Cannot find a piece within plot for target');
    }
    this.logger.verbose(`Closest piece to target: ${bin2Hex(pieceTarget).substr(0, 12)} is ${bin2Hex(closestEncodings.data.pieceHash).substring(0, 12)}`);

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

    this.logger.verbose(`Closest chunk to target: ${bin2Hex(chunkTarget).substring(0, 12)} is ${bin2Hex(bestChunk).substring(0, 12)} from plot ${encodingIndex}`);

    const encoding = closestEncodings.encodings[encodingIndex];
    const account = this.wallet.getAccount(this.farm.getPlotAddress(encodingIndex));

    // create proof of storage
    const unsignedProof = await Proof.create(
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

    // create the block
    const block = await this.ledger.createBlock(signedProof, coinbaseTx);

    // check if proof for this block was too late for chain
    if (!block) {
      return;
    }

    // gossip the block across the network
    if (this.isGossiping) {
      this.rpc.gossipBlock(block, encoding);
    }

    // validate the block
    if (this.ledger.isValidating) {
      await this.ledger.isValidBlock(block, encoding);
      this.logger.verbose(`Validated new block ${bin2Hex(block.key).substring(0, 12)}`);
    }

    // apply the block to the ledger
    await this.ledger.applyBlock(block);
    this.logger.verbose(`Applied new block ${bin2Hex(block.key).substring(0, 12)} to ledger.`);

    // emit the block and encoding
    this.emit('block', block, encoding);
  }

  /**
   * Sends a ping request to another node
   */
  public async ping(): Promise<void> {
    await this.rpc.ping();
    this.logger.info(`Received a ping reply from gateway`);
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
      // check to ensure you have parent
      if (! (await this.ledger.getBlock(block.value.previousBlockHash))) {
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
   * Request all blocks for a given index in the ordered ledger from another node over the network.
   *
   * @param index an integer index in the ordered ledger
   *
   * @return An array of block hashes or null if no blocks at this level
   */
  public async requestBlocksForIndex(index: number): Promise<Uint8Array[] | void> {
    return this.rpc.requestBlocksForIndex(index);
  }

  /**
   * Received a request for all blocks at a given index over the network, used to sync the chain.
   *
   * @param index
   * @param responseCallback
   */
  private async onBlocksForIndexRequest(index: number, responseCallback: (response: Uint8Array) => void): Promise<Uint8Array[] | void> {
    const blocksForIndex = this.ledger.pendingBlocksByLevel.get(index);
    if (blocksForIndex) {
      const blockIds = [...blocksForIndex.keys()];
      const blockIdsData = Buffer.concat(blockIds);
      responseCallback(blockIdsData);
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
   return this.rpc.requestBlockByIndex(index);
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
    return this.rpc.requestStateByIndex(index);
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

  public async destroy(): Promise<void> {
    await this.rpc.destroy();
  }
}
