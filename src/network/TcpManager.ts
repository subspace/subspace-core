import * as net from "net";
import {bin2Hex, ILogger} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys} from "./constants";
import {INodeContactInfo, INodeContactInfoTcp} from "./Network";
import {composeMessage} from "./utils";

function extractTcpBootstrapNodes(bootstrapNodes: INodeContactInfo[]): INodeContactInfoTcp[] {
  const bootstrapNodesTcp: INodeContactInfoTcp[] = [];
  for (const bootstrapNode of bootstrapNodes) {
    if (bootstrapNode.tcp4Port !== undefined) {
      bootstrapNodesTcp.push(bootstrapNode as INodeContactInfoTcp);
    }
  }
  return bootstrapNodesTcp;
}

/**
 * @param message
 */
function composeMessageWithTcpHeader(message: Uint8Array): Uint8Array {
  // 4 bytes for message length and message itself
  const messageWithTcpHeader = new Uint8Array(4 + message.length);
  const view = new DataView(messageWithTcpHeader.buffer);
  view.setUint32(0, message.length, false);
  messageWithTcpHeader.set(message, 4);
  return messageWithTcpHeader;
}

// 4 bytes for message length, 1 byte for command, 4 bytes for request ID
const MIN_TCP_MESSAGE_SIZE = 4 + 1 + 4;

const emptyPayload = new Uint8Array(0);

