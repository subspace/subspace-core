import {EventEmitter} from "events";
import {ICommandsKeysForSending, INodeTypesKeys} from "./constants";

export interface INodeContactAddress {
  address: string;
  tcp4Port?: number;
  udp4Port?: number;
  wsPort?: number;
}

export interface INodeContactIdentification {
  nodeId: Uint8Array;
  nodeType: INodeTypesKeys;
}

export type INodeContactInfo = INodeContactAddress & INodeContactIdentification;

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
   * Returns an array of peers known in network
   */
  getPeers(): INodeContactInfo[];

  /**
   * One-way sending
   *
   * @param nodeTypes
   * @param command
   * @param payload
   */
  sendRequestOneWay(nodeTypes: INodeTypesKeys[], command: ICommandsKeysForSending, payload?: Uint8Array): Promise<void>;

  /**
   * One-way sending (unreliable with UDP)
   *
   * @param nodeTypes
   * @param command
   * @param payload
   */
  sendRequestOneWayUnreliable(nodeTypes: INodeTypesKeys[], command: ICommandsKeysForSending, payload?: Uint8Array): Promise<void>;

  /**
   * Make request that implies response
   *
   * @param nodeTypes
   * @param command
   * @param payload
   */
  sendRequest(nodeTypes: INodeTypesKeys[], command: ICommandsKeysForSending, payload?: Uint8Array): Promise<Uint8Array>;

  /**
   * Make request that implies response (unreliable with UDP)
   *
   * @param nodeTypes
   * @param command
   * @param payload
   */
  sendRequestUnreliable(nodeTypes: INodeTypesKeys[], command: ICommandsKeysForSending, payload?: Uint8Array): Promise<Uint8Array>;

  /**
   * Start gossiping command across the network
   *
   * @param command
   * @param payload
   */
  gossip(command: ICommandsKeysForSending, payload: Uint8Array): Promise<void>;

  destroy(): Promise<void>;

  on(
    event: 'peer-connected',
    listener: (
      nodeContactInfo: INodeContactInfo,
    ) => void,
  ): this;
  on(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;

  once(
    event: 'peer-connected' | 'peer-disconnected',
    listener: (
      nodeContactInfo: INodeContactInfo,
    ) => void,
  ): this;
  once(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;

  off(
    event: 'peer-connected' | 'peer-disconnected',
    listener: (
      nodeContactInfo: INodeContactInfo,
    ) => void,
  ): this;
  off(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;

  emit(
    event: 'peer-connected' | 'peer-disconnected',
    nodeContactInfo: INodeContactInfo,
  ): boolean;
  emit(
    event: ICommandsKeysForSending,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void,
    extra: INodeContactIdentification,
  ): boolean;
}
