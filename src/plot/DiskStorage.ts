import * as fs from "fs";
import {PIECE_SIZE} from "../main/constants";
import {SINGLE_PIECE_METADATA_LENGTH} from "./constants";
import {IStorageInstance} from "./IStorage";

async function allocateEmptyFile(path: string, size: number, chunkSize: number): Promise<void> {
    const fileHandle = await fs.promises.open(path, 'w');
    let written = 0;
    const emptyPiece = Buffer.alloc(chunkSize);
    while (written < size) {
        await fileHandle.write(emptyPiece);
        written += chunkSize;
    }
    await fileHandle.close();
}

export class DiskStorage implements IStorageInstance {
    public static async create(plotSize: number, plotLocation: string): Promise<DiskStorage> {
        if (plotSize % PIECE_SIZE !== 0) {
            throw new Error('Incorrect plot dataSize, dataSize of plot should be multiple of piece dataSize');
        }
        const plotDataLocation = `${plotLocation}/plot.data`;
        const plotMetadataLocation = `${plotLocation}/plot.metadata`;
        await allocateEmptyFile(plotDataLocation, plotSize, PIECE_SIZE);
        await allocateEmptyFile(plotMetadataLocation, plotSize / PIECE_SIZE * SINGLE_PIECE_METADATA_LENGTH, SINGLE_PIECE_METADATA_LENGTH);
        return DiskStorage.open(plotLocation);
    }

    public static async open(plotLocation?: string): Promise<DiskStorage> {
        const plotDataLocation = `${plotLocation}/plot.data`;
        const plotMetadataLocation = `${plotLocation}/plot.metadata`;
        const plotSize = fs.statSync(plotDataLocation).size;
        if (plotSize % PIECE_SIZE !== 0) {
            throw new Error("Plot dataSize doesn't match piece dataSize, dataSize of plot over number of buckets should be multiple of piece dataSize");
        }
        const numberOfPieces = plotSize / PIECE_SIZE;
        const plotMetadataSize = fs.statSync(plotMetadataLocation).size;
        if (plotMetadataSize !== numberOfPieces * SINGLE_PIECE_METADATA_LENGTH) {
            throw new Error("Plot metadata dataSize doesn't match plot and piece dataSize");
        }
        const plotData = await fs.promises.open(plotDataLocation, 'r+');
        const plotMetadata = await fs.promises.open(plotMetadataLocation, 'r+');
        return new DiskStorage(plotData, plotMetadata, plotSize, numberOfPieces);
    }

    public readonly numberOfPieces: number;
    public readonly plotSize: number;

    private readonly plotData: fs.promises.FileHandle;
    private readonly plotMetadata: fs.promises.FileHandle;

    private constructor(
        plotData: fs.promises.FileHandle,
        plotMetadata: fs.promises.FileHandle,
        plotSize: number,
        numberOfPieces: number,
    ) {
        this.numberOfPieces = numberOfPieces;
        this.plotSize = plotSize;
        this.plotData = plotData;
        this.plotMetadata = plotMetadata;
    }

    public async readData(offset: number, length: number): Promise<Buffer> {
        const data = Buffer.allocUnsafe(length);
        await this.plotData.read(data, 0, length, offset);
        return data;
    }

    public async writeData(offset: number, data: Uint8Array): Promise<void> {
        await this.plotData.write(data, 0, data.length, offset);
    }

    public async readMetadata(offset: number, length: number): Promise<Buffer> {
        const data = Buffer.allocUnsafe(length);
        await this.plotMetadata.read(data, 0, length, offset);
        return data;
    }

    public async writeMetadata(offset: number, data: Uint8Array): Promise<void> {
        await this.plotMetadata.write(data, 0, data.length, offset);
    }

    public async close(): Promise<void> {
        await Promise.all([
            this.plotData.close(),
            this.plotMetadata.close(),
        ]);
    }
}
