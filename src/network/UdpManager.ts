import * as dgram from "dgram";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys, IDENTIFICATION_PAYLOAD_LENGTH, INodeTypesKeys} from "./constants";
import {INodeContactInfo, INodeContactInfoUdp} from "./INetwork";
import {composeMessage, parseIdentificationPayload} from "./utils";

function extractUdpBootstrapNodes(bootstrapNodes: INodeContactInfo[]): INodeContactInfoUdp[] {
  const bootstrapNodesUdp: INodeContactInfoUdp[] = [];
  for (const bootstrapNode of bootstrapNodes) {
    if (bootstrapNode.udp4Port !== undefined) {
      bootstrapNodesUdp.push(bootstrapNode as INodeContactInfoUdp);
    }
  }
  return bootstrapNodesUdp;
}

export class UdpManager extends AbstractProtocolManager<INodeContactInfoUdp, INodeContactInfoUdp> {
  public static init(
    ownNodeContactInfo: INodeContactInfo,
    identificationPayload: Uint8Array,
    bootstrapNodes: INodeContactInfo[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
  ): Promise<UdpManager> {
    return new Promise((resolve, reject) => {
      const instance = new UdpManager(
        ownNodeContactInfo,
        identificationPayload,
        extractUdpBootstrapNodes(bootstrapNodes),
        browserNode,
        messageSizeLimit,
        responseTimeout,
        () => {
          resolve(instance);
        },
        reject,
      );
    });
  }

  private readonly identificationPayload: Uint8Array;
  private readonly udp4Socket?: dgram.Socket;

  /**
   * @param ownNodeContactInfo
   * @param identificationPayload
   * @param bootstrapNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param readyCallback
   * @param errorCallback
   */
  public constructor(
    ownNodeContactInfo: INodeContactInfo,
    identificationPayload: Uint8Array,
    bootstrapNodes: INodeContactInfoUdp[],
    browserNode: boolean,
    messageSizeLimit: number,
    responseTimeout: number,
    readyCallback?: () => void,
    errorCallback?: (error: Error) => void,
  ) {
    super(bootstrapNodes, browserNode, messageSizeLimit, responseTimeout, false);
    this.setMaxListeners(Infinity);

    this.identificationPayload = identificationPayload;
    if (!browserNode) {
      this.udp4Socket = this.createUdp4Socket(ownNodeContactInfo.address, ownNodeContactInfo.udp4Port, readyCallback, errorCallback);
    } else if (readyCallback) {
      setTimeout(readyCallback);
    }
  }

  /**
   * @param nodeTypes
   *
   * @return Active connections
   */
  public getActiveConnectionsOfNodeTypes(nodeTypes: INodeTypesKeys[]): INodeContactInfoUdp[] {
    const nodeTypesSet = new Set(nodeTypes);
    const connections: INodeContactInfoUdp[] = [];
    this.nodeIdToAddressMap.forEach((address: INodeContactInfoUdp) => {
      if (!nodeTypesSet.has(address.nodeType)) {
        return;
      }
      connections.push(address);
    });

    return connections;
  }

  public async nodeIdToConnection(nodeId: Uint8Array): Promise<INodeContactInfoUdp | null> {
    if (this.browserNode) {
      return null;
    }
    const address = this.nodeIdToAddressMap.get(nodeId);
    if (address) {
      return address;
    }

    return null;
  }

  public async sendRawMessage(address: INodeContactInfoUdp, message: Uint8Array): Promise<void> {
    const udp4Socket = this.udp4Socket;
    if (!udp4Socket) {
      throw new Error(`UDP Socket is not running, can't send a message; are you trying to use UDP in the browser?`);
    }
    const udpMessage = new Uint8Array(IDENTIFICATION_PAYLOAD_LENGTH + message.length);
    udpMessage.set(this.identificationPayload);
    udpMessage.set(message, IDENTIFICATION_PAYLOAD_LENGTH);
    if (udpMessage.length > this.messageSizeLimit) {
      throw new Error(
        `UDP message too big, ${udpMessage.length} bytes specified, but only ${this.messageSizeLimit} bytes allowed`,
      );
    }
    return new Promise((resolve, reject) => {
      udp4Socket.send(
        udpMessage,
        address.udp4Port,
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
      if (this.udp4Socket) {
        this.udp4Socket.close(resolve);
      } else {
        resolve();
      }
    });
  }

  protected sendMessageImplementation(
    address: INodeContactInfoUdp,
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
    address?: string,
    port?: number,
    readyCallback?: () => void,
    errorCallback?: (error: Error) => void,
  ): dgram.Socket {
    const udp4Socket = dgram.createSocket('udp4');
    udp4Socket
      .on(
        'message',
        (udpMessage: Buffer, remote: dgram.RemoteInfo) => {
          // Should be at least identification payload + command
          if (udpMessage.length < (IDENTIFICATION_PAYLOAD_LENGTH + 1)) {
            // TODO: Log in debug mode
            return;
          }
          const {nodeId, nodeType} = parseIdentificationPayload(udpMessage.subarray(0, IDENTIFICATION_PAYLOAD_LENGTH));
          const nodeContactInfo: INodeContactInfoUdp = {
            address: remote.address,
            nodeId: nodeId,
            nodeType: nodeType,
            udp4Port: remote.port,
          };
          this.handleIncomingMessage(
            nodeContactInfo,
            udpMessage.subarray(IDENTIFICATION_PAYLOAD_LENGTH),
            {nodeId, nodeType},
          )
            .catch((_) => {
              // TODO: Handle errors
            });
        },
      )
      .on('error', () => {
        // TODO: Handle errors
      });
    if (port) {
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
      udp4Socket.bind(port, address as string);
    } else if (readyCallback) {
      setTimeout(readyCallback);
    }

    return udp4Socket;
  }
}
