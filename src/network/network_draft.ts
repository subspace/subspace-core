// // tslint:disable: max-classes-per-file
// // tslint:disable: object-literal-sort-keys
// // tslint:disable: no-console
// // tslint:disable: member-ordering
//
// import { EventEmitter } from 'events';
// import * as net from 'net';
// import * as crypto from '../crypto/crypto';
// import { Tx } from '../ledger/tx';
// import { bin2Hex } from '../utils/utils';
//
// // priorities of work
//   // define a message wire protocol
//   // ping-pong over UDP
//   // gossip blocks and tx over UDP
//   // request blocks and tx over UDP
//   // sync ledger with RPC ovr TCP
//   // announce and find peers over k-rpc DHT
//   // listen for browser clients over WebSockets
//   // expose a JSON-RPC over HTTPS w/thrift
//
// // architecture
//   // Transports (UDP, TCP, Websocket) -- handles raw sockets, sends and receives binary data
//   // Network (direct, gossip, dht) -- serializes wire protocol, handles network topology logic
//   // RPC -- manages asynchronous logic, simplifying node implementation
//   // Node -- manages protocol logic
//   // Server -- exposes node over JSON-RPC (via thrift)
//
// // Notes
//   // Port over existing TCP and WS code (Network and NetworkManagers)
//   // keep it all in the same folder
//   // don't forget to write tests
//   // will need request and response manager to handle multiple concurrent requests/responses of the same type
//   // think about security against malicious peers
//   // plan is to torrent pieces over UDP and TCP using webtorrent code
//   // leave room for WebRTC and QUIC sockets
//
// // index.ts
// export const serve = async (): Promise<void> => {
//   const node = await Node.init();
//   const server = new ThriftServer();
//
//   server.on('get-tx', (txId: Uint8Array) => {
//     const tx: Tx = node.ledger.txs.get(txId);
//     server.respond(tx);
//   });
// };
//
// // test.network.ts
// export const test = async (): Promise<void> => {
//   const alphaNode = await Node.init();
//   const betaNode = await Node.init();
//
//   alphaNode.ping(betaNode.address);
//
//   // alpha -> beta
//   // beta -> alpha
//   // alpha emits 'pong'
//
//   // expect
//     // betaNode gets a ping request
//     // alphaNode gets a pong reply
//
//   alphaNode.on('pong', () => {
//     betaNode.ping(alphaNode.address);
//
//     // expect
//       // alphaNode gets a ping request
//       // betaNode gets a pong reply
//
//   });
// };
//
// // node.ts
// class Node extends EventEmitter {
//
//   // contains the 'protocol' logic
//
//   public static async init(): Promise<Node> {
//     const node = new Node();
//     await node.rpc.connect();
//     return node;
//   }
//
//   constructor(
//     public address = crypto.randomBytes(32),
//     public rpc = new RPC(address),
//   ) {
//     super();
//     this.rpc.on('ping', (sender: Uint8Array) => this.onPing(sender));
//     this.rpc.on('tx-request', (sender: Uint8Array, txId: Uint8Array) => this.onTxRequest(sender, txId));
//     this.rpc.on('tx', (sender: Uint8Array, tx: Tx) => this.onTx(sender, tx));
//   }
//
//   public async ping(receiverAddress: Uint8Array): Promise<void> {
//     // send the ping request
//     await this.rpc.ping(receiverAddress);
//
//     this.rpc.once('pong', (senderAddress: Uint8Array) => {
//       // handle the pong reply
//       this.emit('pong');
//       console.log(`Received a ping reply (pong) from ${bin2Hex(senderAddress).substring(0, 12)}`);
//     });
//   }
//
//   private async onPing(senderAddress: Uint8Array): Promise<void> {
//     // handle the ping request
//     this.emit('ping');
//     console.log(`Received a ping request from ${bin2Hex(senderAddress).substring(0, 12)}`);
//
//     // send the pong reply
//     await this.rpc.pong(senderAddress);
//   }
//
//   public async requestTx(txId: Uint8Array): Promise<Tx> {
//     return this.rpc.requestTx(txId);
//   }
//
//   private async onTxRequest(sender: Uint8Array, txId: Uint8Array): Promise<void> {
//     // logic to get tx from ledger txMap
//     await this.rpc.txReply(sender, tx);
//   }
//
//   private async onTx(sender: Uint8Array, tx: Tx): Promise<void> {
//     // validate tx and send to ledger
//     return;
//   }
//
//   public async requestPiece(pieceId: Uint8Array): Promise<Uint8Array> {
//     return this.rpc.getPiece(pieceId);
//   }
//
//   public async onPieceRequest(sender: Uint8Array, pieceId: Uint8Array): Promise<void> {
//     // logic to get piece from plot
//     await this.rpc.pieceReply(sender, piece);
//   }
//
// }
//
// // rpc.ts
// class RPC extends EventEmitter {
//
//   // contains the request/response workflow
//
//   constructor(
//     public address: Uint8Array,
//     public network = new Network(address),
//   ) {
//     super();
//
//     this.network.on('message', (type: string, senderAddress: Uint8Array, data: Uint8Array) => {
//       this.emit(type, senderAddress, data);
//     });
//
//   }
//
//   public async connect(): Promise<void> {
//     await this.network.connect();
//   }
//
//   public async ping(receiverAddress: Uint8Array): Promise<void> {
//     const message = {
//       type: 'ping',
//       data: null,
//     };
//     await this.network.send(receiverAddress, message);
//   }
//
//   public async pong(receiverAddress: Uint8Array): Promise<void> {
//     const message = {
//       type: 'pong',
//       data: null,
//     };
//     await this.network.send(receiverAddress, message);
//   }
//
//   public async requestTx(txId: Uint8Array): Promise<Tx> {
//     return new Promise(async (resolve) => {
//       // rpc get the closest node from network
//       const receiverAddress = this.network.getPeer();
//       const message = {
//         type: 'tx-request',
//         data: txId,
//       };
//       await this.network.send(receiverAddress, message);
//
//       this.once('tx-reply', (tx: Tx) => {
//         resolve(tx);
//       });
//     });
//   }
//
//   public async txReply(sender: Uint8Array, tx: Tx): Promise<void> {
//     const message = {
//       type: 'tx-reply',
//       data: tx,
//     };
//     await this.network.send(sender, message);
//   }
//
//   public async gossipTx(tx: Tx): Promise<void> {
//     const message = {
//       type: 'tx',
//       data: tx,
//     };
//     await this.network.gossip(message);
//   }
//
//   public async getPiece(pieceId: Uint8Array): Promise<Uint8Array> {
//     return new Promise( async (resolve) => {
//       const peers = await this.network.getClosestPeers(pieceId);
//       for (const peer of peers) {
//         const message = {
//           type: 'piece-request',
//           data: pieceId,
//         };
//         await this.network.send(peer, message);
//
//         this.once('piece-reply', (piece: Uint8Array) => {
//           resolve(piece);
//         });
//       }
//     });
//   }
//
//   public async pieceReply(sender: Uint8Array, piece: Uint8Array): Promise<void> {
//     const message = {
//       type: 'piece-reply',
//       data: piece,
//     };
//     await this.network.send(sender, message);
//   }
// }
//
// // network.ts
// class Network extends EventEmitter {
//
//   // deal with message type and data as binary here
//   // send, gossip, dht, torrent
//
//   private peers: Uint8Array[] = [];
//
//   constructor(
//     public address: Uint8Array,
//     public transport = new UDPAdapter(),
//     public dht = new DHT(),
//   ) {
//     super();
//
//     this.transport.on('message', (sender: Uint8Array, data: Uint8Array) => {
//       const { type, message } = this.deserialize(data);
//       this.emit('message', type, sender, message);
//     });
//   }
//
//   public async connect(): Promise<void> {
//     await this.transport.connect();
//   }
//
//   public getPeer(): Uint8Array {
//     return;
//   }
//
//   private serialize(message: object): Uint8Array {
//     // serialize message from object to binary here
//     return;
//   }
//
//   private deserialize(binaryMessage: Uint8Array): object {
//     // deserialize message here
//     return {type, sender, message};
//   }
//
//   public async send(receiverAddress: Uint8Array, message: object): Promise<void> {
//     // serialize message to binary here
//     const binaryMessage = this.serialize(message);
//     this.transport.send(receiverAddress, binaryMessage);
//   }
//
//   public async gossip(message: object): Promise<void> {
//     const binaryMessage = this.serialize(message);
//     for (const peer of this.peers) {
//       await this.send(peer, binaryMessage);
//     }
//   }
//
//   public async getClosestPeers(pieceId: Uint8Array): Promise<Uint8Array[]> {
//     return this.dht.getPeers(pieceId);
//   }
//
//   // get peer
//
// }
//
// // udpAdapter.ts
// class UDPAdapter extends EventEmitter {
//
//   constructor(
//     public UDPServer = new net.Server(),
//   ) {
//     super();
//     this.UDPServer.on('message', (sender, data) => this.emit('message', sender, data));
//   }
//
//   public async connect(): Promise<void> {
//     return;
//   }
//
//   public send(receiverAddress: Uint8Array, binaryMessage: Uint8Array): void {
//     return;
//   }
// }
//
// // planned RPC methods
//   // Gossip Methods
//     // gossipTx() => void
//     // gossipBlock() => void
//   // Record Methods
//     // getTx(txId) => Tx
//     // getBlock(blockId) => Block
//     // getProof(proofId) => Proof
//     // getContent(contentId) => Content
//     // getStateBlock(stateId) => StateBlock
//     // getStateData(stateId) => StateData
//     // getPiece(pieceId) => Piece
//   // DHT Methods
//     // announce(address) => void
//     // getPeers() => addresses[]
//     // getClosestPeers(target) => addressees[]
//   // Ledger Methods
//     // getPendingTxIds() => txId[]
//     // getPendingBlockIds() => blockId[]
//     // getBlockCount() => number
//     // getChainHeigh(chainIndex) => number
//     // getLevelHeight() => number
//     // getStateHeight() => number
//     // getLastLevelId() => levelId
//     // getLastStateId() => stateId
//     // getBalance(address) => number
//     // getProximityTarget() => number
//   // Farm Methods
//     // getSizeOfFarm() => number
//     // getNumberOfPlots() => number
//     // getPiece(pieceId) => Piece (from DHT)
//     // getSeeds(target) => Piece[] (from DHT)
