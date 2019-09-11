import * as websocket from "websocket";
import {AbstractProtocolManager} from "./AbstractProtocolManager";
import {ICommandsKeys} from "./commands";
import {composeMessage} from "./utils";

type WebSocketConnection = websocket.w3cwebsocket | websocket.connection;

export class WsManager extends AbstractProtocolManager<WebSocketConnection> {
  /**
   * @param messageSizeLimit In bytes
   * @param responseTimeout In seconds
   */
  public constructor(messageSizeLimit: number, responseTimeout: number) {
    super(messageSizeLimit, responseTimeout, true);
    this.setMaxListeners(Infinity);
  }

  public sendMessage(
    connection: WebSocketConnection,
    command: ICommandsKeys,
    requestResponseId: number,
    payload: Uint8Array,
  ): Promise<void> {
    const message = composeMessage(command, requestResponseId, payload);
    return this.sendRawMessage(connection, message);
  }

  public async sendRawMessage(connection: WebSocketConnection, message: Uint8Array): Promise<void> {
    if ('sendBytes' in connection) {
      connection.sendBytes(Buffer.from(message));
    } else {
      connection.send(message);
    }
  }

  protected destroyConnection(connection: WebSocketConnection): void {
    connection.close();
    // Because https://github.com/theturtle32/WebSocket-Node/issues/354
    this.connectionCloseHandler(connection);
  }

  // TODO: This method is public only for refactoring period and should be changed to `private` afterwards
  // tslint:disable-next-line
  public connectionCloseHandler(connection: WebSocketConnection): void {
    const nodeId = this.connectionToNodeIdMap.get(connection);
    if (nodeId) {
      this.connectionToNodeIdMap.delete(connection);
      this.nodeIdToConnectionMap.delete(nodeId);
    }
  }
}
