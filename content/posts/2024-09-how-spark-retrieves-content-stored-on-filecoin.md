---
title: How SPARK Retrieves Content from Filecoin
date: 2024-09-09
originalUrl: https://blog.filstation.app/posts/how-spark-retrieves-content-stored-on-filecoin
---

In the previous posts, we explained
[how SPARK samples Filecoin deals](/posts/2024-05-how-spark-samples-filecoin-deals/) and
[how SPARK discovers content stored in those deals](/posts/2024-07-how-spark-discovers-content-stored-in-fil-deals/).
In the final post of this series, we will explain how SPARK tests whether the content can be
retrieved.

We wanted SPARK to perform meaningful tests that mirror typical clients retrieving data. Imagine you
are a data scientist who wants to analyse a large dataset stored by CERN on Filecoin. You have the
CID of the dataset (a string starting with `bafy`) and want to retrieve the archive.

1. The first step is to ask the network which nodes (peers) can serve the content of the CID.
2. Once you have the network addresses of these nodes, you can send retrieval requests to fetch the
   content from them.
3. Finally, you should verify that the content you received matches the CID you requested. (Hash the
   bytes and check that the produced hash digest is the same as the hash digest in the CID.)

SPARK checker nodes perform these three steps, too, but with a small twist: it’s not enough to
verify that _somebody_ can serve the content; we want to verify that _the specific storage provider_
advertises retrievals and serves the content.

> **Note:** Spark does not verify that a specific storage provider is storing a hot copy themselves.
> Spark verifies that the specific storage provider advertises the content to IPNI and serves
> retrieval requests at the advertised endpoint. The advertisements can point retrieval clients to a
> hot copy shared by multiple storage providers, and this is fine by Spark.

Let’s recall that a retrieval testing task is defined as a pair of `(CID, minerID)`. The checker is
requested to verify that the given `CID` (the content identifier) can be retrieved from the storage
provider identified by the given `minerID`.

## Discovering retrieval providers

