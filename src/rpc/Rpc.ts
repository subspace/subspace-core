// tslint:disable: object-literal-sort-keys

import { ArrayMap } from "array-map-set";
import { EventEmitter } from "events";
import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { Block } from "../ledger/block";
import { Content } from "../ledger/content";
import { Proof } from "../ledger/proof";
import { State } from "../ledger/state";
import { Tx } from "../ledger/tx";
import { IPiece } from "../main/interfaces";
import { INodeContactInfo, Network } from "../network/Network";
import { bin2Hex, bin2Num, ILogger, num2Bin, smallBin2Num } from "../utils/utils";

// ToDo
  // handle validation failures without throwing
  // blacklist malicious peers
  // test sendOneWayReliable vs sendOneWayUnreliable for gossip
  // test sendReliable vs sendUnreliable for rpc methods
  // test the max UDP message size limit
  // get network stats methods
  // get node stats methods

// CLI Methods (ToDo)
  // getPeers
  // requestBlock
  // requestTx
  // requestPiece
  // requestProof
  // requestContent
  // requestState

export class Rpc extends EventEmitter {

  public peers: Map<Uint8Array, INodeContactInfo> = ArrayMap<Uint8Array, INodeContactInfo>();
  public readonly logger: ILogger;

  constructor(
    private readonly network: Network,
    private readonly blsSignatures: BlsSignatures,
    parentLogger: ILogger,
  ) {
      super();

      this.logger = parentLogger.child({subsystem: 'rpc'});

      // this node has connected to a new peer on the network
      this.network.on('peer-connected', (nodeContactInfo: INodeContactInfo) => {
        this.peers.set(nodeContactInfo.nodeId, nodeContactInfo);
        this.emit('peer-connected', nodeContactInfo);
      });

      // this node has disconnected from an existing peer on the network
      this.network.on('peer-disconnected', (nodeContactInfo: INodeContactInfo) => {
        this.peers.delete(nodeContactInfo.nodeId);
        this.emit('peer-disconnected', nodeContactInfo);
      });

      // received a ping from another node
      this.network.on('ping', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        // TODO
          // how do we know who the ping is from?
        // tslint:disable: no-console
        this.logger.verbose('ping-received');
        this.emit('ping', payload, responseCallback);
      });

