import {ArrayMap} from "array-map-set";
import * as dgram from "dgram";
import {EventEmitter} from "events";
import * as net from "net";
import {NODE_ID_LENGTH} from "../main/constants";
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

function noopResponseCallback(): void {
  // Do nothing
}

/**
 * @param command
 * @param requestResponseId `0` if no response is expected for request
 * @param payload
 */
function composeMessage(command: ICommandsKeys, requestResponseId: number, payload: Uint8Array): Uint8Array {
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
function parseMessage(message: Uint8Array): [ICommandsKeys, number, Uint8Array] {
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

// 4 bytes for message length, 1 byte for command, 4 bytes for request ID
const MIN_TCP_MESSAGE_SIZE = 4 + 1 + 4;

const emptyPayload = new Uint8Array(0);

export class Network extends EventEmitter implements INetwork {
  // In seconds
  private readonly DEFAULT_TIMEOUT = 10;
  // In seconds
  private readonly DEFAULT_CONNECTION_EXPIRATION = 60;
  // In bytes
  private readonly UDP_MESSAGE_SIZE_LIMIT = 508;
  // In bytes, excluding 4-bytes header with message length
  private readonly TCP_MESSAGE_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MiB

  // Will 2**32 be enough?
  private requestId: number = 0;
  // Will 2**32 be enough?
  private responseId: number = 0;
  /**
   * Mapping from requestId to callback
   */
  private readonly requestCallbacks = new Map<number, (payload: Uint8Array) => any>();
  /**
   * Mapping from responseId to callback
   */
  private readonly responseCallbacks = new Map<number, (payload: Uint8Array) => any>();

  private readonly udp4Socket: dgram.Socket;
  private readonly tcp4Server: net.Server;

  private readonly nodeIdToUdpAddressMap = ArrayMap<Uint8Array, IAddress>();
  private readonly nodeIdToTcpAddressMap = ArrayMap<Uint8Array, IAddress>();
  private readonly nodeIdToTcpSocketMap = ArrayMap<Uint8Array, net.Socket>();
  private readonly tcpSocketToNodeIdMap = new Map<net.Socket, Uint8Array>();

  constructor(
    bootstrapUdpNodes: INodeAddress[],
    bootstrapTcpNodes: INodeAddress[],
    // bootstrapWsNodes: INodeAddress[],
    private readonly ownNodeId: Uint8Array,
    ownUdpAddress: IAddress,
    ownTcpAddress: IAddress,
    // ownWsAddress: IAddress,
  ) {
    super();
    this.setMaxListeners(Infinity);

    for (const bootstrapUdpNode of bootstrapUdpNodes) {
      this.nodeIdToUdpAddressMap.set(
        bootstrapUdpNode.nodeId,
        {
          address: bootstrapUdpNode.address,
          port: bootstrapUdpNode.port,
          protocolVersion: bootstrapUdpNode.protocolVersion,
        },
      );
    }

    for (const bootstrapTcpNode of bootstrapTcpNodes) {
      this.nodeIdToTcpAddressMap.set(
        bootstrapTcpNode.nodeId,
        {
          address: bootstrapTcpNode.address,
          port: bootstrapTcpNode.port,
          protocolVersion: bootstrapTcpNode.protocolVersion,
        },
      );
    }

    this.udp4Socket = this.createUdp4Socket(ownUdpAddress);
    this.tcp4Server = this.createTcp4Server(ownTcpAddress);
  }

  public async sendOneWayRequest(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    const message = composeMessage(command, 0, payload);
    const socket = await this.nodeIdToTcpSocket(nodeId);
    return this.sendTcpMessage(socket, message);
  }

  public async sendOneWayRequestUnreliable(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    const message = composeMessage(command, 0, payload);
    const {address, port} = await this.nodeIdToUdpAddress(nodeId);
    return new Promise((resolve, reject) => {
      this.udp4Socket.send(
        message,
        port,
        address,
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
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
    const message = composeMessage(command, requestId, payload);
    const UDP_MESSAGE_SIZE_LIMIT = this.UDP_MESSAGE_SIZE_LIMIT;
    if (message.length > UDP_MESSAGE_SIZE_LIMIT) {
      throw new Error(
        `UDP message too big, ${message.length} bytes specified, but only ${UDP_MESSAGE_SIZE_LIMIT} bytes allowed}`,
      );
    }
    const {address, port} = await this.nodeIdToUdpAddress(nodeId);
    return new Promise((resolve, reject) => {
      this.requestCallbacks.set(requestId, async () => {
        resolve();
      });
      setTimeout(
        () => {
          this.requestCallbacks.delete(requestId);
          reject(new Error(`Request ${requestId} timeout out`));
        },
        this.DEFAULT_TIMEOUT * 1000,
      ).unref();
      this.udp4Socket.send(
        message,
        port,
        address,
        (error) => {
          if (error) {
            reject(error);
          }
        },
      );
    });
  }

  // public gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
  //   throw new Error("Method not implemented.");
  // }

  // public gossipUnreliable(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
  //   throw new Error("Method not implemented.");
  // }

  public async destroy(): Promise<void> {
    await Promise.all([
      new Promise((resolve) => {
        this.udp4Socket.close(resolve);
      }),
      new Promise((resolve) => {
        this.tcp4Server.close(resolve);
      }),
    ]);
  }

  // Below methods are mostly to make nice TypeScript interface
  // TODO: Achieve the same without re-implementing methods

  public on(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: ICommandsKeys,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void = noopResponseCallback,
  ): boolean {
    return EventEmitter.prototype.emit.call(this, event, payload, responseCallback);
  }

  private createUdp4Socket(ownUdpAddress: IAddress): dgram.Socket {
    const udp4Socket = dgram.createSocket('udp4');
    udp4Socket.on(
      'message',
      (message: Buffer, remote: dgram.RemoteInfo) => {
        if (message.length > this.UDP_MESSAGE_SIZE_LIMIT) {
          // TODO: Log too big message in debug mode
          return;
        }
        try {
          const [command, requestId, payload] = parseMessage(message);
          if (command === 'response') {
            // TODO: No validation!
            const requestCallback = this.requestCallbacks.get(requestId);
            if (requestCallback) {
              requestCallback(payload);
              // TODO: Should this really be done in case we receive response from random sender?
              this.requestCallbacks.delete(requestId);
            }
            return;
          }
          if (requestId) {
            ++this.responseId;
            const responseId = this.responseId;
            this.responseCallbacks.set(
              responseId,
              async (payload) => {
                this.responseCallbacks.delete(responseId);
                const message = composeMessage('response', requestId, payload);
                udp4Socket.send(message, remote.port, remote.address);
              },
            );
            setTimeout(
              () => {
                this.responseCallbacks.delete(responseId);
              },
              this.DEFAULT_TIMEOUT * 1000,
            ).unref();
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
        } catch (error) {
          // TODO: Log error in debug mode
        }
      },
    );
    udp4Socket.on('error', () => {
      // TODO: Handle errors
    });
    udp4Socket.bind(ownUdpAddress.port, ownUdpAddress.address);

    return udp4Socket;
  }

  private createTcp4Server(ownTcpAddress: IAddress): net.Server {
    const tcp4Server = net.createServer();
    tcp4Server.on('connection', (socket: net.Socket) => {
      this.registerTcpConnection(socket);
    });
    tcp4Server.on('error', () => {
      // TODO: Handle errors
    });
    tcp4Server.listen(ownTcpAddress.port, ownTcpAddress.address);

    return tcp4Server;
  }

  private registerTcpConnection(socket: net.Socket, nodeId?: Uint8Array): void {
    let receivedBuffer: Buffer = Buffer.allocUnsafe(0);
    socket
      .on('data', (buffer: Buffer) => {
        receivedBuffer = Buffer.concat([receivedBuffer, buffer]);

        while (receivedBuffer.length >= MIN_TCP_MESSAGE_SIZE) {
          const messageLength = receivedBuffer.readUInt32BE(0);
          if (receivedBuffer.length < (4 + messageLength)) {
            break;
          }
          const message = receivedBuffer.slice(4, 4 + messageLength);
          this.handleTcpMessage(socket, message);
          receivedBuffer = receivedBuffer.slice(4 + messageLength);
        }
      })
      .on('close', () => {
        const nodeId = this.tcpSocketToNodeIdMap.get(socket);
        if (nodeId) {
          this.tcpSocketToNodeIdMap.delete(socket);
          this.nodeIdToTcpSocketMap.delete(nodeId);
        }
      })
      .setTimeout(this.DEFAULT_CONNECTION_EXPIRATION * 1000)
      .on('timeout', () => {
        socket.destroy();
      });
    // TODO: Connection expiration for cleanup
    if (nodeId) {
      this.nodeIdToTcpSocketMap.set(nodeId, socket);
      this.tcpSocketToNodeIdMap.set(socket, nodeId);
    }
  }

  private handleTcpMessage(socket: net.Socket, message: Buffer): void {
    if (message.length > this.TCP_MESSAGE_SIZE_LIMIT) {
      // TODO: Log too big message in debug mode
      return;
    }
    try {
      const [command, requestId, payload] = parseMessage(message);
      // TODO: Almost no validation!
      switch (command) {
        case 'identification':
          if (payload.length !== NODE_ID_LENGTH) {
            // TODO: Log in debug mode that payload length is incorrect
            socket.destroy();
          } else if (this.nodeIdToTcpSocketMap.has(payload)) {
            // TODO: Log in debug mode that node mapping is already present
            socket.destroy();
          } else {
            const nodeId = payload.slice();
            this.nodeIdToTcpSocketMap.set(nodeId, socket);
            this.tcpSocketToNodeIdMap.set(socket, nodeId);
          }
          break;
        case 'response':
          if (!this.tcpSocketToNodeIdMap.has(socket)) {
            // TODO: Log in debug mode that non-identified node tried to send message
            break;
          }
          const requestCallback = this.requestCallbacks.get(requestId);
          if (requestCallback) {
            requestCallback(payload);
            // TODO: Should this really be done in case we receive response from random sender?
            this.requestCallbacks.delete(requestId);
          }
          break;
        default:
          if (!this.tcpSocketToNodeIdMap.has(socket)) {
            // TODO: Log in debug mode that non-identified node tried to send message
            break;
          }
          if (requestId) {
            ++this.responseId;
            const responseId = this.responseId;
            this.responseCallbacks.set(
              responseId,
              (payload) => {
                this.responseCallbacks.delete(responseId);
                const message = composeMessage('response', requestId, payload);
                return this.sendTcpMessage(socket, message);
              },
            );
            setTimeout(
              () => {
                this.responseCallbacks.delete(responseId);
              },
              this.DEFAULT_TIMEOUT * 1000,
            ).unref();
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
          break;
      }
    } catch (error) {
      // TODO: Log error in debug mode
    }
  }

  private async sendTcpMessage(socket: net.Socket, message: Uint8Array): Promise<void> {
    const header = new Uint8Array(4);
    const view = new DataView(header.buffer);
    view.setUint32(0, message.length, false);
    if (!socket.destroyed) {
      // 2 `.write` calls to avoid `Buffer.concat()` with unnecessary memory copying
      await new Promise((resolve, reject) => {
        socket.write(header, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await new Promise((resolve, reject) => {
        socket.write(message, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  }

  private async nodeIdToUdpAddress(nodeId: Uint8Array): Promise<IAddress> {
    const address = this.nodeIdToUdpAddressMap.get(nodeId);
    if (address) {
      return address;
    }
    // TODO: Implement fetching from DHT
    throw new Error('Sending to arbitrary nodeId is not implemented yet');
  }

  private async nodeIdToTcpSocket(nodeId: Uint8Array): Promise<net.Socket> {
    const socket = this.nodeIdToTcpSocketMap.get(nodeId);
    if (socket) {
      return socket;
    }
    const address = this.nodeIdToTcpAddressMap.get(nodeId);
    if (address) {
      return new Promise((resolve, reject) => {
        let timedOut = false;
        const timeout = setTimeout(
          () => {
            timedOut = true;
            const hexNodeId = Array.from(nodeId)
              .map((byte) => byte.toString(16))
              .join('');
            reject(new Error(`Connection to node ${hexNodeId}`));
          },
          this.DEFAULT_TIMEOUT * 1000,
        );
        timeout.unref();
        const socket = net.createConnection(
          address.port,
          address.address,
          () => {
            clearTimeout(timeout);
            if (timedOut) {
              socket.destroy();
            } else {
              const identificationMessage = composeMessage(
                'identification',
                0,
                this.ownNodeId,
              );
              socket.write(identificationMessage);
              this.registerTcpConnection(socket, nodeId);
              resolve(socket);
            }
          },
        );
      });
    }
    // TODO: Implement fetching from DHT
    throw new Error('Sending to arbitrary nodeId is not implemented yet');
  }
}