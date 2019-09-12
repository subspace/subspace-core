import * as net from "net";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {COMMANDS, ICommandsKeys} from "./commands";
import {IAddress} from "./Network";

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

// 4 bytes for message length, 1 byte for command, 4 bytes for request ID
const MIN_TCP_MESSAGE_SIZE = 4 + 1 + 4;

export class TcpManager extends AbstractProtocolManager<net.Socket> {
  private readonly tcp4Server: net.Server | undefined;
  private readonly connectionExpiration: number;

  /**
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionExpiration In seconds
   * @param ownTcpAddress
   */
  public constructor(
    messageSizeLimit: number,
    responseTimeout: number,
    connectionExpiration: number,
    ownTcpAddress?: IAddress,
  ) {
    super(messageSizeLimit, responseTimeout, true);
    this.setMaxListeners(Infinity);

    this.connectionExpiration = connectionExpiration;

    if (ownTcpAddress) {
      this.tcp4Server = this.createTcp4Server(ownTcpAddress);
    }
  }

  public async sendRawMessage(socket: net.Socket, message: Uint8Array): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      throw new Error(
        `TCP message too big, ${message.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed}`,
      );
    }
    if (!socket.destroyed) {
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

  public destroy(): Promise<void> {
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

  protected sendMessageImplementation(
    socket: net.Socket,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void> {
    const message = composeMessageWithTcpHeader(command, requestResponseId, payload);
    return this.sendRawMessage(socket, message);
  }

  protected destroyConnection(socket: net.Socket): void {
    socket.destroy();
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

  // TODO: This method is public only for refactoring period and should be changed to `private` afterwards
  // tslint:disable-next-line:member-ordering
  public registerTcpConnection(socket: net.Socket, nodeId?: Uint8Array): void {
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
        }
      })
      .setTimeout(this.connectionExpiration * 1000)
      .on('timeout', () => {
        socket.destroy();
      });
    // TODO: Connection expiration for cleanup
    if (nodeId) {
      this.nodeIdToConnectionMap.set(nodeId, socket);
      this.connectionToNodeIdMap.set(socket, nodeId);
    }
  }
}
