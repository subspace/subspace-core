import {randomBytes} from "crypto";
import {Network} from "./Network";

const nodeIdClient1 = new Uint8Array(32);
nodeIdClient1.set([1]);
const udpPortClient1 = 11888;
const tcpPortClient1 = 11889;

const nodeIdClient2 = new Uint8Array(32);
nodeIdClient2.set([2]);
const udpPortClient2 = 12888;
const tcpPortClient2 = 12889;

const nodeIdClient3 = new Uint8Array(33);
nodeIdClient3.set([3]);
const udpPortClient3 = 13888;
const tcpPortClient3 = 13889;

let networkClient1: Network;
let networkClient2: Network;
let networkClient3: Network;

beforeEach(() => {
  networkClient1 = new Network(
    [
      {
        address: 'localhost',
        nodeId: nodeIdClient2,
        port: udpPortClient2,
      },
    ],
    [
      {
        address: 'localhost',
        nodeId: nodeIdClient2,
        port: tcpPortClient2,
      },
    ],
    nodeIdClient1,
    {
      address: 'localhost',
      port: udpPortClient1,
    },
    {
      address: 'localhost',
      port: tcpPortClient1,
    },
  );
  networkClient2 = new Network(
    [
      {
        address: 'localhost',
        nodeId: nodeIdClient1,
        port: udpPortClient1,
      },
    ],
    [
      {
        address: 'localhost',
        nodeId: nodeIdClient1,
        port: tcpPortClient1,
      },
    ],
    nodeIdClient2,
    {
      address: 'localhost',
      port: udpPortClient2,
    },
    {
      address: 'localhost',
      port: tcpPortClient2,
    },
  );
  networkClient3 = new Network(
    [
      {
        address: 'localhost',
        nodeId: nodeIdClient1,
        port: udpPortClient1,
      },
    ],
    [
      {
        address: 'localhost',
        nodeId: nodeIdClient1,
        port: tcpPortClient1,
      },
    ],
    nodeIdClient3,
    {
      address: 'localhost',
      port: udpPortClient3,
    },
    {
      address: 'localhost',
      port: tcpPortClient3,
    },
  );
});

describe('UDP', () => {
  test('Send one-way unreliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.on('ping', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        resolve();
      });
      networkClient1.sendOneWayRequestUnreliable(nodeIdClient2, 'ping', randomPayload);
    });
  });

  test('Send unreliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.on('ping', async (payload, responseCallback) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient1.sendRequestUnreliable(nodeIdClient2, 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('TCP', () => {
  test('Send one-way reliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.on('ping', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        resolve();
      });
      networkClient1.sendOneWayRequest(nodeIdClient2, 'ping', randomPayload);
    });
  });

  test('Send reliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.on('ping', async (payload, responseCallback) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient1.sendRequest(nodeIdClient2, 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('Gossip', () => {
  test('Send gossip command', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      let waitingFor = 2;
      networkClient2.on('tx-gossip', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient3.on('tx-gossip', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient1.gossip('tx-gossip', randomPayload);
    });
  });
});

afterEach(async () => {
  await networkClient1.destroy();
  await networkClient2.destroy();
  await networkClient3.destroy();
});
