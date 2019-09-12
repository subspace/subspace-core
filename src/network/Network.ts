import {ArrayMap, ArraySet} from "array-map-set";
import * as dgram from "dgram";
import {EventEmitter} from "events";
import * as http from "http";
import * as net from "net";
import * as websocket from "websocket";
import {hash} from "../crypto/crypto";
import {COMMANDS, COMMANDS_INVERSE, GOSSIP_COMMANDS, ICommandsKeys} from "./commands";
import {INetwork} from "./INetwork";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {composeMessage} from "./utils";
import {WsManager} from "./WsManager";

type WebSocketConnection = websocket.w3cwebsocket | websocket.connection;

export interface IAddress {
  address: string;
  port: number;
  // TODO: Support IPv6
  protocolVersion?: '4';
}

export interface INodeAddress {
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
function composeMessageWithTcpHeader(
  command: ICommandsKeys,
  requestResponseId: number,
  payload: Uint8Array,
): Uint8Array {
  // 4 bytes for message length, 1 byte for command, 4 bytes for requestResponseId
  const message = new Uint8Array(4 + 1 + 4 + payload.length);
  const view = new DataView(message.buffer);
  view.setUint32(0, 1 + 4 + payload.length, false);
  message.set([COMMANDS[command]], 4);
  view.setUint32(4 + 1, requestResponseId, false);
  message.set(payload, 4 + 1 + 4);
  return message;
}

export function compareUint8Array(aKey: Uint8Array, bKey: Uint8Array): -1 | 0 | 1 {
  const length = aKey.length;
  for (let i = 0; i < length; ++i) {
    const diff = aKey[i] - bKey[i];
    if (diff < 0) {
      return -1;
    } else if (diff > 0) {
      return 1;
    }
  }
  return 0;
}

function nodeIdToHex(nodeId: Uint8Array): string {
  return Array.from(nodeId)
    .map((byte) => byte.toString(16))
    .join('');
}

// 4 bytes for message length, 1 byte for command, 4 bytes for request ID
const MIN_TCP_MESSAGE_SIZE = 4 + 1 + 4;

const emptyPayload = new Uint8Array(0);

export class Network extends EventEmitter implements INetwork {
  // In seconds
  private readonly DEFAULT_TIMEOUT = 10;
  // In seconds
  private readonly DEFAULT_CONNECTION_EXPIRATION = 60;
  // In seconds
  private readonly GOSSIP_CACHE_TIMEOUT = 60;
  // In bytes
  private readonly UDP_MESSAGE_SIZE_LIMIT = 508;
  // In bytes, excluding 4-bytes header with message length
  private readonly TCP_MESSAGE_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MiB
  // In bytes
  private readonly WS_MESSAGE_SIZE_LIMIT = this.TCP_MESSAGE_SIZE_LIMIT;

  // Will 2**32 be enough?
  private requestId: number = 0;

  private readonly udp4Socket: dgram.Socket | undefined;
  private readonly tcp4Server: net.Server | undefined;
  private readonly wsServer: websocket.server | undefined;
  private readonly httpServer: http.Server | undefined;

  private readonly udpManager: UdpManager;
  private readonly tcpManager: TcpManager;
  private readonly wsManager: WsManager;

  private readonly nodeIdToUdpAddressMap = ArrayMap<Uint8Array, IAddress>();
  private readonly nodeIdToTcpAddressMap = ArrayMap<Uint8Array, IAddress>();
  private readonly nodeIdToWsAddressMap = ArrayMap<Uint8Array, IAddress>();
  private readonly gossipCache = new Set<string>();

