export default interface IAdapter {
  put(key: Uint8Array, value: Uint8Array): Promise<void>;

  get(key: Uint8Array): Promise<Uint8Array | null>;

  del(key: Uint8Array): Promise<void>;

  getKeys(): Promise<Uint8Array[]>;

  getLength(): Promise<number>;

  clear(): Promise<void>;

  close(): Promise<void>;
}
