declare module 'random-bytes-numbers' {
  export function random_bytes(size: number): Uint8Array;
  export function random_int(min: number, max: number): number;
  export function random(): number;
}
