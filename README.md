# Linecraft

The same customers, three ways to line up.

**[Open the playground](https://echuq.github.io/linecraft/)** · [Tests](https://github.com/echuq/linecraft/actions/workflows/test.yml)

Linecraft is a small browser playground for the queue you didn't choose. Compare
one shared line with separate windows, change how unpredictable service is, and
replay what happened. No framework, packages, account, or external data.

![A seeded example showing waiting times for three queueing policies](docs/example.svg)

## Try it locally

With Node.js 22 or newer:

```sh
git clone https://github.com/echuq/linecraft.git
cd linecraft
node scripts/serve.mjs
```

Open **http://127.0.0.1:4173**. No installation or build step. The server binds only
to loopback and serves an explicit list of public files.

Prefer a single file? Run `node scripts/standalone.mjs`, then open
`dist/linecraft.html` directly. This bundles the exact same engine, interface and
styles into an offline HTML file, with no external requests.

## Things to try

- Start with **Coffee shop**, then switch service variation to **None**.
- Open **Lunch rush** to see what happens when arrivals exceed capacity.
- Set **one window**: all three setups should give exactly the same result.
- Drag the replay scrubber, or play through the run in about 25 seconds.
- Use **Link to this run** to preserve the parameters and random seed.
- Export every customer's arrival, service, window, start, finish, and wait as CSV.

The chart shows people **waiting**, excluding those being served. The summary
reports average waiting time, an interpolated 95th percentile, and the largest
total waiting queue. These are simulated results, not real-world measurements.

## What is being compared?

| Setup | Routing rule |
| --- | --- |
| One shared line | FCFS; the next person goes to the first available window |
| Shortest line | Choose the fewest people (including the person in service); random tie-break; no switching |
| Random line | Uniformly choose a window on arrival; no switching |

Customers arrive according to a homogeneous Poisson process. Service times are
deterministic, Erlang(shape 4), or exponential, all with the configured mean.
Arrivals and service times are generated **once** and reused for all policies.
The shortest-line policy sees the number of people, not their future service times.

Arrivals stop at the selected horizon. All queues then drain, so slow customers
aren't quietly dropped from the reported waits. The chart and replay can extend
past closing. `arrivalRate * serviceMean / servers` is **expected offered load**,
not measured utilization. At or above 100%, this finite experiment is not an
estimate of stable long-run behavior.

No breaks, abandonment, walking time, priority classes, or cross-queue switching
are modelled. A single seed is not a confidence interval or proof that one policy
always wins. Floating-point results may differ at the last few digits across
JavaScript engines. Parameter changes can produce a different customer stream.

## Tests

```sh
node --test
node --check public/app.js
```

Tests cover a hand-worked FCFS example, routing without knowledge of future service
times, equal inputs across policies, one-window equivalence, server capacity and
FIFO across 30 seeds, replay boundaries, CSV output, invalid inputs, and overload.
They also check that the area under the waiting-queue curve equals total wait,
and verify the finite-run Little identity for the full empty-to-empty run.

Regenerate the illustrative figure and its data:

```sh
node scripts/example.mjs
```

The illustration is rendered from simulator output; it is not a browser screenshot.

## Files

```text
public/engine.js       deterministic simulation, metrics, replay snapshots, CSV
public/app.js          controls, SVG chart, replay and permalink handling
public/index.html     interface and model notes
public/style.css      responsive layout
scripts/serve.mjs      dependency-free local server
scripts/example.mjs    regenerate README figure and JSON data
test/engine.test.js    Node's built-in test runner
```

`public/` is also a buildless static app: serve its files from any static host.
No server API or secrets are needed. Opening `public/index.html` directly with
`file://` is not supported because it imports JavaScript modules; use the
standalone build instead.

## License

MIT. An initial, deliberately small implementation, not a production capacity planner.
