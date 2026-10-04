/* =========================================================
 * trackdata.js —— 赛道数学层（纯逻辑，可在 Node 下无头运行）
 *
 * 把控制点定义的闭合样条离散成等距采样点，并提供：
 *   - 任意进度 u∈[0,1) 处的位置/切线/法线/曲率查询
 *   - 世界坐标 → 赛道进度 + 侧向偏移 的反查（带滑动窗口加速）
 * 物理、AI、碰撞、圈数判定全部建立在这层之上。
 * 仅依赖 THREE.Vector3 与 THREE.CatmullRomCurve3。
 * ========================================================= */
window.RACER = window.RACER || {};

/**
 * @param {Array<[number,number]>} controlPts 控制点 [x, z]
 * @param {number} halfWidth 路面半宽（米）
 * @param {number} [numSamples] 采样数（越多进度查询越平滑）
 */
RACER.TrackData = function (controlPts, halfWidth, numSamples) {
  var N = numSamples || 600;
  this.N = N;
  this.halfWidth = halfWidth;

  // 向心参数化闭合样条：过弯形状自然、不会打圈
  var pts3 = controlPts.map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); });
  this.curve = new THREE.CatmullRomCurve3(pts3, true, 'centripetal');

  // getSpacedPoints 返回按弧长等距的 N+1 个点（末点与首点重合）
  var sp = this.curve.getSpacedPoints(N);

  this.samples = [];   // { pos:{x,z}, tx,tz (切线), rx,rz (右法线), kappa (曲率), dist (累计弧长) }
  this.length = 0;

  var i, prev = null;
  for (i = 0; i < N; i++) {
    var p = sp[i];
    this.samples.push({ pos: { x: p.x, z: p.z }, tx: 0, tz: 1, rx: 1, rz: 0, kappa: 0, dist: this.length });
    if (prev) this.length += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }

  // 第一遍：中心差分求切线与右法线
  for (i = 0; i < N; i++) {
    var a = this.samples[(i - 1 + N) % N];
    var b = this.samples[i];
    var c = this.samples[(i + 1) % N];
    var dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
    var len = Math.hypot(dx, dz) || 1e-6;
    b.tx = dx / len; b.tz = dz / len;
    b.rx = b.tz; b.rz = -b.tx;      // 右法线 = 切线顺时针旋转 90°
  }

  // 第二遍：曲率 ≈ 相邻切线方向差 / 平均弧长
  // （必须等所有切线算完再算，否则用到未初始化的切线）
  for (i = 0; i < N; i++) {
    var a2 = this.samples[(i - 1 + N) % N];
    var b2 = this.samples[i];
    var c2 = this.samples[(i + 1) % N];
    var seg = (this.samples[(i + 1) % N].dist - a2.dist + this.length) % this.length || 1e-6;
    var ddx = c2.tx - a2.tx, ddz = c2.tz - a2.tz;
    b2.kappa = Math.hypot(ddx, ddz) / (seg + 1e-6);
  }
};

RACER.TrackData.prototype = {

  /** u∈[0,1) → 赛道中心线位置（线性插值） */
  pointAt: function (u, out) {
    u = RACER.Utils.wrap01(u);
    var f = u * this.N;
    var i = Math.floor(f) % this.N;
    var t = f - Math.floor(f);
    var a = this.samples[i], b = this.samples[(i + 1) % this.N];
    out = out || {};
    out.x = a.pos.x + (b.pos.x - a.pos.x) * t;
    out.z = a.pos.z + (b.pos.z - a.pos.z) * t;
    return out;
  },

  /** u 处单位切线（前进方向） */
  tangentAt: function (u, out) {
    var i = Math.floor(RACER.Utils.wrap01(u) * this.N) % this.N;
    out = out || {};
    out.x = this.samples[i].tx; out.z = this.samples[i].tz;
    return out;
  },

  /** u 处右法线 */
  normalAt: function (u, out) {
    var i = Math.floor(RACER.Utils.wrap01(u) * this.N) % this.N;
    out = out || {};
    out.x = this.samples[i].rx; out.z = this.samples[i].rz;
    return out;
  },

  /** [u0, u1] 区间内的最大曲率（用于 AI 刹车预判） */
  maxCurvature: function (u0, u1) {
    var i0 = Math.floor(RACER.Utils.wrap01(u0) * this.N);
    var count = Math.max(1, Math.floor(RACER.Utils.wrap01(u1 - u0) * this.N));
    var max = 0;
    for (var k = 0; k < count; k++) {
      var kk = this.samples[(i0 + k) % this.N].kappa;
      if (kk > max) max = kk;
    }
    return max;
  },

  /**
   * 世界坐标 → 赛道进度查询。
   * 在 lastIdx 附近的滑动窗口内搜索最近采样点（前进方向偏置），
   * 再向相邻线段投影细化，返回：
   *   { index, u01, lateral(右为正的侧向偏移), dist2 }
   */
  query: function (x, z, lastIdx) {
    var N = this.N, best = -1, bestD = Infinity;
    for (var k = -12; k <= 48; k++) {
      var i = ((lastIdx + k) % N + N) % N;
      var s = this.samples[i].pos;
      var dx = x - s.x, dz = z - s.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    // 向 [best, best+1] 线段投影，得到亚采样精度
    var a = this.samples[best], b = this.samples[(best + 1) % N];
    var abx = b.pos.x - a.pos.x, abz = b.pos.z - a.pos.z;
    var len2 = abx * abx + abz * abz || 1e-6;
    var t = ((x - a.pos.x) * abx + (z - a.pos.z) * abz) / len2;
    t = RACER.Utils.clamp(t, 0, 1);
    var px = a.pos.x + abx * t, pz = a.pos.z + abz * t;
    var lateral = (x - px) * a.rx + (z - pz) * a.rz;   // 投影到右法线
    return {
      index: best,
      u01: (best + t) / N,
      lateral: lateral,
      dist2: (x - px) * (x - px) + (z - pz) * (z - pz)
    };
  },

  /** 全赛道最近点搜索（出生/重置时用，O(N)） */
  queryGlobal: function (x, z) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < this.N; i++) {
      var s = this.samples[i].pos;
      var dx = x - s.x, dz = z - s.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    return this.query(x, z, best);
  }
};
