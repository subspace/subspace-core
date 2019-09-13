import {EventEmitter} from "events";
import {bin2Hex} from "../utils/utils";
import {ICommandsKeys, IDENTIFICATION_PAYLOAD_LENGTH, INodeTypesKeys, NODE_TYPES} from "./constants";
import {GossipManager} from "./GossipManager";
import {INetwork, INodeContactInfo} from "./INetwork";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {noopResponseCallback} from "./utils";
import {WsManager} from "./WsManager";

export interface IAddress {
  address: string;
  port: number;
  // TODO: Support IPv6
  protocolVersion?: '4';
}

const emptyPayload = new Uint8Array(0);

export class Network extends EventEmitter implements INetwork {
  public static async init(
    bootstrapNodes: INodeContactInfo[],
    nodeType: INodeTypesKeys,
    browserNode: boolean,
    ownNodeId: Uint8Array,
    ownUdpAddress?: IAddress,
    ownTcpAddress?: IAddress,
    ownWsAddress?: IAddress,
  ): Promise<Network> {
    const identificationPayload = new Uint8Array(IDENTIFICATION_PAYLOAD_LENGTH);
    identificationPayload.set([NODE_TYPES[nodeType]]);
    identificationPayload.set(ownNodeId, 1);

    const [udpManager, tcpManager, wsManager] = await Promise.all([
      UdpManager.init(
        identificationPayload,
        bootstrapNodes,
        browserNode,
        Network.UDP_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        ownUdpAddress,
      ),
      TcpManager.init(
        identificationPayload,
        bootstrapNodes,
        browserNode,
        Network.TCP_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_CONNECTION_EXPIRATION,
        ownTcpAddress,
      ),
      WsManager.init(
        identificationPayload,
        bootstrapNodes,
        browserNode,
        Network.WS_MESSAGE_SIZE_LIMIT,
        Network.DEFAULT_TIMEOUT,
        Network.DEFAULT_TIMEOUT,
        ownWsAddress,
      ),
    ]);

    const gossipManager = new GossipManager(
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
      manager.on(
        'command',
        this.emit.bind(this),
      );
    }
  }

  public async sendOneWayRequest(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    const wsConnection = this.wsManager.nodeIdToActiveConnection(nodeId);
    if (wsConnection) {
      // Node likely doesn't have any other way to communicate besides WebSocket
      return this.wsManager.sendMessageOneWay(wsConnection, command, payload);
    }
    const socket = await this.tcpManager.nodeIdToConnection(nodeId);
    if (socket) {
      return this.tcpManager.sendMessageOneWay(socket, command, payload);
    }

    {
      const wsConnection = await this.wsManager.nodeIdToConnection(nodeId);
      if (wsConnection) {
        return this.wsManager.sendMessageOneWay(wsConnection, command, payload);
      }

      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
    }
  }

  public async sendOneWayRequestUnreliable(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<void> {
    if (this.browserNode) {
      return this.sendOneWayRequest(nodeId, command, payload);
    }

    const address = await this.udpManager.nodeIdToConnection(nodeId);
    if (address) {
      return this.udpManager.sendMessageOneWay(address, command, payload);
    } else {
      // TODO: Fallback to reliable if no UDP route?
      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
    }
  }

  public async sendRequest(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    const wsConnection = this.wsManager.nodeIdToActiveConnection(nodeId);
    if (wsConnection) {
      // Node likely doesn't have any other way to communicate besides WebSocket
      return this.wsManager.sendMessage(wsConnection, command, payload);
    }
    const socket = await this.tcpManager.nodeIdToConnection(nodeId);
    if (socket) {
      return this.tcpManager.sendMessage(socket, command, payload);
    }

    {
      const wsConnection = await this.wsManager.nodeIdToConnection(nodeId);
      if (wsConnection) {
        return this.wsManager.sendMessage(wsConnection, command, payload);
      }

      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
    }
  }

  public async sendRequestUnreliable(
    nodeId: Uint8Array,
    command: ICommandsKeys,
    payload: Uint8Array = emptyPayload,
  ): Promise<Uint8Array> {
    if (this.browserNode) {
      return this.sendRequest(nodeId, command, payload);
    }
    const address = await this.udpManager.nodeIdToConnection(nodeId);
    if (address) {
      return this.udpManager.sendMessage(address, command, payload);
    } else {
      // TODO: Fallback to reliable if no UDP route?
      throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
    }
  }

  public async gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
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
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: ICommandsKeys,
    listener: (payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: ICommandsKeys,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void = noopResponseCallback,
  ): boolean {
    return EventEmitter.prototype.emit.call(this, event, payload, responseCallback);
  }
}
