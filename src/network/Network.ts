import {ArrayMap} from "array-map-set";
import {EventEmitter} from "events";
import {areArraysEqual, bin2Hex, ILogger, randomElement, shuffleArray} from "../utils/utils";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {
  ICommandsKeysForSending,
  INodeTypesKeys,
} from "./constants";
import {GossipManager} from "./GossipManager";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {composeIdentificationPayload, composeNodeInfoPayload, composePeersBinary, parsePeersBinary} from "./utils";
import {WsManager} from "./WsManager";

// TODO: Major improvements that need to be done in nearest future
// * Periodically get peers if necessary (in addition to establishing connections)
// * Maintain health state of peers even if active connections are missing

export interface INodeContactAddress {
  address?: string;
  tcp4Port?: number;
  udp4Port?: number;
  wsPort?: number;
}

export interface INodeContactIdentification {
  nodeId: Uint8Array;
  nodeType: INodeTypesKeys;
}

export type INodeContactInfo = INodeContactAddress & INodeContactIdentification;

export interface INodeContactInfoUdp extends INodeContactInfo {
  address: string;
  udp4Port: number;
}

export interface INodeContactInfoTcp extends INodeContactInfo {
  address: string;
  tcp4Port: number;
}

export interface INodeContactInfoWs extends INodeContactInfo {
  address: string;
  wsPort: number;
}

export interface INetworkOptions {
  activeConnectionsMaxNumber?: number;
  activeConnectionsMinNumber?: number;
  // In seconds
  connectionsMaintenanceInterval?: number;
  // In seconds
  contactsMaintenanceInterval?: number;
  routingTableMaxSize?: number;
  routingTableMinSize?: number;
}

export interface INetworkOptionsDefined extends INetworkOptions {
  activeConnectionsMaxNumber: number;
  activeConnectionsMinNumber: number;
  // In seconds
  connectionsMaintenanceInterval: number;
  // In seconds
  contactsMaintenanceInterval: number;
  routingTableMaxSize: number;
  routingTableMinSize: number;
}

const emptyPayload = new Uint8Array(0);

