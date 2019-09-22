import {ArrayMap} from "array-map-set";
import {EventEmitter} from "events";
import {areArraysEqual, bin2Hex, ILogger, randomElement} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {
  ICommandsKeysForSending,
  INodeTypesKeys,
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
import {composeIdentificationPayload, composeNodeInfoPayload, composePeersBinary, parsePeersBinary} from "./utils";
import {WsManager} from "./WsManager";

const emptyPayload = new Uint8Array(0);

export class Network extends EventEmitter implements INetwork {
  public static async init(
    ownNodeContactInfo: INodeContactInfo,
    bootstrapNodes: INodeContactInfo[],
    browserNode: boolean,
    globalLogger: ILogger,
    routingTableMinSize: number = 10,
    routingTableMaxSize: number = 100,
    activeConnectionsMinNumber: number = 5,
    activeConnectionsMaxNumber: number = 20,
  ): Promise<Network> {
    const identificationPayload = composeIdentificationPayload(ownNodeContactInfo);
    const nodeInfoPayload = composeNodeInfoPayload(ownNodeContactInfo);

    const logger = globalLogger.child({subsystem: 'network'});

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
        nodeInfoPayload,
        bootstrapNodes,
        browserNode,
        Network.TCP_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_CONNECTION_EXPIRATION,
      ),
      WsManager.init(
        ownNodeContactInfo,
        nodeInfoPayload,
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

    return new Network(
      ownNodeContactInfo,
      udpManager,
      tcpManager,
      wsManager,
      gossipManager,
      bootstrapNodes,
      browserNode,
      logger,
      routingTableMinSize,
      routingTableMaxSize,
      activeConnectionsMinNumber,
      activeConnectionsMaxNumber,
    );
  }

  // In seconds
  private static readonly DEFAULT_TIMEOUT = 10;
  // In seconds
  private static readonly DEFAULT_CONNECTION_EXPIRATION = 60;
  // In seconds
  private static readonly GOSSIP_CACHE_TIMEOUT = 60;
  // In seconds
  private static readonly CONNECTION_MAINTENANCE_INTERVAL = 30;
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
  private readonly browserNode: boolean;
  private readonly logger: ILogger;
  private readonly activeConnectionsMinNumber: number;
  private readonly activeConnectionsMaxNumber: number;

  private readonly peers = ArrayMap<Uint8Array, INodeContactInfo>();
  private numberOfActiveConnections = 0;
  private readonly connectionMaintenanceInterval: ReturnType<typeof setInterval>;

  private maintainingNumberOfConnectionsInProgress = false;
  private destroying = false;

  constructor(
    ownNodeContactInfo: INodeContactInfo,
    udpManager: UdpManager,
    tcpManager: TcpManager,
    wsManager: WsManager,
    gossipManager: GossipManager,
    bootstrapNodes: INodeContactInfo[],
    browserNode: boolean,
    logger: ILogger,
    routingTableMinSize: number = 10,
    routingTableMaxSize: number = 100,
    activeConnectionsMinNumber: number = 5,
    activeConnectionsMaxNumber: number = 20,
  ) {
    super();
    this.setMaxListeners(Infinity);

    const ownNodeId = ownNodeContactInfo.nodeId;

    this.udpManager = udpManager;
    this.tcpManager = tcpManager;
    this.wsManager = wsManager;
    this.gossipManager = gossipManager;
    this.browserNode = browserNode;
    this.logger = logger;
    this.activeConnectionsMinNumber = activeConnectionsMinNumber;
    this.activeConnectionsMaxNumber = activeConnectionsMaxNumber;

    for (const manager of [udpManager, tcpManager, wsManager, gossipManager]) {
      manager.on('command', this.emit.bind(this));
    }

    for (const manager of [udpManager, tcpManager, wsManager]) {
      manager
        .on('peer-contact-info', (nodeContactInfo: INodeContactInfo) => {
          this.addPeer(nodeContactInfo);
        })
        .on('peer-connected', (nodeContactInfo: INodeContactInfo) => {
          ++this.numberOfActiveConnections;
          this.emit('peer-connected', nodeContactInfo);
          if (this.peers.size < routingTableMinSize) {
            const connection = manager.nodeIdToActiveConnection(nodeContactInfo.nodeId) as Exclude<ReturnType<typeof manager.nodeIdToActiveConnection>, null>;
            manager.sendMessage(
              // @ts-ignore We have type corresponding to manager, but it is hard to explain to TypeScript
              connection,
              'get-peers',
              Uint8Array.of(routingTableMaxSize - this.peers.size),
            )
              .then((peersBinary: Uint8Array) => {
                const requestedNodeId = nodeContactInfo.nodeId;
                for (const peer of parsePeersBinary(peersBinary)) {
                  if (!(
                    areArraysEqual(peer.nodeId, requestedNodeId) ||
                    areArraysEqual(peer.nodeId, ownNodeId)
                  )) {
                    this.addPeer(peer);
                  }
                }
                this.maintainNumberOfConnections();
              })
              .catch((error: any) => {
                const errorText = (error.stack || error) as string;
                logger.debug(`Failed to request peers from ${bin2Hex(nodeContactInfo.nodeId)}: ${errorText}`);
              });
          }
        })
        .on('peer-disconnected', (nodeContactInfo: INodeContactInfo) => {
          --this.numberOfActiveConnections;
          this.emit('peer-disconnected', nodeContactInfo);
          this.maintainNumberOfConnections();
        })
        .on(
          'get-peers',
          (
            numberOfPeersBinary: Uint8Array,
            responseCallback: (peersBinary: Uint8Array) => void,
            contactInfo: INodeContactInfo,
          ) => {
            const requesterNodeId = contactInfo.nodeId;
            responseCallback(
              composePeersBinary(
                Array.from(this.peers.values())
                  .filter((peer) => {
                    return !(
                      areArraysEqual(peer.nodeId, requesterNodeId) ||
                      areArraysEqual(peer.nodeId, ownNodeId)
                    );
                  })
                  // TODO: Randomize
                  .slice(0, numberOfPeersBinary[0]),
              ),
            );
          },
        );
    }

    // Initiate connection establishment to bootstrap nodes in case they are TCP or WebSocket
    for (const bootstrapNode of bootstrapNodes) {
      // noinspection JSIgnoredPromiseFromCall
      this.establishConnectionToNode(bootstrapNode);
    }

    this.connectionMaintenanceInterval = setInterval(
      () => {
        if (this.destroying) {
          return;
        }
        this.maintainNumberOfConnections();
      },
      Network.CONNECTION_MAINTENANCE_INTERVAL * 1000,
    );
  }

  /**
   * Returns an array of peers known in network
   */
  public getPeers(): INodeContactInfo[] {
    return Array.from(this.peers.values());
  }

  public getNumberOfActiveConnections(): number {
    return this.numberOfActiveConnections;
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
    if (this.destroying) {
      return;
    }
    this.destroying = true;

    clearInterval(this.connectionMaintenanceInterval);
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

  private addPeer(nodeContactInfo: INodeContactInfo): void {
    // TODO: No cleanup and check whether peers are still reachable
    this.peers.set(nodeContactInfo.nodeId, nodeContactInfo);
    if (nodeContactInfo.udp4Port) {
      this.udpManager.setNodeAddress(nodeContactInfo.nodeId, nodeContactInfo as INodeContactInfoUdp);
    }
    if (nodeContactInfo.tcp4Port) {
      this.tcpManager.setNodeAddress(nodeContactInfo.nodeId, nodeContactInfo as INodeContactInfoTcp);
    }
    if (nodeContactInfo.wsPort) {
      this.wsManager.setNodeAddress(nodeContactInfo.nodeId, nodeContactInfo as INodeContactInfoWs);
    }
  }

  private maintainNumberOfConnections(): void {
    if (this.maintainingNumberOfConnectionsInProgress) {
      return;
    }

    this.maintainingNumberOfConnectionsInProgress = true;
    this.maintainNumberOfConnectionsImplementation()
      .catch((error: any) => {
        const errorText = (error.stack || error) as string;
        this.logger.debug(`Error on maintain connection: ${errorText}`);
      })
      .finally(() => {
        this.maintainingNumberOfConnectionsInProgress = false;
      });
  }

  private async maintainNumberOfConnectionsImplementation(): Promise<void> {
    if (this.numberOfActiveConnections >= this.activeConnectionsMinNumber) {
      return;
    }
    // TODO: Randomize
    const peersToConnectTo = Array.from(this.peers.values())
      .filter((peer) => {
        return !(
          this.tcpManager.nodeIdToActiveConnection(peer.nodeId) ||
          this.wsManager.nodeIdToActiveConnection(peer.nodeId)
        );
      })
      .slice(0, this.activeConnectionsMaxNumber);

    for (const peer of peersToConnectTo) {
      if (this.destroying) {
        return;
      }
      await this.establishConnectionToNode(peer);
    }
  }

  private establishConnectionToNode(nodeContactInfo: INodeContactInfo): Promise<any> {
    if (nodeContactInfo.tcp4Port && !this.browserNode) {
      return this.tcpManager.nodeIdToConnection(nodeContactInfo.nodeId)
        .catch((error: any) => {
          const errorText = (error.stack || error) as string;
          this.logger.debug(`Error on connection establishment during connection maintenance: ${errorText}`);
        });
    } else if (nodeContactInfo.wsPort) {
      return this.wsManager.nodeIdToConnection(nodeContactInfo.nodeId)
        .catch((error: any) => {
          const errorText = (error.stack || error) as string;
          this.logger.debug(`Error on connection establishment during connection maintenance: ${errorText}`);
        });
    }

    return Promise.resolve();
  }
}
