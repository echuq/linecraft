// Minutes throughout. This module has no DOM or external dependencies.
export const POLICIES = ['shared', 'shortest', 'random'];

export function validateConfig(config) {
  for (const [key, lo, hi] of [
    ['duration', 1, 120], ['arrivalRate', 0.1, 30],
    ['serviceMean', 0.1, 30], ['servers', 1, 12],
  ]) {
    if (!Number.isFinite(config[key]) || config[key] < lo || config[key] > hi) {
      throw new RangeError(`${key} must be between ${lo} and ${hi}`);
    }
  }
  if (!Number.isInteger(config.servers)) throw new RangeError('servers must be an integer');
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
    throw new RangeError('seed must be an unsigned 32-bit integer');
  }
  if (!['steady', 'variable', 'very-variable'].includes(config.variability)) {
    throw new RangeError('Unknown service variability');
  }
}

export function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), value | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // Open interval (0, 1), so log() is always finite.
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 + 0.5 / 4294967296;
  };
}

export function generateCustomers(config) {
  validateConfig(config);
  const rng = randomGenerator(config.seed);
  const customers = [];
  let arrival = 0;
  for (let id = 0; ; id++) {
    arrival += -Math.log(rng()) / config.arrivalRate;
    if (arrival >= config.duration) break;
    let service = config.serviceMean;
    if (config.variability === 'variable') {
      service = 0;
      for (let k = 0; k < 4; k++) service += -Math.log(rng()) * config.serviceMean / 4;
    } else if (config.variability === 'very-variable') {
      service = -Math.log(rng()) * config.serviceMean;
    }
    customers.push({ id, arrival, service, lane: rng() });
    if (customers.length >= 100000) throw new RangeError('Simulation is too large');
  }
  return customers;
}

export function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export function simulate(customers, serverCount, policy, arrivalHorizon = 0) {
  if (!POLICIES.includes(policy)) throw new RangeError('Unknown routing policy');
  if (!Number.isInteger(serverCount) || serverCount < 1 || serverCount > 12) {
    throw new RangeError('serverCount must be an integer between 1 and 12');
  }
  if (!Number.isFinite(arrivalHorizon) || arrivalHorizon < 0) throw new RangeError('Invalid horizon');
  const free = Array(serverCount).fill(0);
  const completions = Array.from({ length: serverCount }, () => []);
  const heads = Array(serverCount).fill(0);
  const records = [];
  let previousArrival = -Infinity;
  const ids = new Set();
  for (const customer of customers) {
    const { id, arrival, service, lane } = customer;
    if (!Number.isFinite(arrival) || arrival < 0 || arrival < previousArrival ||
        !Number.isFinite(service) || service <= 0 || !Number.isFinite(lane) || lane < 0 || lane >= 1 || ids.has(id)) {
      throw new RangeError('Customers must have unique IDs, sorted nonnegative arrivals, positive service, and lane in [0,1)');
    }
    previousArrival = arrival;
    ids.add(id);
    for (let s = 0; s < serverCount; s++) {
      while (heads[s] < completions[s].length && completions[s][heads[s]] <= arrival) heads[s]++;
    }
    let server = 0;
    if (policy === 'shared') {
      // Next available server is exactly FCFS for one shared, work-conserving queue.
      for (let s = 1; s < serverCount; s++) if (free[s] < free[server]) server = s;
    } else if (policy === 'random') {
      server = Math.floor(lane * serverCount);
    } else {
      // Observe people, not hidden service durations. Count the person in service.
      const lengths = completions.map((list, s) => list.length - heads[s]);
      const minimum = Math.min(...lengths);
      const candidates = lengths.map((n, s) => n === minimum ? s : -1).filter(s => s >= 0);
      server = candidates[Math.floor(lane * candidates.length)];
    }
    const start = Math.max(arrival, free[server]);
    const end = start + service;
    free[server] = end;
    completions[server].push(end);
    records.push({ ...customer, server, start, end, wait: start - arrival });
  }
  const endTime = Math.max(arrivalHorizon, ...free);
  const count = records.length;
  const sum = (fn) => records.reduce((total, record) => total + fn(record), 0);
  const waitTotal = sum(r => r.wait);
  const sojournTotal = sum(r => r.end - r.arrival);
  const serviceTotal = sum(r => r.service);
  // Arrival +1, service-start -1 gives the number waiting (not being served).
  const changes = records.flatMap(r => [{ time: r.arrival, delta: 1 }, { time: r.start, delta: -1 }]);
  changes.sort((a, b) => a.time - b.time);
  const timeline = [{ time: 0, queue: 0 }];
  let queue = 0;
  for (let i = 0; i < changes.length;) {
    const time = changes[i].time;
    let delta = 0;
    while (i < changes.length && changes[i].time === time) delta += changes[i++].delta;
    queue += delta;
    timeline.push({ time, queue });
  }
  timeline.push({ time: endTime, queue: 0 });
  return {
    policy, records, timeline, endTime,
    stats: {
      count,
      meanWait: count ? waitTotal / count : 0,
      p95Wait: quantile(records.map(r => r.wait), 0.95),
      maxWait: records.reduce((maximum, r) => Math.max(maximum, r.wait), 0),
      meanSojourn: count ? sojournTotal / count : 0,
      averageQueue: endTime ? waitTotal / endTime : 0,
      averageInSystem: endTime ? sojournTotal / endTime : 0,
      throughput: endTime ? count / endTime : 0,
      utilization: endTime ? serviceTotal / (serverCount * endTime) : 0,
      maxQueue: timeline.reduce((maximum, point) => Math.max(maximum, point.queue), 0),
    },
  };
}

export function runExperiment(config) {
  const customers = generateCustomers(config);
  return {
    config: { ...config }, customers,
    results: POLICIES.map(policy => simulate(customers, config.servers, policy, config.duration)),
  };
}

export function snapshot(result, time, serverCount) {
  const waiting = [], active = Array(serverCount).fill(null);
  let completed = 0;
  for (const record of result.records) {
    if (record.end <= time) completed++;
    else if (record.start <= time) active[record.server] = record;
    else if (record.arrival <= time) waiting.push(record);
  }
  return { waiting, active, completed };
}

export function toCSV(experiment) {
  const header = 'policy,id,arrival_min,service_min,server,start_min,end_min,wait_min';
  return header + '\n' + experiment.results.flatMap(result => result.records.map(r =>
    [result.policy, r.id, r.arrival, r.service, r.server + 1, r.start, r.end, r.wait].join(',')
  )).join('\n') + '\n';
}
