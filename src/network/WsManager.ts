import * as http from "http";
import * as websocket from "websocket";
import {bin2Hex, ILogger} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys} from "./constants";
import {INodeContactInfo, INodeContactInfoWs} from "./Network";
import {composeMessage} from "./utils";

type WebSocketConnection = websocket.w3cwebsocket | websocket.connection;

function extractWsBootstrapNodes(bootstrapNodes: INodeContactInfo[]): INodeContactInfoWs[] {
  const bootstrapNodesWs: INodeContactInfoWs[] = [];
  for (const bootstrapNode of bootstrapNodes) {
    if (bootstrapNode.wsPort !== undefined) {
      bootstrapNodesWs.push(bootstrapNode as INodeContactInfoWs);
    }
  }
  return bootstrapNodesWs;
}

export class WsManager extends AbstractProtocolManager<WebSocketConnection, INodeContactInfoWs> {
  public static init(
    ownNodeContactInfo: INodeContactInfo,
    nodeInfoPayload: Uint8Array,
    bootstrapNodes: INodeContactInfo[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    connectionTimeout: number,
    parentLogger: ILogger,
  ): Promise<WsManager> {
    return new Promise((resolve, reject) => {
      const instance = new WsManager(
        ownNodeContactInfo,
        nodeInfoPayload,
        extractWsBootstrapNodes(bootstrapNodes),
        browserNode,
        messageSizeLimit,
        responseTimeout,
        connectionTimeout,
        parentLogger,
        () => {
          resolve(instance);
        },
        reject,
      );
    });
  }

  private readonly nodeInfoPayload: Uint8Array;
  private readonly connectionTimeout: number;
  private readonly wsServer: websocket.server | undefined;
  private readonly httpServer: http.Server | undefined;
  private readonly incompleteConnections = new Set<WebSocketConnection>();

  /**
   * @param ownNodeContactInfo
   * @param nodeInfoPayload
   * @param bootstrapNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionTimeout
   * @param parentLogger
   * @param readyCallback
   * @param errorCallback
   */
  public constructor(
    ownNodeContactInfo: INodeContactInfo,
    nodeInfoPayload: Uint8Array,
    bootstrapNodes: INodeContactInfoWs[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    connectionTimeout: number,
    parentLogger: ILogger,
    readyCallback?: () => void,
    errorCallback?: (error: Error) => void,
  ) {
    super(
      ownNodeContactInfo.nodeId,
      bootstrapNodes,
      browserNode,
      messageSizeLimit,
      responseTimeout,
      true,
      parentLogger.child({manager: 'UDP'}),
    );
    this.setMaxListeners(Infinity);

    this.nodeInfoPayload = nodeInfoPayload;
    this.connectionTimeout = connectionTimeout;

    if (!browserNode && ownNodeContactInfo.wsPort) {
      const httpServer = http.createServer()
        .on('error', (error: Error) => {
          if (errorCallback) {
            errorCallback(error);
          }
        })
        .listen(ownNodeContactInfo.wsPort, ownNodeContactInfo.address, readyCallback);

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

  public async sendRawMessage(connection: WebSocketConnection, message: Uint8Array): Promise<void> {
    if (this.destroying) {
      return;
    }
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

  public async nodeIdToConnectionImplementation(nodeId: Uint8Array): Promise<WebSocketConnection | null> {
    const connection = this.nodeIdToConnectionMap.get(nodeId);
    if (connection) {
      return connection;
    }
    const nodeContactInfo = this.nodeIdToAddressMap.get(nodeId);
    if (!nodeContactInfo) {
      return null;
    }
    return new Promise((resolve, reject) => {
      if (this.destroying) {
        return;
      }
      if (!this.browserNode) {
        resolve(null);
        return;
      }
      let timedOut = false;
      const timeout = setTimeout(
        () => {
          timedOut = true;
          this.incompleteConnections.delete(connection);
          reject(new Error(`Connection to node ${bin2Hex(nodeId)} failed`));
        },
        this.connectionTimeout * 1000,
      );
      if (timeout.unref) {
        timeout.unref();
      }
      const connection = new websocket.w3cwebsocket(`ws://${nodeContactInfo.address}:${nodeContactInfo.wsPort}`);
      connection.binaryType = 'arraybuffer';
      connection.onopen = () => {
        if (timedOut) {
          connection.close();
        } else {
          clearTimeout(timeout);
          const identificationMessage = composeMessage(
            'identification',
            0,
            this.nodeInfoPayload,
          );
          connection.send(identificationMessage);
          this.registerBrowserWsConnection(
            connection,
            nodeContactInfo,
          );
          this.incompleteConnections.delete(connection);
          connection.onerror = () => {
            // Nothing
          };
          resolve(connection);
        }
      };
      connection.onerror = (error: Error) => {
        const errorText = (error.stack || error) as string;
        const baseMessage = `Connection to node ${bin2Hex(nodeId)} failed`;
        this.logger.debug(`${baseMessage}: ${errorText}`);
        clearTimeout(timeout);
        this.incompleteConnections.delete(connection);
        reject(new Error(baseMessage));
      };
      connection.onclose = () => {
        this.connectionCloseHandler(connection);
      };
      this.incompleteConnections.add(connection);
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

  protected destroyImplementation(): Promise<void> {
    return new Promise((resolve) => {
      for (const connection of this.connectionToNodeIdMap.keys()) {
        connection.close();
        this.connectionCloseHandler(connection);
      }
      for (const connection of this.incompleteConnections.values()) {
        // Hack: See https://github.com/theturtle32/WebSocket-Node/issues/371
        if (
          // @ts-ignore
          connection.readyState === websocket.w3cwebsocket.CONNECTING &&
          // @ts-ignore
          connection._client &&
          // @ts-ignore
          connection._client._req &&
          // @ts-ignore
          connection._client._req.socket
        ) {
          // @ts-ignore
          connection._client._req.socket.destroy();
        }
        connection.close();
      }
      if (this.wsServer) {
        this.wsServer.shutDown();
      }
      if (this.httpServer) {
        // There may be HTTP connections dangling, but we don't want to track them or wait, so resolve immediately
        this.httpServer.close();
      }
      resolve();
    });
  }

  private connectionCloseHandler(connection: WebSocketConnection): void {
    const nodeId = this.connectionToNodeIdMap.get(connection);
    if (nodeId) {
      const nodeContactInfo = this.nodeIdToAddressMap.get(nodeId) || this.connectionToIdentificationMap.get(connection);
      if (nodeContactInfo) {
        this.emit('peer-disconnected', nodeContactInfo);
      }
      this.connectionToNodeIdMap.delete(connection);
      // In case of concurrent connection
      if (this.nodeIdToConnectionMap.get(nodeId) === connection) {
        this.nodeIdToConnectionMap.delete(nodeId);
      }
    }
  }

  private registerServerWsConnection(connection: websocket.connection): void {
    connection
      .on('message', (message: websocket.IMessage) => {
        const nodeId = this.connectionToNodeIdMap.get(connection);
        const localLogger = this.logger.child(
          {
            nodeId: nodeId ? bin2Hex(nodeId) : 'unknown',
          },
        );
        if (message.type !== 'binary') {
          connection.close();
          // Because https://github.com/theturtle32/WebSocket-Node/issues/354
          this.connectionCloseHandler(connection);
          localLogger.debug(`Only binary messages supported`);
          return;
        }
        const buffer = message.binaryData as Buffer;
        this.handleIncomingMessage(connection, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
          .catch((error: any) => {
            const errorText = (error.stack || error) as string;
            localLogger.debug(`Error on handling incoming message: ${errorText}`);
          });
      });
  }

  private registerBrowserWsConnection(
    connection: websocket.w3cwebsocket,
    nodeContactInfo?: INodeContactInfo,
  ): void {
    connection.onmessage = (event: MessageEvent) => {
      const localLogger = this.logger.child(
        {
          nodeId: bin2Hex(this.connectionToNodeIdMap.get(connection) as Uint8Array),
        },
      );
      if (!(event.data instanceof ArrayBuffer)) {
        connection.close();
        localLogger.debug(`Only binary messages supported`);
        return;
      }
      this.handleIncomingMessage(connection, new Uint8Array(event.data))
        .catch((error: any) => {
          const errorText = (error.stack || error) as string;
          localLogger.debug(`Error on handling incoming message: ${errorText}`);
        });
    };
    // TODO: Connection expiration for cleanup
    if (nodeContactInfo) {
      const nodeId = nodeContactInfo.nodeId;
      this.nodeIdToConnectionMap.set(nodeId, connection);
      this.connectionToNodeIdMap.set(connection, nodeId);
      setTimeout(() => {
        this.emit('peer-connected', nodeContactInfo);
      });
    }
  }
}
