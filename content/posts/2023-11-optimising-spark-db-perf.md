---
title: Optimising performance of Spark's Postgres database
date: 2023-11-30
---

On November 13th, we publicly launched Filecoin Station, a desktop app enabling
everybody to participate in the Filecoin economy and earn FIL for contributing
their spare computing resources & network bandwidth. (You can download the app
here: https://www.filstation.app). The launch was a success, and our network
grew from ~50 to more than ~1500 nodes in a few days. As of today, we have 4000
nodes running. We quickly discovered that our database was having a hard time
keeping up with the increased load.

## TL;DR

- Setting up observability for Postgres performance requires a bit of work, but
  it gives you valuable insights into the performance of your database.

- Often, you can reduce database load by optimizing other parts of your system
  first, e.g., caching the HTTP responses. Adding more indices is not always the
  most impactful change.

- Using Postgres for time-series data gives you a fast start but does not scale
  well. Instead of querying the raw data for visualizations, consider
  periodically calculating aggregated statistics and storing them in a different
  table (or a time-series database).

## Metrics

While I had plenty of ideas of what could be optimized, I wanted to focus on the
most impactful changes and have data to boast about my impact. _If you can not
measure it, you can not improve it._

The first step was to improve our tooling and start observing the performance of
our Postgres database. Initially, I was thinking about the following metrics:

- queries per second
- query duration (p50, p90)

After a quick search on the internet, I realized there are more aspects I should
care about:

- fetch, insert, update, and delete throughput
- proportion of index scans over total scans
- CPU load
- memory use

Let's get to work!

We are hosting our backend services and the database on Fly.io and use Grafana
to visualize metrics reported by our systems. Fortunately, Fly.io is already
ingesting Postgres metrics
([docs](https://fly.io/docs/postgres/managing/monitoring/#metrics)) into a
managed Prometheus instance that we can query from our managed Grafana
dashboards ([docs](https://fly.io/docs/reference/metrics/)).

### Queries per second

Visualizing queries per second is easy. I just copied the query from the Fly.io
Metrics dashboard:

```promql
sum(irate(
  pg_stat_database_xact_commit{app="your-db-app"}[15s]
)) by (datname) + sum(irate(
  pg_stat_database_xact_rollback{app="your-db-app"}[15s]
)) by (datname)
```

### Query duration

Observing how long it takes to execute queries is surprisingly difficult. The
only relevant metric provided by Fly.io is `pg_stat_activity_max_tx_duration`. I
decided to stick with this one for the time being.

```promql
max(pg_stat_activity_max_tx_duration{app="your-db-app"}) by (datname)
```

### Query throughput

I adapted the queries from Fly.io's built-in dashboard to show only queries from
the Spark API application. For each metric I am interested in, I created a new
query in the Grafana visualization.

```promql
sum(irate(pg_stat_database_tup_returned{app="your-db-app", datname="your-db-name"}))
```

List of metrics:

- pg_stat_database_tup_fetched
- pg_stat_database_tup_inserted
- pg_stat_database_tup_updated
- pg_stat_database_tup_deleted

### Rows loaded vs. rows returned

Ideally, the number of rows loaded should be close to the number of rows
returned on the database. This indicates that the database is completing read
queries efficiently — it is not scanning through many more rows than it needs to
in order to satisfy read queries. A low ratio indicates that the data may not be
properly indexed.

```promql
sum(irate(
  pg_stat_database_tup_fetched{app="your-db-app", datname="your-db-name"}
  /
  pg_stat_database_tup_returned{app="your-db-app", datname="your-db-name"}
))
```

Postgres' terminology is a bit confusing; you can learn more in Datadog's
article about PostgreSQL monitoring
[here](https://www.datadoghq.com/blog/postgresql-monitoring/#read-query-throughput-and-performance).

### Index scans vs total scans

This needs `idx_scan` and `seq_scan` from `pg_stat_user_tables`, which is
unfortunately not provided by Fly.io.

I skipped this metric in the initial setup but later found a way to observe it.
I describe the solution below in
[Observing query performance](#observing-query-performance).

### CPU load & memory usage

These metrics are described in Fly.io's docs:

- [Instance Load and CPU](https://fly.io/docs/reference/metrics/#instance-load-and-cpu)
- [Instance Memory](https://fly.io/docs/reference/metrics/#instance-memory-fly_instance_memory_)

CPU load:

```promql
max(max_over_time(fly_instance_load_average{app="your-db-app",minutes="1"}[15s]))
```

Memory usage:

```promql
avg(
  fly_instance_memory_mem_total{app="your-db-app"}
  -
  fly_instance_memory_mem_available{app="your-db-app"}
)
```

## Initial observations

1. The ratio `tup_fetched` vs. `tup_returned` is extremely low (less than
   0.01%). We are sorely missing an index for a frequent query.

2. Max query duration has peaks that are gradually becoming higher and higher.
   This can be explained by sequential scans taking longer as the number of rows
   increases.

3. CPU load has spikes reaching 15; that's awfully high.

## Finding missing indices

How can we find which queries are missing an index to speed them up? Let's
enable the extension `pg_stat_statements`
([docs](https://www.postgresql.org/docs/current/pgstatstatements.html)).

This extension requires the DB server to load a shared library. Fortunately,
Fly.io makes this easy, as explained in the
[community discussion](https://community.fly.io/t/pg-stat-statements-extension-in-postgres/3788/9):

```sh
❯ fly postgres config update -a your-db --shared-preload-libraries pg_stat_statements
```

The next step is enabling the extension by running the following SQL command:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

While we manage database schema using migration scripts, I decided to execute
this command directly:

```
❯ fly pg connect -a your-db-app -d your-db-name
your-db-name=# CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION
```

Now we can find the top 10 slowest queries:

```sql
SELECT query, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Observing query performance

Checking `pg_stat_statements` manually is a good start, but can we ingest this
data into Grafana? It turns out there is an easy solution: InfluxDB's
[Telegraf](https://www.influxdata.com/time-series-platform/telegraf/) and its
plugin
[postgresql_extensible](https://github.com/influxdata/telegraf/tree/master/plugins/inputs/postgresql_extensible).

We are already running Telegraf to collect measurements about the on-chain
activity; all I need is to set up the plugin `postgresql_extensible`.

The first step is to attach our database to our Telegraf app:

```sh
❯ flyctl postgres attach --app you-telegraf-app your-db-app
```

IMPORTANT: This will configure a new secret `DATABASE_URL` containing the
Postgres connection string. This connection string specifies `telegraf` as the
database name. That's not what we want! We need to edit the connection string,
change `/telegraf` to `/you-db-name`, and then edit the secret via
`fly secret set`.

The next step is to add more inputs to the Telegraf configuration file:

```toml
[[inputs.postgresql_extensible]]
  address = "${DATABASE_URL}"
  prepared_statements = true

[[inputs.postgresql_extensible.query]]
  measurement="pg_stat_database"
  sqlquery="SELECT * FROM pg_stat_database WHERE datname = 'your-db-name'"
  tagvalue=""

[[inputs.postgresql_extensible.query]]
  measurement="pg_stat_user_tables"
  sqlquery="SELECT * FROM pg_stat_user_tables"
  tagvalue="relname"

[[inputs.postgresql_extensible.query]]
  measurement="pg_stat_statements_slowest_mean_exec_time"
  sqlquery="SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 1"
  tagvalue=""

[[inputs.postgresql_extensible.query]]
  measurement="pg_stat_statements_slowest_total_exec_time"
  sqlquery="SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 1"
  tagvalue=""
```

After deploying the changes to Fly.io via `fly deploy`, we can add new
visualizations to our Grafana dashboard.

This part is a bit tricky. I don't know how to work with the data points
recorded by `postgresql_extensible` query, so I created a visualization that
shows the last slowest query.

Flux DB query:

```
import "strings"

from(bucket: "station")
  |> range(start: v.timeRangeStart, stop:v.timeRangeStop)
  |> filter(fn: (r) =>
    r._measurement == "pg_stat_statements_slowest_mean_exec_time"
    and r._field == "mean_exec_time"
  )
```

Grafana transformation:

```
Config from query results
Config query: query
Apply to: Fields returned by query
Apply to options: Query: mean_exec_time

Field                       Use as        Select
Time                        Ignore        Last *
query {db="postgres",...    Display name  Last
```

We can also visualize the ratio of indexed vs. sequential scans now, using the
following query:

```
import "strings"

from(bucket: "station")
  |> range(start: v.timeRangeStart, stop:v.timeRangeStop)
  |> filter(fn: (r) =>
    r._measurement == "pg_stat_user_tables"
    and (r._field == "idx_scan" or r._field == "seq_scan" or r._field == "relname")
  )
  |> keep(columns: ["_field", "_value", "_time", "relname"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
```

## Fixing slow queries

This was the easiest part. I looked at the slowest queries reported in the table
`pg_stat_statements`, figured out which columns need to be indexed, and added
those indices.

## Caching at the REST API layer

While I was optimizing our database, my colleague enabled Cloudflare cache for
our REST API. That change immediately fixed most of the database performance
problems we had. Ouch! 🤦🏻‍♂️

There was a catch, though: the most frequently accessed API endpoint returns
data that changes once an hour. The caching configuration was a tradeoff:

- a short max-age avoids stale data but puts more pressure on our system
- a long max-age increases the chance that clients receive stale data

Here came the moment when I appreciated our decision to design SPARK to
eventually become fully decentralized with no single point of failure and to
leverage immutable data. The REST API endpoint in question was performing two
tasks:

1. Determine what's the current SPARK round. This data is stored in memory and
   does not require database access. We will run this logic client-side in the
   future, as the data is available in the smart-contract's on-chain state.

2. Return details about the SPARK round N. This requires database access, but
   round details are immutable. (We will eventually calculate round tasks on the
   client, too, but that's further away.)

We already have a different API endpoint for obtaining round details, which the
evaluation service uses to validate that clients performed tasks belonging to
the current round. What was remaining to do: rework the API endpoint for
obtaining current round details to redirect clients to the other API endpoint,
and change `Cache-Control` headers returned by both endpoints:

- "current round redirect" is cached for 1 second
- "round N details" is cached for one year

With this change in place, we fetch round details from the database only very
few times (once per round for each Cloudflare cache instance) and still serve
our clients accurate information about the current round.

Important: By default, Cloudflare enforces a minimal `max-age` value of 4 hours
for cache-able content. I had to turn off this behaviour in the caching
configuration by asking Cloudflare to honor `max-age` returned by the server.

## Grafana Dashboards

The changes I made in our backend significantly improved the performance:

- CPU load decreased from 15 to 0.4
- Max query duration went down from 140 ms to 0.1 ms

However, there were still big spikes whenever we opened SPARK's dashboard.

The thing is, we were treating our Postgres database as a source of time-series
data and running aggregation queries to build data for visualizations. Indexing
does not help here because the database has to read every row belonging to the
selected time interval. With hundreds of thousands of measurements recorded
every hour, there are a lot of rows to scan!

While it's tempting to have a granular view of live data, most of the time, we
are interested in a high-level overview spanning a larger timeframe. Instead of
computing the retrieval success rate at each minute, it's enough to see the
retrieval success rate for each SPARK round (around one hour now).

The last step on my database performance optimization journey was to rework our
backend to calculate aggregated metrics for each SPARK round and write it to our
InfluxDB instance we already use for other time-series data, and rework our
Grafana visualizations to source this aggregated data from InfluxDB instead of
Postgres.

This change has noticeably improved the loading time of our dashboards.

## Conclusions

- Setting up observability for Postgres performance requires a bit of work, but
  it gives you valuable insights into the performance of your database.

- Often, you can reduce database load by optimizing other parts of your system
  first, e.g., caching the HTTP responses. Adding more indices is not always the
  most impactful change.

- Using Postgres for time-series data gives you a fast start but does not scale
  well. Instead of querying the raw data for visualizations, consider
  periodically calculating aggregated statistics and storing them in a different
  table (or a time-series database).