export class Network extends EventEmitter {
  public static async init(
    ownNodeContactInfo: INodeContactInfo,
    bootstrapNodes: INodeContactInfo[],
    browserNode: boolean,
    parentLogger: ILogger,
    options?: INetworkOptions,
  ): Promise<Network> {
    const identificationPayload = composeIdentificationPayload(ownNodeContactInfo);
    const nodeInfoPayload = composeNodeInfoPayload(ownNodeContactInfo);

    const logger = parentLogger.child({subsystem: 'network'});

    const [udpManager, tcpManager, wsManager] = await Promise.all([
      UdpManager.init(
        ownNodeContactInfo,
        identificationPayload,
        bootstrapNodes,
        browserNode,
        Network.UDP_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        logger,
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
        logger,
      ),
      WsManager.init(
        ownNodeContactInfo,
        nodeInfoPayload,
        bootstrapNodes,
        browserNode,
        Network.WS_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_TIMEOUT,
        logger,
      ),
    ]);

    const gossipManager = new GossipManager(
      ownNodeContactInfo.nodeId,
      browserNode,
      udpManager,
      tcpManager,
      wsManager,
      this.GOSSIP_CACHE_TIMEOUT,
      logger,
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
      options,
    );
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

  public readonly options: INetworkOptionsDefined;

  private readonly nodeId: Uint8Array;
  private readonly udpManager: UdpManager;
  private readonly tcpManager: TcpManager;
  private readonly wsManager: WsManager;
  private readonly gossipManager: GossipManager;
  private readonly browserNode: boolean;
  private readonly logger: ILogger;

  private readonly peers = ArrayMap<Uint8Array, INodeContactInfo>();
  private numberOfActiveConnections = 0;
  private readonly contactsMaintenanceInterval: ReturnType<typeof setInterval>;
  private readonly connectionsMaintenanceInterval: ReturnType<typeof setInterval>;

  private maintainingNumberOfContactsInProgress = false;
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
    options?: INetworkOptions,
  ) {
    super();
    this.setMaxListeners(Infinity);

    const defaultOptions: INetworkOptionsDefined = {
      activeConnectionsMaxNumber: 20,
      activeConnectionsMinNumber: 5,
      connectionsMaintenanceInterval: 30,
      contactsMaintenanceInterval: 30,
      routingTableMaxSize: 100,
      routingTableMinSize: 10,
    };

    const ownNodeId = ownNodeContactInfo.nodeId;

    this.nodeId = ownNodeId;
    this.udpManager = udpManager;
    this.tcpManager = tcpManager;
    this.wsManager = wsManager;
    this.gossipManager = gossipManager;
    this.browserNode = browserNode;
    this.logger = logger;
    this.options = Object.assign(
      {},
      defaultOptions,
      options || {},
    );

    for (const manager of [udpManager, tcpManager, wsManager, gossipManager]) {
      manager.on('command', this.emit.bind(this));
    }

    for (const manager of [udpManager, tcpManager, wsManager]) {
      manager
        .on('peer-contact-info', (nodeContactInfo: INodeContactInfo) => {
          logger.info('peer-contact-info', {nodeId: bin2Hex(nodeContactInfo.nodeId)});
          this.addPeer(nodeContactInfo);
        })
        .on('peer-connected', (nodeContactInfo: INodeContactInfo) => {
          logger.info('peer-connected', {nodeId: bin2Hex(nodeContactInfo.nodeId)});
          ++this.numberOfActiveConnections;
          this.emit('peer-connected', nodeContactInfo);
          if (this.peers.size < this.options.routingTableMinSize) {
            const connection = manager.nodeIdToActiveConnection(nodeContactInfo.nodeId);
            // Connection can be closed in case of race condition
            if (!connection) {
              return;
            }
            manager.sendMessage(
              // @ts-ignore We have type corresponding to manager, but it is hard to explain to TypeScript
              connection,
              'get-peers',
              Uint8Array.of(this.options.routingTableMaxSize - this.peers.size),
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
          logger.info('peer-disconnected', {nodeId: bin2Hex(nodeContactInfo.nodeId)});
          --this.numberOfActiveConnections;
          this.emit('peer-disconnected', nodeContactInfo);
          this.maintainNumberOfConnections();
        })
        .on(
          'get-peers',
          (
            numberOfPeersBinary: Uint8Array,
            responseCallback: (peersBinary: Uint8Array) => void,
            contactIdentification: INodeContactIdentification,
          ) => {
            const requesterNodeId = contactIdentification.nodeId;
            responseCallback(
              composePeersBinary(
                shuffleArray(
                  Array.from(this.peers.values())
                    .filter((peer) => {
                      return !(
                        areArraysEqual(peer.nodeId, requesterNodeId) ||
                        areArraysEqual(peer.nodeId, ownNodeId)
                      );
                    }),
                )
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
      this.addPeer(bootstrapNode);
    }

    this.contactsMaintenanceInterval = setInterval(
      () => {
        if (this.destroying) {
          return;
        }
        this.maintainNumberOfContacts();
      },
      this.options.contactsMaintenanceInterval * 1000,
    );

    this.connectionsMaintenanceInterval = setInterval(
      () => {
        if (this.destroying) {
          return;
        }
        this.maintainNumberOfConnections();
      },
      this.options.connectionsMaintenanceInterval * 1000,
    );
  }

  /**
   * @return An array of known nodes on the network
   */
  public getContacts(): INodeContactInfo[] {
    return Array.from(this.peers.values());
  }

  /**
   * @return An array of peers to which an active connection exists
   */
  public getPeers(): INodeContactInfo[] {
    return Array.from(this.peers.values())
      .filter((peer) => {
        return (
          this.tcpManager.nodeIdToActiveConnection(peer.nodeId) ||
          this.wsManager.nodeIdToActiveConnection(peer.nodeId)
        );
      });
  }

  public getNumberOfActiveConnections(): number {
    return this.numberOfActiveConnections;
  }

  /**
   * Send request without expecting response
   *
   * @param nodeTypes
   * @param command
   * @param payload
   */
  public sendRequestOneWay(
    nodeTypes: INodeTypesKeys[],
    command: ICommandsKeysForSending,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    return this.makeRequestToNodeType(
      nodeTypes,
      (protocolManager, connection) => {
        return protocolManager.sendMessageOneWay(connection, command, payload);
      },
    );
  }

  /**
   * Same as `sendRequestOneWay()`, but without guaranteed delivery (more efficient)
   *
   * @param nodeTypes
   * @param command
   * @param payload
   */
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

  /**
   * Send request and wait for response
   *
   * @param nodeTypes
   * @param command
   * @param payload
   *
   * @return Resolves with response contents
   */
  public sendRequest(
    nodeTypes: INodeTypesKeys[],
    command: ICommandsKeysForSending,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    return this.makeRequestToNodeType(
      nodeTypes,
      (protocolManager, connection) => {
        return protocolManager.sendMessage(connection, command, payload);
      });
  }

  /**
   * Same as `sendRequest()`, but without guaranteed delivery (more efficient)
   *
   * @param nodeTypes
   * @param command
   * @param payload
   */
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
      try {
        const randomAddress = randomElement(addresses);
        return await this.udpManager.sendMessage(randomAddress, command, payload);
      } catch (error) {
        const errorText = (error.stack || error) as string;
        this.logger.debug(`Initial request failed, trying again: ${errorText}`);

        if (addresses.length) {
          const randomAddress = randomElement(addresses);
          return this.udpManager.sendMessage(randomAddress, command, payload);
        }
      }
    }

    return this.sendRequest(nodeTypes, command, payload);
  }

  /**
   * Gossip command across the network
   *
   * @param command
   * @param payload
   */
  public async gossip(command: ICommandsKeysForSending, payload: Uint8Array): Promise<void> {
    return this.gossipManager.gossip(command, payload);
  }

  public async destroy(): Promise<void> {
    if (this.destroying) {
      return;
    }
    this.destroying = true;

    clearInterval(this.connectionsMaintenanceInterval);
    clearInterval(this.contactsMaintenanceInterval);
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

  /**
   * @param nodeTypes
   * @param makeRequestCallback
   *
   * This will make request and will do 1 retry in case request fails (if possible)
   */
  private async makeRequestToNodeType<Result>(
    nodeTypes: INodeTypesKeys[],
    // TODO: There should be a smart way to infer type instead of `any` that will work
    makeRequestCallback: (protocolManager: AbstractProtocolManager<any, INodeContactInfo>, connection: any) => Promise<Result>,
  ): Promise<Result> {
    const tcpConnections = this.tcpManager.getActiveConnectionsOfNodeTypes(nodeTypes);
    if (tcpConnections.length) {
      try {
        const randomConnection = randomElement(tcpConnections);
        return await makeRequestCallback(this.tcpManager, randomConnection);
      } catch (error) {
        const errorText = (error.stack || error) as string;
        this.logger.debug(`Initial request failed, trying again: ${errorText}`);

        if (tcpConnections.length) {
          const randomConnection = randomElement(tcpConnections);
          return makeRequestCallback(this.tcpManager, randomConnection);
        }
      }
    }

    const nodeIds = this.tcpManager.getNodeIdsOfNodeTypes(nodeTypes);
    if (nodeIds.length) {
      const randomNodeId = randomElement(nodeIds);
      const connection = await this.tcpManager.nodeIdToConnection(randomNodeId);
      if (connection) {
        try {
          return await makeRequestCallback(this.tcpManager, connection);
        } catch (error) {
          const errorText = (error.stack || error) as string;
          this.logger.debug(`Initial request failed, trying again: ${errorText}`);

          const randomNodeId = randomElement(nodeIds);
          const connection = await this.tcpManager.nodeIdToConnection(randomNodeId);
          if (connection) {
            return makeRequestCallback(this.tcpManager, connection);
          }
        }
      }
    }

    // Node likely doesn't have any other way to communicate besides WebSocket
    const wsConnections = this.wsManager.getActiveConnectionsOfNodeTypes(nodeTypes);
    if (wsConnections.length) {
      try {
        const randomConnection = randomElement(wsConnections);
        return await makeRequestCallback(this.wsManager, randomConnection);
      } catch (error) {
        const errorText = (error.stack || error) as string;
        this.logger.debug(`Initial request failed, trying again: ${errorText}`);

        if (wsConnections.length) {
          const randomConnection = randomElement(wsConnections);
          return makeRequestCallback(this.wsManager, randomConnection);
        }
      }
    }

    {
      const nodeIds = this.wsManager.getNodeIdsOfNodeTypes(nodeTypes);
      if (nodeIds.length) {
        const randomNodeId = randomElement(nodeIds);
        const connection = await this.wsManager.nodeIdToConnection(randomNodeId);
        if (connection) {
          try {
            return await makeRequestCallback(this.wsManager, connection);
          } catch (error) {
            const errorText = (error.stack || error) as string;
            this.logger.debug(`Initial request failed, trying again: ${errorText}`);

            if (nodeIds.length) {
              const randomNodeId = randomElement(nodeIds);
              const connection = await this.wsManager.nodeIdToConnection(randomNodeId);
              if (connection) {
                return makeRequestCallback(this.wsManager, connection);
              }
            }
          }
        }
      }
    }

    throw new Error(`Can't find any node that is in node types list and works: ${nodeTypes.join(', ')}`);
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

  private maintainNumberOfContacts(): void {
    if (this.maintainingNumberOfContactsInProgress) {
      return;
    }

    this.maintainingNumberOfContactsInProgress = true;
    this.maintainNumberOfContactsImplementation()
      .catch((error: any) => {
        const errorText = (error.stack || error) as string;
        this.logger.debug(`Error on maintain contacts: ${errorText}`);
      })
      .finally(() => {
        this.maintainingNumberOfContactsInProgress = false;
      });
  }

  private async maintainNumberOfContactsImplementation(): Promise<void> {
    if (this.peers.size >= this.options.routingTableMinSize) {
      return;
    }
    const peersBinary = await this.makeRequestToNodeType(
      ['any'],
      (protocolManager, connection) => {
        return protocolManager.sendMessage(
          connection,
          'get-peers',
          Uint8Array.of(this.options.routingTableMaxSize - this.peers.size),
        );
      },
    );

    const ownNodeId = this.nodeId;

    for (const peer of parsePeersBinary(peersBinary)) {
      if (!areArraysEqual(peer.nodeId, ownNodeId)) {
        this.addPeer(peer);
      }
    }
    this.maintainNumberOfConnections();
  }

  private maintainNumberOfConnections(): void {
    if (this.maintainingNumberOfConnectionsInProgress) {
      return;
    }

    this.maintainingNumberOfConnectionsInProgress = true;
    this.maintainNumberOfConnectionsImplementation()
      .catch((error: any) => {
        const errorText = (error.stack || error) as string;
        this.logger.debug(`Error on maintain connections: ${errorText}`);
      })
      .finally(() => {
        this.maintainingNumberOfConnectionsInProgress = false;
      });
  }

  private async maintainNumberOfConnectionsImplementation(): Promise<void> {
    if (this.numberOfActiveConnections >= this.options.activeConnectionsMinNumber) {
      return;
    }
    const peersToConnectTo = shuffleArray(
      Array.from(this.peers.values())
        .filter((peer) => {
          return !(
            this.tcpManager.nodeIdToActiveConnection(peer.nodeId) ||
            this.wsManager.nodeIdToActiveConnection(peer.nodeId)
          );
        }),
    )
      .slice(0, this.options.activeConnectionsMaxNumber);

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
