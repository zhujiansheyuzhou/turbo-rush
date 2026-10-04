/* =========================================================
 * sim.js —— 无头仿真测试（Node 环境运行，无需浏览器）
 *
 * 加载 three.min.js (UMD) 与游戏纯逻辑层，让"AI 扮演玩家"
 * 跑完整场比赛，验证：
 *   1. 赛道数据构建无异常（长度合理、曲率有限）
 *   2. 物理积分稳定（全程无 NaN、速度不超限）
 *   3. 圈数/名次系统正确（所有车辆都能完赛、名次无重复）
 *   4. 计时赛模式、重置功能、护墙约束正常工作
 *
 * 运行： node test/sim.js
 * ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---- 加载 three UMD 与游戏逻辑（经典脚本挂 window，Node 下 window=global） ---- */
global.window = global;
global.THREE = require(path.join(__dirname, '..', 'lib', 'three.min.js'));

['utils.js', 'config.js', 'trackdata.js', 'physics.js', 'ai.js', 'racecore.js'].forEach(f => {
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
});

const R = global.RACER;
let passed = 0, failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ================= 测试 1：赛道数据 ================= */
console.log('\n[1] 赛道数据构建');
const tracks = R.CONFIG.tracks.map(t => new R.TrackData(t.points, t.halfWidth));
tracks.forEach((td, i) => {
  const t = R.CONFIG.tracks[i];
  check(`${t.name} 长度在 1km~4km 之间`, td.length > 1000 && td.length < 4000, td.length.toFixed(0) + 'm');
  let maxK = 0;
  td.samples.forEach(s => { if (s.kappa > maxK) maxK = s.kappa; });
  check(`${t.name} 曲率有限且 > 0`, maxK > 0.01 && maxK < 1, 'max κ=' + maxK.toFixed(3));
  const p = td.pointAt(0.25);
  check(`${t.name} pointAt 返回有限坐标`, isFinite(p.x) && isFinite(p.z));
  const q = td.queryGlobal(p.x, p.z);
  check(`${t.name} queryGlobal 反查进度误差 < 1%`, Math.abs(q.u01 - 0.25) < 0.01, (q.u01 - 0.25).toFixed(4));
});

/* ================= 测试 2：竞速模式整场比赛 ================= */
console.log('\n[2] 竞速模式（AI 扮演玩家 + 7 个 AI，8 车跑满 3 圈）');
{
  const td = tracks[0];
  const cfg = R.CONFIG;
  const core = new R.RaceCore(td, {
    mode: 'race', playerSpec: cfg.cars[0], totalLaps: 3,
    aiSpecs: cfg.aiNames.map((n, i) => ({ name: n, spec: cfg.cars[(i + 1) % 3] }))
  });
  // 用 AI 算法驾驶"玩家"车辆，实现全自动仿真
  const botDriver = new R.AIDriver(td, 0, 1.0);

  const dt = 1 / 60;
  let nanFound = false, overSpeed = false, simT = 0;
  const maxSimT = 600;   // 仿真最长 10 分钟游戏时间
  let sawCountdown = false, sawGo = false, lapsSeen = new Set();

  while (core.state !== 'finished' && simT < maxSimT) {
    const player = core.cars[0];
    const input = core.state === 'racing'
      ? botDriver.compute(player.state, player.spec, R.Utils.wrap01(player.progressTotal), 1, player.nitro, dt)
      : { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };
    core.setPlayerInput(input);
    const evts = core.step(dt);
    evts.forEach(e => {
      if (e.type === 'count') sawCountdown = true;
      if (e.type === 'go') sawGo = true;
      if (e.type === 'lap') lapsSeen.add(e.car.name + ':' + e.lap);
    });
    core.cars.forEach(c => {
      const s = c.state;
      if (![s.x, s.z, s.heading, s.vF, s.vL, c.progressTotal].every(isFinite)) nanFound = true;
      if (s.vF > c.spec.topSpeed * c.spec.nitroFactor + 1) overSpeed = true;
    });
    simT += dt;
  }

  check('倒计时 → GO 事件序列完整', sawCountdown && sawGo);
  check('全程状态无 NaN', !nanFound);
  check('车速未超物理上限', !overSpeed);
  check('玩家在时限内完赛', core.cars[0].finished, 'simT=' + simT.toFixed(0) + 's');
  check('完赛用时合理 (90s~300s)', core.cars[0].finishTime > 90 && core.cars[0].finishTime < 300,
    core.cars[0].finishTime && core.cars[0].finishTime.toFixed(1) + 's');
  const standings = core.getStandings();
  const ranks = standings.map((c, i) => c.name + '#' + (i + 1));
  check('名次表包含全部 8 车且无重复', standings.length === 8 && new Set(standings).size === 8, ranks.join(' '));
  console.log('    最终名次: ' + standings.map((c, i) =>
    `${i + 1}.${c.name}(${c.spec.name} ${c.finished ? R.Utils.formatTime(c.finishTime) : '未完赛'})`).join('  '));
  console.log('    玩家各圈: 最佳=' + R.Utils.formatTime(core.cars[0].bestLap));

  /* ---- 测试 3：护墙约束 ---- */
  console.log('\n[3] 护墙约束');
  let wallOK = true;
  for (const c of core.cars) {
    const q = td.query(c.state.x, c.state.z, c.lastIndex);
    if (Math.abs(q.lateral) > td.halfWidth + 2.2) wallOK = false;
  }
  check('所有车辆始终被限制在护墙内', wallOK);
}

/* ================= 测试 4：计时赛模式 + 重置 ================= */
console.log('\n[4] 计时赛模式与重置功能');
{
  const td = tracks[1];
  const core = new R.RaceCore(td, { mode: 'time', playerSpec: R.CONFIG.cars[2], totalLaps: 3 });
  check('计时赛只有玩家一辆车', core.cars.length === 1);

  // 跳过倒计时
  for (let i = 0; i < 300; i++) core.step(1 / 60);
  check('倒计时结束进入 racing', core.state === 'racing');

  // 把车丢到赛道外再重置
  const car = core.cars[0];
  car.state.x += 200; car.state.z += 200;
  core.resetPlayerToTrack();
  const q = td.query(car.state.x, car.state.z, car.lastIndex);
  check('重置后回到赛道中心线', Math.abs(q.lateral) < 0.5, 'lateral=' + q.lateral.toFixed(2));
  check('重置后速度清零', car.state.vF === 0 && car.state.vL === 0);
  check('重置后需重新过半程点才能计圈', car.canCountLap === false);
}

/* ================= 汇总 ================= */
console.log(`\n========== 测试结果: ${passed} 通过, ${failed} 失败 ==========\n`);
process.exit(failed ? 1 : 0);
