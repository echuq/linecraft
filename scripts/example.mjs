import { mkdir, writeFile } from 'node:fs/promises';
import { runExperiment } from '../public/engine.js';

const config = { servers: 3, arrivalRate: 2.4, serviceMean: 1, variability: 'very-variable', duration: 30, seed: 42 };
const experiment = runExperiment(config);
const names = ['One shared line', 'Shortest line', 'Random line'];
const colors = ['#3464d9', '#148675', '#b45c83'];
const end = Math.max(...experiment.results.map(r => r.endTime));
const maxQueue = Math.max(4, ...experiment.results.map(r => r.stats.maxQueue));
const x = t => 65 + t / end * 970;
const y = q => 540 - q / maxQueue * 175;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="600" viewBox="0 0 1100 600"><rect width="1100" height="600" rx="20" fill="#f5f7fa"/><g font-family="Arial,sans-serif" fill="#192736"><path d="M50 38h22M50 46h16M50 54h10" fill="none" stroke="#dc6a32" stroke-width="3" stroke-linecap="round"/><text x="85" y="52" font-size="25" font-weight="700">linecraft</text><text x="50" y="113" font-size="38" font-weight="600">The same customers, three ways to line up.</text><text x="50" y="147" font-size="16" fill="#617082">Coffee shop · ${experiment.customers.length} customers · ${config.servers} windows · seed ${config.seed}</text>`;
experiment.results.forEach((result, i) => {
  const start = 50 + i * 340;
  svg += `<rect x="${start}" y="182" width="320" height="145" rx="10" fill="white" stroke="#dce2ea"/><rect x="${start + 15}" y="199" width="5" height="17" rx="2" fill="${colors[i]}"/><text x="${start + 30}" y="213" font-size="16">${names[i]}</text><text x="${start + 20}" y="270" font-size="40" font-weight="600">${result.stats.meanWait.toFixed(2)}<tspan font-size="17" fill="#617082"> min</tspan></text><text x="${start + 20}" y="301" font-size="14" fill="#617082">average wait · p95 ${result.stats.p95Wait.toFixed(2)} min</text>`;
});
for (let k = 0; k <= 4; k++) {
  const q = maxQueue * k / 4;
  svg += `<path d="M65 ${y(q)}H1035" stroke="#dce2ea"/><text x="55" y="${y(q) + 4}" font-size="12" text-anchor="end" fill="#617082">${q.toFixed(0)}</text>`;
}
experiment.results.slice().reverse().forEach(result => {
  let d = `M${x(0)} ${y(0)}`;
  for (const p of result.timeline) d += `H${x(p.time).toFixed(2)}V${y(p.queue).toFixed(2)}`;
  svg += `<path d="${d}" fill="none" stroke="${colors[['shared','shortest','random'].indexOf(result.policy)]}" stroke-width="2"/>`;
});
svg += `<path d="M${x(config.duration)} 360V540" stroke="#dc6a32" stroke-dasharray="4 5"/><text x="65" y="572" font-size="13" fill="#617082">Waiting queue over time · arrivals stop at 30 min · all queues drain by ${end.toFixed(1)} min</text></g></svg>`;
const dir = new URL('../docs/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('example.svg', dir), svg);
await writeFile(new URL('example.json', dir), JSON.stringify({ config, customers: experiment.customers.length, results: experiment.results.map(({ policy, stats, endTime }) => ({ policy, stats, endTime })) }, null, 2) + '\n');
console.log(`Generated example for ${experiment.customers.length} customers.`);
