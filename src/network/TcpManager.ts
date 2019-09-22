import * as net from "net";
import {bin2Hex} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys} from "./constants";
import {INodeContactInfo, INodeContactInfoTcp} from "./INetwork";
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

  /**
   * @param ownNodeContactInfo
   * @param nodeInfoPayload
   * @param bootstrapNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionTimeout In seconds
   * @param connectionExpiration In seconds
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
    readyCallback?: () => void,
    errorCallback?: (error: Error) => void,
  ) {
    super(ownNodeContactInfo.nodeId, bootstrapNodes, browserNode, messageSizeLimit, responseTimeout, true);
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
      this.tcp4Server = net.createServer()
        .on('connection', (socket: net.Socket) => {
          this.registerTcpConnection(socket);
        })
        .on('error', (error: Error) => {
          if (errorCallback) {
            errorCallback(error);
          }
        })
        .listen(ownNodeContactInfo.tcp4Port, ownNodeContactInfo.address, readyCallback);
    } else if (readyCallback) {
      setTimeout(readyCallback);
    }
  }

  public async sendRawMessage(socket: net.Socket, message: Uint8Array): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      throw new Error(
        `TCP message too big, ${message.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed`,
      );
    }
    if (!socket.destroyed) {
      await new Promise((resolve, reject) => {
        socket.write(composeMessageWithTcpHeader(message), (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
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
          reject(new Error(`Connection to node ${bin2Hex(nodeId)}`));
        },
        this.connectionTimeout * 1000,
      );
      if (timeout.unref) {
        timeout.unref();
      }
      const socket = net.createConnection(
        nodeContactInfo.tcp4Port,
        nodeContactInfo.address,
        () => {
          clearTimeout(timeout);
          if (timedOut) {
            socket.destroy();
          } else {
            socket.write(this.identificationMessage);
            this.registerTcpConnection(
              socket,
              nodeContactInfo,
            );
            resolve(socket);
          }
        },
      );
      socket
        .setTimeout(this.connectionTimeout)
        .once('error', reject);
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
    return new Promise((resolve, reject) => {
      for (const socket of this.nodeIdToConnectionMap.values()) {
        socket.destroy();
      }
      if (this.tcp4Server) {
        this.tcp4Server.close((error?: Error) => {
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
            .catch((_) => {
              // TODO: Handle errors
            });
          receivedBuffer = receivedBuffer.slice(4 + messageLength);
        }
      })
      .on('close', () => {
        const nodeId = this.connectionToNodeIdMap.get(socket);
        if (nodeId) {
          this.connectionToNodeIdMap.delete(socket);
          this.nodeIdToConnectionMap.delete(nodeId);
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
      this.emit('peer-connected', nodeContactInfo);
    }
  }
}
