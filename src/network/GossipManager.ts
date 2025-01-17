import {ArraySet} from "array-map-set";
import {EventEmitter} from "events";
import {hash} from "../crypto/crypto";
import {bin2Hex, compareUint8Array, ILogger, xorUint8Array} from "../utils/utils";
import {COMMANDS, COMMANDS_INVERSE, GOSSIP_COMMANDS_SET, ICommandsKeysForSending} from "./constants";
import {INodeContactIdentification} from "./Network";
import {TcpManager} from "./TcpManager";
import {UdpManager} from "./UdpManager";
import {composeMessage, noopResponseCallback} from "./utils";
import {WsManager} from "./WsManager";

export class GossipManager extends EventEmitter {
  private readonly gossipCache = new Set<string>();
  private readonly maxMessageSizeLimit: number;
  private readonly logger: ILogger;

  constructor(
    private readonly ownNodeId: Uint8Array,
    private readonly browserNode: boolean,
    private readonly udpManager: UdpManager,
    private readonly tcpManager: TcpManager,
    private readonly wsManager: WsManager,
    private readonly gossipCacheTimeout: number,
    parentLogger: ILogger,
  ) {
    super();
    this.setMaxListeners(Infinity);

    this.logger = parentLogger.child({manager: 'gossip'});

    let maxMessageSizeLimit = 0;
    for (const protocolManager of [udpManager, tcpManager, wsManager]) {
      protocolManager.on('gossip', (gossipMessage: Uint8Array, contactIdentification: INodeContactIdentification): void => {
        this.handleIncomingGossip(gossipMessage, contactIdentification);
      });
      maxMessageSizeLimit = Math.max(maxMessageSizeLimit, protocolManager.getMessageSizeLimit());
    }

    this.maxMessageSizeLimit = maxMessageSizeLimit;
  }

  // Below EventEmitter-derived methods are mostly to make nice TypeScript interface
  // TODO: Achieve the same without re-implementing methods

  public on(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this {
    EventEmitter.prototype.on.call(this, event, listener);
    return this;
  }

  public once(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this {
    EventEmitter.prototype.once.call(this, event, listener);
    return this;
  }

  public off(
    event: 'command',
    listener: (
      command: ICommandsKeysForSending,
      payload: Uint8Array,
      responseCallback: (responsePayload: Uint8Array) => void,
      extra: INodeContactIdentification,
    ) => void,
  ): this {
    EventEmitter.prototype.off.call(this, event, listener);
    return this;
  }

  public emit(
    event: 'command',
    command: ICommandsKeysForSending,
    payload: Uint8Array,
    responseCallback: (responsePayload: Uint8Array) => void,
    extra: INodeContactIdentification,
  ): boolean {
    return EventEmitter.prototype.emit.call(this, event, command, payload, responseCallback, extra);
  }

  public gossip(command: ICommandsKeysForSending, payload: Uint8Array): Promise<void> {
    if (!GOSSIP_COMMANDS_SET.has(command)) {
      throw new Error(`Command ${command} is not supported for gossiping`);
    }
    const gossipMessage = new Uint8Array(1 + payload.length);
    gossipMessage.set([COMMANDS[command]]);
    gossipMessage.set(payload, 1);
    return this.gossipInternal(gossipMessage, this.ownNodeId);
  }

  private async gossipInternal(gossipMessage: Uint8Array, sourceNodeId: Uint8Array): Promise<void> {
    const message = composeMessage('gossip', 0, gossipMessage);
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
      ...this.udpManager.getKnownNodeIds(),
      ...this.tcpManager.getKnownNodeIds(),
      ...this.wsManager.getKnownNodeIds(),
    ]);

    if (sourceNodeId) {
      allNodesSet.delete(sourceNodeId);
    }
    const ownNodeId = this.ownNodeId;
    const nodesToGossipTo = Array.from(allNodesSet)
      .map((nodeId) => {
        // Convert into XOR distance
        return xorUint8Array(nodeId, ownNodeId);
      })
      .sort(compareUint8Array)
      .slice(
        0,
        Math.max(
          Math.log2(allNodesSet.size),
          10,
        ),
      )
      .map((xorDistance) => {
        // Convert back to nodeId
        return xorUint8Array(xorDistance, ownNodeId);
      });

    const fitsInUdp = message.length <= this.udpManager.getMessageSizeLimit();

    for (const nodeId of nodesToGossipTo) {
      const socket = this.tcpManager.nodeIdToActiveConnection(nodeId);
      if (socket) {
        this.tcpManager.sendRawMessage(socket, message)
          .catch((error: any) => {
            const errorText = (error.stack || error) as string;
            this.logger.debug(`Error on sending raw message over TCP: ${errorText}`);
          });
        continue;
      }
      const udpAddress = await this.udpManager.nodeIdToConnection(nodeId);
      if (!this.browserNode && fitsInUdp && udpAddress) {
        this.udpManager.sendRawMessage(
          udpAddress,
          message,
        )
          .catch((error) => {
            if (error) {
              const errorText = (error.stack || error) as string;
              this.logger.debug(`Error on sending raw message over UDP: ${errorText}`);
            }
          });
        continue;
      }
      const wsConnection = this.wsManager.nodeIdToActiveConnection(nodeId);
      if (wsConnection) {
        // Node likely doesn't have any other way to communicate besides WebSocket
        this.wsManager.sendRawMessage(wsConnection, message)
          .catch((error: any) => {
            const errorText = (error.stack || error) as string;
            this.logger.debug(`Error on sending raw message over WebSocket: ${errorText}`);
          });
      }

      this.tcpManager.nodeIdToConnection(nodeId)
        .then(async (socket) => {
          if (socket) {
            return this.tcpManager.sendRawMessage(socket, message);
          }

          const wsConnection = await this.wsManager.nodeIdToConnection(nodeId);
          if (wsConnection) {
            return this.wsManager.sendRawMessage(wsConnection, message);
          }

          throw new Error(`Node ${bin2Hex(nodeId)} unreachable`);
        })
        .catch((error: any) => {
          const errorText = (error.stack || error) as string;
          this.logger.debug(`Error on sending raw message over TCP or WebSocket: ${errorText}`);
        });
    }
  }

  private handleIncomingGossip(
    gossipMessage: Uint8Array,
    contactIdentification: INodeContactIdentification,
  ): void {
    const command = COMMANDS_INVERSE[gossipMessage[0]];
    if (!GOSSIP_COMMANDS_SET.has(command)) {
      this.logger.debug(`Received command ${command} that is not allowed for gossip from node ${bin2Hex(contactIdentification.nodeId)}`);
      return;
    }
    const messageHash = hash(gossipMessage).join(',');
    if (this.gossipCache.has(messageHash)) {
      // Prevent infinite recursive gossiping
      return;
    }
    this.gossipCache.add(messageHash);

    const payload = gossipMessage.subarray(1);
    this.emit(
      'command',
      command as ICommandsKeysForSending,
      payload,
      noopResponseCallback,
      contactIdentification,
    );
    this.gossipInternal(gossipMessage, contactIdentification.nodeId)
      .catch((error: any) => {
        const errorText = (error.stack || error) as string;
        this.logger.debug(`Error when sending internal gossip: ${errorText}`);
      });
  }
}
