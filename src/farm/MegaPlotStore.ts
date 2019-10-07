import IStore from "./IStore";
import {MegaPlot} from "./MegaPlot";

export default class MegaPlotStore implements IStore {
  public constructor(private readonly megaPlotStore: MegaPlot, private readonly plotIndex: number) {
  }

  public add(value: Uint8Array, offset: number): Promise<void> {
    return this.megaPlotStore.add(value, offset, this.plotIndex);
  }

  public get(offset: number): Promise<Uint8Array | null> {
    return this.megaPlotStore.get(offset, this.plotIndex);
  }

  public del(offset: number): Promise<void> {
    return this.megaPlotStore.del(offset, this.plotIndex);
  }

  public async close(): Promise<void> {
    return this.megaPlotStore.close(this.plotIndex);
  }
}
