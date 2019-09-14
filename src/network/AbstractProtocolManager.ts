import {ArrayMap} from "array-map-set";
import {EventEmitter} from "events";
import {
  ADDRESS_PAYLOAD_LENGTH,
  EXTENDED_IDENTIFICATION_PAYLOAD_LENGTH,
  ICommandsKeys,
  ICommandsKeysForSending,
  IDENTIFICATION_PAYLOAD_LENGTH,
  INodeTypesKeys,
} from "./constants";
import {INodeContactIdentification, INodeContactInfo} from "./INetwork";
import {noopResponseCallback, parseAddressPayload, parseIdentificationPayload, parseMessage} from "./utils";

export abstract class AbstractProtocolManager<Connection, Address extends INodeContactInfo> extends EventEmitter {
  protected readonly nodeIdToConnectionMap = ArrayMap<Uint8Array, Connection>();
  protected readonly nodeIdToAddressMap = ArrayMap<Uint8Array, Address>();
  protected readonly nodeIdToIdentificationMap = ArrayMap<Uint8Array, INodeContactIdentification>();
  protected readonly connectionToNodeIdMap = new Map<Connection, Uint8Array>();
  /**
   * Mapping from requestId to callback
   */
  private readonly requestCallbacks = new Map<number, (payload: Uint8Array) => any>();
  /**
   * Mapping from responseId to callback
   */
  private readonly responseCallbacks = new Map<number, (payload: Uint8Array) => any>();
  // Will 2**32 be enough?
  private requestId: number = 0;
  // Will 2**32 be enough?
  private responseId: number = 0;

  /**
   * @param bootstrapNodes
   * @param browserNode
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionBased Whether there is a concept of persistent connection (like in TCP and unlike UDP)
   */
  protected constructor(
    bootstrapNodes: Address[],
    protected readonly browserNode: boolean,
    protected readonly messageSizeLimit: number,
    private readonly responseTimeout: number,
    private readonly connectionBased: boolean,
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
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, contactIdentification: INodeContactIdentification) => void,
  ): this;
  public on(
    event: 'peer-contact-info',
    listener: (nodeContactInfo: INodeContactInfo) => void,
  ): this;
  public on(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;
  public on(event: string, listener: (arg1: any, arg2?: any, arg3?: any, arg4?: any) => void): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, contactIdentification: INodeContactIdentification) => void,
  ): this;
  public once(
    event: 'peer-contact-info',
    listener: (nodeContactInfo: INodeContactInfo) => void,
  ): this;
  public once(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;
  public once(event: string, listener: (arg1: any, arg2?: any, arg3?: any, arg4?: any) => void): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, contactIdentification: INodeContactIdentification) => void,
  ): this;
  public off(
    event: 'peer-contact-info',
    listener: (nodeContactInfo: INodeContactInfo) => void,
  ): this;
  public off(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this;
  public off(event: string, listener: (arg1: any, arg2?: any, arg3?: any, arg4?: any) => void): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: 'gossip',
    gossipMessage: Uint8Array,
    contactIdentification: INodeContactIdentification,
  ): boolean;
  public emit(
    event: 'peer-contact-info',
    nodeContactInfo: INodeContactInfo,
  ): boolean;
  public emit(
    event: 'command',
    command: ICommandsKeysForSending,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void,
    extra: INodeContactIdentification,
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
    const connections: Connection[] = [];
    this.nodeIdToAddressMap.forEach((address: Address, nodeId: Uint8Array) => {
      if (!nodeTypesSet.has(address.nodeType)) {
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
   *
   * @return
   */
  public getNodeIdsOfNodeTypes(nodeTypes: INodeTypesKeys[]): Uint8Array[] {
    const nodeTypesSet = new Set(nodeTypes);
    const nodeIds: Uint8Array[] = [];
    this.nodeIdToAddressMap.forEach((address: Address, nodeId: Uint8Array) => {
      if (nodeTypesSet.has(address.nodeType)) {
        nodeIds.push(nodeId);
      }
    });

    return nodeIds;
  }

  /**
   * @param nodeId
   *
   * @return Active connection if already present, null otherwise
   */
  public nodeIdToActiveConnection(nodeId: Uint8Array): Connection | null {
    return this.nodeIdToConnectionMap.get(nodeId) || null;
  }

  public abstract nodeIdToConnection(nodeId: Uint8Array): Promise<Connection | null>;

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

  public abstract destroy(): Promise<void>;

  protected async handleIncomingMessage(
    connection: Connection,
    message: Uint8Array,
    contactIdentification?: INodeContactIdentification,
  ): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      // TODO: Log too big message in debug mode
      return;
    }
    const [command, requestId, payload] = parseMessage(message);
    // TODO: Almost no validation!
    if (command === 'identification') {
      if (!this.connectionBased) {
        this.destroyConnection(connection);
        throw new Error('Identification is not supported by protocol');
      }
      if (payload.length !== EXTENDED_IDENTIFICATION_PAYLOAD_LENGTH) {
        this.destroyConnection(connection);
        throw new Error(
          `Identification payload length is incorrect, expected ${EXTENDED_IDENTIFICATION_PAYLOAD_LENGTH} bytes but got ${payload.length} bytes`,
        );
      }
      // TODO: nodeType is not used
      const nodeContactIdentification = parseIdentificationPayload(payload.subarray(0, IDENTIFICATION_PAYLOAD_LENGTH));
      const nodeContactAddress = parseAddressPayload(
        payload.subarray(
          IDENTIFICATION_PAYLOAD_LENGTH,
          IDENTIFICATION_PAYLOAD_LENGTH + ADDRESS_PAYLOAD_LENGTH,
        ),
      );
      const nodeContactInfo = {...nodeContactIdentification, ...nodeContactAddress};
      if (this.nodeIdToConnectionMap.has(nodeContactIdentification.nodeId)) {
        // TODO: Log in debug mode that node mapping is already present
        this.destroyConnection(connection);
      } else {
        this.nodeIdToConnectionMap.set(nodeContactIdentification.nodeId, connection);
        this.connectionToNodeIdMap.set(connection, nodeContactIdentification.nodeId);
        this.nodeIdToIdentificationMap.set(nodeContactIdentification.nodeId, nodeContactIdentification);
        this.emit('peer-contact-info', nodeContactInfo);
      }
      return;
    }
    const nodeId = this.connectionToNodeIdMap.get(connection);
    if (this.connectionBased && !nodeId) {
      // TODO: Log in debug mode that non-identified node tried to send message
      return;
    }
    if (!contactIdentification) {
      if (!nodeId) {
        throw new Error('There is no contact identification, but also no nodeId, this should never happen');
      }
      contactIdentification = this.nodeIdToIdentificationMap.get(nodeId);
      if (!contactIdentification) {
        throw new Error('There is no contact identification, this should never happen');
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
        } else {
          this.emit('command', command, payload, noopResponseCallback, contactIdentification);
        }
        break;
    }
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
}
