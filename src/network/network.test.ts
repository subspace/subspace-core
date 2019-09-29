import {randomBytes} from "crypto";
import {NODE_ID_LENGTH} from "../main/constants";
import {IPeerContactInfo} from "../main/interfaces";
import {allocatePort, bin2Hex, createLogger} from "../utils/utils";
import {INodeContactInfo, Network} from "./Network";

function serializeNodeContactInfo(nodeContactInfo: INodeContactInfo): string {
  return JSON.stringify({
    address: nodeContactInfo.address,
    nodeId: bin2Hex(nodeContactInfo.nodeId),
    nodeType: nodeContactInfo.nodeType,
    tcp4Port: nodeContactInfo.tcp4Port,
    udp4Port: nodeContactInfo.udp4Port,
    wsPort: nodeContactInfo.wsPort,
  });
}

const logger = createLogger('warn');

const peer1: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('1'.repeat(NODE_ID_LENGTH * 2), 'hex'),
  nodeType: 'full',
  tcp4Port: allocatePort(),
  udp4Port: allocatePort(),
  wsPort: allocatePort(),
};

const peer2: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('2'.repeat(NODE_ID_LENGTH * 2), 'hex'),
  nodeType: 'full',
  tcp4Port: allocatePort(),
  udp4Port: allocatePort(),
  wsPort: allocatePort(),
};

const peer3: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('3'.repeat(NODE_ID_LENGTH * 2), 'hex'),
  nodeType: 'full',
  tcp4Port: allocatePort(),
  udp4Port: allocatePort(),
  wsPort: allocatePort(),
};

const peer4: IPeerContactInfo = {
  nodeId: Buffer.from('4'.repeat(NODE_ID_LENGTH * 2), 'hex'),
  nodeType: 'client',
};

let networkClient1: Network;
let networkClient2: Network;
let networkClient3: Network;
let networkClient4: Network;

beforeEach(async () => {
  networkClient1 = await Network.init(peer1, [peer2, peer3], false, logger);
  networkClient2 = await Network.init(peer2, [peer1], false, logger);
  networkClient3 = await Network.init(peer3, [peer1], false, logger);
  networkClient4 = await Network.init(peer4, [peer1], true, logger);
});

describe('UDP', () => {
  test('Send one-way unreliable', () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.once('ping', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
        resolve();
      });
      networkClient1.sendRequestOneWayUnreliable(['full'], 'ping', randomPayload);
    });
  });

  test('Send unreliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.once('ping', async (payload, responseCallback, clientIdentification) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
          expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient1.sendRequestUnreliable(['full'], 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('TCP', () => {
  test('Send one-way reliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.once('peer-connected', () => {
        networkClient2.once('ping', (payload, _, clientIdentification) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
          expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
          resolve();
        });
        networkClient1.sendRequestOneWay(['full'], 'ping', randomPayload);
      });
    });
  });

  test('Send reliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.once('ping', async (payload, responseCallback, clientIdentification) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
          expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
          responseCallback(randomPayload);
          resolve();
        });
      }),
      new Promise<Uint8Array>((resolve) => {
        networkClient2.once('peer-connected', () => {
          resolve(networkClient1.sendRequest(['full'], 'ping', randomPayload));
        });
      }),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('WebSocket', () => {
  test('Send one-way reliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient1.once('ping', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer4.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer4.nodeType);
        resolve();
      });
      networkClient4.sendRequestOneWay(['full'], 'ping', randomPayload);
    });
  });

  test('Send reliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient1.once('ping', async (payload, responseCallback, clientIdentification) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          expect(clientIdentification.nodeId.join(', ')).toEqual(peer4.nodeId.join(', '));
          expect(clientIdentification.nodeType).toEqual(peer4.nodeType);
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient4.sendRequest(['full'], 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('Gossip', () => {
  test('Send gossip command', () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      let waitingFor = 3;
      networkClient1.once('tx-gossip', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer4.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer4.nodeType);
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient2.once('tx-gossip', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient3.once('tx-gossip', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient4.gossip('tx-gossip', randomPayload);
    });
  });
});

describe('Identification', () => {
  test('Send one-way reliable to initially unknown', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient4.once('ping', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
        resolve();
      });
      networkClient1.on('peer-connected', (nodeContactInfo) => {
        if (nodeContactInfo.nodeType === 'client') {
          networkClient1.sendRequestOneWay(['client'], 'ping', randomPayload);
        }
      });
    });
  });
});

