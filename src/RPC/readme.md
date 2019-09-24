## Design

The Remote Procedure Call (RPC) module provides an abstraction interface between the `Network` and `Node` modules. While `Network` is concerned with abstract messages and binary data, `Node` is concerned with generic methods and objects. The `RPC` module manages this translation layer in a manner that allows the other modules to focus on what they do best, in the data format that makes the most sense. The goal is to reduce the amount of networking implementation logic that resides in `Node` to make it conceptually simpler to orchestrate the different facets of the protocol.

When called, `RPC` takes an object payload for a message (gossip, request, or response), serializes it to binary, and calls the appropriate `Network` method with the appropriate arguments. On receipt of a new binary message from `Network`, `RPC` will deserialize the payload back to an object, validate the payload, and return the payload to `Node` as either a promise or event.

Importantly, neither `Node` nor `RPC` need worry about which peer or what transport layer (socket) a message is sent to or received from. This logic is handled entirely at the `Network` level. However, `RPC` does track and expose the basic peer routing table info for visibility and debug purposes.

`RPC` follows the Dependency Injection (DI) pattern and cannot be instantiated without a valid `Network` and `BLSSignature` instance. It may be instantiated synchronously, after the `Network` argument has been asynchronously instantiated. A `Node` should only have one `RPC` module to handle all of its network requests. Calling `RPC.destroy()` will initiate a recursive graceful shutdown on the `Network` dependency and all of its active sockets.

Currently there are two primary classes of methods: gossip methods and RPC proper methods.

## Gossip Methods

When a node generates a new `Block` or `Tx` it will call the appropriate gossip method, which will serialize the record and pass to `Network` for dissemination amongst a subset of active peer connections.

When a new `Block` or `Tx` is received via gossip from `Network`, `RPC` will deserialize and validate (only the schema), before passing to `Node` through an `EventEmitter`.

`Node` may then further validate the record before deciding whether to apply, cache, or rebroadcast the message.

Ideally, all gossip will occur over UDP, as this provides a more robust P2P network with more connections that are lower overhead. However, this is not always feasible given the maximum size of a UDP packet and the inability of many private nodes (nodes behind a router who have a dynamic, or private IP address and/or port) to consistently receive UDP messages.

If a record cannot be sent over UDP, `Network` will find or open a socket over an available transport layer based on the node runtime environment (TCP for Node JS and WS for Browser).

## RPC Proper Method

Standard RPC methods follow the typical request/response pattern, whereby one node requests some information by id or type from another node, who attempts to process the request, returning either the data or not found (currently null response). The requestor then validates the schema of the response before passing up to `Node` to do with as it pleases.

`RPC` follows the `Network` promise response pattern, so that if or when a response is received, it will be returned to `RPC` method as a promise. This greatly simplifies the event handler pattern necessary to process asynchronous network requests.

On the other hand, the node receiving the request will listen for and handle an Event to process and validate the request, before passing to `Node`, along with the `responseCallback`. `Node` will attempt to answer the query and will respond directly through the `responseCallback`.

### Get Record Methods

Request a `Block`, `Tx `, `Proof`, `Content`, `State` or `Piece` record by its content addressed ID, on in some cases by its integer index. Primarily used for syncing the chain on startup and to request parents for blocks received out of order. Either the record or null wil be sent by the queried node. The requestor will then validate the record schema before returning the response to `Node`.

### Get Network Stats Methods

Request some info on the network status from one or more peers, such as the height of the ledger or the current work difficulty target. Typically a string argument is provided in the request and an object or Integer response is returned.

### Get Node Stats Methods

These are the only methods that require a `Node ID` argument and must match a valid node in the peer routing table. These allow the `Node` to query a neighbor for some specific stats such as the size of its farm or how many plots it has. Typically a string argument is provided in the request and an object or Integer response is returned.

## Notes on Validation, Error Handling, and Security.

Currently `RPC` will `throw()` and fail if an invalid gossip, request, or response payload is received. This is both intentional and temporary, as we are still testing the network under an assumption that all peers are trusted and follow the protocol. Once we begin to test the security in a more Byzantine environment, we will need to log these message as errors and create an eviction policy for peers that return invalid data, and maintaining records of whitelisted and blacklisted peers.

