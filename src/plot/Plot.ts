import {ArrayMap} from "array-map-set";
import {hash} from "../crypto/crypto";
import {HASH_LENGTH, PIECE_SIZE} from "../main/constants";
import {SINGLE_PIECE_METADATA_LENGTH} from "./constants";
import {DiskStorage} from "./DiskStorage";
import {encoding, IEncoding} from "./encoding";
import {IStorage, IStorageInstance} from "./IStorage";

const standardEncoding = encoding;

// TODO: Locks so that reads and writes on the same indexes do not happen at the same time
export class Plot {
    /**
     * @param nodeId
     * @param plotLocation
     * @param plotSize     In Bytes, should be multiple of piece dataSize
     * @param Storage      Underlying storage implementation
     * @param encoding
     */
    public static async create(
        nodeId: Buffer,
        plotLocation: string,
        plotSize: number,
        Storage: IStorage | null = null,
        encoding: IEncoding | null = null,
    ): Promise<Plot> {
        const storage = await (Storage || DiskStorage).create(plotSize, plotLocation);
        return Plot.open(nodeId, plotLocation, storage, encoding);
    }

    /**
     * @param nodeId
     * @param plotLocation
     * @param storage
     * @param encoding
     */
    public static async open(
        nodeId: Buffer,
        plotLocation: string,
        storage: IStorageInstance | null = null,
        encoding: IEncoding | null,
    ): Promise<Plot> {
        const actualStorage = storage || await DiskStorage.open(plotLocation);
        return new Promise((resolve, reject) => {
            const plot = new Plot(
                nodeId,
                actualStorage,
                encoding || standardEncoding,
                () => {
                    resolve(plot);
                },
                reject,
            );
        });
    }

    private readonly nodeId: Buffer;
    private readonly storage: IStorageInstance;
    private readonly encoding: IEncoding;
    private lastUsedPieceIndex: number = -1;

    private initialized = false;
    private readonly pieceIdToIndex: Map<Buffer, number>;
    private readonly pieceIndexToId: Map<number, Buffer | undefined>;
    private readonly encodedIdToIndex: Map<Buffer, number>;
    private readonly pieceIndexToEncodedId: Map<number, Buffer | undefined>;

    private constructor(
        nodeId: Buffer,
        storage: IStorageInstance,
        encoding: IEncoding,
        resolve: () => void,
        reject: (error: Error) => void,
    ) {
        this.nodeId = nodeId;
        this.storage = storage;
        this.encoding = encoding;
        this.pieceIdToIndex = ArrayMap<Buffer, number>();
        this.pieceIndexToId = new Map<number, Buffer | undefined>();
        this.encodedIdToIndex = ArrayMap<Buffer, number>();
        this.pieceIndexToEncodedId = new Map<number, Buffer | undefined>();
        this.init().then(resolve, reject);
    }

    /**
     * Add piece to the free space of the plot
     *
     * @param piece
     *
     * @return Resolves with piece key
     */
    public async addPiece(piece: Buffer): Promise<Buffer> {
        if (piece.length !== PIECE_SIZE) {
            throw new Error(`Incorrect piece size: expected ${PIECE_SIZE} bytes, but ${piece.length} bytes was given`);
        }

        const indexForNewPiece = this.getIndexForNewPiece();
        if (indexForNewPiece === null) {
            throw new Error(`Plot is fully utilized, can't add more pieces`);
        }

        // TODO: Maybe some kind of log for these operations in case of unexpected power loss?
        const pieceId = Buffer.from(hash(piece));
        const encodedPiece = this.encoding.encode(piece, this.nodeId);
        const encodedId = Buffer.from(hash(encodedPiece));

        const storage = this.storage;
        await storage.writeData(indexForNewPiece * PIECE_SIZE, encodedPiece);
        await storage.writeMetadata(indexForNewPiece * HASH_LENGTH, pieceId);
        await storage.writeMetadata(indexForNewPiece * HASH_LENGTH + HASH_LENGTH, encodedId);

        this.pieceIndexToId.set(indexForNewPiece, pieceId);
        this.pieceIdToIndex.set(pieceId, indexForNewPiece);
        this.pieceIndexToEncodedId.set(indexForNewPiece, encodedId);
        this.encodedIdToIndex.set(encodedId, indexForNewPiece);

        return pieceId;
    }

    /**
     * Get piece by its key
     *
     * @param pieceId
     *
     * @return Resolves with piece on success of `null` if piece is not found in plot
     */
    public async getPiece(pieceId: Buffer): Promise<Buffer | null> {
        const pieceIndex = this.pieceIdToIndex.get(pieceId);
        if (pieceIndex === undefined) {
            return null;
        }

        const encodedPiece = await this.storage.readData(pieceIndex * PIECE_SIZE, PIECE_SIZE);

        return Buffer.from(this.encoding.decode(encodedPiece, this.nodeId));
    }

    public destroy(): Promise<void> {
        return this.storage.close();
    }

    private async init(): Promise<void> {
        if (this.initialized) {
            throw new Error('Already initialized');
        }
        this.initialized = true;
        const numberOfPieces = this.storage.numberOfPieces;
        let lastUsedPieceIndex = -1;

        const storage = this.storage;
        const metadataContents = await storage.readMetadata(0, storage.numberOfPieces * SINGLE_PIECE_METADATA_LENGTH);
        // Read metadata file and re-build in memory map with occupied keys and their offset in the plot
        for (let pieceIndex = 0; pieceIndex < numberOfPieces; ++pieceIndex) {
            const pieceMetadataOffset = pieceIndex * SINGLE_PIECE_METADATA_LENGTH;
            const pieceMetadata = metadataContents.slice(pieceMetadataOffset, pieceMetadataOffset + SINGLE_PIECE_METADATA_LENGTH);
            const pieceId = pieceMetadata.slice(0, HASH_LENGTH);
            const encodedId = pieceMetadata.slice(HASH_LENGTH);
            const empty = pieceId.find((byte) => byte !== 0) === undefined;
            if (empty) {
                // Store `undefined` if corresponding piece index is not used for storing a piece yet
                this.pieceIndexToId.set(pieceIndex, undefined);
                this.pieceIndexToEncodedId.set(pieceIndex, undefined);
                // TODO: Stop reading further, the rest of indexes will be undefined anyway, we can fill them right away
            } else {
                // We assume sequential plotting, namely after single unoccupied pieceIndex the rest is also unoccupied
                lastUsedPieceIndex = pieceIndex;
                this.pieceIndexToId.set(pieceIndex, pieceId);
                this.pieceIdToIndex.set(pieceId, pieceIndex);
                this.pieceIndexToEncodedId.set(pieceIndex, encodedId);
                this.encodedIdToIndex.set(encodedId, pieceIndex);
            }
        }

        this.lastUsedPieceIndex = lastUsedPieceIndex;
    }

    /**
     * Returns index at which to write a new piece  or `null` if there is no space anymore
     *
     * TODO: Support replacing worse pieces with better ones in case plot is full
     */
    private getIndexForNewPiece(): number | null {
        const indexForNewPiece = this.lastUsedPieceIndex + 1;

        if (indexForNewPiece === this.storage.numberOfPieces) {
            return null;
        }

        this.lastUsedPieceIndex = indexForNewPiece;

        return indexForNewPiece;
    }
}
