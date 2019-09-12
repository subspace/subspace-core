import * as dgram from "dgram";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys} from "./commands";
import {IAddress} from "./Network";
import {composeMessage} from "./utils";

type ISocket = [dgram.Socket, IAddress];

export class UdpManager extends AbstractProtocolManager<ISocket> {
  /**
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   */
  public constructor(messageSizeLimit: number, responseTimeout: number) {
    super(messageSizeLimit, responseTimeout, false);
    this.setMaxListeners(Infinity);
  }

  public sendMessage(
    socket: ISocket,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void> {
    const message = composeMessage(command, requestResponseId, payload);
    return this.sendRawMessage(socket, message);
  }

  public async sendRawMessage(socket: ISocket, message: Uint8Array): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      throw new Error(
        `UDP message too big, ${message.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed}`,
      );
    }
    return new Promise((resolve, reject) => {
      const [udp4Socket, {address, port}] = socket;
      udp4Socket.send(
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

  protected destroyConnection(): void {
    // Not used by non-connection-based manager
  }
}
