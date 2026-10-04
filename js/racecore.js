/* =========================================================
 * racecore.js —— 比赛核心（纯逻辑，可在 Node 下无头仿真）
 *
 * 职责：
 *   - 管理所有赛车的状态、输入（玩家由外部注入，AI 由 AIDriver 计算）
 *   - 赛道进度/圈数/名次判定、护墙碰撞、车际碰撞
 *   - 氮气资源、倒计时状态机、比赛结束判定
 *   - 每帧返回事件列表（撞墙/过圈/完赛等），供表现层播音效、做特效
 *
 * 状态机： countdown(3s) → racing → finished（玩家冲线）
 * ========================================================= */
window.RACER = window.RACER || {};

/**
 * @param {RACER.TrackData} td
 * @param {Object} opts { mode:'race'|'time', playerSpec, totalLaps, aiSpecs? }
 */
RACER.RaceCore = function (td, opts) {
  this.td = td;
  this.mode = opts.mode;
  this.totalLaps = opts.totalLaps || RACER.CONFIG.totalLaps;
  this.state = 'countdown';
  this.countdownT = 3.6;          // 3-2-1-GO
  this.raceTime = 0;
  this.events = [];
  this.playerInput = null;        // 兼容别名（= playerInputs[0]）
  this.playerInputs = {};         // 双人模式：{0: P1输入, 1: P2输入}

  this.cars = [];
  var grid = [{ spec: opts.playerSpec, isPlayer: true, name: 'P1', slot: 0 }];
  if (this.mode === 'duel') {
    grid.push({ spec: opts.player2Spec, isPlayer: true, name: 'P2', slot: 1 });
  } else if (this.mode === 'race') {
    for (var i = 0; i < (opts.aiSpecs || []).length; i++) {
      grid.push({ spec: opts.aiSpecs[i].spec, isPlayer: false, name: opts.aiSpecs[i].name, slot: -1 });
    }
  }

  // 发车格：起点线后方交错两列
  var U = RACER.Utils;
  for (var g = 0; g < grid.length; g++) {
    var row = Math.floor(g / 2), col = g % 2;
    var u = 1 - (10 + row * 8) / td.length;
    var n = td.normalAt(u), p0 = td.pointAt(u);
    var lat = (col === 0 ? -1 : 1) * 2.6;
    var tan = td.tangentAt(u);
    var st = {
      x: p0.x + n.x * lat, z: p0.z + n.z * lat,
      heading: Math.atan2(tan.x, tan.z),
      vF: 0, vL: 0, speed: 0, drifting: false
    };
    var car = {
      name: grid[g].name, spec: grid[g].spec, isPlayer: grid[g].isPlayer,
      playerSlot: grid[g].slot,
      state: st, input: { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false },
      nitro: 70,                          // 初始氮气
      lastIndex: 0, progressTotal: -((10 + row * 8) + 0) / td.length,
      lap: 0, canCountLap: false, justReset: true,
      lapStartTime: 0, lastLap: null, bestLap: null,
      finished: false, finishTime: null,
      stuckT: 0, stuckRefX: 0, stuckRefZ: 0,
      ai: null
    };
    // AI 车道偏移与水平系数（随车数增多缓慢提升，制造层次）
    if (!car.isPlayer) {
      var lane = (g % 2 === 0 ? 1 : -1) * (1.5 + Math.random() * 2);
      car.ai = new RACER.AIDriver(td, lane, 0.93 + g * 0.02);
    }
    this.cars.push(car);
  }
  // 初始化 lastIndex，避免第一帧全图搜索抖动
  for (var c = 0; c < this.cars.length; c++) {
    var q = td.queryGlobal(this.cars[c].state.x, this.cars[c].state.z);
    this.cars[c].lastIndex = q.index;
    this.cars[c].stuckRefX = this.cars[c].state.x;
    this.cars[c].stuckRefZ = this.cars[c].state.z;
  }
};

