import { runExperiment, snapshot, toCSV } from './engine.js';

const $ = id => document.getElementById(id);
const names = { shared: 'One shared line', shortest: 'Shortest line', random: 'Random line' };
const colors = { shared: '#3464d9', shortest: '#148675', random: '#b45c83' };
const presets = {
  coffee: { servers: 3, arrivalRate: 2.4, serviceMean: 1, variability: 'very-variable', duration: 30, seed: 42 },
  checkout: { servers: 4, arrivalRate: 1.6, serviceMean: 2, variability: 'variable', duration: 45, seed: 186 },
  rush: { servers: 3, arrivalRate: 3.8, serviceMean: 1, variability: 'very-variable', duration: 20, seed: 95 },
};
let experiment, playback = null, lastFrame = 0;
const form = $('settings');
const duration = n => n < 1 ? `${Math.round(n * 60)} sec` : `${n.toFixed(1)} min`;
const clock = n => `${Math.floor(n)}:${String(Math.floor(n * 60) % 60).padStart(2, '0')}`;

function readConfig() {
  return Object.fromEntries(Object.keys(presets.coffee).map(key => [key, key === 'variability' ? $(key).value : Number($(key).value)]));
}
function setConfig(config) {
  for (const [key, value] of Object.entries(config)) $(key).value = value;
  $('servers-value').value = config.servers;
}
function updateLoad() {
  const config = readConfig();
  const load = config.arrivalRate * config.serviceMean / config.servers;
  $('load-value').textContent = `${Math.round(load * 100)}%`;
  $('load-fill').style.width = `${Math.min(load * 100, 100)}%`;
  $('load-fill').style.background = load >= 1 ? '#dc6a32' : '#148675';
  $('load-note').textContent = load >= 1 ? 'Arrivals meet or exceed capacity. A finite run still finishes, but this is not a stable long-run queue.' : load > 0.85 ? 'Close to capacity. Small bursts can turn into long waits.' : 'Some breathing room, but queues can still form.';
}
function stopPlayback() {
  if (playback !== null) cancelAnimationFrame(playback);
  playback = null;
  $('play').textContent = 'Play';
  $('play').setAttribute('aria-label', 'Play simulation');
}
function run() {
  stopPlayback();
  try {
    experiment = runExperiment(readConfig());
    $('error').hidden = true;
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
    return;
  }
  const { config, customers, results } = experiment;
  const minimum = Math.min(...results.map(r => r.stats.meanWait));
  $('run-count').textContent = `${customers.length} customers · ${config.duration} min of arrivals`;
  $('summaries').innerHTML = results.map(({ policy, stats }) => {
    const value = stats.meanWait < 1 ? (stats.meanWait * 60).toFixed(0) : stats.meanWait.toFixed(1);
    const unit = stats.meanWait < 1 ? 'sec' : 'min';
    return `<article class="summary-card" style="--color:${colors[policy]}"><div class="summary-label">${names[policy]}${stats.meanWait === minimum && customers.length ? '<span class="best-label">LOWEST THIS RUN</span>' : ''}</div><div class="wait-value">${value}<small>${unit}</small></div><p class="wait-label">average wait</p><div class="stat-divider"></div><div class="stat-row"><span>95th percentile</span><strong>${duration(stats.p95Wait)}</strong></div><div class="stat-row"><span>Longest queue</span><strong>${stats.maxQueue} people</strong></div></article>`;
  }).join('');
  drawChart();
  const end = Math.max(...results.map(r => r.endTime));
  $('timeline').max = end;
  $('timeline').value = Math.min(config.duration * 0.6, end);
  $('replay-end').textContent = clock(end);
  $('run-details').textContent = `seed ${config.seed} / drains by ${clock(end)}`;
  const url = new URL(location.href);
  url.search = new URLSearchParams(config).toString();
  url.hash = '';
  $('permalink').href = url.href;
  renderReplay();
}

function drawChart() {
  const { config, results } = experiment;
  const W = 860, H = 210, left = 35, right = 12, top = 12, bottom = 32;
  const maxTime = Math.max(...results.map(r => r.endTime));
  const maxQueue = Math.max(4, ...results.map(r => r.stats.maxQueue));
  const x = t => left + t / maxTime * (W - left - right);
  const y = q => H - bottom - q / maxQueue * (H - top - bottom);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Waiting queue length over time. The orange dashed line marks when arrivals stop."><title>Queue length over time</title>`;
  for (let k = 0; k <= 4; k++) {
    const q = maxQueue * k / 4;
    svg += `<path class="gridline" d="M${left} ${y(q)}H${W - right}"/><text x="${left - 8}" y="${y(q) + 4}" text-anchor="end">${Number(q.toFixed(1))}</text>`;
  }
  for (let k = 0; k <= 4; k++) {
    const time = maxTime * k / 4;
    svg += `<text x="${x(time)}" y="${H - 10}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}">${time.toFixed(0)} min</text>`;
  }
  svg += `<path d="M${x(config.duration)} ${top}V${H - bottom}" stroke="#dc6a32" stroke-dasharray="3 4"/><text x="${x(config.duration) - 5}" y="${top + 9}" text-anchor="end" style="fill:#b35b30">arrivals stop</text>`;
  // Draw the most crowded line first so smaller queues remain legible.
  for (const result of [...results].reverse()) {
    let path = `M${x(0)} ${y(0)}`;
    for (const point of result.timeline) path += `H${x(point.time).toFixed(2)}V${y(point.queue).toFixed(2)}`;
    svg += `<path d="${path}" fill="none" stroke="${colors[result.policy]}" stroke-width="1.8" stroke-linejoin="round" opacity=".9"/>`;
  }
  svg += `<path id="chart-cursor" d="" stroke="#192736" stroke-dasharray="2 3" opacity=".5"/></svg>`;
  $('queue-chart').innerHTML = svg;
}

