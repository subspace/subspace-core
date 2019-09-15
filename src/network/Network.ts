import {ArrayMap} from "array-map-set";
import {EventEmitter} from "events";
import {randomElement} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {
  ICommandsKeysForSending,
  IDENTIFICATION_PAYLOAD_LENGTH,
  INodeTypesKeys,
  NODE_TYPES,
} from "./constants";
import {GossipManager} from "./GossipManager";
import {
  INetwork,
  INodeContactIdentification,
  INodeContactInfo,
  INodeContactInfoTcp,
  INodeContactInfoUdp,
  INodeContactInfoWs,
} from "./INetwork";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {composeAddressPayload} from "./utils";
import {WsManager} from "./WsManager";

const emptyPayload = new Uint8Array(0);

export class Network extends EventEmitter implements INetwork {
  public static async init(
    ownNodeContactInfo: INodeContactInfo,
    bootstrapNodes: INodeContactInfo[],
    browserNode: boolean,
  ): Promise<Network> {
    const identificationPayload = new Uint8Array(IDENTIFICATION_PAYLOAD_LENGTH);
    identificationPayload.set([NODE_TYPES[ownNodeContactInfo.nodeType]]);
    identificationPayload.set(ownNodeContactInfo.nodeId, 1);

    const addressPayload = composeAddressPayload(ownNodeContactInfo);

    const extendedIdentificationPayload = new Uint8Array(identificationPayload.length + addressPayload.length);
    extendedIdentificationPayload.set(identificationPayload);
    extendedIdentificationPayload.set(addressPayload, identificationPayload.length);

    const [udpManager, tcpManager, wsManager] = await Promise.all([
      UdpManager.init(
        ownNodeContactInfo,
        identificationPayload,
        bootstrapNodes,
        browserNode,
        Network.UDP_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
      ),
      TcpManager.init(
        ownNodeContactInfo,
        extendedIdentificationPayload,
        bootstrapNodes,
        browserNode,
        Network.TCP_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_CONNECTION_EXPIRATION,
      ),
      WsManager.init(
        ownNodeContactInfo,
        extendedIdentificationPayload,
        bootstrapNodes,
        browserNode,
        Network.WS_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_TIMEOUT,
      ),
    ]);

    const gossipManager = new GossipManager(
      ownNodeContactInfo.nodeId,
      browserNode,
      udpManager,
      tcpManager,
      wsManager,
      this.GOSSIP_CACHE_TIMEOUT,
    );

    // TODO: We wait for them since otherwise concurrent connections to the same peer will cause issues; this should be
    //  handled by protocol managers nicely
    const bootstrapPromises: Array<Promise<any>> = [];
    // Initiate connection establishment to bootstrap nodes in case they are TCP or WebSocket
    for (const bootstrapNode of bootstrapNodes) {
      if (bootstrapNode.tcp4Port && !browserNode) {
        bootstrapPromises.push(
          tcpManager.nodeIdToConnection(bootstrapNode.nodeId)
            .catch((_) => {
              // TODO: Log in debug mode
            }),
        );
      } else if (bootstrapNode.wsPort) {
        bootstrapPromises.push(
          wsManager.nodeIdToConnection(bootstrapNode.nodeId)
            .catch((_) => {
              // TODO: Log in debug mode
            }),
        );
      }
    }

    await Promise.all(bootstrapPromises);

    return new Network(udpManager, tcpManager, wsManager, gossipManager, bootstrapNodes, browserNode);
  }

  // In seconds
  private static readonly DEFAULT_TIMEOUT = 10;
  // In seconds
  private static readonly DEFAULT_CONNECTION_EXPIRATION = 60;
  // In seconds
  private static readonly GOSSIP_CACHE_TIMEOUT = 60;
  // In bytes
  private static readonly UDP_MESSAGE_SIZE_LIMIT = 8192;
  // In bytes, excluding 4-bytes header with message length
  private static readonly TCP_MESSAGE_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MiB
  // In bytes
  private static readonly WS_MESSAGE_SIZE_LIMIT = Network.TCP_MESSAGE_SIZE_LIMIT;

  private readonly udpManager: UdpManager;
  private readonly tcpManager: TcpManager;
  private readonly wsManager: WsManager;
  private readonly gossipManager: GossipManager;
  private readonly peers = ArrayMap<Uint8Array, INodeContactInfo>();

  constructor(
    udpManager: UdpManager,
    tcpManager: TcpManager,
    wsManager: WsManager,
    gossipManager: GossipManager,
    bootstrapNodes: INodeContactInfo[],
    private readonly browserNode: boolean,
  ) {
    super();
    this.setMaxListeners(Infinity);

    this.udpManager = udpManager;
    this.tcpManager = tcpManager;
    this.wsManager = wsManager;
    this.gossipManager = gossipManager;

    for (const manager of [udpManager, tcpManager, wsManager, gossipManager]) {
      manager.on('command', this.emit.bind(this));
    }

    for (const manager of [udpManager, tcpManager, wsManager]) {
      manager
        .on('peer-contact-info', (nodeContactInfo: INodeContactInfo) => {
          this.peers.set(nodeContactInfo.nodeId, nodeContactInfo);
          if (nodeContactInfo.udp4Port) {
            udpManager.setNodeAddress(nodeContactInfo.nodeId, nodeContactInfo as INodeContactInfoUdp);
          }
          if (nodeContactInfo.tcp4Port) {
            tcpManager.setNodeAddress(nodeContactInfo.nodeId, nodeContactInfo as INodeContactInfoTcp);
          }
          if (nodeContactInfo.wsPort) {
            wsManager.setNodeAddress(nodeContactInfo.nodeId, nodeContactInfo as INodeContactInfoWs);
          }
        })
        .on('peer-connected', (nodeContactInfo: INodeContactInfo) => {
          this.emit('peer-connected', nodeContactInfo);
        })
        .on('peer-disconnected', (nodeContactInfo: INodeContactInfo) => {
          this.emit('peer-disconnected', nodeContactInfo);
        });
    }

    for (const bootstrapNode of bootstrapNodes) {
      this.peers.set(bootstrapNode.nodeId, bootstrapNode);
    }
  }

