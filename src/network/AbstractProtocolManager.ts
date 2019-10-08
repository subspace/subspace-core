import {ArrayMap, ArraySet} from "array-map-set";
import {EventEmitter} from "events";
import {bin2Hex, compareUint8Array, ILogger} from "../utils/utils";
import {
  ICommandsKeys,
  ICommandsKeysForSending,
  INodeTypesKeys,
  NODE_CONTACT_INFO_PAYLOAD_LENGTH,
} from "./constants";
import {INodeContactIdentification, INodeContactInfo} from "./Network";
import {
  noopResponseCallback,
  parseMessage,
  parseNodeInfoPayload,
} from "./utils";

export abstract class AbstractProtocolManager<Connection extends object, Address extends INodeContactInfo> extends EventEmitter {
  protected readonly nodeIdToConnectionMap = ArrayMap<Uint8Array, Connection>();
  protected readonly nodeIdToAddressMap = ArrayMap<Uint8Array, Address>();
  protected readonly connectionToIdentificationMap = new WeakMap<Connection, INodeContactIdentification>();
  protected readonly connectionToNodeIdMap = new Map<Connection, Uint8Array>();
  protected destroying = false;
  /**
   * Mapping from requestId to callback
   */
  private readonly requestCallbacks = new Map<number, (payload: Uint8Array) => any>();
  /**
   * Mapping from responseId to callback
   */
  private readonly responseCallbacks = new Map<number, (payload: Uint8Array) => any>();
  /**
   * Mapping from nodeId to Promise that will potentially resolve to established connection
   */
  private readonly connectionEstablishmentInProgress = ArrayMap<Uint8Array, Promise<Connection | null>>();
  // Will 2**32 be enough?
  private requestId = 0;
  // Will 2**32 be enough?
  private responseId = 0;

  /**
   * @param ownNodeId
   * @param bootstrapNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionBased Whether there is a concept of persistent connection (like in TCP and unlike UDP)
   * @param logger
   */
  protected constructor(
    protected ownNodeId: Uint8Array,
    bootstrapNodes: Address[],
    protected readonly browserNode: boolean,
    protected readonly messageSizeLimit: number,
    private readonly responseTimeout: number,
    private readonly connectionBased: boolean,
    protected readonly logger: ILogger,
  ) {
    super();
    this.setMaxListeners(Infinity);

    for (const bootstrapNode of bootstrapNodes) {
      this.nodeIdToAddressMap.set(bootstrapNode.nodeId, bootstrapNode);
    }
  }

  // Below EventEmitter-derived methods are mostly to make nice TypeScript interface
  // TODO: Achieve the same without re-implementing methods

