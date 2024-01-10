---
title: How we reduced memory usage by 90%
date: 2023-12-14
---

## TL;DR

Four easy changes reduced the total memory usage of [Spark](https://filspark.com)'s Node.js backend
from 4+ GB to ~360 MB:

- [Convert plain data objects to class instances.](#plain-data-objects)
- [De-duplicate immutable string values.](#duplicate-string-values)
- [Carefully choose how you calculate percentiles.](#external-memory-and-hdr-histogram-js)
- [Represent timestamps as numbers.](#timestamps)

## Introduction

After I finished [optimizing our database usage](../2023-11-optimising-spark-db-perf), another
problem came to our attention: the spark-evaluate service was consuming too much memory. This
service periodically processes a large batch of records (measurements).

Here comes the issue: as the Station node network grows, so does the number of measurements
submitted each round. In early December 2023, we were evaluating more than 1.5 million measurements
every round. Each measurement had around 600 bytes; we had to process 900MB of raw data at once.

We implemented spark-evaluate to keep all data in memory because it was the fastest way to ship a
working version. As we watched the network grow, every now and then, we would receive an email from
Fly.io that spark-evaluate crashed on an "out of memory" error. In the current stage, cloud
resources are cheaper than engineering efforts, so we fixed these incidents by doubling the memory
size of the virtual machine running the service. When we reached the point of 8 GB of RAM not being
enough, we decided the situation was no longer sustainable, and the time came to do some engineering
work.

Fortunately, we found a small number of easy changes that significantly reduced our memory usage
without any major changes in the implementation, such as offloading the data from memory to the
filesystem.

## Plain data objects

_Spoiler: this change reduced our memory usage by 50%!_ 😳

My colleague [Julian Gruber](https://github.com/juliangruber) discovered the first low-hanging
fruit: apparently, plain data objects take more memory than class instances. Adding a step to map
objects parsed from JSON to instances of a newly introduced `Measurement` class reduced our memory
usage by 50%.

The original version parsed measurements from JSON and then stored these objects for future
evaluations.

```js
const measurements = /* fetch and parse JSON */
const validMeasurements = measurements.map(measurement => {
  try {
    return {
      ...measurement,
      // additional fields parsed from data
      }
  } catch (err) {
    logger.error('Invalid measurement:', err.message, measurement)
    return null
  }
})
```

The new version converts each plain data object into a class instance. The class constructor
performs preprocessing, e.g., parsing additional fields.

```js
const measurements = /* fetch and parse JSON */
const validMeasurements = measurements.map(measurement => {
  try {
    return new Measurement(measurement)
  } catch (err) {
    logger.error('Invalid measurement:', err.message, measurement)
    return null
  }
})
```

Take a look at the pull request
[filecoin-station/spark-evaluate#84](https://github.com/filecoin-station/spark-evaluate/pull/84) if
you are interested in more details.

## Duplicate string values

_Spoiler: this change reduced heap usage from 570 MB to 167 MB._

This first improvement sparked my interest. What other easy optimizations can we make?

Let's take a look at an example measurement:

```json
{
  "id": 280847321,
  "spark_version": "1.6.0",
  "zinnia_version": "0.15.0",
  "participant_address": "0x000000000000000000000000000000000000dEaD",
  "finished_at": "2023-12-11T08:31:00.157Z",
  "timeout": false,
  "start_at": "2023-12-11T08:30:29.947Z",
  "status_code": 502,
  "first_byte_at": null,
  "end_at": "2023-12-11T08:30:59.954Z",
  "byte_length": 0,
  "attestation": null,
  "inet_group": "uWJAEcUyzouo",
  "car_too_large": false,
  "cid": "QmU4P3dfgDHUJ8GUREND2p3hH6T7hsQiPL9NrHs5T86NAp",
  "provider_address": "/ip4/127.0.0.1/tcp/8080/http",
  "protocol": "http"
}
```

Setting aside timestamps, most of the string properties can contain only a small number of possible
values; each value is repeated many times in different measurements. For example, we pick 4000
different CIDs to test every round. With 100k measurements submitted per round, there are, on
average, 10,000 measurements for the same CID.

Here comes the question: how does V8 (the JavaScript runtime in Node.js) represent strings? If two
object properties hold the same string value, how many copies of the string's bytes are stored in
the memory? The answer seems to be two copies.

![Measurements and CID strings with duplicated bytes](/images/2024/measurement-string-bytes-duplicated.svg)

Aside: I guess this makes sense - most applications don't have that many duplicate string values.
The cost of maintaining a lookup table would outweigh the benefits of memory savings.

Using the knowledge about the specific usage patterns of our application, we can trade additional
CPU load for less memory usage and implement a lookup table ourselves. The idea is simple: whenever
we encounter a new string coming from the parsed JSON data, check if we have seen it before. If yes,
replace the new string value with a pointer to the same string we have seen before.

![Measurements and CID strings reusing the same bytes](/images/2024/measurement-string-bytes-reused.svg)

This solution has one fantastic property: we don't need to change any code reading the measurement
objects; only the ingestion part needs changing. But, there is also an essential requirement: we
must never mutate these string values.

Here is a code snippet illustrating the algorithm:

```js
const knownStrings = new Map();

function pointerize(str) {
  if (str === undefined || str === null) return str;
  const found = knownStrings.get(str);
  if (found !== undefined) return found;
  knownStrings.set(str, str);
  return str;
}

// usage in Measurement constructor
this.cid = pointerize(m.cid);
this.provider_address = pointerize(m.provider_address);
this.protocol = pointerize(m.protocol);
// etc.
```

This change reduced our memory usage from 70% - the `heapTotal` metric went down from 570 MB to 167
MB. You can find more details in the pull request
[filecoin-station/spark-evaluate#86](https://github.com/filecoin-station/spark-evaluate/pull/84).

## External memory and `hdr-histogram-js`

_Spoiler: this change reduced our total memory usage (`rss`) from 3,526 MB to 375 MB._

I stumbled across this opportunity by a lucky coincidence. After evaluating all measurements, we
calculate various statistics about the round and submit them to InfluxDB for visualization. For some
data, we are interested in values at different percentiles. For example, what's the
time-to-first-byte (TTFB) at the 5th, 50th, and 95th percentile? (What's TTFB for the fast, typical,
and slow retrieval?)

When I was implementing these calculations, I didn't want to implement percentiles myself and looked
for an existing npm module to use. The module
[hdr-histogram-js](https://www.npmjs.com/package/hdr-histogram-js) offers the features I needed; it
has more than two million weekly downloads and is also used by
[Matteo Collina](https://github.com/mcollina) in his tools like
[autocannon](https://www.npmjs.com/package/autocannon). I highly respect Matteo for his knowledge of
Node.js & V8 performance tuning. If `hdr-histogram-js` is good for him, then it surely should be
good for us, too. Right?

Well, our data set is different from what autocannon produces. I _think_ the major difference is
that we have a much wider range of possible values. For example, "CAR size in bytes" can be anywhere
between zero to hundreds of million.

Anyway, this is what I saw in our logs:

- For many rounds, the histogram module threw an error while adding more data points.
- Often, the values at percentiles were inaccurate. For example, "CAR size in bytes" at p5 and p10
  was zero.

Instead of debugging the library, I decided to calculate the histogram ourselves. If we can fit all
measurements in memory, we can surely keep in memory an array of all values for an individual
measurement field like "CAR size in bytes" or "TTFB," too.

Calculating values at a given percentile is easy when we have all data points in memory:

1. Sort the array by values.

   _Remember to provide a custom comparator function because JavaScript sorts lexicographically by
   default: the word **10** comes before the word **2**!_

2. Calculate the value at the percentile `p` as the array item at position
   `Math.ceil(p * count / 100)`.

This formula produces the so-called _discrete percentile_. As I quickly discovered during testing,
discrete percentiles are not very useful if you have a small number of data points. For example, if
you record values `[1, 50, 100]`, the discrete percentile 5% (p5) is the same as the median value
(p50): `50`.

Fortunately, there are also _continuous percentiles_ that use interpolation to get finer-grained
values. In my previous example, p5 is calculated as `5.9`.

Here is the final implementation we use:

```js
export const getValueAtPercentile = (values, p) => {
  // See https://www.calculatorsoup.com/calculators/statistics/percentile-calculator.php
  // 1. Arrange n number of data points in ascending order: x1, x2, x3, ... xn
  const n = values.length;

  // 2. Calculate the rank r for the percentile p you want to find: r = (p/100) * (n - 1) + 1
  const r = ((n - 1) * p) / 100 + 1;

  // 3. If r is an integer then the data value at location r, xr, is the percentile p: p = xr
  if (Number.isInteger(r)) {
    // Remember that we are indexing from 0, i.e. x1 is stored in values[0]
    return values[r - 1];
  }

  const ri = Math.floor(r);
  const rf = r - ri;

  // 4. If r is not an integer, p is interpolated using ri, the integer part of r,
  // and rf, the fractional part of r:
  // p = xri + rf * (xri+1 - xri)
  return values[ri - 1] + rf * (values[ri] - values[ri - 1]);
};
```

Replacing `hdr-histogram-js` with my in-house implementation reduced our total memory usage (`rss`)
from 3,526 MB to 375 MB — trading 3 GB of external memory used by `hdr-histogram-js` for a 90 MB
increase in heap usage. You can learn more in the following pull requests:
[filecoin-station/spark-evaluate#88](https://github.com/filecoin-station/spark-evaluate/pull/88) and
[filecoin-station/spark-evaluate#89](https://github.com/filecoin-station/spark-evaluate/pull/89).

Note: While revisiting this blog post, I performed another search on npmjs.com and found a package
that provides the same functionality:
[just-percentile](https://www.npmjs.com/package/just-percentile). I'll use it the next time I need
to calculate percentiles.

## Timestamps

Storing timestamps as `Date` instances is more expensive than storing them as the number of
milliseconds has elapsed since the Unix epoch.

In [filecoin-station/spark-evaluate#85](https://github.com/filecoin-station/spark-evaluate/pull/85),
Julian modified our code parsing timestamps from ISO-8601-formatted strings (e.g.
`2023-12-11T08:31:00.157Z`) to convert the parsed date object to the numeric representation.

```diff
   const value = new Date(str)
   if (Number.isNaN(value.getTime())) return undefined
-  return value
+  return value.getTime()
```

This improvement shaved off only 5% but was still worthwhile.

## Conclusions

These four relatively easy changes dramatically reduced the memory used by our spark-evaluate
service. It deferred the need to undertake the major rewrite from all-in-memory to
stream-from-filesystem design by several months, if not more.
