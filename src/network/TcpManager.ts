import * as net from "net";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {COMMANDS, ICommandsKeys} from "./commands";

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

export class TcpManager extends AbstractProtocolManager<net.Socket> {
  /**
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   */
  public constructor(messageSizeLimit: number, responseTimeout: number) {
    super(messageSizeLimit, responseTimeout, true);
    this.setMaxListeners(Infinity);
  }

  public sendMessage(
    connection: net.Socket,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void> {
    const message = composeMessageWithTcpHeader(command, requestResponseId, payload);
    return this.sendRawMessage(connection, message);
  }

  public async sendRawMessage(connection: net.Socket, message: Uint8Array): Promise<void> {
    if (!connection.destroyed) {
      await new Promise((resolve, reject) => {
        connection.write(message, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  }

  protected destroyConnection(connection: net.Socket): void {
    connection.destroy();
  }
}