function people(count, max = 12) {
  return '<i class="person"></i>'.repeat(Math.min(count, max)) + (count > max ? `<span class="overflow">+${count - max}</span>` : '');
}
function windowMarkup(record, server, time) {
  const progress = record ? Math.max(0, Math.min(100, (time - record.start) / record.service * 100)) : 0;
  return `<div class="window${record ? ' busy' : ''}" aria-label="Window ${server + 1}: ${record ? 'busy' : 'idle'}">${server + 1}${record ? `<span class="progress" style="width:${progress}%"></span>` : ''}</div>`;
}
function renderReplay() {
  const time = Number($('timeline').value);
  $('replay-time').value = clock(time);
  $('replay').innerHTML = experiment.results.map(result => {
    const state = snapshot(result, time, experiment.config.servers);
    let body;
    if (result.policy === 'shared') {
      body = `<div class="shared-windows">${state.active.map((r, s) => windowMarkup(r, s, time)).join('')}</div><div class="shared-waiting" aria-hidden="true">${people(state.waiting.length, 24)}</div>`;
    } else {
      const counts = Array(experiment.config.servers).fill(0);
      state.waiting.forEach(record => counts[record.server]++);
      body = state.active.map((record, s) => `<div class="lane">${windowMarkup(record, s, time)}<div class="people" aria-hidden="true">${people(counts[s], 8)}</div></div>`).join('');
    }
    return `<div style="--color:${colors[result.policy]}"><h3 class="replay-title">${names[result.policy]}</h3>${body}<p class="replay-count">${state.waiting.length} waiting · ${state.completed} done</p></div>`;
  }).join('');
  const maxTime = Math.max(...experiment.results.map(r => r.endTime));
  const x = 35 + time / maxTime * (860 - 35 - 12);
  $('chart-cursor').setAttribute('d', `M${x} 12V178`);
}

form.addEventListener('submit', event => { event.preventDefault(); run(); });
form.addEventListener('input', () => {
  $('servers-value').value = $('servers').value;
  document.querySelectorAll('[data-preset]').forEach(button => button.classList.remove('selected'));
  updateLoad();
});
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  setConfig(presets[button.dataset.preset]);
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('selected', b === button));
  updateLoad(); run();
}));
$('new-seed').addEventListener('click', () => {
  $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0];
  run();
});
$('timeline').addEventListener('input', () => { stopPlayback(); renderReplay(); });
$('play').addEventListener('click', () => {
  if (playback !== null) { stopPlayback(); return; }
  if (Number($('timeline').value) >= Number($('timeline').max)) $('timeline').value = 0;
  $('play').textContent = 'Pause';
  $('play').setAttribute('aria-label', 'Pause simulation');
  lastFrame = performance.now();
  const frame = now => {
    const max = Number($('timeline').max);
    $('timeline').value = Math.min(max, Number($('timeline').value) + Math.min(now - lastFrame, 100) / 1000 * max / 25);
    lastFrame = now;
    renderReplay();
    if (Number($('timeline').value) >= max) stopPlayback();
    else playback = requestAnimationFrame(frame);
  };
  playback = requestAnimationFrame(frame);
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([toCSV(experiment)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `linecraft-${experiment.config.seed}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const config = { ...presets.coffee };
const query = new URLSearchParams(location.search);
for (const key of Object.keys(config)) {
  if (query.has(key)) config[key] = key === 'variability' ? query.get(key) : Number(query.get(key));
}
// Malformed links should not leave a broken UI or silently clamp the experiment.
try {
  runExperiment(config);
  setConfig(config);
} catch {
  setConfig(presets.coffee);
  $('error').textContent = 'This link contains invalid settings. Showing the coffee shop preset instead.';
  $('error').hidden = false;
}
const linkError = !$('error').hidden;
updateLoad(); run();
if (linkError) { $('error').textContent = 'This link contains invalid settings. Showing the coffee shop preset instead.'; $('error').hidden = false; }
