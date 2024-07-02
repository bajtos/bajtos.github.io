---
title: How Spark Discovers Content Stored in FIL+ Deals
date: 2024-07-02
originalUrl: https://blog.filstation.app/posts/how-spark-discovers-content-stored-in-fil-deals
---

In the previous post, we explained
[how SPARK samples Filecoin deals](/posts/2024-05-how-spark-samples-filecoin-deals) to find deals
storing data that’s expected to be publicly available. In the second post of the series, we’ll look
at how Spark discovers the CIDs (content identifiers) of the data stored in Filecoin deals.

## Piece vs Payload

To understand how Filecoin data retrieval works, it’s essential to understand the Filecoin data
onboarding process and the difference between Piece CID and Payload CID.

- The payload is the data you want to store, such as a video of
  [a space probe landing on a comet](https://bafybeihphudgtepwkcrowxla7tuenux6soa5wwdm3l6hmdsvf2r2eiv7mm.ipfs.w3s.link).
- Filecoin Piece is defined in
  [Filecoin Spec](https://spec.filecoin.io/systems/filecoin_files/piece/) as the main *unit of
  negotiation* for data that users store on the Filecoin network. The Piece data structure is
  designed to prove the storage of arbitrary structured or binary data.
- Data submitted to the Filecoin network undergoes several transformations before it reaches the
  format in which the Storage Provider stores it.

For most users, it’s sufficient to understand that Piece CID is calculated from the stored payload
using an algorithm different from that used by IPFS/IPLD. Therefore, Piece CID is different from
Payload CID.

- Payload CIDs usually start with `bafy`. For example,
  `bafybeif52xbl5qwshdj3sj3kx3jdt7dq5mzwv6ytdretkj7tnu3nm2euvy`.
- Piece CIDs usually start with `baga`. For example,
  `baga6ea4seaqpg2hxv5os6bygcipqks537txiaojypb6ilzsu5qmp7bw2dptwcei`.

## Finding Payload CID

In the previous post, we left after the deal ingested filtered StorageMarket deals to keep only
active FIL+ LDN deals. To test whether the stored data can be retrieved, we need to find the Payload
CID for each deal.

Filecoin deals are all about pieces, and so the `DealProposal` object contains a `PieceCID` field.
Unfortunately, it’s not possible to infer payload CID from `PieceCID` (unless you download the
entire Piece data). However, there is a convention honoured by the current data-onboarding tooling
requiring that FIL+ LDN deals should provide the (root) CID of the payload in `DealProposal`'s field
`Label`.

As the second step, Spark’s deal ingester examines the `Label` field of each FIL+ LDN deal found and
keeps only the deals where the `Label` looks like a valid payload CID, i.e. if the value is a string
starting with `bafy`, `bafk` or `Qm` prefix.

So far, this convention has been working surprisingly well for us.

## What’s next

This was the second post in the series explaining how SPARK checks retrievability. In the next
posts, we will explore how to find the network address of the server serving the content and how
Spark performs the actual retrieval process. Stay tuned!
