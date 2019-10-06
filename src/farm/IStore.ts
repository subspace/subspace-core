export default interface IStore {
  add(encoding: Uint8Array, offset: number): Promise<void>;

  get(offset: number): Promise<Uint8Array | undefined | null>;

  del(offset: number): Promise<void>;

  close(): Promise<void>;
}
