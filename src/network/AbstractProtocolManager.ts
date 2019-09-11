import {ArrayMap} from "array-map-set";
import {EventEmitter} from "events";
import {NODE_ID_LENGTH} from "../main/constants";
import {ICommandsKeys} from "./commands";
import {parseMessage} from "./utils";

function noopResponseCallback(): void {
  // Do nothing
}

export abstract class AbstractProtocolManager<Connection> extends EventEmitter {
  // Will 2**32 be enough?
  // private requestId: number = 0;
  // Will 2**32 be enough?
  private responseId: number = 0;
  // TODO: This property is public only for refactoring period and should be changed to `protected` afterwards
  // tslint:disable-next-line
  public readonly nodeIdToConnectionMap = ArrayMap<Uint8Array, Connection>();
  // TODO: This property is public only for refactoring period and should be changed to `protected` afterwards
  // tslint:disable-next-line
  public readonly connectionToNodeIdMap = new Map<Connection, Uint8Array>();
  /**
   * Mapping from requestId to callback
   */
  // TODO: This property is public only for refactoring period and should be changed to `private` afterwards
  // tslint:disable-next-line
  public readonly requestCallbacks = new Map<number, (payload: Uint8Array) => any>();
  /**
   * Mapping from responseId to callback
   */
  private readonly responseCallbacks = new Map<number, (payload: Uint8Array) => any>();

  /**
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   * @param connectionBased Whether there is a concept of persistent connection (like in TCP and unlike UDP)
   */
  protected constructor(
    private readonly messageSizeLimit: number,
    private readonly responseTimeout: number,
    private readonly connectionBased: boolean,
  ) {
    super();
    this.setMaxListeners(Infinity);
  }

  // Below EventEmitter-derived methods are mostly to make nice TypeScript interface
  // TODO: Achieve the same without re-implementing methods

  public on(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, sourceNodeId?: Uint8Array) => void,
  ): this;
  public on(
    event: 'command',
    listener: (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;
  public on(event: string, listener: (arg1: any, arg2?: any, arg3?: any) => void): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, sourceNodeId?: Uint8Array) => void,
  ): this;
  public once(
    event: 'command',
    listener: (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;
  public once(event: string, listener: (arg1: any, arg2?: any, arg3?: any) => void): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: 'gossip',
    listener: (gossipMessage: Uint8Array, sourceNodeId?: Uint8Array) => void,
  ): this;
  public off(
    event: 'command',
    listener: (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this;
  public off(event: string, listener: (arg1: any, arg2?: any, arg3?: any) => void): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: 'gossip',
    gossipMessage: Uint8Array,
    sourceNodeId?: Uint8Array,
  ): boolean;
  public emit(
    event: 'command',
    command: ICommandsKeys,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void,
  ): boolean;
  public emit(
    event: string,
    arg1: any,
    arg2?: any,
    arg3?: any,
  ): boolean {
    return EventEmitter.prototype.emit.call(this, event, arg1, arg2, arg3);
  }

  /**
   * @param connection
   * @param command
   * @param requestResponseId `0` if no response is expected for request
   * @param payload
   */
  public abstract sendMessage(
    connection: Connection,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void>;

  public abstract sendRawMessage(connection: Connection, message: Uint8Array): Promise<void>;

  // TODO: This method is public only for refactoring period and should be changed to `protected` afterwards
  public async handleIncomingMessage(connection: Connection, message: Buffer): Promise<void> {
    if (message.length > this.messageSizeLimit) {
      // TODO: Log too big message in debug mode
      return;
    }
    const [command, requestId, payload] = parseMessage(message);
    // TODO: Almost no validation!
    if (command === 'identification') {
      if (!this.connectionBased) {
        throw new Error('Identification is not supported by protocol');
      }
      if (payload.length !== NODE_ID_LENGTH) {
        // TODO: Log in debug mode that payload length is incorrect
        this.destroyConnection(connection);
      } else if (this.nodeIdToConnectionMap.has(payload)) {
        // TODO: Log in debug mode that node mapping is already present
        this.destroyConnection(connection);
      } else {
        const nodeId = payload.slice();
        this.nodeIdToConnectionMap.set(nodeId, connection);
        this.connectionToNodeIdMap.set(connection, nodeId);
      }
      return;
    }
    if (this.connectionBased && !this.connectionToNodeIdMap.has(connection)) {
      // TODO: Log in debug mode that non-identified node tried to send message
      return;
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
          this.connectionToNodeIdMap.get(connection) as Uint8Array,
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
              return this.sendMessage(connection, 'response', requestId, payload);
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
          );
        } else {
          this.emit('command', command, payload, noopResponseCallback);
        }
        break;
    }
  }

  protected abstract destroyConnection(connection: Connection): void;
}
