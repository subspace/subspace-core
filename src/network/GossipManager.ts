import {ArraySet} from "array-map-set";
import {EventEmitter} from "events";
import * as net from "net";
import * as websocket from "websocket";
import {hash} from "../crypto/crypto";
import {bin2Hex} from "../utils/utils";
import {COMMANDS, COMMANDS_INVERSE, GOSSIP_COMMANDS, ICommandsKeys} from "./commands";
import {compareUint8Array, IAddress} from "./Network";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {composeMessage, noopResponseCallback} from "./utils";
import {WsManager} from "./WsManager";

export class GossipManager extends EventEmitter {
  private readonly gossipCache = new Set<string>();
  private readonly maxMessageSizeLimit: number;

  constructor(
    private readonly nodeIdToUdpAddressMap: Map<Uint8Array, IAddress>,
    private readonly nodeIdToTcpAddressMap: Map<Uint8Array, IAddress>,
    private readonly nodeIdToWsAddressMap: Map<Uint8Array, IAddress>,
    private readonly nodeIdToTcpSocket: (nodeId: Uint8Array) => Promise<net.Socket | null>,
    private readonly nodeIdToWsConnection: (nodeId: Uint8Array) => Promise<websocket.w3cwebsocket | websocket.connection | null>,
    // TODO: All of above arguments just for migration purpose and should be removed in the future
    private readonly browserNode: boolean,
    private readonly udpManager: UdpManager,
    private readonly tcpManager: TcpManager,
    private readonly wsManager: WsManager,
    private readonly gossipCacheTimeout: number,
  ) {
    super();
    this.setMaxListeners(Infinity);

    let maxMessageSizeLimit = 0;
    for (const protocolManager of [udpManager, tcpManager, wsManager]) {
      protocolManager.on('gossip', (gossipMessage: Uint8Array, sourceNodeId?: Uint8Array): void => {
        this.handleIncomingGossip(gossipMessage, sourceNodeId);
      });
      maxMessageSizeLimit = Math.max(maxMessageSizeLimit, protocolManager.getMessageSizeLimit());
    }

    this.maxMessageSizeLimit = maxMessageSizeLimit;
  }

  // Below EventEmitter-derived methods are mostly to make nice TypeScript interface
  // TODO: Achieve the same without re-implementing methods

  public on(
    event: 'command',
    listener: (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: 'command',
    listener: (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: 'command',
    listener: (command: ICommandsKeys, payload: Uint8Array, responseCallback: (responsePayload: Uint8Array) => void) => void,
  ): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: 'command',
    command: ICommandsKeys,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void = noopResponseCallback,
  ): boolean {
    return EventEmitter.prototype.emit.call(this, event, command, payload, responseCallback);
  }

  public gossip(command: ICommandsKeys, payload: Uint8Array): Promise<void> {
    if (!GOSSIP_COMMANDS.has(command)) {
      throw new Error(`Command ${command} is not supported for gossiping`);
    }
    const gossipMessage = new Uint8Array(1 + payload.length);
    gossipMessage.set([COMMANDS[command]]);
    gossipMessage.set(payload, 1);
    return this.gossipInternal(gossipMessage);
  }

  private async gossipInternal(gossipMessage: Uint8Array, sourceNodeId?: Uint8Array): Promise<void> {
    const message = composeMessage('gossip', 0, gossipMessage);
    // TODO: Store hash of the message and do not re-gossip it further
    if (message.length >= this.maxMessageSizeLimit) {
      throw new Error(
        `Too big message of ${message.length} bytes, can't gossip more than ${this.maxMessageSizeLimit} bytes`,
      );
    }
    const messageHash = hash(message).join(',');
    this.gossipCache.add(messageHash);
    const timeout = setTimeout(
      () => {
        this.gossipCache.delete(messageHash);
      },
      this.gossipCacheTimeout * 1000,
    );
    if (timeout.unref) {
      timeout.unref();
    }

    const allNodesSet = ArraySet([
      ...this.nodeIdToUdpAddressMap.keys(),
      ...this.nodeIdToTcpAddressMap.keys(),
      ...this.nodeIdToWsAddressMap.keys(),
      ...this.tcpManager.getKnownNodeIds(),
      ...this.wsManager.getKnownNodeIds(),
    ]);
    if (sourceNodeId) {
      allNodesSet.delete(sourceNodeId);
    }
    const nodesToGossipTo = Array.from(allNodesSet)
      .sort(compareUint8Array)
      .slice(
        0,
        Math.max(
          Math.log2(allNodesSet.size),
          10,
        ),
      );

    const fitsInUdp = message.length <= this.udpManager.getMessageSizeLimit();

    for (const nodeId of nodesToGossipTo) {
      const socket = this.tcpManager.nodeIdToConnectionMap.get(nodeId);
      if (socket) {
        this.tcpManager.sendRawMessage(socket, message)
          .catch((_) => {
            // TODO: Log in debug mode
          });
        continue;
      }
      const udpAddress = this.nodeIdToUdpAddressMap.get(nodeId);
      if (!this.browserNode && fitsInUdp && udpAddress) {
        this.udpManager.sendRawMessage(
          udpAddress,
          message,
        )
          .catch((error) => {
            if (error) {
              // TODO: Log in debug mode
            }
          });
        continue;
      }
      const wsConnection = this.wsManager.nodeIdToConnectionMap.get(nodeId);
      if (wsConnection) {
        // Node likely doesn't have any other way to communicate besides WebSocket
        this.wsManager.sendRawMessage(wsConnection, message)
          .catch((_) => {
            // TODO: Log in debug mode
          });
      }

      this.nodeIdToTcpSocket(nodeId)
        .then(async (socket) => {
          if (socket) {
            return this.tcpManager.sendRawMessage(socket, message);
          }

          const wsConnection = await this.nodeIdToWsConnection(nodeId);
          if (wsConnection) {
            return this.wsManager.sendRawMessage(wsConnection, message);
          }

          throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
        })
        .catch((_) => {
          // TODO: Log in debug mode
        });
    }
  }

  private handleIncomingGossip(gossipMessage: Uint8Array, sourceNodeId?: Uint8Array): void {
    const command = COMMANDS_INVERSE[gossipMessage[0]];
    if (!GOSSIP_COMMANDS.has(command)) {
      // TODO: Log in debug mode
      return;
    }
    const messageHash = hash(gossipMessage).join(',');
    if (this.gossipCache.has(messageHash)) {
      // Prevent infinite recursive gossiping
      return;
    }
    this.gossipCache.add(messageHash);

    const payload = gossipMessage.subarray(1);
    this.emit('command', command, payload);
    this.gossipInternal(gossipMessage, sourceNodeId)
      .catch((_) => {
        // TODO: Log in debug mode
      });
  }
}
