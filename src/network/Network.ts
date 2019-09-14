import {EventEmitter} from "events";
import {random_int} from "random-bytes-numbers";
import {randomElement} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeysForSending, IDENTIFICATION_PAYLOAD_LENGTH, INodeTypesKeys, NODE_TYPES} from "./constants";
import {GossipManager} from "./GossipManager";
import {INetwork, INodeContactIdentification, INodeContactInfo} from "./INetwork";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {noopResponseCallback} from "./utils";
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
        identificationPayload,
        bootstrapNodes,
        browserNode,
        Network.TCP_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_CONNECTION_EXPIRATION,
      ),
      WsManager.init(
        ownNodeContactInfo,
        identificationPayload,
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

    return new Network(udpManager, tcpManager, wsManager, gossipManager, browserNode);
  }

  // In seconds
  private static readonly DEFAULT_TIMEOUT = 10;
  // In seconds
  private static readonly DEFAULT_CONNECTION_EXPIRATION = 60;
  // In seconds
  private static readonly GOSSIP_CACHE_TIMEOUT = 60;
  // In bytes
  private static readonly UDP_MESSAGE_SIZE_LIMIT = 508;
  // In bytes, excluding 4-bytes header with message length
  private static readonly TCP_MESSAGE_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MiB
  // In bytes
  private static readonly WS_MESSAGE_SIZE_LIMIT = Network.TCP_MESSAGE_SIZE_LIMIT;

  private readonly udpManager: UdpManager;
  private readonly tcpManager: TcpManager;
  private readonly wsManager: WsManager;
  private readonly gossipManager: GossipManager;

  constructor(
    udpManager: UdpManager,
    tcpManager: TcpManager,
    wsManager: WsManager,
    gossipManager: GossipManager,
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
      const randomAddress = addresses[random_int(0, addresses.length - 1)];
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
      const randomAddress = addresses[random_int(0, addresses.length - 1)];
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
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: ICommandsKeysForSending,
    listener: (
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: ICommandsKeysForSending,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void = noopResponseCallback,
    extra: INodeContactIdentification,
  ): boolean {
    return EventEmitter.prototype.emit.call(this, event, payload, responseCallback, extra);
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
