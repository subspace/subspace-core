export interface IStorage {
    /**
     * Create storage from scratch (override if already exists)
     *
     * @param size
     * @param location Storage-specific location
     */
    create(size: number, location: string): Promise<IStorageInstance>;

    /**
     * Open existing storage (should already be created)
     *
     * @param location Storage-specific location
     */
    open(location?: string): Promise<IStorageInstance>;
}

export interface IStorageInstance {
    numberOfPieces: number;
    plotSize: number;

    /**
     * @param offset At which offset to start reading
     * @param length How many bytes to read
     */
    readData(offset: number, length: number): Promise<Buffer>;

    /**
     * @param offset At which offset to start writing
     * @param data Bytes to write
     */
    writeData(offset: number, data: Uint8Array): Promise<void>;

    /**
     * @param offset At which offset to start reading
     * @param length How many bytes to read
     */
    readMetadata(offset: number, length: number): Promise<Buffer>;

    /**
     * @param offset At which offset to start writing
     * @param data Bytes to write
     */
    writeMetadata(offset: number, data: Uint8Array): Promise<void>;

    close(): Promise<void>;
}
