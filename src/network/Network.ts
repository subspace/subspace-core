import {ArrayMap} from "array-map-set";
import {EventEmitter} from "events";
import * as http from "http";
import * as net from "net";
import * as websocket from "websocket";
import {bin2Hex} from "../utils/utils";
import {COMMANDS, ICommandsKeys} from "./commands";
import {GossipManager} from "./GossipManager";
import {INetwork} from "./INetwork";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {composeMessage, noopResponseCallback} from "./utils";
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

  private readonly tcp4Server: net.Server | undefined;
  private readonly wsServer: websocket.server | undefined;
  private readonly httpServer: http.Server | undefined;

  private readonly udpManager: UdpManager;
  private readonly tcpManager: TcpManager;
  private readonly wsManager: WsManager;
  private readonly gossipManager: GossipManager;

  private readonly nodeIdToUdpAddressMap = ArrayMap<Uint8Array, IAddress>();
  private readonly nodeIdToTcpAddressMap = ArrayMap<Uint8Array, IAddress>();
  private readonly nodeIdToWsAddressMap = ArrayMap<Uint8Array, IAddress>();

  constructor(
    bootstrapUdpNodes: INodeAddress[],
    bootstrapTcpNodes: INodeAddress[],
    bootstrapWsNodes: INodeAddress[],
    private readonly browserNode: boolean,
    private readonly ownNodeId: Uint8Array,
    ownUdpAddress?: IAddress,
    ownTcpAddress?: IAddress,
    ownWsAddress?: IAddress,
  ) {
    super();
    this.setMaxListeners(Infinity);

    if (ownTcpAddress) {
      this.tcp4Server = this.createTcp4Server(ownTcpAddress);
    }
    if (ownWsAddress) {
      const httpServer = http.createServer();
      this.wsServer = this.createWebSocketServer(httpServer);
      httpServer.listen(ownWsAddress.port, ownWsAddress.address);
      this.httpServer = httpServer;
    }

    const udpManager = new UdpManager(this.UDP_MESSAGE_SIZE_LIMIT, this.DEFAULT_TIMEOUT, ownUdpAddress);
    this.udpManager = udpManager;

    const tcpManager = new TcpManager(this.TCP_MESSAGE_SIZE_LIMIT, this.DEFAULT_TIMEOUT);
    this.tcpManager = tcpManager;

    const wsManager = new WsManager(this.WS_MESSAGE_SIZE_LIMIT, this.DEFAULT_TIMEOUT);
    this.wsManager = wsManager;

    const gossipManager = new GossipManager(
      this.nodeIdToUdpAddressMap,
      this.nodeIdToTcpAddressMap,
      this.nodeIdToWsAddressMap,
      this.nodeIdToTcpSocket.bind(this),
      this.nodeIdToWsConnection.bind(this),
      browserNode,
      udpManager,
      tcpManager,
      wsManager,
      this.GOSSIP_CACHE_TIMEOUT,
    );
    this.gossipManager = gossipManager;

    for (const manager of [udpManager, tcpManager, wsManager, gossipManager]) {
      manager.on(
        'command',
        this.emit.bind(this),
      );
    }

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
  }

  public async sendOneWayRequest(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    const wsConnection = this.wsManager.nodeIdToConnectionMap.get(nodeId);
    if (wsConnection) {
      // Node likely doesn't have any other way to communicate besides WebSocket
      return this.wsManager.sendMessageOneWay(wsConnection, command, payload);
    }
    const socket = await this.nodeIdToTcpSocket(nodeId);
    if (socket) {
      return this.tcpManager.sendMessageOneWay(socket, command, payload);
    }

    {
      const wsConnection = await this.nodeIdToWsConnection(nodeId);
      if (wsConnection) {
        return this.wsManager.sendMessageOneWay(wsConnection, command, payload);
      }

      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
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
    return this.udpManager.sendMessageOneWay(address, command, payload);
  }

  public async sendRequest(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    const wsConnection = this.wsManager.nodeIdToConnectionMap.get(nodeId);
    if (wsConnection) {
      // Node likely doesn't have any other way to communicate besides WebSocket
      return this.wsManager.sendMessage(wsConnection, command, payload);
    }
    const socket = await this.nodeIdToTcpSocket(nodeId);
    if (socket) {
      return this.tcpManager.sendMessage(socket, command, payload);
    }

    {
      const wsConnection = await this.nodeIdToWsConnection(nodeId);
      if (wsConnection) {
        return this.wsManager.sendMessage(wsConnection, command, payload);
      }

      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
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
    const address = await this.nodeIdToUdpAddress(nodeId);
    // TODO: Fallback to reliable if no UDP route?
    return this.udpManager.sendMessage(address, command, payload);
  }

  public async gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
    return this.gossipManager.gossip(command, payload);
  }

  public async destroy(): Promise<void> {
    await Promise.all([
      this.udpManager.destroy(),
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
          reject(new Error(`Connection to node ${bin2Hex(nodeId)}`));
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
          reject(new Error(`Connection to node ${bin2Hex(nodeId)}`));
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
}