describe('Peers', () => {
  test('Get contacts from network instance', () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const peer1Peers = networkClient1.getContacts().map(serializeNodeContactInfo);
        expect(peer1Peers).toContainEqual(serializeNodeContactInfo(peer2));
        expect(peer1Peers).toContainEqual(serializeNodeContactInfo(peer3));
        // WebSocket peer will take time to show up, hence setTimeout, but it will be here even though not in bootstrap
        // nodes list
        expect(peer1Peers).toContainEqual(serializeNodeContactInfo(peer4));

        // WebSocket peer should get to know about other peers from gateway too
        const peer4Peers = networkClient4.getContacts().map(serializeNodeContactInfo);
        expect(peer4Peers).toContainEqual(serializeNodeContactInfo(peer2));
        expect(peer4Peers).toContainEqual(serializeNodeContactInfo(peer3));
        // And establish some connections too
        expect(networkClient4.getNumberOfActiveConnections()).toBeGreaterThan(1);
        resolve();
      }, 100);
    });
  });

  test('Maintain contacts', async () => {
    return new Promise((resolve) => {
      setTimeout(async () => {
        const contactsMaintenanceInterval = 0.001;
        const peerServer: IPeerContactInfo = {
          address: 'localhost',
          nodeId: randomBytes(NODE_ID_LENGTH),
          nodeType: 'client',
          wsPort: allocatePort(),
        };
        const peerClient1: IPeerContactInfo = {
          nodeId: randomBytes(NODE_ID_LENGTH),
          nodeType: 'client',
        };
        const peerClient2: IPeerContactInfo = {
          nodeId: randomBytes(NODE_ID_LENGTH),
          nodeType: 'client',
        };
        const networkServer = await Network.init(peerServer, [], false, logger);
        const networkClient1 = await Network.init(
          peerClient1,
          [peerServer],
          true,
          logger,
          {contactsMaintenanceInterval},
        );
        networkServer.once('peer-connected', async () => {
          const networkClient2 = await Network.init(
            peerClient2,
            [peerServer],
            true,
            logger,
            {contactsMaintenanceInterval},
          );

          networkServer.once('peer-connected', async () => {
            setTimeout(async () => {
              expect(
                networkClient1.getContacts().map(serializeNodeContactInfo),
              ).toContainEqual(
                serializeNodeContactInfo(peerClient2),
              );
              await networkServer.destroy();
              await networkClient1.destroy();
              await networkClient2.destroy();
              resolve();
            }, contactsMaintenanceInterval * 10 * 1000);
          });
        });
      });
    });
  });

  test('Connection events', () => {
    return new Promise((resolve) => {
      setTimeout(async () => {
        const peerServer: IPeerContactInfo = {
          address: 'localhost',
          nodeId: randomBytes(NODE_ID_LENGTH),
          nodeType: 'client',
          wsPort: allocatePort(),
        };
        const peerClient: IPeerContactInfo = {
          nodeId: randomBytes(NODE_ID_LENGTH),
          nodeType: 'client',
        };
        let networkClient: Network;
        const networkServer = await Network.init(peerServer, [], false, logger);
        networkServer
          .once('peer-connected', (nodeContactInfo: INodeContactInfo) => {
            expect(serializeNodeContactInfo(nodeContactInfo)).toEqual(serializeNodeContactInfo(peerClient));
            networkClient.destroy();
          })
          .once('peer-disconnected', async (nodeContactInfo: INodeContactInfo) => {
            expect(serializeNodeContactInfo(nodeContactInfo)).toEqual(serializeNodeContactInfo(peerClient));
            await networkServer.destroy();
            resolve();
          });
        networkClient = await Network.init(peerClient, [peerServer], true, logger);
      });
    });
  });
});

afterEach(async () => {
  if (networkClient1) {
    await networkClient1.destroy();
  }
  if (networkClient2) {
    await networkClient2.destroy();
  }
  if (networkClient3) {
    await networkClient3.destroy();
  }
  if (networkClient4) {
    await networkClient4.destroy();
  }
});
