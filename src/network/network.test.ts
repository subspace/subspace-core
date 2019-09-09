import {randomBytes} from "crypto";
import {Network} from "./Network";

const nodeIdClient1 = new Uint8Array(32);
nodeIdClient1.set([1]);
const nodeIdClient2 = new Uint8Array(32);
nodeIdClient1.set([2]);
const udpPortClient1 = 10888;
const udpPortClient2 = 11888;
const tcpPortClient1 = 10889;
const tcpPortClient2 = 11889;

let networkClient1: Network;
let networkClient2: Network;

beforeEach(() => {
  networkClient1 = new Network(
    {
      address: 'localhost',
      nodeId: nodeIdClient2,
      port: udpPortClient2,
    },
    {
      address: 'localhost',
      nodeId: nodeIdClient2,
      port: tcpPortClient2,
    },
    {
      address: 'localhost',
      port: udpPortClient1,
    },
  );
  networkClient2 = new Network(
    {
      address: 'localhost',
      nodeId: nodeIdClient1,
      port: udpPortClient1,
    },
    {
      address: 'localhost',
      nodeId: nodeIdClient1,
      port: tcpPortClient1,
    },
    {
      address: 'localhost',
      port: udpPortClient2,
    },
  );
});

test('UDP: Send one-way unreliable', async () => {
  const randomPayload = randomBytes(32);
  return new Promise((resolve) => {
    networkClient2.on('ping', (payload) => {
      expect(payload.join(', ')).toEqual(randomPayload.join(', '));
      resolve();
    });
    networkClient1.sendOneWayRequestUnreliable(nodeIdClient2, 'ping', randomPayload);
  });
});

test('UDP: Send unreliable', async () => {
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

afterEach(async () => {
  await networkClient1.destroy();
  await networkClient2.destroy();
});
