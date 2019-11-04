import { ArrayMap } from "array-map-set";

interface IBlock {
  key: Uint8Array;
  parentProof: Uint8Array;
  parentContent: Uint8Array;
}

// purpose
//  read blocks in a canonical order
//  know what blocks are seen at the same time
//  visualize the linkages betwen blocks

export class Level {

  public blockCount: number = 0;
  private levels: Map<number, Set<IBlock>> = new Map();
  private blocks: Map<Uint8Array, number> = ArrayMap<Uint8Array, number>();

  /**
   * Add a new level to the block tree once all blocks for that level are confirmed
   *
   * @param blocks an array of compact block values
   */
  public addLevel(blocks: Set<IBlock>): void {
    const levelIndex = this.levels.size;
    this.levels.set(levelIndex, blocks);
    for (const block of [...blocks]) {
      this.blocks.set(block.key, levelIndex);
      this.blockCount ++;
    }
  }

  /**
   * Get all confimred blocks for a level
   *
   * @param levelIndex the numeric index for the level
   *
   * @return a set of compact blocks
   */
  public getBlocksForLevel(levelIndex: number): Set<IBlock> | undefined {
    return this.levels.get(levelIndex);
  }

  /**
   * Get the level for a block by id
   *
   * @param blockId 32 byte content addressed block id
   *
   * @return numeric index for level
   */
  public getLevelForBlock(blockId: Uint8Array): number | undefined {
    return this.blocks.get(blockId);
  }

  /**
   * Return the number of confirmed levels in the ledger
   */
  public getLevelCount(): number {
    return this.levels.size;
  }
}
