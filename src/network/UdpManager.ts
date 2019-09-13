import * as dgram from "dgram";
import {NODE_ID_LENGTH} from "../main/constants";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys, INodeTypesKeys, NODE_TYPES} from "./constants";
import {IAddress, INodeAddress} from "./Network";
import {composeMessage} from "./utils";

// Node type + node ID
const UDP_HEADER_LENGTH = 1 + NODE_ID_LENGTH;

export class UdpManager extends AbstractProtocolManager<IAddress> {
  public static init(
    ownNodeId: Uint8Array,
    nodeType: INodeTypesKeys,
    bootstrapUdpNodes: INodeAddress[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    ownUdpAddress?: IAddress,
  ): Promise<UdpManager> {
    return new Promise((resolve, reject) => {
      const instance = new UdpManager(
        ownNodeId,
        nodeType,
        bootstrapUdpNodes,
        browserNode,
        messageSizeLimit,
        responseTimeout,
        ownUdpAddress,
        () => {
          resolve(instance);
        },
        reject,
      );
    });
  }

  private readonly udpMessageHeader: Uint8Array;
  private readonly udp4Socket: dgram.Socket;

  /**
   * @param ownNodeId
   * @param nodeType
   * @param bootstrapUdpNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param ownUdpAddress
   * @param readyCallback
   * @param errorCallback
   */
  public constructor(
    ownNodeId: Uint8Array,
    nodeType: INodeTypesKeys,
    bootstrapUdpNodes: INodeAddress[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    ownUdpAddress?: IAddress,
    readyCallback?: () => void,
    errorCallback?: (error: Error) => void,
  ) {
    super(bootstrapUdpNodes, browserNode, messageSizeLimit, responseTimeout, false);
    this.setMaxListeners(Infinity);

    const udpMessageHeader = new Uint8Array(UDP_HEADER_LENGTH);
    udpMessageHeader.set([NODE_TYPES[nodeType]]);
    udpMessageHeader.set(ownNodeId, 1);
    this.udpMessageHeader = udpMessageHeader;
    this.udp4Socket = this.createUdp4Socket(ownUdpAddress, readyCallback, errorCallback);
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
    const udpMessage = new Uint8Array(UDP_HEADER_LENGTH + message.length);
    udpMessage.set(this.udpMessageHeader);
    udpMessage.set(message, UDP_HEADER_LENGTH);
    if (udpMessage.length > this.messageSizeLimit) {
      throw new Error(
        `UDP message too big, ${udpMessage.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed`,
      );
    }
    return new Promise((resolve, reject) => {
      this.udp4Socket.send(
        udpMessage,
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

  private createUdp4Socket(
    ownUdpAddress?: IAddress,
    readyCallback?: () => void,
    errorCallback?: (error: Error) => void,
  ): dgram.Socket {
    const udp4Socket = dgram.createSocket('udp4');
    udp4Socket
      .on(
        'message',
        (udpMessage: Buffer, remote: dgram.RemoteInfo) => {
          // TODO: Make use of UDP header
          this.handleIncomingMessage(remote, udpMessage.slice(UDP_HEADER_LENGTH))
            .catch((_) => {
              // TODO: Handle errors
            });
        },
      )
      .on('error', () => {
        // TODO: Handle errors
      });
    if (ownUdpAddress) {
      udp4Socket
        .once('listening', () => {
          if (readyCallback) {
            readyCallback();
          }
        })
        .once('error', (error: Error) => {
          if (errorCallback) {
            errorCallback(error);
          }
        });
      udp4Socket.bind(ownUdpAddress.port, ownUdpAddress.address);
    } else if (readyCallback) {
      setTimeout(readyCallback);
    }

    return udp4Socket;
  }
}