The first step is to discover nodes offering retrievals of the CID we are testing. In the algorithm
above, the client retrieving data does not know which storage providers are storing the data, and
that’s right. There are different approaches to discovering retrieval providers, e.g. distributed
hash table lookups used by IPFS. In the current Filecoin architecture, retrieval clients should
query a [Network Indexer](https://ipni.io/) service to find retrieval providers for the given CID
quickly & efficiently.

> **Note:** Filecoin nodes (Lotus, Venus or Forrest) don’t provide APIs for retrieving the stored
> content and advertising such retrievals to network indexers. Storage providers must run a side
> service to keep a “hot” (unsealed) copy of stored data and serve retrieval requests. When
> configured correctly, this service advertises its public address and the content it can serve
> to [IPNI](https://docs.cid.contact/) - the indexer for IPFS and Filecoin. IPNI uses these
> advertisements to build content lookup functionality mapping CIDs to retrieval providers.

Querying IPNI is simple - just make an HTTP call
to [`https://cid.contact/cid/{your-cid}`](https://cid.contact/cid/bafkreicl5473u3g5c2l34n5oh5trtpft56ep6mbqv57affzgkfppcitfl4) and
get back a list of providers serving content for that CID.

Example [cid.contact](http://cid.contact/) response:

```json
{
  "MultihashResults": [
    {
      "Multihash": "EiBL7z+6bN0Wl743rj9nGbyz74j/MDCvfgKXJlFe8SJlXw==",
      "ProviderResults": [
        {
          "ContextID": "AXESID+frcp8SRLj7X9b63XXudegemdCruT5QmfNs1QhwfXe",
          "Metadata": "kBKjaFBpZWNlQ0lE2CpYKAABgeIDkiAgZrwty2svqEY4aaWJPJ4W9ipyQRZFlrrZGUL8QhsuDAxsVmVyaWZpZWREZWFs9W1GYXN0UmV0cmlldmFs9Q==",
          "Provider": {
            "ID": "12D3KooWRPoH4YSs8irwK348KE6dDP9vuERv4jWxXagrHSZGVZSc",
            "Addrs": ["/ip4/106.240.230.123/tcp/50123"]
          }
        },
        {
          "ContextID": "AXESID+frcp8SRLj7X9b63XXudegemdCruT5QmfNs1QhwfXe",
          "Metadata": "gBI=",
          "Provider": {
            "ID": "12D3KooWQsKtAJ8JMoCakR583ndecZHod6A9B364bdbVCH1t1Ugk",
            "Addrs": ["/ip4/106.240.230.123/tcp/8888"]
          }
        }
      ]
    }
  ]
}
```

As you can see, the response contains a list of `ProviderResults` objects describing different
providers offering retrieval of content for the queried CID. The following two fields specify where
& how to retrieve the data:

1. `Addrs` is a list of network addresses in
   the [multiaddr format](https://github.com/multiformats/multiaddr) where you can reach the
   provider.
2. `Metadata` contains base64-encoded binary metadata beginning with a `uvarint` identifying the
   protocol and followed by protocol-specific metadata. The list of supported protocols and their
   codes is in
   the [IPNI documentation.](https://github.com/ipni/specs/blob/90648bca4749ef912b2d18f221514bc26b5bef0a/IPNI.md#metadata)

In the example response above, the provider results describe retrieval over Graphsync and Bitswap
offered at the same IPv4 address `106.240.230.123`.

## Linking IPNI retrieval providers to Filecoin storage providers

Many (if not most) CIDs can be retrieved from multiple providers. Clients are typically storing each
dataset with multiple SPs for redundancy. Services like [web3.storage](http://web3.storage/) use
Filecoin as a backup layer; they implement their own service for fast retrieval and advertise such
service to IPNI. This is great if you only want to get the data from anybody willing to serve it.
However, Spark tests whether a particular storage provider - the miner that accepted the deal we are
checking - provides access to stored content. To do so, we need to link IPNI ProviderResults entries
to the storage provider we are testing.

Establishing this link is easy! Each IPNI provider result has an `ID` field that contains the
provider’s peer ID (public key). This peer ID is the same value as the `PeerID` field in the
on-chain miner info returned by the RPC
method `Filecoin.StateMinerInfo` (see [Lotus API Docs)](https://lotus.filecoin.io/reference/lotus/state/#stateminerinfo).

You can retrieve miner info either from your own Filecoin node or by calling one of the public RPC
API providers. SPARK uses [Glif](https://api.node.glif.io/).

## Downloading the data

Now that we have the address where the storage provider accepts retrieval requests, we can retrieve
the content!

Initially, SPs supported only the Graphsync protocol for retrievals. Later, support for Bitswap was
added to improve compatibility with the IPFS ecosystem. However, very few SPs enabled Bitswap
retrievals, and the performance was much worse than Graphsync’s. Nowadays, the ecosystem is moving
towards [IPFS Trustless Gateway protocol](https://specs.ipfs.tech/http-gateways/trustless-gateway/),
which is based on HTTP.

At the moment, SPARK supports both Graphsync and IPFS Trustless Gateway protocols (for simplicity,
we call the latter simply “HTTP protocol”). In the near future, we plan to discontinue support for
the Graphsync protocol and keep testing only HTTP-based retrievals.

Additionally, when SPARK tests a retrieval, it requests only one IPLD block instead of the entire
content. When we were retrieving full content, the SPARK network was putting too much load storage
providers. It is not our goal to perform stress testing of storage provider infrastructure,
therefore we changed the protocol to perform root-block retrievals only.

Obviously, testing the retrievability of the root block does not guarantee the retrievability of the
entire content. One of the incremental improvements on our roadmap is to implement a random sampling
of payload blocks so that providers must be able to serve the entire content to pass Spark’s checks.

### Retrieving via HTTP

The beauty of the IPFS Trustless Gateway Protocol is that clients can stay very simple, all they
need is to send a single HTTP request, process the
[content-addressed archive](https://ipld.io/specs/transport/car/) (CARv1) returned by the server and
verify that the content block(s) match the requested CID.

In SPARK, we use [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) for HTTP
communication, [@ipld/car](https://www.npmjs.com/package/@ipld/car) to process the CAR data, and
[@web3-storage/car-block-validator](https://www.npmjs.com/package/@web3-storage/car-block-validator)
to check that the block payload matches its CID.

### Retrieving via Graphsync

The Graphsync protocol is complex and there isn’t any actively maintained JavaScript implementation.
In SPARK, we decided to use [Lassie](https://github.com/filecoin-project/lassie/) (via
[rusty-lassie](https://github.com/filecoin-station/rusty-lassie)) to handle the Graphsync
intricacies for us. Among other features, Lassie provides an IPFS Trustless Gateway server that
proxies retrieval requests to storage providers over Bitswap, Grapsync or HTTP. It also performs
content verification.

So far, we have had a great experience using Lassie. The most notable downside is the lack of
details when the retrieval or content verification fails. Lassie responds with generic
`502 Bad Gateway Error` and the error details are logged to console, which SPARK cannot read from.

> **Note:** Once Lassie starts streaming back the response body containing the payload, there is no
> standard HTTP/1.1 way how to abort the process and indicate what error happened. To workaround
> this limitation, Lassie uses chunk transfer encoding for the response body and then sends an
> invalid chunk when it encounters an error. When this happens, clients receive a network-level
> error that is difficult to link to a retrieval/verification error unless you are aware of this
> Lassie’s quirk.

## Summary

SPARK’s retrieval test of `(CID, minerID)` performs the following steps:

1. Call Filecoin RPC API method `Filecoin.StateMinerInfo` to map `minerID` to `PeerID`.
2. Call [`https://cid.contact/cid/{CID}`](https://cid.contact/cid/{CID}) to obtain _all_ retrieval
   providers.
3. Filter the response to find the provider identified by `PeerID` found in step 1 and obtain the
   address where this provider serves retrievals.
4. Retrieve the root block of the content identified by `CID` from that address using Graphsync or
   IPFS Trustless Gateway protocol.
5. Verify that the received block matches the `CID`.
