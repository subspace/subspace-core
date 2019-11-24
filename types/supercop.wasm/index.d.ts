/**
 * This only covers minimal surface touched by this project, not entire library
 */
declare module 'supercop.wasm' {
    export function ready(callback: () => any): void;
    export function createSeed(): Uint8Array;
    export function createKeyPair(seed: Uint8Array): {publicKey: Uint8Array, secretKey: Uint8Array};
    export function sign(msg: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;
    export function verify(sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array): boolean;
}