      // received a new tx via gossip
      this.network.on('tx-gossip', (payload: Uint8Array) => {
        const tx = Tx.fromBytes(payload);
        if (!tx.isValid(blsSignatures)) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Received an invalid tx via gossip');
        }

        // is date no more than 10 minutes
        if (!crypto.isDateWithinRange(tx.value.timestamp, 600000)) {
          throw new Error('Received an invalid tx via gossip, date is out of range');
        }

        this.logger.verbose('tx-gossip-received', {txId: bin2Hex(tx.key)});
        this.emit('tx-gossip', tx);
      });

      // received a new block and encoding via gossip
      this.network.on('block-gossip', (payload: Uint8Array) => {
        const encoding = payload.subarray(0, 4096);
        const blockData = payload.subarray(4096);
        const block = Block.fromFullBytes(blockData);
        if (!block.isValid(blsSignatures)) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Received an invalid block via gossip');
        }

        this.logger.verbose('block-gossip-received', {blockId: bin2Hex(block.key)});
        this.emit('block-gossip', block, encoding);
      });

      // received a tx-request from another node
      this.network.on('tx-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Received an invalid tx request, tx-id is not 32 bytes');
        }
        this.logger.verbose('tx-request-received', {txId: bin2Hex(payload)});
        this.emit('tx-request', payload, responseCallback);
      });

      // received a block request from another node
      this.network.on('block-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Invalid block request, block-id is not 32 bytes');
        }
        this.logger.verbose('block-request-received', {blockId: bin2Hex(payload)});
        this.emit('block-request', payload, responseCallback);
      });

      // received a block request by index from another node
      this.network.on('block-request-by-index', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 4) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Invalid block-request-by-index, block-index is not 4 bytes');
        }
        const index = bin2Num(payload);
        this.logger.verbose('block-request-by-index-received', index);
        this.emit('block-request-by-index', index, responseCallback);
      });

      // received a block request from another node
      this.network.on('piece-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Invalid piece-request, piece-id is not 32 bytes');
        }
        this.logger.verbose('piece-request-received', {pieceId: bin2Hex(payload)});
        this.emit('piece-request', payload, responseCallback);
      });

      // received a block request from another node
      this.network.on('proof-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Invalid proof-request, proof-id is not 32 bytes');
        }
        this.logger.verbose('proof-request-received', {proofId: bin2Hex(payload)});
        this.emit('proof-request', payload, responseCallback);
      });

      // received a block request from another node
      this.network.on('content-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Invalid content-request, content-id is not 32 bytes');
        }
        this.logger.verbose('content-request-received', {contentId: bin2Hex(payload)});
        this.emit('content-request', payload, responseCallback);
      });

      // received a block request from another node
      this.network.on('state-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Invalid state request, state-id is not 32 bytes');
        }
        this.logger.verbose('state-request-received', {stateId: bin2Hex(payload)});
        this.emit('state-request', payload, responseCallback);
      });

      // received a state request by index from another node
      this.network.on('state-request-by-index', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 4) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          this.logger.debug('Invalid state-request-by-index, state-index is not 4 bytes');
        }
        const index = bin2Num(payload);
        this.logger.verbose('state-request-by-index-received', index);
        this.emit('state-request-by-index', index, responseCallback);
      });
  }

  /**
   * Returns an array of all active peers in the routing table.
   */
  public async getPeers(): Promise<INodeContactInfo[]> {
    return this.network.getPeers();
  }

  public async ping(): Promise<void> {
    return this.network.sendRequestOneWay(['full', 'gateway'], 'ping');
  }

  /**
   * Gossip a new tx out to all peers.
   *
   * @param tx      tx instance to be gossiped
   *
   */
  public async gossipTx(tx: Tx): Promise<void> {
    const binaryTx = tx.toBytes();
    await this.network.gossip('tx-gossip', binaryTx);
    this.logger.verbose('sent-tx-gossip', {txId: bin2Hex(tx.key)});
  }

  /**
   * Gossip a new block out to all peers.
   *
   * @param block   block instance to be gossiped
   *
   */
  public async gossipBlock(block: Block, encoding: Uint8Array): Promise<void> {
    const blockData = block.toFullBytes();
    const payload = Buffer.concat([encoding, blockData]);
    await this.network.gossip('block-gossip', payload);
    this.logger.verbose('sent-block-gossip', {blockId: bin2Hex(block.key)});
  }

  /**
   * Request a tx over the network by id
   *
   * @param txId    content-addressed id of tx
   *
   * @return A valid tx instance
   */
  public async requestTx(txId: Uint8Array): Promise<Tx> {
    const binaryTx = await this.network.sendRequest(['full', 'validator', 'gateway'], 'tx-request', txId);
    const tx = Tx.fromBytes(binaryTx);
    if (!tx.isValid(this.blsSignatures)) {
      // TODO
        // Drop the node who sent response from peer table
        // Add to blacklisted nodes
        // Request from another node
      this.logger.debug('Received invalid response from peer');
    }
    this.logger.verbose('tx-response-received', {txId: bin2Hex(tx.key)});
    return tx;
  }

  /**
   * Request a block over the network by id
   *
   * @param blockId content-addressed id of block
   *
   * @return A valid block instance
   */
  public async requestBlock(blockId: Uint8Array): Promise<Block> {
    const binaryBlock = await this.network.sendRequest(['gateway', 'full', 'validator'], 'block-request', blockId);
    const block = Block.fromFullBytes(binaryBlock);
    if (!block.isValid(this.blsSignatures)) {
      // TODO
        // Drop the node who sent response from peer table
        // Add to blacklisted nodes
        // Request from another node
      this.logger.debug('Received invalid block response from peer');
    }
    this.logger.verbose('block-response-received', {blockId: bin2Hex(block.key)});
    return block;
  }

  /**
   * Request a block over the network by index
   *
   * @param index sequence in which the block appears in the ledger
   *
   * @return A valid block instance
   */
  public async requestBlockByIndex(blockIndex: number): Promise<Block | void> {
    const binaryIndex = num2Bin(blockIndex);
    const binaryBlock = await this.network.sendRequest(['gateway', 'full', 'validator'], 'block-request-by-index', binaryIndex);
    if (binaryBlock.length > 0) {
      const block = Block.fromFullBytes(binaryBlock);
      if (!block.isValid(this.blsSignatures)) {
        // TODO
          // Drop the node who sent response from peer table
          // Add to blacklisted nodes
          // Request from another node
        this.logger.debug('Received invalid block response from peer');
      }
      this.logger.verbose('block-response-from-index-received', {blockId: bin2Hex(block.key)});
      return block;
    }
    this.logger.verbose('null-block-response-from-index-received', {blockIndex});
  }

  /**
   * Request a piece and metadata over the network by id
   *
   * @param pieceId content-addressed id of piece
   *
   * @return A valid piece instance, with metadata
   */
  public async requestPiece(pieceId: Uint8Array): Promise<IPiece> {
    const binaryPiece = await this.network.sendRequest(['gateway', 'full'], 'piece-request', pieceId);
    if (binaryPiece.length < 4162) {
      this.logger.debug('Received invalid piece, too short');
    }

    const piece: IPiece = {
      piece: binaryPiece.subarray(0, 4096),
      data: {
        pieceHash: binaryPiece.subarray(4096, 4128),
        stateHash: binaryPiece.subarray(4128, 4160),
        pieceIndex: smallBin2Num(binaryPiece.subarray(4160, 4162)),
        proof: binaryPiece.subarray(4162),
      },
    };

    this.logger.verbose('piece-response-received', {pieceId: bin2Hex(piece.data.pieceHash)});
    return piece;
  }

  /**
   * Request a proof record over the network by id
   *
   * @param proofId content-addressed id of proof
   *
   * @return A valid proof instance
   */
  public async requestProof(proofId: Uint8Array): Promise<Proof> {
    const binaryProof = await this.network.sendRequest(['gateway', 'full', 'validator'], 'proof-request', proofId);
    const proof = Proof.fromBytes(binaryProof);
    if (!proof.isValid(this.blsSignatures)) {
      // TODO
        // Drop the node who sent response from peer table
        // Add to blacklisted nodes
        // Request from another node
      this.logger.debug('Received invalid proof response from peer');
    }
    this.logger.verbose('proof-response-received', {proofId: bin2Hex(proof.key)});
    return proof;
  }

  /**
   * Request a content record over the network by id
   *
   * @param contentId content-addressed id of content
   *
   * @return A valid content instance
   */
  public async requestContent(contentId: Uint8Array): Promise<Content> {
    const binaryContent = await this.network.sendRequest(['gateway', 'full', 'validator'], 'content-request', contentId);
    const content = Content.fromBytes(binaryContent);
    if (!content.isValid()) {
      // TODO
        // Drop the node who sent response from peer table
        // Add to blacklisted nodes
        // Request from another node
      this.logger.debug('Received invalid content response from peer');
    }
    this.logger.verbose('content-response-received', {contentId: bin2Hex(content.key)});
    return content;
  }

  /**
   * Request a state record over the network by id
   *
   * @param stateId content-addressed id of state record
   *
   * @return A valid state instance
   */
  public async requestState(stateId: Uint8Array): Promise<State> {
    const binaryState = await this.network.sendRequest(['gateway', 'full', 'validator'], 'state-request', stateId);
    const state = State.fromBytes(binaryState);
    if (!state.isValid()) {
      // TODO
        // Drop the node who sent response from peer table
        // Add to blacklisted nodes
        // Request from another node
      this.logger.debug('Received invalid state response from peer');
    }
    this.logger.verbose('state-response-received', {stateId: bin2Hex(state.key)});
    return state;
  }

  /**
   * Request a state block over the network by index
   *
   * @param index sequence in which the state appears in the ledger
   *
   * @return A valid state instance
   */
  public async requestStateByIndex(stateIndex: number): Promise<State | void> {
    const binaryIndex = num2Bin(stateIndex);
    const binaryState = await this.network.sendRequest(['gateway', 'full', 'validator'], 'state-request-by-index', binaryIndex);
    if (binaryState.length > 0) {
      const state = State.fromBytes(binaryState);
      if (!state.isValid()) {
        // TODO
          // Drop the node who sent response from peer table
          // Add to blacklisted nodes
          // Request from another node
        this.logger.debug('Received invalid state response fro peer');
      }
      this.logger.verbose('state-response-by-index-received', {stateId: bin2Hex(state.key)});
      return state;
    }
    this.logger.verbose('null-state-response-by-index-received', stateIndex);
  }

  /**
   * Called on graceful shutdown. Close the underlying network instance and all sockets.
   */
  public async destroy(): Promise<void> {
    await this.network.destroy();
  }

}
