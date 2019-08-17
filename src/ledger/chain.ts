// tslint:disable: variable-name

/**
 * An in-memory object that tracks the pending state of a chain on the ledger.
 */
export class Chain {

  private _index: number;
  private _height: number;
  private _blocks: Set<Uint8Array>;

  constructor(index: number) {
    this._index = index;
    this._height = 0;
    this._blocks = new Set();
  }

  /**
   * Returns the zero-indexed sequence number for this chain in the ledger.
   */
  get index(): number {
    return this._index;
  }

  /**
   * Returns the height of this chain in blocks, since genesis.
   */
  get height(): number {
    return this._height;
  }

  /**
   * Returns the number of pending blocks for this chain.
   */
  get size(): number {
    return this._blocks.size;
  }

  /**
   * Returns an array of pending block ids for this chain, in insertion order (oldest first).
   */
  get blocks(): Uint8Array[] {
    return [...this._blocks.values()];
  }

  /**
   * Checks if a pending block is in this chain.
   */
  public hasBlock(id: Uint8Array): boolean {
    return this._blocks.has(id);
  }

  /**
   * Adds a new pending block to the head of this chain.
   */
  public addBlock(id: Uint8Array): void {
    this._blocks.add(id);
    this._height += 1;
  }

  /**
   * Removes a block and all of its children blocks from the chain. Called on a chain fork.
   */
  public removeBlocks(startId: Uint8Array): void {
    if (this.hasBlock(startId)) {
      let startPoint = false;
      for (const id of this.blocks) {
        if (!startPoint) {
          if (id === startId) {
            startPoint = true;
            this._blocks.delete(id);
            this._height -= 1;
          }
        } else {
          this._blocks.delete(id);
          this._height -= 1;
        }
      }
    }
  }

  /**
   * Removes all pending blocks from the chain. Called when a new level is confirmed.
   */
  public reset(): void {
    this._blocks.clear();
  }
}
