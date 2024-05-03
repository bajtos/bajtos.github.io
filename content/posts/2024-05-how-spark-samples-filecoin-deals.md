---
title: How SPARK Samples Filecoin Deals
date: 2024-05-02
originalUrl: https://blog.filstation.app/posts/how-spark-samples-filecoin-deals
---

[SPARK](https://filspark.com/) is checking whether public content stored on Filecoin can be
retrieved. To do so, we need to find out which Filecoin deals store data that’s expected to be
publicly available.

Filecoin was designed to store all kinds of data, but not all of it is meant to be publicly
retrievable. For these “private data” deals, it’s up to the client and the
[Storage Provider](https://docs.filecoin.io/basics/what-is-filecoin/storage-model) to agree on how
the client can access the stored data. Such an agreement happens off-chain.

On the other side of the spectrum is the community program called
[Filecoin Plus for Large Datasets](https://github.com/filecoin-project/filecoin-plus-large-datasets),
often abbreviated as FIL+ LDN. This program aims to incentivise the storage of public open datasets
on Filecoin, such as measurements produced by scientific experiments. There is a clear expectation
that content stored through FIL+ LDN _should be readily retrievable on the network and this can be
regularly verified_ (quoted from
[current scope in FIL+ LDN docs](https://github.com/filecoin-project/filecoin-plus-large-datasets?tab=readme-ov-file#current-scope)).

While FIL+ LDN does not cover all publicly retrievable data, it gives us a great start.

## Listing active FIL+ LDN deals

How can we find all FIL+ LDN deals to choose some of them to check? There are three steps in this
process:

1. Get a list of all storage deals
2. Filter active FIL+ deals
3. Keep FIL+ LDN deals only

<aside>
💡 You can find our implementation of this sampling algorithm on GitHub at [https://github.com/filecoin-station/fil-deal-ingester/](https://github.com/filecoin-station/fil-deal-ingester/).

</aside>

### Get a list of all storage deals

Storage deals are managed by the built-in
[Storage Market Actor](https://spec.filecoin.io/systems/filecoin_markets/onchain_storage_market/storage_market_actor/).
The RPC API method `Filecoin.StateMarketDeals` returns a list of all deals created since the
Filecoin Mainnet genesis. As you can imagine, it’s a lot of data - more than 20 GB in April 2024 -
and the size is steadily growing as more deals are created over time. As a result, most RPC API
providers have disabled access to this RPC method.

Fortunately, the awesome folks at [Glif.io](http://Glif.io) are creating hourly snapshots of
`StateMarketDeals` data, the latest snapshot is publicly available via their
[Amazon S3 link](https://marketdeals.s3.amazonaws.com/StateMarketDeals.json.zst).

In Spark, we use this snapshot as the data source of all storage deals.

<aside>
💡 *In the future, we will also need to include deals created via the Direct Data Onboarding mechanism recently introduced by [FIP-0076](https://fips.filecoin.io/FIPS/fip-0076.html).*

</aside>

### Filter active FIL+ deals

The next step in our deal-processing pipeline is discarding all deals that are not active or that
are not part of the FIL+ program. This is straightforward to implement using the following fields in
the `DealProposal` objects from the Market Deals state:

- `Verified` is a boolean field set to `true` if the deal is part of FIL+.
- `StartEpoch` and `EndEpoch` specify the time interval when the deal is active.

### Keep FIL+ LDN deals only

Lastly, we must filter the deals to keep only those made as part of the FIL+ LDN program.
Theoretically, all data needed to construct such a filter is available in the on-chain state. In
practice, it was easier to implement the following heuristics, which seem to work well.

First, we build a list of all clients that are verified for FIL+ LDN. We are using the following two
endpoints offered by the public [DataCapStats.io](http://DataCapStats.io) API:

1. `getVerifiers`
   ([docs](https://documenter.getpostman.com/view/131998/Tzsim4NU#2b19fe36-c2f5-49c8-a94e-8ab4d81718c0))
   to find all notaries (verifiers) that contain the string `ldn` in their description.
2. `getVerifiedClients`
   ([docs](https://documenter.getpostman.com/view/131998/Tzsim4NU#978a9c29-aacf-4a60-a0a6-a4bf8db241ff))
   to get all clients of a given notary.

```jsx
const notaries = await findNotaries();

const allLdnClients = [];
for (const notaryAddressId of notaries) {
  const clients = await getVerifiedClientsOfNotary(notaryAddressId);
  allLdnClients.push(...clients);
}
removeDuplicates(allLdnClients);

async function findNotaries(filter) {
  const res = await fetch('https://api.datacapstats.io/public/api/getVerifiers?limit=1000', {
    headers: { 'X-API-KEY': API_KEY },
  });
  const body = await res.json();
  return body.data.map((obj) => obj.addressId);
}

async function getVerifiedClientsOfNotary(notaryAddressId) {
  const res = await fetch(
    'https://api.datacapstats.io/public/api/getVerifiedClients/${notaryAddressId}?limit=1000',
    { headers: { 'X-API-KEY': API_KEY } },
  );
  const body = await res.json();
  return body.data.map((obj) => obj.addressId).filter((val) => !!val);
}
```

Second, to determine whether a deal is expected to be publicly retrievable, we check the `Client`
field of the `DealProposal`. This field contains the address of the client making the deal. If the
client is in the list of clients verified for FIL+ LDN, then we consider the deal to belong to the
FIL+ LDN program and to have the expectation of public retrievability.

## What’s next

This was the first post in the series explaining how SPARK checks retrievability. In next posts, we
will explore how to find content identifiers (CIDs) of data stored in the deal and find the network
address where to fetch the content from. Stay tuned!