  /**
   * Returns an array of peers known in network
   */
  public getPeers(): INodeContactInfo[] {
    return Array.from(this.peers.values());
  }

  public async sendRequestOneWay(
    nodeTypes: INodeTypesKeys[],
    command: ICommandsKeysForSending,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    const [protocolManager, connection] = await this.getProtocolManagerAndConnection(nodeTypes);
    return protocolManager.sendMessageOneWay(connection, command, payload);
  }

  public async sendRequestOneWayUnreliable(
    nodeTypes: INodeTypesKeys[],
    command: ICommandsKeysForSending,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    if (this.browserNode) {
      return this.sendRequestOneWay(nodeTypes, command, payload);
    }

    const addresses = await this.udpManager.getActiveConnectionsOfNodeTypes(nodeTypes);
    if (addresses.length) {
      const randomAddress = randomElement(addresses);
      return this.udpManager.sendMessageOneWay(randomAddress, command, payload);
    }

    return this.sendRequestOneWay(nodeTypes, command, payload);
  }

  public async sendRequest(
    nodeTypes: INodeTypesKeys[],
    command: ICommandsKeysForSending,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    const [protocolManager, connection] = await this.getProtocolManagerAndConnection(nodeTypes);
    return protocolManager.sendMessage(connection, command, payload);
  }

  public async sendRequestUnreliable(
    nodeTypes: INodeTypesKeys[],
    command: ICommandsKeysForSending,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    if (this.browserNode) {
      return this.sendRequest(nodeTypes, command, payload);
    }

    const addresses = await this.udpManager.getActiveConnectionsOfNodeTypes(nodeTypes);
    if (addresses.length) {
      const randomAddress = randomElement(addresses);
      return this.udpManager.sendMessage(randomAddress, command, payload);
    }

    return this.sendRequest(nodeTypes, command, payload);
  }

  public async gossip(command: ICommandsKeysForSending, payload: Uint8Array): Promise<void> {
    return this.gossipManager.gossip(command, payload);
  }

  public async destroy(): Promise<void> {
    await Promise.all([
      this.udpManager.destroy(),
      this.tcpManager.destroy(),
      this.wsManager.destroy(),
    ]);
  }

  // Below methods are mostly to make nice TypeScript interface
  // TODO: Achieve the same without re-implementing methods

  public on(
    event: 'peer-connected' | 'peer-disconnected',
    listener: (
      nodeContactInfo: INodeContactInfo,
    ) => void,
  ): this;
  public on(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;
  public on(arg1: any, arg2: any): this {
    EventEmitter.prototype.on.call(this, arg1, arg2);
    return this;
  }

  public once(
    event: 'peer-connected' | 'peer-disconnected',
    listener: (
      nodeContactInfo: INodeContactInfo,
    ) => void,
  ): this;
  public once(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;
  public once(arg1: any, arg2: any): this {
    EventEmitter.prototype.once.call(this, arg1, arg2);
    return this;
  }

  public off(
    event: 'peer-connected' | 'peer-disconnected',
    listener: (
      nodeContactInfo: INodeContactInfo,
    ) => void,
  ): this;
  public off(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;
  public off(arg1: any, arg2: any): this {
    EventEmitter.prototype.off.call(this, arg1, arg2);
    return this;
  }

  public emit(
    event: 'peer-connected' | 'peer-disconnected',
    nodeContactInfo: INodeContactInfo,
  ): boolean;
  public emit(
    event: ICommandsKeysForSending,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void,
    extra: INodeContactIdentification,
  ): boolean;
  public emit(arg1: any, arg2: any, arg3?: any, arg4?: any): boolean {
    return EventEmitter.prototype.emit.call(this, arg1, arg2, arg3, arg4);
  }

  // TODO: There should be a smart way to infer type instead of `any`
  private async getProtocolManagerAndConnection(
    nodeTypes: INodeTypesKeys[],
  ): Promise<[AbstractProtocolManager<any, INodeContactInfo>, any]> {
    const tcpConnections = this.tcpManager.getActiveConnectionsOfNodeTypes(nodeTypes);
    if (tcpConnections.length) {
      const randomConnection = randomElement(tcpConnections);
      return [this.tcpManager, randomConnection];
    }

    const nodeIds = this.tcpManager.getNodeIdsOfNodeTypes(nodeTypes);
    if (nodeIds.length) {
      const randomNodeId = randomElement(nodeIds);
      const connection = await this.tcpManager.nodeIdToConnection(randomNodeId);
      if (connection) {
        return [this.tcpManager, connection];
      }
    }

    // Node likely doesn't have any other way to communicate besides WebSocket
    const wsConnections = this.wsManager.getActiveConnectionsOfNodeTypes(nodeTypes);
    if (wsConnections.length) {
      const randomConnection = randomElement(wsConnections);
      return [this.wsManager, randomConnection];
    }

    {
      const nodeIds = this.wsManager.getNodeIdsOfNodeTypes(nodeTypes);
      if (nodeIds.length) {
        const randomNodeId = randomElement(nodeIds);
        const connection = await this.wsManager.nodeIdToConnection(randomNodeId);
        if (connection) {
          return [this.wsManager, connection];
        }
      }
    }

    throw new Error(`Can't find any node that is in node types list: ${nodeTypes.join(', ')}`);
  }
}
