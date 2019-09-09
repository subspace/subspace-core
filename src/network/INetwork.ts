import {EventEmitter} from "events";
import {ICommandsKeys} from "./commands";

export interface INetwork extends EventEmitter {
  /**
   * One-way sending
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  // sendOneWayRequest(nodeId: Uint8Array, command: ICommandsKeys, payload?: Uint8Array): Promise<void>;

  /**
   * One-way sending (unreliable with UDP)
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  sendOneWayRequestUnreliable(nodeId: Uint8Array, command: ICommandsKeys, payload?: Uint8Array): Promise<void>;

  /**
   * Make request that implies response
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  // sendRequest(nodeId: Uint8Array, command: ICommandsKeys, payload?: Uint8Array): Promise<Uint8Array>;

  /**
   * Make request that implies response (unreliable with UDP)
   *
   * @param nodeId
   * @param command
   * @param payload
   */
  sendRequestUnreliable(nodeId: Uint8Array, command: ICommandsKeys, payload?: Uint8Array): Promise<Uint8Array>;

  /**
   * Send response to previously received request
   *
   * @param requestId
   * @param payload
   */
  // sendResponse(requestId: number, payload: Uint8Array): Promise<void>;

  /**
   * Start gossiping command across the network
   *
   * @param command
   * @param payload
   */
  // gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void>;

  /**
   * Start gossiping command across the network (unreliable with UDP)
   *
   * @param command
   * @param payload
   */
  // gossipUnreliable(command: ICommandsKeys, payload: Uint8Array): Promise<void>;

  destroy(): Promise<void>;

  on(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;

  once(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;

  off(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;

  emit(
    event: ICommandsKeys,
    payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void,
  ): boolean;
}
