# Networking design overview
This is a brief overview of major concepts, for implementation details take a look at source code in this directory.

### Protocols
Networking in Subspace has to support 3 protocols:
* UDP for small messages without requirement for guaranteed delivery
* TCP when bigger messages need to be sent or it is important to know that message was delivered
* WebSockets when browser client needs to communicate with the rest of the network somehow

Those protocols complement instead of replacing each other.
For instance, when small message needs to be sent without guaranteed delivery, but we only have WebSocket connection - it will be used instead of UDP.
Similarly, when gossip message is small, but there is no UDP address for the peer in question, TCP will be used to deliver a message.

### Implementation architecture
At the time of writing, there is a Network class and brings everything together with a simple interface and 4 managers that it uses to do its job:
* UdpManager - protocol manager for UDP connections (socket for incoming/outgoing requests)
* TcpManager - protocol manager for TCP connections (server and client)
* WsManager - protocol manager for WebSocket connections (server and client)
* GossipManager - uses 3 of above to process gossip messages

Protocol managers only care about their protocols.
They share common API defined by AbstractProtocolManager and handle things like starting a server, opening outgoing connection, waiting for incoming messages, parsing incoming message and dispatching corresponding events.
Protocol managers also keep addresses and open connections/sockets for respective protocols (such that one node ID can be registered in multiple node managers).

Gossip Manager is different, it uses protocol managers to receive gossip messages, processed them and dispatches corresponding events. It also does re-gossiping using protocol manages for actual messages delivery.

When Network class is instantiated, its configuration can be tailored to server or browser environment.
In browser environment UDP and TCP protocols will be replaced with WebSocket for outgoing connections and there will be no server running for either protocol for obvious reasons.

Connection-based protocols like TCP and WebSocket always start with identification message consisting node ID, no other messages are allowed before identification message.
UDP doesn't have this limitation, any identification must be provided inside of payload or in some other way.

WebRTC is not supported (yet?)

### Messages format
All messages for all protocols are sent in binary.

In general, single message consists of 3 parts going one after another like this:
* command - 1 byte unsigned integer
* requestId - 4 bytes unsigned integer in big-endian encoding, can be `0` if message doesn't foresee any response to be sent back
* payload - other bytes in a message

Since TCP protocol looks more like a stream of bytes, rather stream of distinct messages, we need a way to delimit messages.
This is done by packing messages in TCP into one more layer like this:
* message_length - 4 bytes unsigned integer in big-endian encoding
* message - following `message_length` bytes

There are 2 special message commands: `response` and `gossip`.

#### Response message
While in request messages `requestId` is, well, identifier for the request, in response messages `requestId` corresponds to `requestId` that was sent in request earlier.
This way sender can know to which request received response belongs.

#### Gossip message
Gossip message has a special payload format, since despite gossiping, it carries one fo the other commands inside.

For this reason `payload` for gossip command has following structure:
* command - 1 byte unsigned integer
* command_payload - other bytes in a payload are payload for `command`
