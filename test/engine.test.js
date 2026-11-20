import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCustomers, simulate, runExperiment, snapshot, quantile, toCSV, validateConfig } from '../public/engine.js';

const config = { duration: 60, arrivalRate: 3.8, serviceMean: 1, servers: 4, variability: 'very-variable', seed: 42 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const customer = (id, arrival, service, lane = 0) => ({ id, arrival, service, lane });

test('seeded arrivals and service times reproduce exactly', () => {
  assert.deepEqual(generateCustomers(config), generateCustomers(config));
  assert.notDeepEqual(generateCustomers(config), generateCustomers({ ...config, seed: 43 }));
});

test('hand-worked FCFS example', () => {
  const result = simulate([customer(0, 0, 3), customer(1, 1, 2), customer(2, 2, 1)], 1, 'shared', 4);
  assert.deepEqual(result.records.map(r => r.wait), [0, 2, 3]);
  near(result.stats.meanWait, 5 / 3);
  near(result.endTime, 6);
  near(result.stats.utilization, 1);
});

test('shared queue sends waiting work to the first free server', () => {
  const jobs = [customer(0, 0, 10), customer(1, 0, 1, 0.8), customer(2, 0.2, 1, 0)];
  const shared = simulate(jobs, 2, 'shared', 1);
  assert.equal(shared.records[2].start, 1);
  assert.equal(shared.records[2].server, 1);
  assert.equal(simulate(jobs, 2, 'random', 1).records[2].start, 10);
});

test('shortest-line routing observes counts, not future service times', () => {
  const jobs = [customer(0, 0, 10), customer(1, 0, 1, 0.8), customer(2, 0.2, 1, 0)];
  const result = simulate(jobs, 2, 'shortest', 1);
  assert.equal(result.records[2].server, 0); // tied lengths, lane=0; cannot know server 1 ends sooner
  assert.equal(result.records[2].wait, 9.8);
});

test('one server gives identical outcomes for every policy', () => {
  const experiment = runExperiment({ ...config, servers: 1 });
  for (const result of experiment.results.slice(1)) assert.deepEqual(result.records, experiment.results[0].records);
});

test('all policies use the same customers and finish every arrival', () => {
  const experiment = runExperiment(config);
  for (const result of experiment.results) {
    assert.equal(result.stats.count, experiment.customers.length);
    assert.deepEqual(result.records.map(r => [r.id, r.arrival, r.service]), experiment.customers.map(r => [r.id, r.arrival, r.service]));
    assert.equal(snapshot(result, result.endTime, config.servers).completed, result.stats.count);
  }
});

test('server capacity, FIFO and nonnegative waits across 30 seeds', () => {
  for (let seed = 0; seed < 30; seed++) {
    for (const result of runExperiment({ ...config, seed }).results) {
      const end = Array(config.servers).fill(0);
      for (const r of result.records) {
        assert.ok(r.start >= r.arrival && r.wait >= 0);
        assert.ok(r.start >= end[r.server]);
        end[r.server] = r.end;
      }
      assert.ok(result.stats.utilization >= 0 && result.stats.utilization <= 1 + 1e-12);
      assert.ok(result.timeline.every(point => point.queue >= 0));
      assert.equal(result.timeline.at(-1).queue, 0);
    }
  }
});

test('integrated queue length equals total wait; finite-run Little identity holds', () => {
  for (const result of runExperiment(config).results) {
    let area = 0;
    for (let i = 0; i < result.timeline.length - 1; i++) {
      area += result.timeline[i].queue * (result.timeline[i + 1].time - result.timeline[i].time);
    }
    near(area, result.records.reduce((sum, r) => sum + r.wait, 0));
    near(result.stats.averageInSystem, result.stats.throughput * result.stats.meanSojourn);
  }
});

test('no arrivals and simultaneous service starts are handled', () => {
  const empty = simulate([], 2, 'shared', 10);
  assert.equal(empty.stats.meanWait, 0);
  assert.equal(empty.endTime, 10);
  const result = simulate([customer(0, 0, 1), customer(1, 0, 1)], 2, 'shared', 2);
  assert.equal(result.stats.maxQueue, 0);
  assert.deepEqual(snapshot(result, 0, 2).active.map(r => r.id), [0, 1]);
});

test('snapshots include waiting, service and completed boundaries', () => {
  const result = simulate([customer(0, 0, 2), customer(1, 1, 1)], 1, 'shared', 3);
  assert.equal(snapshot(result, 1, 1).waiting.length, 1);
  assert.equal(snapshot(result, 2, 1).completed, 1);
  assert.equal(snapshot(result, 2, 1).active[0].id, 1);
});

test('CSV has one row per customer per policy', () => {
  const experiment = runExperiment(config);
  const lines = toCSV(experiment).trim().split('\n');
  assert.equal(lines.length, 1 + experiment.customers.length * 3);
  assert.equal(lines[0].split(',').length, 8);
});

test('percentile interpolation and empty sample', () => {
  assert.equal(quantile([], 0.95), 0);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  near(quantile([0, 10], 0.95), 9.5);
});

test('invalid configuration and malformed customer input fail clearly', () => {
  for (const change of [{ servers: 0 }, { servers: 1.5 }, { duration: NaN }, { arrivalRate: -1 }, { seed: -1 }, { variability: 'mystery' }]) {
    assert.throws(() => validateConfig({ ...config, ...change }), RangeError);
  }
  assert.throws(() => simulate([], 2, 'mystery'), RangeError);
  assert.throws(() => simulate([customer(0, 2, 1), customer(1, 1, 1)], 2, 'shared'), RangeError);
  assert.throws(() => simulate([customer(0, 0, 0)], 2, 'shared'), RangeError);
  assert.throws(() => simulate([customer(0, 0, 1, 1)], 2, 'random'), RangeError);
  assert.throws(() => simulate([customer(0, 0, 1), customer(0, 1, 1)], 2, 'shared'), RangeError);
});

test('high-load finite run drains instead of hiding unfinished customers', () => {
  const experiment = runExperiment({ ...config, duration: 10, arrivalRate: 10, servers: 1 });
  assert.ok(experiment.results[0].endTime > 10);
  assert.ok(experiment.results[0].records.every(r => Number.isFinite(r.end)));
});
