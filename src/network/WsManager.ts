import * as http from "http";
import * as websocket from "websocket";
import {bin2Hex} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys} from "./constants";
import {IAddress, IBootstrapNodeContactInfo} from "./Network";
import {composeMessage} from "./utils";

type WebSocketConnection = websocket.w3cwebsocket | websocket.connection;

export class WsManager extends AbstractProtocolManager<WebSocketConnection> {
  public static init(
    ownNodeId: Uint8Array,
    bootstrapWsNodes: IBootstrapNodeContactInfo[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    connectionTimeout: number,
    ownWsAddress?: IAddress,
  ): Promise<WsManager> {
    return new Promise((resolve, reject) => {
      const instance = new WsManager(
        ownNodeId,
        bootstrapWsNodes,
        browserNode,
        messageSizeLimit,
        responseTimeout,
        connectionTimeout,
        ownWsAddress,
        () => {
          resolve(instance);
        },
        reject,
      );
    });
  }

  private readonly ownNodeId: Uint8Array;
  private readonly connectionTimeout: number;
  private readonly wsServer: websocket.server | undefined;
  private readonly httpServer: http.Server | undefined;

  /**
   * @param ownNodeId
   * @param bootstrapWsNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionTimeout
   * @param ownWsAddress
   * @param readyCallback
   * @param errorCallback
   */
  public constructor(
    ownNodeId: Uint8Array,
    bootstrapWsNodes: IBootstrapNodeContactInfo[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    connectionTimeout: number,
    ownWsAddress?: IAddress,
    readyCallback?: () => void,
    errorCallback?: (error: Error) => void,
  ) {
    super(bootstrapWsNodes, browserNode, messageSizeLimit, responseTimeout, true);
    this.setMaxListeners(Infinity);

    this.ownNodeId = ownNodeId;
    this.connectionTimeout = connectionTimeout;

    if (ownWsAddress) {
      const httpServer = http.createServer()
        .on('error', (error: Error) => {
          if (errorCallback) {
            errorCallback(error);
          }
        })
        .listen(ownWsAddress.port, ownWsAddress.address, readyCallback);

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
          this.connectionCloseHandler(connection);
        });
      this.httpServer = httpServer;
      this.wsServer = wsServer;
    } else if (readyCallback) {
      setTimeout(readyCallback);
    }
  }

  public async nodeIdToConnection(nodeId: Uint8Array): Promise<WebSocketConnection | null> {
    const connection = this.nodeIdToConnectionMap.get(nodeId);
    if (connection) {
      return connection;
    }
    const address = this.nodeIdToAddressMap.get(nodeId);
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
        this.connectionTimeout * 1000,
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
        this.connectionCloseHandler(connection);
      };
    });
  }

  public async sendRawMessage(connection: WebSocketConnection, message: Uint8Array): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      throw new Error(
        `WebSocket message too big, ${message.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed`,
      );
    }
    if ('sendBytes' in connection) {
      connection.sendBytes(Buffer.from(message));
    } else {
      connection.send(message);
    }
  }

  public destroy(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wsServer) {
        this.wsServer.closeAllConnections();
        this.wsServer.shutDown();
      }
      if (this.httpServer) {
        this.httpServer.close((error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  protected sendMessageImplementation(
    connection: WebSocketConnection,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void> {
    const message = composeMessage(command, requestResponseId, payload);
    return this.sendRawMessage(connection, message);
  }

  protected destroyConnection(connection: WebSocketConnection): void {
    connection.close();
    // Because https://github.com/theturtle32/WebSocket-Node/issues/354
    this.connectionCloseHandler(connection);
  }

  private connectionCloseHandler(connection: WebSocketConnection): void {
    const nodeId = this.connectionToNodeIdMap.get(connection);
    if (nodeId) {
      this.connectionToNodeIdMap.delete(connection);
      this.nodeIdToConnectionMap.delete(nodeId);
    }
  }

  private registerServerWsConnection(connection: websocket.connection, nodeId?: Uint8Array): void {
    connection
      .on('message', (message: websocket.IMessage) => {
        if (message.type !== 'binary') {
          connection.close();
          // Because https://github.com/theturtle32/WebSocket-Node/issues/354
          this.connectionCloseHandler(connection);
          // TODO: Log in debug mode that only binary messages are supported
          return;
        }
        const buffer = message.binaryData as Buffer;
        this.handleIncomingMessage(connection, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
          .catch((_) => {
            // TODO: Handle errors
          });
      });
    // TODO: Connection expiration for cleanup
    if (nodeId) {
      this.nodeIdToConnectionMap.set(nodeId, connection);
      this.connectionToNodeIdMap.set(connection, nodeId);
    }
  }

  private registerBrowserWsConnection(connection: websocket.w3cwebsocket, nodeId?: Uint8Array): void {
    connection.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) {
        connection.close();
        // TODO: Log in debug mode that only binary messages are supported
        return;
      }
      this.handleIncomingMessage(connection, new Uint8Array(event.data))
        .catch((_) => {
          // TODO: Handle errors
        });
    };
    // TODO: Connection expiration for cleanup
    if (nodeId) {
      this.nodeIdToConnectionMap.set(nodeId, connection);
      this.connectionToNodeIdMap.set(connection, nodeId);
    }
  }
}
