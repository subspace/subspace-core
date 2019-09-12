import { EventEmitter } from "events";
import {BlsSignatures} from "../crypto/BlsSignatures";
import { Block } from "../ledger/block";
import { Tx } from "../ledger/tx";
import { Network } from './Network';

export class RPC extends EventEmitter {

  constructor(private readonly network: Network, private readonly blsSignatures: BlsSignatures) {
      super();

      // received a ping from another node
      this.network.on('ping', (payload: Uint8Array, responseCallback: (response: Uint8Array) => void) => {
        // TODO
          // how do we know who the ping is from?
        // tslint:disable: no-console
        console.log('rpc heard a ping from network');
        this.emit('ping', payload, responseCallback);
      });

      // received a pong response from another node
      this.network.on('pong', (payload: Uint8Array) => {
        // TODO
          // how do we know who the ping is from?
        console.log('rpc heard a pong from network');
        this.emit('pong', payload);
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
        // tslint:disable-next-line: no-console
        console.log('Received a block via gossip over the network');
        const encoding = payload.subarray(0, 4096);
        const block = Block.fromFullBytes(payload.subarray(4096));
        if (!block.isValid(blsSignatures)) {
          // TODO
            // Drop the node who sent response from peer table
            // Add to blacklisted nodes
          throw new Error('Receive an invalid block via gossip');
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
  }

  public async ping(nodeId: Uint8Array, payload?: Uint8Array): Promise<Uint8Array> {
    return this.network.sendRequestUnreliable(nodeId, 'ping', payload);
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
  public async gossipBlock(block: Block): Promise<void> {
    const binaryBlock = block.toBytes();
    await this.network.gossip('block-gossip', binaryBlock);
  }

  /**
   * Request a tx over the network by id
   *
   * @param nodeId  address of node to request from
   * @param txId    content-addressed id of tx
   *
   * @return A valid tx instance
   */
  public async requestTx(nodeId: Uint8Array, txId: Uint8Array): Promise<Tx> {
    const binaryTx = await this.network.sendRequestUnreliable(nodeId, 'tx-request', txId);
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
   * @param nodeId  address of node to request from
   * @param blockId content-addressed id of block
   *
   * @return A valid block instance
   */
  public async requestBlock(nodeId: Uint8Array, blockId: Uint8Array): Promise<Block> {
    const binaryBlock = await this.network.sendRequestUnreliable(nodeId, 'block-request', blockId);
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

  public async destroy(): Promise<void> {
    await this.network.destroy();
  }

}