  constructor(
    bootstrapUdpNodes: INodeAddress[],
    bootstrapTcpNodes: INodeAddress[],
    bootstrapWsNodes: INodeAddress[],
    // TODO: If `browserNode === true` then avoid running servers and establishing UDP/TCP connections
    private readonly browserNode: boolean,
    private readonly ownNodeId: Uint8Array,
    ownUdpAddress?: IAddress,
    ownTcpAddress?: IAddress,
    ownWsAddress?: IAddress,
  ) {
    super();
    this.setMaxListeners(Infinity);

    const udpManager = new UdpManager(this.UDP_MESSAGE_SIZE_LIMIT, this.DEFAULT_TIMEOUT);
    udpManager
      .on('gossip', (gossipMessage: Uint8Array, sourceNodeId?: Uint8Array) => {
        this.handleIncomingGossip(gossipMessage, sourceNodeId);
      })
      .on('command', (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => {
        this.emit(command, payload, responseCallback);
      });
    this.udpManager = udpManager;

    const tcpManager = new TcpManager(this.TCP_MESSAGE_SIZE_LIMIT, this.DEFAULT_TIMEOUT);
    tcpManager
      .on('gossip', (gossipMessage: Uint8Array, sourceNodeId?: Uint8Array) => {
        this.handleIncomingGossip(gossipMessage, sourceNodeId);
      })
      .on('command', (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => {
        this.emit(command, payload, responseCallback);
      });
    this.tcpManager = tcpManager;

    const wsManager = new WsManager(this.WS_MESSAGE_SIZE_LIMIT, this.DEFAULT_TIMEOUT);
    wsManager
      .on('gossip', (gossipMessage: Uint8Array, sourceNodeId?: Uint8Array) => {
        this.handleIncomingGossip(gossipMessage, sourceNodeId);
      })
      .on('command', (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => {
        this.emit(command, payload, responseCallback);
      });
    this.wsManager = wsManager;

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

    for (const bootstrapWsNode of bootstrapWsNodes) {
      this.nodeIdToWsAddressMap.set(
        bootstrapWsNode.nodeId,
        {
          address: bootstrapWsNode.address,
          port: bootstrapWsNode.port,
          protocolVersion: bootstrapWsNode.protocolVersion,
        },
      );
    }

    if (ownUdpAddress) {
      this.udp4Socket = this.createUdp4Socket(ownUdpAddress);
    }
    if (ownTcpAddress) {
      this.tcp4Server = this.createTcp4Server(ownTcpAddress);
    }
    if (ownWsAddress) {
      const httpServer = http.createServer();
      this.wsServer = this.createWebSocketServer(httpServer);
      httpServer.listen(ownWsAddress.port, ownWsAddress.address);
      this.httpServer = httpServer;
    }
  }

  public async sendOneWayRequest(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    const wsConnection = this.wsManager.nodeIdToConnectionMap.get(nodeId);
    if (wsConnection) {
      // Node likely doesn't have any other way to communicate besides WebSocket
      return this.wsManager.sendMessage(wsConnection, command, 0, payload);
    }
    const socket = await this.nodeIdToTcpSocket(nodeId);
    if (socket) {
      return this.tcpManager.sendMessage(socket, command, 0, payload);
    }

    {
      const wsConnection = await this.nodeIdToWsConnection(nodeId);
      if (wsConnection) {
        return this.wsManager.sendMessage(wsConnection, command, 0, payload);
      }

      throw new Error(`Node ${nodeIdToHex(nodeId)} unreachable`);
    }
  }

  public async sendOneWayRequestUnreliable(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    if (this.browserNode) {
      return this.sendOneWayRequest(nodeId, command, payload);
    }

    const address = await this.nodeIdToUdpAddress(nodeId);
    // TODO: Fallback to reliable if no UDP route?
    return this.udpManager.sendMessage(
      [
        (this.udp4Socket as dgram.Socket),
        address,
      ],
      command,
      0,
      payload,
    );
  }

  public async sendRequest(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    ++this.requestId;
    const requestId = this.requestId;
    const wsConnection = this.wsManager.nodeIdToConnectionMap.get(nodeId);
    if (wsConnection) {
      // Node likely doesn't have any other way to communicate besides WebSocket
      return new Promise((resolve, reject) => {
        this.wsManager.requestCallbacks.set(requestId, resolve);
        const timeout = setTimeout(
          () => {
            this.wsManager.requestCallbacks.delete(requestId);
            reject(new Error(`Request ${requestId} timeout out`));
          },
          this.DEFAULT_TIMEOUT * 1000,
        );
        if (timeout.unref) {
          timeout.unref();
        }
        this.wsManager.sendMessage(wsConnection, command, requestId, payload)
          .catch((error) => {
            this.wsManager.requestCallbacks.delete(requestId);
            clearTimeout(timeout);
            reject(error);
          });
      });
    }
    const socket = await this.nodeIdToTcpSocket(nodeId);
    if (socket) {
      return new Promise((resolve, reject) => {
        this.tcpManager.requestCallbacks.set(requestId, resolve);
        const timeout = setTimeout(
          () => {
            this.tcpManager.requestCallbacks.delete(requestId);
            reject(new Error(`Request ${requestId} timeout out`));
          },
          this.DEFAULT_TIMEOUT * 1000,
        );
        if (timeout.unref) {
          timeout.unref();
        }
        this.tcpManager.sendMessage(socket, command, requestId, payload)
          .catch((error) => {
            this.tcpManager.requestCallbacks.delete(requestId);
            clearTimeout(timeout);
            reject(error);
          });
      });
    }

    {
      const wsConnection = await this.nodeIdToWsConnection(nodeId);
      if (wsConnection) {
        return new Promise((resolve, reject) => {
          this.wsManager.requestCallbacks.set(requestId, resolve);
          const timeout = setTimeout(
            () => {
              this.wsManager.requestCallbacks.delete(requestId);
              reject(new Error(`Request ${requestId} timeout out`));
            },
            this.DEFAULT_TIMEOUT * 1000,
          );
          if (timeout.unref) {
            timeout.unref();
          }
          this.wsManager.sendMessage(wsConnection, command, requestId, payload)
            .catch((error) => {
              this.wsManager.requestCallbacks.delete(requestId);
              clearTimeout(timeout);
              reject(error);
            });
        });
      }

      throw new Error(`Node ${nodeIdToHex(nodeId)} unreachable`);
    }
  }

  public async sendRequestUnreliable(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    if (this.browserNode) {
      return this.sendRequest(nodeId, command, payload);
    }
    ++this.requestId;
    const requestId = this.requestId;
    const address = await this.nodeIdToUdpAddress(nodeId);
    // TODO: Fallback to reliable if no UDP route?
    return new Promise((resolve, reject) => {
      this.udpManager.requestCallbacks.set(requestId, resolve);
      const timeout = setTimeout(
        () => {
          this.udpManager.requestCallbacks.delete(requestId);
          reject(new Error(`Request ${requestId} timeout out`));
        },
        this.DEFAULT_TIMEOUT * 1000,
      );
      if (timeout.unref) {
        timeout.unref();
      }
      this.udpManager.sendMessage(
        [
          (this.udp4Socket as dgram.Socket),
          address,
        ],
        command,
        requestId,
        payload,
      )
        .catch((error) => {
          if (error) {
            this.udpManager.requestCallbacks.delete(requestId);
            clearTimeout(timeout);
            reject(error);
          }
        });
    });
  }

  public async gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
    if (!GOSSIP_COMMANDS.has(command)) {
      throw new Error(`Command ${command} is not supported for gossiping`);
    }
    const gossipMessage = new Uint8Array(1 + payload.length);
    gossipMessage.set([COMMANDS[command]]);
    gossipMessage.set(payload, 1);
    this.gossipInternal(gossipMessage);
  }

  public async destroy(): Promise<void> {
    await Promise.all([
      new Promise((resolve) => {
        if (this.udp4Socket) {
          this.udp4Socket.close(resolve);
        } else {
          resolve();
        }
      }),
      new Promise((resolve) => {
        for (const socket of this.tcpManager.nodeIdToConnectionMap.values()) {
          socket.destroy();
        }
        if (this.tcp4Server) {
          this.tcp4Server.close(resolve);
        } else {
          resolve();
        }
      }),
      new Promise((resolve) => {
        for (const connection of this.wsManager.nodeIdToConnectionMap.values()) {
          connection.close();
        }
        if (this.wsServer) {
          this.wsServer.shutDown();
        }
        if (this.httpServer) {
          this.httpServer.close(resolve);
        } else {
          resolve();
        }
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
        this.udpManager.handleIncomingMessage(
          [
            udp4Socket,
            remote,
          ],
          message,
        )
          .catch((_) => {
            // TODO: Handle errors
          });
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

  private createWebSocketServer(httpServer: http.Server): websocket.server {
    const wsServer = new websocket.server({
      fragmentOutgoingMessages: false,
      httpServer,
      keepaliveGracePeriod: 5000,
      keepaliveInterval: 2000,
    });
    wsServer
      .on('request', (request: websocket.request) => {
        const connection = request.accept();
        this.registerServerWsConnection(connection);
      })
      .on('close', (connection: websocket.connection) => {
        this.wsManager.connectionCloseHandler(connection);
      });

    return wsServer;
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
          this.tcpManager.handleIncomingMessage(socket, message)
            .catch((_) => {
              // TODO: Handle errors
            });
          receivedBuffer = receivedBuffer.slice(4 + messageLength);
        }
      })
      .on('close', () => {
        const nodeId = this.tcpManager.connectionToNodeIdMap.get(socket);
        if (nodeId) {
          this.tcpManager.connectionToNodeIdMap.delete(socket);
          this.tcpManager.nodeIdToConnectionMap.delete(nodeId);
        }
      })
      .setTimeout(this.DEFAULT_CONNECTION_EXPIRATION * 1000)
      .on('timeout', () => {
        socket.destroy();
      });
    // TODO: Connection expiration for cleanup
    if (nodeId) {
      this.tcpManager.nodeIdToConnectionMap.set(nodeId, socket);
      this.tcpManager.connectionToNodeIdMap.set(socket, nodeId);
    }
  }

  private registerServerWsConnection(connection: websocket.connection, nodeId?: Uint8Array): void {
    connection
      .on('message', (message: websocket.IMessage) => {
        if (message.type !== 'binary') {
          connection.close();
          // Because https://github.com/theturtle32/WebSocket-Node/issues/354
          this.wsManager.connectionCloseHandler(connection);
          // TODO: Log in debug mode that only binary messages are supported
          return;
        }
        const buffer = message.binaryData as Buffer;
        this.wsManager.handleIncomingMessage(connection, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
          .catch((_) => {
            // TODO: Handle errors
          });
      });
    // TODO: Connection expiration for cleanup
    if (nodeId) {
      this.wsManager.nodeIdToConnectionMap.set(nodeId, connection);
      this.wsManager.connectionToNodeIdMap.set(connection, nodeId);
    }
  }

  private registerBrowserWsConnection(connection: websocket.w3cwebsocket, nodeId?: Uint8Array): void {
    connection.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) {
        connection.close();
        // TODO: Log in debug mode that only binary messages are supported
        return;
      }
      this.wsManager.handleIncomingMessage(connection, new Uint8Array(event.data))
        .catch((_) => {
          // TODO: Handle errors
        });
    };
    // TODO: Connection expiration for cleanup
    if (nodeId) {
      this.wsManager.nodeIdToConnectionMap.set(nodeId, connection);
      this.wsManager.connectionToNodeIdMap.set(connection, nodeId);
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

  private async nodeIdToTcpSocket(nodeId: Uint8Array): Promise<net.Socket | null> {
    if (this.browserNode) {
      return null;
    }
    const socket = this.tcpManager.nodeIdToConnectionMap.get(nodeId);
    if (socket) {
      return socket;
    }
    const address = this.nodeIdToTcpAddressMap.get(nodeId);
    if (!address) {
      return null;
    }
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timeout = setTimeout(
        () => {
          timedOut = true;
          reject(new Error(`Connection to node ${nodeIdToHex(nodeId)}`));
        },
        this.DEFAULT_TIMEOUT * 1000,
      );
      if (timeout.unref) {
        timeout.unref();
      }
      const socket = net.createConnection(
        address.port,
        address.address,
        () => {
          clearTimeout(timeout);
          if (timedOut) {
            socket.destroy();
          } else {
            const identificationMessage = composeMessageWithTcpHeader(
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

  private async nodeIdToWsConnection(nodeId: Uint8Array): Promise<WebSocketConnection | null> {
    const connection = this.wsManager.nodeIdToConnectionMap.get(nodeId);
    if (connection) {
      return connection;
    }
    const address = this.nodeIdToWsAddressMap.get(nodeId);
    if (!address) {
      return null;
    }
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timeout = setTimeout(
        () => {
          timedOut = true;
          reject(new Error(`Connection to node ${nodeIdToHex(nodeId)}`));
        },
        this.DEFAULT_TIMEOUT * 1000,
      );
      if (timeout.unref) {
        timeout.unref();
      }
      if (!this.browserNode) {
        resolve(null);
        return;
      }
      const connection = new websocket.w3cwebsocket(`ws://${address.address}:${address.port}`);
      connection.onopen = () => {
        clearTimeout(timeout);
        if (timedOut) {
          connection.close();
        } else {
          const identificationMessage = composeMessage(
            'identification',
            0,
            this.ownNodeId,
          );
          connection.send(identificationMessage);
          this.registerBrowserWsConnection(connection, nodeId);
          resolve(connection);
        }
      };
      connection.onclose = () => {
        this.wsManager.connectionCloseHandler(connection);
      };
    });
  }

  private handleIncomingGossip(gossipMessage: Uint8Array, sourceNodeId?: Uint8Array): void {
    const command = COMMANDS_INVERSE[gossipMessage[0]];
    if (!GOSSIP_COMMANDS.has(command)) {
      // TODO: Log in debug mode
      return;
    }
    const messageHash = hash(gossipMessage).join(',');
    if (this.gossipCache.has(messageHash)) {
      // Prevent infinite recursive gossiping
      return;
    }
    this.gossipCache.add(messageHash);

    const payload = gossipMessage.subarray(1);
    this.emit(command, payload);

    this.gossipInternal(gossipMessage, sourceNodeId)
      .catch((_) => {
        // TODO: Log in debug mode
      });
  }

  private async gossipInternal(gossipMessage: Uint8Array, sourceNodeId?: Uint8Array): Promise<void> {
    const message = composeMessage('gossip', 0, gossipMessage);
    // TODO: Store hash of the message and do not re-gossip it further
    if (message.length >= this.TCP_MESSAGE_SIZE_LIMIT) {
      throw new Error(
        `Too big message of ${message.length} bytes, can't gossip more than ${this.TCP_MESSAGE_SIZE_LIMIT} bytes`,
      );
    }
    const messageHash = hash(message).join(',');
    this.gossipCache.add(messageHash);
    const timeout = setTimeout(
      () => {
        this.gossipCache.delete(messageHash);
      },
      this.GOSSIP_CACHE_TIMEOUT * 1000,
    );
    if (timeout.unref) {
      timeout.unref();
    }

    const allNodesSet = ArraySet([
      ...this.nodeIdToUdpAddressMap.keys(),
      ...this.nodeIdToTcpAddressMap.keys(),
      ...this.nodeIdToWsAddressMap.keys(),
      ...this.tcpManager.nodeIdToConnectionMap.keys(),
      ...this.wsManager.nodeIdToConnectionMap.keys(),
    ]);
    if (sourceNodeId) {
      allNodesSet.delete(sourceNodeId);
    }
    const nodesToGossipTo = Array.from(allNodesSet)
      .sort(compareUint8Array)
      .slice(
        0,
        Math.max(
          Math.log2(allNodesSet.size),
          10,
        ),
      );

    const fitsInUdp = message.length <= this.UDP_MESSAGE_SIZE_LIMIT;

    for (const nodeId of nodesToGossipTo) {
      const socket = this.tcpManager.nodeIdToConnectionMap.get(nodeId);
      if (socket) {
        this.tcpManager.sendRawMessage(socket, message)
          .catch((_) => {
            // TODO: Log in debug mode
          });
        continue;
      }
      const udpAddress = this.nodeIdToUdpAddressMap.get(nodeId);
      if (this.udp4Socket && fitsInUdp && udpAddress) {
        this.udp4Socket.send(
          message,
          udpAddress.port,
          udpAddress.address,
          (error) => {
            if (error) {
              // TODO: Log in debug mode
            }
          },
        );
        continue;
      }
      const wsConnection = this.wsManager.nodeIdToConnectionMap.get(nodeId);
      if (wsConnection) {
        // Node likely doesn't have any other way to communicate besides WebSocket
        this.wsManager.sendRawMessage(wsConnection, message)
          .catch((_) => {
            // TODO: Log in debug mode
          });
      }

      this.nodeIdToTcpSocket(nodeId)
        .then(async (socket) => {
          if (socket) {
            return this.tcpManager.sendRawMessage(socket, message);
          }

          const wsConnection = await this.nodeIdToWsConnection(nodeId);
          if (wsConnection) {
            return this.wsManager.sendRawMessage(wsConnection, message);
          }

          throw new Error(`Node ${nodeIdToHex(nodeId)} unreachable`);
        })
        .catch((_) => {
          // TODO: Log in debug mode
        });
    }
  }
}
