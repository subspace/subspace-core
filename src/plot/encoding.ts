import {decodePiece, encodePiece} from "../codes/codes";

export interface IEncoding {
    decode: (encodedPiece: Uint8Array, key: Uint8Array) => Uint8Array;
    encode: (piece: Uint8Array, key: Uint8Array) => Uint8Array;
}

export const encoding: IEncoding = {
    decode: decodePiece,
    encode: encodePiece,
};
