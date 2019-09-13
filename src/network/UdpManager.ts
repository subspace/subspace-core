import * as dgram from "dgram";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys} from "./commands";
import {IAddress, INodeAddress} from "./Network";
import {composeMessage} from "./utils";

export class UdpManager extends AbstractProtocolManager<IAddress> {
  private ready: boolean = true;
  private readyPromise: Promise<any> = Promise.resolve();
  private readonly udp4Socket: dgram.Socket;

  /**
   * @param bootstrapUdpNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param ownUdpAddress
   */
  public constructor(
    bootstrapUdpNodes: INodeAddress[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    ownUdpAddress?: IAddress,
  ) {
    super(bootstrapUdpNodes, browserNode, messageSizeLimit, responseTimeout, false);
    this.setMaxListeners(Infinity);

    this.udp4Socket = this.createUdp4Socket(ownUdpAddress);
  }

  public async nodeIdToConnection(nodeId: Uint8Array): Promise<IAddress | null> {
    if (this.browserNode) {
      return null;
    }
    const address = this.nodeIdToAddressMap.get(nodeId);
    if (address) {
      return address;
    }
    // TODO: Implement fetching from DHT
    throw new Error('Sending to arbitrary nodeId is not implemented yet');
  }

  public async sendRawMessage(address: IAddress, message: Uint8Array): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      throw new Error(
        `UDP message too big, ${message.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed}`,
      );
    }
    if (!this.ready) {
      try {
        await this.readyPromise;
      } catch {
        // Just to avoid unhandled Promise exception
        return;
      }
    }
    return new Promise((resolve, reject) => {
      this.udp4Socket.send(
        message,
        address.port,
        address.address,
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

  public destroy(): Promise<void> {
    return new Promise((resolve) => {
      this.udp4Socket.close(resolve);
    });
  }

  protected sendMessageImplementation(
    address: IAddress,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void> {
    const message = composeMessage(command, requestResponseId, payload);
    return this.sendRawMessage(address, message);
  }

  protected destroyConnection(): void {
    // Not used by non-connection-based manager
  }

  private createUdp4Socket(ownUdpAddress?: IAddress): dgram.Socket {
    const udp4Socket = dgram.createSocket('udp4');
    udp4Socket
      .on(
        'message',
        (message: Buffer, remote: dgram.RemoteInfo) => {
          this.handleIncomingMessage(remote, message)
            .catch((_) => {
              // TODO: Handle errors
            });
        },
      )
      .on('error', () => {
        // TODO: Handle errors
      });
    if (ownUdpAddress) {
      this.ready = false;
      this.readyPromise = new Promise((resolve, reject) => {
        udp4Socket
          .once('listening', () => {
            this.ready = true;
            resolve();
          })
          .once('error', reject);
      });
      udp4Socket.bind(ownUdpAddress.port, ownUdpAddress.address);
    }

    return udp4Socket;
  }
}