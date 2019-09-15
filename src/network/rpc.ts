// tslint:disable: object-literal-sort-keys

import { EventEmitter } from "events";
import {BlsSignatures} from "../crypto/BlsSignatures";
import { Block } from "../ledger/block";
import { Tx } from "../ledger/tx";
import { IPiece } from "../main/interfaces";
import { bin2Hex, bin2Num, num2Bin, smallBin2Num } from "../utils/utils";
import { Network } from './Network';

export class RPC extends EventEmitter {

  constructor(private readonly network: Network, private readonly blsSignatures: BlsSignatures) {
      super();

      // received a ping from another node
      this.network.on('ping', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        // TODO
          // how do we know who the ping is from?
        // tslint:disable: no-console
        this.emit('ping', payload, responseCallback);
      });

      // received a new tx via gossip
      this.network.on('tx-gossip', (payload: Uint8Array) => {
        const tx = Tx.fromBytes(payload);
        if (!tx.isValid(blsSignatures)) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          throw new Error('Received an invalid tx via gossip');
        }
        this.emit('tx-gossip', tx);
      });

      // received a new block and encoding via gossip
      this.network.on('block-gossip', (payload: Uint8Array) => {
        console.log('Received a block via gossip');
        const encoding = payload.subarray(0, 4096);
        const blockData = payload.subarray(4096);
        const block = Block.fromFullBytes(blockData);
        if (!block.isValid(blsSignatures)) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          throw new Error('Received an invalid block via gossip');
        }
        this.emit('block-gossip', block, encoding);
      });

      // received a tx-request from another node
      this.network.on('tx-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          throw new Error('Invalid tx-request, tx-id is not 32 bytes');
        }
        this.emit('tx-request', payload, responseCallback);
      });

      // received a block request from another node
      this.network.on('block-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          throw new Error('Invalid block-request, block-id is not 32 bytes');
        }
        this.emit('block-request', payload, responseCallback);
      });

      // received a block request by index from another node
      this.network.on('block-request-by-index', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 4) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          throw new Error('Invalid block-request by index, block-index is not 4 bytes');
        }
        const index = bin2Num(payload);
        this.emit('block-request-by-index', index, responseCallback);
      });

      // received a block request from another node
      this.network.on('piece-request', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        if (payload.length !== 32) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          throw new Error('Invalid piece-request, piece-id is not 32 bytes');
        }
        this.emit('piece-request', payload, responseCallback);
      });
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
  }

  /**
   * Gossip a new block out to all peers.
   *
   * @param block   block instance to be gossiped
   *
   */
  public async gossipBlock(block: Block, encoding: Uint8Array): Promise<void> {
    console.log('gossiping a new block', bin2Hex(block.key));
    const blockData = block.toFullBytes();
    const payload = Buffer.concat([encoding, blockData]);
    await this.network.gossip('block-gossip', payload);
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
      throw new Error('Received invalid tx response from peer');
    }
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
      throw new Error('Received invalid block response from peer');
    }
    return block;
  }

  /**
   * Request a block over the network by id
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
        throw new Error('Received invalid block response from peer');
      }
      return block;
    }
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
      throw new Error('Received invalid piece, too short');
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

    return piece;
  }

  public async destroy(): Promise<void> {
    await this.network.destroy();
  }

}
