/* 调试脚本：分析 AI 圈速过慢的原因 */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;
global.THREE = require(path.join(__dirname, '..', 'lib', 'three.min.js'));
['utils.js', 'config.js', 'trackdata.js', 'physics.js', 'ai.js', 'racecore.js'].forEach(f => {
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
});
const R = global.RACER;

for (let ti = 0; ti < 2; ti++) {
  const t = R.CONFIG.tracks[ti];
  const td = new R.TrackData(t.points, t.halfWidth);
  let ks = td.samples.map(s => s.kappa).sort((a, b) => a - b);
  const q = p => ks[Math.floor(p * ks.length)].toFixed(4);
  console.log(`\n=== ${t.name}  长度=${td.length.toFixed(0)}m  N=${td.N}  seg=${(td.length / td.N).toFixed(1)}m`);
  console.log(`  曲率分位数: p50=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} p99=${q(0.99)} max=${ks[ks.length - 1].toFixed(4)}`);

  // 单车全速跑 90 秒，统计
  const core = new R.RaceCore(td, { mode: 'time', playerSpec: R.CONFIG.cars[0], totalLaps: 99 });
  const bot = new R.AIDriver(td, 0, 1.0);
  for (let i = 0; i < 300; i++) core.step(1 / 60); // 跳过倒计时
  const car = core.cars[0];
  let n = 0, sumV = 0, sumTarget = 0, brakeN = 0, steerSat = 0, wallN = 0;
  for (let i = 0; i < 90 * 60; i++) {
    const inp = bot.compute(car.state, car.spec, R.Utils.wrap01(car.progressTotal), 1, car.nitro, 1 / 60);
    const kappa = td.maxCurvature(R.Utils.wrap01(car.progressTotal) + 0.004,
      R.Utils.wrap01(car.progressTotal) + Math.min(42, Math.max(12, 10 + Math.abs(car.state.vF) * 0.5)) * 1.6 / td.length);
    const vT = Math.min(car.spec.topSpeed, Math.sqrt(car.spec.aiLat / Math.max(kappa, 1e-4)));
    core.setPlayerInput(inp);
    const ev = core.step(1 / 60);
    if (ev.some(e => e.type === 'wall')) wallN++;
    n++; sumV += car.state.vF; sumTarget += vT;
    if (inp.brake > 0) brakeN++;
    if (Math.abs(inp.steer) >= 0.99) steerSat++;
  }
  console.log(`  平均车速=${(sumV / n).toFixed(1)}m/s  平均目标速=${(sumTarget / n).toFixed(1)}m/s`);
  console.log(`  刹车时间占比=${(100 * brakeN / n).toFixed(0)}%  转向饱和占比=${(100 * steerSat / n).toFixed(0)}%  撞墙帧=${wallN}`);
  console.log(`  90s 进度=${car.progressTotal.toFixed(2)} 圈`);
}
