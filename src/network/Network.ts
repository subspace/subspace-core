import {ArrayMap} from "array-map-set";
import * as dgram from "dgram";
import {EventEmitter} from "events";
import {COMMANDS, COMMANDS_INVERSE, ICommandsKeys} from "./commands";
import {INetwork} from "./INetwork";

interface IAddress {
  address: string;
  port: number;
  // TODO: Support IPv6
  protocolVersion?: '4';
}

interface INodeAddress {
  address: string;
  nodeId: Uint8Array;
  port: number;
  // TODO: Support IPv6
  protocolVersion?: '4';
}

/**
 * @param command
 * @param requestResponseId `0` if no response is expected for request
 * @param payload
 */
function composeUdpMessage(command: ICommandsKeys, requestResponseId: number, payload: Uint8Array): Uint8Array {
  const message = new Uint8Array(payload.length + 5);
  const view = new DataView(message.buffer);
  message.set([COMMANDS[command]]);
  view.setUint32(1, requestResponseId, false);
  message.set(payload, 5);
  return message;
}

/**
 * TODO: There is no verification about where message came from
 *
 * @param message
 *
 * @return [command, requestId, payload]
 */
function parseUdpMessage(message: Uint8Array): [ICommandsKeys, number, Uint8Array] {
  if (message.length < 5) {
    throw new Error(`Incorrect message length ${message.length} bytes, at least 5 bytes expected`);
  }
  const command = COMMANDS_INVERSE[message[0]];
  if (!command) {
    throw new Error(`Unknown command number ${message[0]}`);
  }
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const requestId = view.getUint32(1);
  const payload = new Uint8Array(
    message.buffer,
    message.byteOffset + 5,
    message.byteLength - 5,
  );

  return [command, requestId, payload];
}

const emptyPayload = new Uint8Array(0);

export class Network extends EventEmitter implements INetwork {
  // Will 2**32 be enough?
  private requestId: number = 0;
  // Will 2**32 be enough?
  private responseId: number = 0;
  /**
   * Mapping from requestId to callback
   */
  private readonly requestCallbacks = new Map<number, (payload: Uint8Array) => void>();
  /**
   * Mapping from responseId to callback
   */
  private readonly responseCallbacks = new Map<number, (payload: Uint8Array) => void>();

  private readonly udp4Socket: dgram.Socket;

  private nodeIdToUdpAddressMap = ArrayMap<Uint8Array, IAddress>();
  private nodeIdToTcpAddressMap = ArrayMap<Uint8Array, IAddress>();

  constructor(
    bootstrapUdpNode: INodeAddress,
    bootstrapTcpNode: INodeAddress,
    // bootstrapWsNode: INodeAddress,
    ownUdpAddress: IAddress,
    // ownTcpAddress: IAddress,
    // ownWsAddress: IAddress,
  ) {
    super();
    this.setMaxListeners(Infinity);

    this.nodeIdToUdpAddressMap.set(
      bootstrapUdpNode.nodeId,
      {
        address: bootstrapUdpNode.address,
        port: bootstrapUdpNode.port,
        protocolVersion: bootstrapUdpNode.protocolVersion,
      },
    );

    this.nodeIdToTcpAddressMap.set(
      bootstrapTcpNode.nodeId,
      {
        address: bootstrapTcpNode.address,
        port: bootstrapTcpNode.port,
        protocolVersion: bootstrapTcpNode.protocolVersion,
      },
    );

    const udp4Socket = dgram.createSocket('udp4');
    udp4Socket.on('message', (message: Buffer, remote: dgram.RemoteInfo) => {
      try {
        const [command, requestId, payload] = parseUdpMessage(message);
        if (command === 'response') {
          // TODO:
        } else {
          if (requestId) {
            ++this.responseId;
            const responseId = this.responseId;
            // TODO: Clean up after timeout
            this.responseCallbacks.set(
              responseId,
              (payload) => {
                this.responseCallbacks.delete(responseId);
                const message = composeUdpMessage('response', requestId, payload);
                udp4Socket.send(message, remote.port, remote.address);
              },
            );
            this.emit(
              command,
              payload,
              (responsePayload: Uint8Array) => {
                const responseCallback = this.responseCallbacks.get(responseId);
                if (responseCallback) {
                  responseCallback(responsePayload);
                }
              },
            );
          } else {
            this.emit(command, payload);
          }
        }
      } catch (error) {
        // TODO: Log error in debug mode
      }
    });
    udp4Socket.bind(ownUdpAddress.port, ownUdpAddress.address);
    this.udp4Socket = udp4Socket;
  }

  // public sendOneWayRequest(nodeId: Uint8Array, command: ICommandsKeys, payload: Uint8Array = emptyPayload): Promise<void> {
  //   throw new Error("Method not implemented.");
  // }

  public async sendOneWayRequestUnreliable(nodeId: Uint8Array, command: ICommandsKeys, payload: Uint8Array = emptyPayload): Promise<void> {
    const message = composeUdpMessage(command, 0, payload);
    const {address, port} = await this.nodeIdToUdpAddress(nodeId);
    return new Promise((resolve, reject) => {
      this.udp4Socket.send(message, port, address, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  // public sendRequest(nodeId: Uint8Array, command: ICommandsKeys, payload: Uint8Array = emptyPayload): Promise<Uint8Array> {
  //   throw new Error("Method not implemented.");
  // }

  public async sendRequestUnreliable(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    ++this.requestId;
    const requestId = this.requestId;
    const message = composeUdpMessage(command, requestId, payload);
    const {address, port} = await this.nodeIdToUdpAddress(nodeId);
    return new Promise((resolve, reject) => {
      // TODO: Reject and clean up after timeout
      this.requestCallbacks.set(requestId, resolve);
      this.udp4Socket.send(message, port, address, (error) => {
        if (error) {
          reject(error);
        }
      });
    });
  }

  // public gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
  //   throw new Error("Method not implemented.");
  // }

  // public gossipUnreliable(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
  //   throw new Error("Method not implemented.");
  // }

  public destroy(): Promise<void> {
    return new Promise((resolve) => {
      this.udp4Socket.close(resolve);
    });
  }

  // Below methods are mostly to make nice TypeScript interface
  // TODO: Achieve the same without re-implementing methods

  public on(event: ICommandsKeys, listener: (payload: Uint8Array, responseCallback?: (responsePayload: Uint8Array) => void) => void): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(event: ICommandsKeys, listener: (payload: Uint8Array, responseCallback?: (responsePayload: Uint8Array) => void) => void): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(event: ICommandsKeys, listener: (payload: Uint8Array, responseCallback?: (responsePayload: Uint8Array) => void) => void): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(event: ICommandsKeys, payload: Uint8Array, responseCallback?: (responsePayload: Uint8Array) => void): boolean {
    return EventEmitter.prototype.emit.call(this, event, payload, responseCallback);
  }

  private async nodeIdToUdpAddress(nodeId: Uint8Array): Promise<IAddress> {
    const address = this.nodeIdToUdpAddressMap.get(nodeId);
    if (address) {
      return address;
    }
    // TODO: Implement fetching from DHT
    throw new Error('Sending to arbitrary nodeId is not implemented yet');
  }
}
