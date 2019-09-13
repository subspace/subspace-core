import {EventEmitter} from "events";
import {ICommandsKeysForSending, INodeTypesKeys} from "./constants";

export interface INodeContactInfo {
  address: string;
  nodeId: Uint8Array;
  nodeType: INodeTypesKeys;
  tcp4Port?: number;
  udp4Port?: number;
  wsPort?: number;
}

export interface INodeContactInfoUdp extends INodeContactInfo {
  udp4Port: number;
}

export interface INodeContactInfoTcp extends INodeContactInfo {
  tcp4Port: number;
}

export interface INodeContactInfoWs extends INodeContactInfo {
  wsPort: number;
}

export interface INetwork extends EventEmitter {
  /**
   * One-way sending
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  sendOneWayRequest(nodeId: Uint8Array, command: ICommandsKeysForSending, payload?: Uint8Array): Promise<void>;

  /**
   * One-way sending (unreliable with UDP)
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  sendOneWayRequestUnreliable(nodeId: Uint8Array, command: ICommandsKeysForSending, payload?: Uint8Array): Promise<void>;

  /**
   * Make request that implies response
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  sendRequest(nodeId: Uint8Array, command: ICommandsKeysForSending, payload?: Uint8Array): Promise<Uint8Array>;

  /**
   * Make request that implies response (unreliable with UDP)
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  sendRequestUnreliable(nodeId: Uint8Array, command: ICommandsKeysForSending, payload?: Uint8Array): Promise<Uint8Array>;

  /**
   * Start gossiping command across the network
   *
   * @param command
   * @param payload
   */
  gossip(command: ICommandsKeysForSending, payload: Uint8Array): Promise<void>;

  destroy(): Promise<void>;

  on(
    event: ICommandsKeysForSending,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;

  once(
    event: ICommandsKeysForSending,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;

  off(
    event: ICommandsKeysForSending,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;

  emit(
    event: ICommandsKeysForSending,
    payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void,
  ): boolean;
}