export class TcpManager extends AbstractProtocolManager<net.Socket, INodeContactInfoTcp> {
  public static init(
    ownNodeContactInfo: INodeContactInfo,
    nodeInfoPayload: Uint8Array,
    bootstrapNodes: INodeContactInfo[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    connectionTimeout: number,
    connectionExpiration: number,
    parentLogger: ILogger,
  ): Promise<TcpManager> {
    return new Promise((resolve, reject) => {
      const instance = new TcpManager(
        ownNodeContactInfo,
        nodeInfoPayload,
        extractTcpBootstrapNodes(bootstrapNodes),
        browserNode,
        messageSizeLimit,
        responseTimeout,
        connectionTimeout,
        connectionExpiration,
        parentLogger,
        () => {
          resolve(instance);
        },
        reject,
      );
    });
  }

  private readonly tcp4Server: net.Server | undefined;
  private readonly identificationMessage: Uint8Array;
  private readonly connectionTimeout: number;
  private readonly connectionExpiration: number;
  private readonly incompleteConnections = new Set<net.Socket>();

  /**
   * @param ownNodeContactInfo
   * @param nodeInfoPayload
   * @param bootstrapNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionTimeout In seconds
   * @param connectionExpiration In seconds
   * @param parentLogger
   * @param readyCallback
   * @param errorCallback
   */
  public constructor(
    ownNodeContactInfo: INodeContactInfo,
    nodeInfoPayload: Uint8Array,
    bootstrapNodes: INodeContactInfoTcp[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    connectionTimeout: number,
    connectionExpiration: number,
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
      parentLogger.child({manager: 'TCP'}),
    );
    this.setMaxListeners(Infinity);

    this.identificationMessage = composeMessageWithTcpHeader(
      composeMessage(
        'identification',
        0,
        nodeInfoPayload,
      ),
    );
    this.connectionTimeout = connectionTimeout;
    this.connectionExpiration = connectionExpiration;

    if (!browserNode && ownNodeContactInfo.tcp4Port) {
      let ready = false;
      this.tcp4Server = net.createServer()
        .on('connection', (socket: net.Socket) => {
          socket.on('error', (error) => {
            const errorText = (error.stack || error) as string;
            this.logger.info(`Error on incoming TCP connection: ${errorText}`);
          });
          this.registerTcpConnection(socket);
        })
        .on('error', (error: Error) => {
          if (errorCallback && !ready) {
            errorCallback(error);
          } else {
            const errorText = (error.stack || error) as string;
            this.logger.info(`Error on TCP server: ${errorText}`);
          }
        })
        .listen(ownNodeContactInfo.tcp4Port, ownNodeContactInfo.address, () => {
          ready = true;
          if (readyCallback) {
            readyCallback();
          }
        });
    } else if (readyCallback) {
      setTimeout(readyCallback);
    }
  }

  public async sendRawMessage(socket: net.Socket, message: Uint8Array): Promise<void> {
    if (this.destroying) {
      return;
    }
    if (message.length > this.messageSizeLimit) {
      throw new Error(
        `TCP message too big, ${message.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed`,
      );
    }
    await new Promise((resolve, reject) => {
      if (!socket.destroyed) {
        socket.write(composeMessageWithTcpHeader(message), (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } else {
        reject(new Error('Socket already destroyed'));
      }
    });
  }

  protected async nodeIdToConnectionImplementation(nodeId: Uint8Array): Promise<net.Socket | null> {
    if (this.browserNode) {
      return null;
    }
    const socket = this.nodeIdToConnectionMap.get(nodeId);
    if (socket) {
      return socket;
    }
    const nodeContactInfo = this.nodeIdToAddressMap.get(nodeId);
    if (!nodeContactInfo) {
      return null;
    }
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timeout = setTimeout(
        () => {
          timedOut = true;
          if (!socket.destroyed) {
            socket.destroy();
          }
          this.incompleteConnections.delete(socket);
          reject(new Error(`Connection to node ${bin2Hex(nodeId)}`));
        },
        this.connectionTimeout * 1000,
      );
      if (timeout.unref) {
        timeout.unref();
      }
      const onError = (error: Error) => {
        clearTimeout(timeout);
        this.incompleteConnections.delete(socket);
        reject(error);
      };
      const socket = net.createConnection(
        nodeContactInfo.tcp4Port,
        nodeContactInfo.address,
        () => {
          if (timedOut) {
            socket.destroy();
          } else {
            clearTimeout(timeout);
            socket.write(this.identificationMessage);
            this.registerTcpConnection(
              socket,
              nodeContactInfo,
            );
            this.incompleteConnections.delete(socket);
            socket
              .off('error', onError)
              .on('error', (error) => {
                const errorText = (error.stack || error) as string;
                this.logger.info(`Error on outgoing TCP connection to node ${bin2Hex(nodeId)}: ${errorText}`);
              });
            resolve(socket);
          }
        },
      );
      socket
        .setTimeout(this.connectionTimeout)
        .once('error', onError);
      this.incompleteConnections.add(socket);
    });
  }

  protected sendMessageImplementation(
    socket: net.Socket,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void> {
    const message = composeMessage(command, requestResponseId, payload);
    return this.sendRawMessage(socket, message);
  }

  protected destroyConnection(socket: net.Socket): void {
    socket.destroy();
  }

  protected destroyImplementation(): Promise<void> {
    return new Promise(async (resolve) => {
      await Promise.all([
        Array.from(this.connectionToNodeIdMap.keys())
          .map((socket) => {
            this.sendMessageOneWay(socket, 'shutdown-disconnection', emptyPayload)
              .catch((error) => {
                const errorText = (error.stack || error) as string;
                this.logger.debug(`Error on sending shutdown-disconnection command: ${errorText}`);
              })
              .finally(() => {
                if (this.connectionToNodeIdMap.has(socket)) {
                  socket.destroy();
                }
              });
          }),
      ]);
      for (const socket of this.incompleteConnections.values()) {
        socket.destroy();
      }
      if (this.tcp4Server) {
        // There may be TCP connections dangling, but we don't want to track them or wait, so resolve immediately
        this.tcp4Server.close();
      }
      resolve();
    });
  }

  private registerTcpConnection(socket: net.Socket, nodeContactInfo?: INodeContactInfo): void {
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
          this.handleIncomingMessage(socket, message)
            .catch((error: any) => {
              const errorText = (error.stack || error) as string;
              this.logger.debug(`Error on handling incoming message: ${errorText}`);
            });
          receivedBuffer = receivedBuffer.slice(4 + messageLength);
        }
      })
      .on('close', () => {
        const nodeId = this.connectionToNodeIdMap.get(socket);
        if (nodeId) {
          this.connectionToNodeIdMap.delete(socket);
          // In case of concurrent connection
          if (this.nodeIdToConnectionMap.get(nodeId) === socket) {
            this.nodeIdToConnectionMap.delete(nodeId);
          }
          if (nodeContactInfo) {
            this.emit('peer-disconnected', nodeContactInfo);
          } else {
            const nodeContactInfo = this.nodeIdToAddressMap.get(nodeId);
            if (nodeContactInfo) {
              this.emit('peer-disconnected', nodeContactInfo);
            }
          }
        }
      })
      .setTimeout(this.connectionExpiration * 1000)
      .on('timeout', () => {
        socket.destroy();
      });

    if (nodeContactInfo) {
      const nodeId = nodeContactInfo.nodeId;
      this.nodeIdToConnectionMap.set(nodeId, socket);
      this.connectionToNodeIdMap.set(socket, nodeId);
      setTimeout(() => {
        this.emit('peer-connected', nodeContactInfo);
      });
    }
  }
}