  public on(
    event: 'shutdown-disconnection',
    listener: (nodeId: Uint8Array) => void,
  ): this;
  public on(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, contactIdentification: INodeContactIdentification) => void,
  ): this;
  public on(
    event: 'get-peers',
    listener: (
      numberOfPeersBinary: Uint8Array,
      responseCallback: (peersBinary: Uint8Array) => void,
      contactIdentification: INodeContactIdentification,
    ) => void,
  ): this;
  public on(
    event: 'peer-contact-info' | 'peer-connected' | 'peer-disconnected',
    listener: (nodeContactInfo: INodeContactInfo) => void,
  ): this;
  public on(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      contactIdentification: INodeContactIdentification,
    ) => void,
  ): this;
  public on(event: string, listener: (arg1: any, arg2?: any, arg3?: any, arg4?: any) => void): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: 'shutdown-disconnection',
    listener: (nodeId: Uint8Array) => void,
  ): this;
  public once(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, contactIdentification: INodeContactIdentification) => void,
  ): this;
  public once(
    event: 'get-peers',
    listener: (
      numberOfPeersBinary: Uint8Array,
      responseCallback: (peersBinary: Uint8Array) => void,
      contactIdentification: INodeContactIdentification,
    ) => void,
  ): this;
  public once(
    event: 'peer-contact-info' | 'peer-connected' | 'peer-disconnected',
    listener: (nodeContactInfo: INodeContactInfo) => void,
  ): this;
  public once(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      contactIdentification: INodeContactIdentification,
    ) => void,
  ): this;
  public once(event: string, listener: (arg1: any, arg2?: any, arg3?: any, arg4?: any) => void): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: 'shutdown-disconnection',
    listener: (nodeId: Uint8Array) => void,
  ): this;
  public off(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, contactIdentification: INodeContactIdentification) => void,
  ): this;
  public off(
    event: 'get-peers',
    listener: (
      numberOfPeersBinary: Uint8Array,
      responseCallback: (peersBinary: Uint8Array) => void,
      contactIdentification: INodeContactIdentification,
    ) => void,
  ): this;
  public off(
    event: 'peer-contact-info' | 'peer-connected' | 'peer-disconnected',
    listener: (nodeContactInfo: INodeContactInfo) => void,
  ): this;
  public off(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (peersBinary: Uint8Array) => void,
      contactIdentification: INodeContactIdentification,
    ) => void,
  ): this;
  public off(event: string, listener: (arg1: any, arg2?: any, arg3?: any, arg4?: any) => void): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: 'shutdown-disconnection',
    nodeId: Uint8Array,
  ): boolean;
  public emit(
    event: 'gossip',
    gossipMessageOrNumberOfPeersBinary: Uint8Array,
    contactIdentification: INodeContactIdentification,
  ): boolean;
  public emit(
    event: 'get-peers',
    numberOfPeersBinary: Uint8Array,
    responseCallback: (peersBinary: Uint8Array) => void,
    contactIdentification: INodeContactIdentification,
  ): boolean;
  public emit(
    event: 'peer-contact-info' | 'peer-connected' | 'peer-disconnected',
    nodeContactInfo: INodeContactInfo,
  ): boolean;
  public emit(
    event: 'command',
    command: ICommandsKeysForSending,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void,
    contactIdentification: INodeContactIdentification,
  ): boolean;
  public emit(
    event: string,
    arg1: any,
    arg2?: any,
    arg3?: any,
    arg4?: any,
  ): boolean {
    return EventEmitter.prototype.emit.call(this, event, arg1, arg2, arg3, arg4);
  }

  /**
   * @return Quickly returns non-unique list of nodeIds protocol manager knows about
   */
  public getKnownNodeIds(): Uint8Array[] {
    return [
      ...this.nodeIdToAddressMap.keys(),
      ...this.nodeIdToConnectionMap.keys(),
    ];
  }

  /**
   * @return In bytes
   */
  public getMessageSizeLimit(): number {
    return this.messageSizeLimit;
  }

  /**
   * @param nodeTypes
   *
   * @return Active connections
   */
  public getActiveConnectionsOfNodeTypes(nodeTypes: INodeTypesKeys[]): Connection[] {
    const nodeTypesSet = new Set(nodeTypes);
    const allowAny = nodeTypesSet.has('any');
    const connections: Connection[] = [];
    this.nodeIdToAddressMap.forEach((address: Address, nodeId: Uint8Array) => {
      if (!(
        allowAny ||
        nodeTypesSet.has(address.nodeType)
      )) {
        return;
      }
      const connection = this.nodeIdToConnectionMap.get(nodeId);
      if (connection) {
        connections.push(connection);
      }
    });

    return connections;
  }

  /**
   * @param nodeTypes
   */
  public getNodeIdsOfNodeTypes(nodeTypes: INodeTypesKeys[]): Uint8Array[] {
    const nodeTypesSet = new Set(nodeTypes);
    const nodeIds = ArraySet();
    this.nodeIdToAddressMap.forEach((address: Address, nodeId: Uint8Array) => {
      if (nodeTypesSet.has(address.nodeType)) {
        nodeIds.add(nodeId);
      }
    });

    this.nodeIdToConnectionMap.forEach((connection: Connection) => {
      const nodeContactIdentification = this.connectionToIdentificationMap.get(connection);
      if (nodeContactIdentification && nodeTypesSet.has(nodeContactIdentification.nodeType)) {
        nodeIds.add(nodeContactIdentification.nodeId);
      }
    });

    return Array.from(nodeIds);
  }

  /**
   * @param nodeId
   *
   * @return Active connection if already present, null otherwise
   */
  public nodeIdToActiveConnection(nodeId: Uint8Array): Connection | null {
    return this.nodeIdToConnectionMap.get(nodeId) || null;
  }

  public nodeIdToConnection(nodeId: Uint8Array): Promise<Connection | null> {
    if (this.destroying) {
      return Promise.resolve(null);
    }
    const connectionEstablishmentInProgress = this.connectionEstablishmentInProgress;
    const existingInProgressPromise = connectionEstablishmentInProgress.get(nodeId);
    if (existingInProgressPromise) {
      return existingInProgressPromise;
    }

    const connectionPromise = this.nodeIdToConnectionImplementation(nodeId);
    connectionEstablishmentInProgress.set(nodeId, connectionPromise);
    connectionPromise
      .finally(() => {
        connectionEstablishmentInProgress.delete(nodeId);
      })
      .catch(() => {
        // Just to avoid unhandled Promise exception
      });

    return connectionPromise;
  }

  public setNodeAddress(nodeId: Uint8Array, nodeContactAddress: Address): void {
    this.nodeIdToAddressMap.set(nodeId, nodeContactAddress);
  }

  /**
   * @param connection
   * @param command
   * @param payload
   */
  public sendMessageOneWay(
    connection: Connection,
    command: ICommandsKeys,
    payload: Uint8Array,
  ): Promise<void> {
    return this.sendMessageImplementation(connection, command, 0, payload);
  }

  /**
   * @param connection
   * @param command
   * @param payload
   */
  public sendMessage(
    connection: Connection,
    command: ICommandsKeys,
    payload: Uint8Array,
  ): Promise<Uint8Array> {
    // TODO: Handle 32-bit overflow
    ++this.requestId;
    const requestId = this.requestId;
    // Node likely doesn't have any other way to communicate besides WebSocket
    return new Promise((resolve, reject) => {
      this.requestCallbacks.set(requestId, resolve);
      const timeout = setTimeout(
        () => {
          this.requestCallbacks.delete(requestId);
          reject(new Error(`Request ${requestId} timeout out`));
        },
        this.responseTimeout * 1000,
      );
      if (timeout.unref) {
        timeout.unref();
      }
      this.sendMessageImplementation(connection, command, requestId, payload)
        .catch((error) => {
          this.requestCallbacks.delete(requestId);
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  public abstract sendRawMessage(connection: Connection, message: Uint8Array): Promise<void>;

  public async destroy(): Promise<void> {
    if (this.destroying) {
      return;
    }
    this.destroying = true;

    return this.destroyImplementation();
  }

  protected abstract nodeIdToConnectionImplementation(nodeId: Uint8Array): Promise<Connection | null>;

  protected async handleIncomingMessage(
    connection: Connection,
    message: Uint8Array,
    contactIdentification?: INodeContactIdentification,
  ): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      this.logger.debug(
        `Error on handling incoming message too big: ${message.length} bytes given, at most ${this.messageSizeLimit} bytes expected`,
        {
          nodeId: contactIdentification ? bin2Hex(contactIdentification.nodeId) : 'unknown',
        },
      );
      return;
    }
    const [command, requestId, payload] = parseMessage(message);
    // TODO: Almost no validation!
    if (command === 'identification') {
      if (!this.connectionBased) {
        this.destroyConnection(connection);
        throw new Error('Identification is not supported by protocol');
      }
      if (payload.length !== NODE_CONTACT_INFO_PAYLOAD_LENGTH) {
        this.destroyConnection(connection);
        throw new Error(
          `Identification payload length is incorrect, expected ${NODE_CONTACT_INFO_PAYLOAD_LENGTH} bytes but got ${payload.length} bytes`,
        );
      }
      const nodeContactInfo = parseNodeInfoPayload(payload);
      this.registerConnectionMappingToIdentificationInfo(connection, nodeContactInfo);
      return;
    }
    const nodeId = this.connectionToNodeIdMap.get(connection);
    if (this.connectionBased && !nodeId) {
      this.logger.debug(`Non-identified node tried to send command ${command}, ignored`);
      return;
    }
    if (!contactIdentification) {
      if (!nodeId) {
        throw new Error('There is no contact identification, but also no nodeId, this should never happen');
      }
      contactIdentification = this.nodeIdToAddressMap.get(nodeId);
      if (!contactIdentification) {
        contactIdentification = this.connectionToIdentificationMap.get(connection);
        if (!contactIdentification) {
          throw new Error('There is no contact identification, this should never happen');
        }
      }
    }
    switch (command) {
      case 'response':
        const requestCallback = this.requestCallbacks.get(requestId);
        if (requestCallback) {
          requestCallback(payload);
          // TODO: Should this really be done in case we receive response from random sender?
          this.requestCallbacks.delete(requestId);
        }
        break;
      case 'gossip':
        this.emit(
          'gossip',
          payload,
          contactIdentification,
        );
        break;
      case 'shutdown-disconnection':
        this.destroyConnection(connection);
        this.emit('shutdown-disconnection', contactIdentification.nodeId);
        break;
      default:
        if (requestId) {
          // TODO: Handle 32-bit overflow
          ++this.responseId;
          const responseId = this.responseId;
          this.responseCallbacks.set(
            responseId,
            (payload) => {
              this.responseCallbacks.delete(responseId);
              return this.sendMessageImplementation(connection, 'response', requestId, payload);
            },
          );
          const timeout = setTimeout(
            () => {
              this.responseCallbacks.delete(responseId);
            },
            this.responseTimeout * 1000,
          );
          if (timeout.unref) {
            timeout.unref();
          }
          if (command === 'get-peers') {
            this.emit(
              'get-peers',
              payload,
              (responsePayload: Uint8Array) => {
                const responseCallback = this.responseCallbacks.get(responseId);
                if (responseCallback) {
                  responseCallback(responsePayload);
                }
              },
              contactIdentification,
            );
          } else {
            this.emit(
              'command',
              command,
              payload,
              (responsePayload: Uint8Array) => {
                const responseCallback = this.responseCallbacks.get(responseId);
                if (responseCallback) {
                  responseCallback(responsePayload);
                }
              },
              contactIdentification,
            );
          }
        } else {
          if (command === 'get-peers') {
            this.logger.debug(`get-peers is not a one-way command`);
            break;
          }
          this.emit('command', command, payload, noopResponseCallback, contactIdentification);
        }
        break;
    }
  }

  protected registerConnectionMappingToIdentificationInfo(connection: Connection, nodeContactInfo: INodeContactInfo): void {
    const nodeId = nodeContactInfo.nodeId;
    const existingConnection = this.nodeIdToConnectionMap.get(nodeId);
    if (existingConnection) {
      if (existingConnection === connection) {
        this.logger.debug(
          `Redundant identification message, connection is already established and mapping exists`,
          {
            nodeId: bin2Hex(nodeId),
          },
        );
        return;
      }
      const comparisonResult = compareUint8Array(this.ownNodeId, nodeId);
      this.logger.debug(
        `Mapping between connection and nodeId already exists`,
        {
          comparisonResult: comparisonResult,
          nodeId: bin2Hex(nodeId),
        },
      );
      switch (comparisonResult) {
        case -1:
          // Our nodeId is smaller, close already existing connection and proceed with replacing it with incoming
          this.destroyConnection(existingConnection);
          break;
        case 1:
          // Our nodeId is bigger, close incoming connection
          this.destroyConnection(connection);
          return;
        default:
          this.logger.error(`Connection to itself, this should never happen!`);
          throw new Error('Connecting to itself, this should never happen');
      }
    }

    this.nodeIdToConnectionMap.set(nodeId, connection);
    this.connectionToNodeIdMap.set(connection, nodeId);
    this.connectionToIdentificationMap.set(connection, nodeContactInfo);
    this.emit('peer-contact-info', nodeContactInfo);
    this.emit('peer-connected', nodeContactInfo);
  }

  /**
   * @param connection
   * @param command
   * @param requestResponseId `0` if no response is expected for request
   * @param payload
   */
  protected abstract sendMessageImplementation(
    connection: Connection,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void>;

  protected abstract destroyConnection(connection: Connection): void;

  protected abstract destroyImplementation(): Promise<void>;
}
