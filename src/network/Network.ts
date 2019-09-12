import {EventEmitter} from "events";
import * as http from "http";
import * as websocket from "websocket";
import {bin2Hex} from "../utils/utils";
import {ICommandsKeys} from "./commands";
import {GossipManager} from "./GossipManager";
import {INetwork} from "./INetwork";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {noopResponseCallback} from "./utils";
import {WsManager} from "./WsManager";

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

  private readonly wsServer: websocket.server | undefined;
  private readonly httpServer: http.Server | undefined;

  private readonly udpManager: UdpManager;
  private readonly tcpManager: TcpManager;
  private readonly wsManager: WsManager;
  private readonly gossipManager: GossipManager;

  constructor(
    bootstrapUdpNodes: INodeAddress[],
    bootstrapTcpNodes: INodeAddress[],
    bootstrapWsNodes: INodeAddress[],
    private readonly browserNode: boolean,
    ownNodeId: Uint8Array,
    ownUdpAddress?: IAddress,
    ownTcpAddress?: IAddress,
    ownWsAddress?: IAddress,
  ) {
    super();
    this.setMaxListeners(Infinity);

    if (ownWsAddress) {
      const httpServer = http.createServer();
      this.wsServer = this.createWebSocketServer(httpServer);
      httpServer.listen(ownWsAddress.port, ownWsAddress.address);
      this.httpServer = httpServer;
    }

    const udpManager = new UdpManager(
      bootstrapUdpNodes,
      browserNode,
      this.UDP_MESSAGE_SIZE_LIMIT,
      this.DEFAULT_TIMEOUT,
      ownUdpAddress,
    );
    this.udpManager = udpManager;

    const tcpManager = new TcpManager(
      ownNodeId,
      bootstrapTcpNodes,
      browserNode,
      this.TCP_MESSAGE_SIZE_LIMIT,
      this.DEFAULT_TIMEOUT,
      this.DEFAULT_TIMEOUT,
      this.DEFAULT_CONNECTION_EXPIRATION,
      ownTcpAddress,
    );
    this.tcpManager = tcpManager;

    const wsManager = new WsManager(
      ownNodeId,
      bootstrapWsNodes,
      browserNode,
      this.WS_MESSAGE_SIZE_LIMIT,
      this.DEFAULT_TIMEOUT,
      this.DEFAULT_TIMEOUT,
    );
    this.wsManager = wsManager;

    const gossipManager = new GossipManager(
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
    const socket = await this.tcpManager.nodeIdToConnection(nodeId);
    if (socket) {
      return this.tcpManager.sendMessageOneWay(socket, command, payload);
    }

    {
      const wsConnection = await this.wsManager.nodeIdToConnection(nodeId);
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

    const address = await this.udpManager.nodeIdToConnection(nodeId);
    if (address) {
      return this.udpManager.sendMessageOneWay(address, command, payload);
    } else {
      // TODO: Fallback to reliable if no UDP route?
      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
    }
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
    const socket = await this.tcpManager.nodeIdToConnection(nodeId);
    if (socket) {
      return this.tcpManager.sendMessage(socket, command, payload);
    }

    {
      const wsConnection = await this.wsManager.nodeIdToConnection(nodeId);
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
    const address = await this.udpManager.nodeIdToConnection(nodeId);
    if (address) {
      return this.udpManager.sendMessage(address, command, payload);
    } else {
      // TODO: Fallback to reliable if no UDP route?
      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
    }
  }

  public async gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
    return this.gossipManager.gossip(command, payload);
  }

  public async destroy(): Promise<void> {
    await Promise.all([
      this.udpManager.destroy(),
      this.tcpManager.destroy(),
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
}