RACER.RaceCore.prototype = {

  /** 注入玩家输入（浏览器键盘层调用）；双人模式用 slot 区分 P1/P2 */
  setPlayerInput: function (input, slot) {
    if (slot === undefined) slot = 0;
    this.playerInputs[slot] = input;
    if (slot === 0) this.playerInput = input;
  },

  /** 玩家按 R：重置回赛道中央，且本圈需重新通过半程点才能计圈 */
  resetPlayerToTrack: function () {
    var car = this.cars[0];
    var q = this.td.queryGlobal(car.state.x, car.state.z);
    var tan = this.td.tangentAt(q.u01);
    car.state.x = this.td.samples[q.index].pos.x;
    car.state.z = this.td.samples[q.index].pos.z;
    car.state.heading = Math.atan2(tan.x, tan.z);
    car.state.vF = 0; car.state.vL = 0;
    car.lastIndex = q.index;
    car.justReset = true;
    car.canCountLap = false;              // 防止"重置到终点前刷圈"
    this.events.push({ type: 'reset', car: car });
  },

  /** 推进一帧，返回本帧事件列表 */
  step: function (dt) {
    this.events.length = 0;

    // ---- 倒计时 ----
    if (this.state === 'countdown') {
      var prev = Math.ceil(this.countdownT);
      this.countdownT -= dt;
      var now = Math.ceil(this.countdownT);
      if (now !== prev && now > 0 && now <= 3) this.events.push({ type: 'count', n: now });
      if (this.countdownT <= 0) {
        this.state = 'racing';
        this.events.push({ type: 'go' });
      }
      return this.events;
    }
    if (this.state === 'finished') {
      // 结算后车辆继续滑行，画面不死板
      for (var f = 0; f < this.cars.length; f++) this._cruiseFinish(this.cars[f], dt);
      return this.events;
    }

    this.raceTime += dt;
    var racing = this.state === 'racing';
    var playerProgress = this.cars[0].progressTotal;

    for (var i = 0; i < this.cars.length; i++) {
      var car = this.cars[i];
      if (car.finished) { this._cruiseFinish(car, dt); continue; }

      // ---- 输入来源 ----
      var input;
      if (car.isPlayer) {
        input = this.playerInputs[car.playerSlot] || car.input;
      } else {
        // 橡皮筋：按与玩家的进度差微调 AI 极速（±12% 封顶）
        var gap = playerProgress - car.progressTotal;   // >0 表示 AI 落后
        var rubber = RACER.Utils.clamp(1 + gap * 0.9, 0.88, 1.12);
        input = car.ai.compute(car.state, car.spec, this._frac(car), rubber, car.nitro, dt);
      }
      if (!racing) input = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };

      // ---- 路面判定 ----
      var q = this.td.query(car.state.x, car.state.z, car.lastIndex);
      car.lastIndex = q.index;
      var offroad = Math.abs(q.lateral) > this.td.halfWidth;

      // ---- 物理 ----
      RACER.CarPhysics.step(car.state, input, car.spec, dt, { offroad: offroad });

      // ---- NaN 护栏（极端工况物理发散时兜底，防止车辆"消失"） ----
      if (!isFinite(car.state.x) || !isFinite(car.state.z) ||
          !isFinite(car.state.vF) || !isFinite(car.state.vL)) {
        var sc = this.td.samples[q.index];
        car.state.x = sc.pos.x; car.state.z = sc.pos.z;
        car.state.vF = 0; car.state.vL = 0;
        car.state.speed = 0; car.state.drifting = false;
        car.justReset = true;
      }

      // ---- 氮气资源 ----
      if (input.nitro && car.nitro > 0 && racing) {
        car.nitro = Math.max(0, car.nitro - 32 * dt);
      } else {
        car.nitro = Math.min(100, car.nitro + (car.state.drifting ? 20 : 5) * dt);
      }

      // ---- 护墙碰撞（真实反弹 + 贴墙滑行，绝不穿透/卡死） ----
      var q2 = this.td.query(car.state.x, car.state.z, car.lastIndex);
      car.lastIndex = q2.index;
      var wallLim = this.td.halfWidth + 0.9;
      if (Math.abs(q2.lateral) > wallLim) {
        var s = this.td.samples[q2.index];
        var sgn = q2.lateral > 0 ? 1 : -1;
        var nx = s.rx * sgn, nz = s.rz * sgn;      // 指向墙外的法线
        var ttx = s.tx, ttz = s.tz;                // 墙面切向（赛道方向）
        var sh = Math.sin(car.state.heading), ch = Math.cos(car.state.heading);
        var wvx = sh * car.state.vF + ch * car.state.vL;
        var wvz = ch * car.state.vF - sh * car.state.vL;
        var vn = wvx * nx + wvz * nz;              // 法向（朝墙外）分量
        var vt = wvx * ttx + wvz * ttz;            // 切向分量
        if (vn > 0) vn = -vn * 0.35;               // 法向反弹（恢复系数 0.35）
        vt *= 0.94;                                // 切向摩擦
        wvx = nx * vn + ttx * vt;
        wvz = nz * vn + ttz * vt;
        car.state.vF = wvx * sh + wvz * ch;
        car.state.vL = wvx * ch - wvz * sh;
        // 贴墙滑行辅助：车头还朝着墙时，把车头渐渐摆正到墙面切向
        if (input.throttle > 0.1) {
          var fwdN = sh * nx + ch * nz;            // >0 表示车头朝墙
          if (fwdN > 0.08) {
            var dir = (sh * ttx + ch * ttz) >= 0 ? 1 : -1;
            var target = Math.atan2(ttx * dir, ttz * dir);
            var dh = RACER.Utils.wrapAngle(target - car.state.heading);
            car.state.heading = RACER.Utils.wrapAngle(
              car.state.heading + RACER.Utils.clamp(dh, -3.5 * dt, 3.5 * dt));
          }
        }
        // 位置贴墙，绝不穿透
        var latC = RACER.Utils.clamp(q2.lateral, -wallLim, wallLim);
        car.state.x = s.pos.x + s.rx * latC;
        car.state.z = s.pos.z + s.rz * latC;
        car.state.speed = Math.hypot(car.state.vF, car.state.vL);
        if (car.state.speed > 12) this.events.push({ type: 'wall', car: car });
      }

      // ---- 防卡死护栏：给油但 2.5s 内挪不到 1m → 自动回赛道中心 ----
      // （倒车/转向都是正常操作，绝不打断）
      if (racing && input.throttle > 0.1) {
        var dxm = car.state.x - car.stuckRefX, dzm = car.state.z - car.stuckRefZ;
        if (dxm * dxm + dzm * dzm > 1.0) {
          car.stuckRefX = car.state.x; car.stuckRefZ = car.state.z;
          car.stuckT = 0;
        } else {
          car.stuckT += dt;
          if (car.stuckT > 2.5) {
            var sc = this.td.samples[q2.index];
            car.state.x = sc.pos.x;
            car.state.z = sc.pos.z;
            car.state.heading = Math.atan2(sc.tx, sc.tz);
            car.state.vF = 0; car.state.vL = 0;
            car.state.drifting = false;
            car.state.speed = 0;
            car.stuckT = 0;
            car.stuckRefX = car.state.x; car.stuckRefZ = car.state.z;
            car.justReset = true;   // 进度对齐，防止跳圈
            if (car.isPlayer) this.events.push({ type: 'unstuck', car: car });
          }
        }
      } else {
        car.stuckT = 0;
        car.stuckRefX = car.state.x; car.stuckRefZ = car.state.z;
      }

      // ---- 进度与圈数 ----
      this._updateProgress(car, q2);
    }

    // ---- 车际碰撞（圆模型推开 + 少量速度交换） ----
    for (i = 0; i < this.cars.length; i++) {
      for (var j = i + 1; j < this.cars.length; j++) {
        var a = this.cars[i], b = this.cars[j];
        var dx = b.state.x - a.state.x, dz = b.state.z - a.state.z;
        var d = Math.hypot(dx, dz);
        if (d < 3.3 && d > 1e-4) {
          var push = (3.3 - d) / 2;
          dx /= d; dz /= d;
          a.state.x -= dx * push; a.state.z -= dz * push;
          b.state.x += dx * push; b.state.z += dz * push;
          var avg = (a.state.vF + b.state.vF) / 2;
          a.state.vF += (avg - a.state.vF) * 0.25;
          b.state.vF += (avg - b.state.vF) * 0.25;
          this.events.push({ type: 'bump', a: a, b: b });
        }
      }
    }

    // ---- 玩家完赛 → 结算（双人模式需两名玩家都冲线） ----
    var raceOver;
    if (this.mode === 'duel') {
      raceOver = true;
      for (i = 0; i < this.cars.length; i++) {
        if (this.cars[i].isPlayer && !this.cars[i].finished) raceOver = false;
      }
    } else {
      raceOver = this.cars[0].finished;
    }
    if (raceOver && this.state === 'racing') {
      this.state = 'finished';
      this.events.push({ type: 'raceover' });
    }
    return this.events;
  },

  /** 当前名次表（按累计进度排序），返回 car 引用数组 */
  getStandings: function () {
    return this.cars.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progressTotal - a.progressTotal;
    });
  },

  /* ---------------- 内部方法 ---------------- */

  _frac: function (car) { return RACER.Utils.wrap01(car.progressTotal); },

  _updateProgress: function (car, q) {
    var du = q.u01 - RACER.Utils.wrap01(car.progressTotal);
    if (du < -0.5) du += 1;
    else if (du > 0.5) du -= 1;

    if (car.justReset) {
      // 重置后把进度小数部分对齐到当前位置，不产生跳变
      car.progressTotal = Math.floor(car.progressTotal) + q.u01;
      car.justReset = false;
    } else {
      car.progressTotal += du;
    }

    var frac = RACER.Utils.wrap01(car.progressTotal);
    if (frac > 0.45 && frac < 0.6) car.canCountLap = true;   // 通过半程点

    var newLap = Math.floor(car.progressTotal);
    if (newLap > car.lap && frac < 0.1) {
      if (car.canCountLap) {
        car.lap = newLap;
        car.canCountLap = false;
        var t = this.raceTime;
        car.lastLap = t - car.lapStartTime;
        car.lapStartTime = t;
        if (car.bestLap === null || car.lastLap < car.bestLap) car.bestLap = car.lastLap;
        this.events.push({ type: 'lap', car: car, lap: car.lap });
        if (car.lap >= this.totalLaps) {
          car.finished = true;
          car.finishTime = t;
          this.events.push({ type: 'finish', car: car });
        }
      } else {
        // 没经过半程点就越线（抄近道/重置作弊），不计圈并回退
        car.progressTotal = car.lap + 0.999;
      }
    }
  },

  /** 已完赛的车辆低速巡航到停下 */
  _cruiseFinish: function (car, dt) {
    var idle = { steer: 0, throttle: 0, brake: 0.3, handbrake: false, nitro: false };
    RACER.CarPhysics.step(car.state, idle, car.spec, dt, { offroad: false });
  }
};
