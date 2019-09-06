export default interface IStore {
  add(encoding: Uint8Array, offset: Uint8Array): Promise<void>;

  get(offset: Uint8Array): Promise<Uint8Array | undefined | null>;

  del(offset: Uint8Array): Promise<void>;

  close(): Promise<void>;
}
