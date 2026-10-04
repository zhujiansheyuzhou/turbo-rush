/* =========================================================
 * physics.js —— 街机风格车辆物理（纯逻辑，无 THREE 依赖）
 *
 * 车辆状态用标量分解表示：
 *   vF —— 沿车头方向的纵向速度（可正可负，负为倒车）
 *   vL —— 沿车身右方的侧向速度（侧滑量）
 * 每步先把 vF/vL 合成世界速度、施加驱动力与阻力，
 * 再按新的车头朝向重新分解并用"抓地力"衰减侧向分量——
 * 漂移就是抓地力被人为降低后自然出现的现象。
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.CarPhysics = {

  /**
   * 推进一帧。
   * @param {Object} st    车辆状态 { x, z, heading, vF, vL, drifting }
   * @param {Object} input { steer∈[-1,1], throttle∈[0,1], brake∈[0,1], handbrake, nitro }
   * @param {Object} p     车辆参数（见 config.js cars）
   * @param {number} dt    秒
   * @param {Object} surf  路面 { offroad:boolean }
   */
  step: function (st, input, p, dt, surf) {
    var U = RACER.Utils;
    var offroad = surf && surf.offroad;

    // 氮气状态：极速与加速度提升
    var boosting = !!input.nitro;
    var maxSpeed = p.topSpeed * (boosting ? p.nitroFactor : 1);
    if (offroad) maxSpeed *= 0.55;

    var sin = Math.sin(st.heading), cos = Math.cos(st.heading);
    // 车头前向 (sin, cos) 与右向 (cos, -sin)
    var wx = sin * st.vF + cos * st.vL;
    var wz = cos * st.vF - sin * st.vL;

    // ---- 纵向驱动 ----
    var acc = 0;
    if (input.throttle > 0) acc += p.accel * (boosting ? 1.7 : 1) * input.throttle;
    if (input.brake > 0) {
      if (st.vF > 0.5) acc -= p.brake * input.brake;        // 前进中 → 刹车
      else acc -= (p.reverseAccel || 8) * input.brake;      // 停稳后 → 倒车
    }
    wx += sin * acc * dt;
    wz += cos * acc * dt;

    // ---- 阻力（松开油门的滑行减速 + 手刹额外减速 + 草地大阻力） ----
    var drag = 0.12 + (input.throttle > 0 ? 0 : 0.35);
    if (input.handbrake) drag += 0.8;
    if (offroad) drag += 1.6;
    var dragK = Math.max(0, 1 - drag * dt);
    wx *= dragK; wz *= dragK;

    // ---- 转向 ----
    // 低速转不动、高速转向衰减；倒车时方向相反
    var speedRatio = U.clamp(Math.abs(st.vF) / maxSpeed, 0, 1);
    var steerAuthority = U.clamp(Math.abs(st.vF) / 10, 0, 1) * (1 - speedRatio * p.steerLoss);
    st.heading = U.wrapAngle(st.heading +
      input.steer * p.steer * steerAuthority * dt * (st.vF >= 0 ? 1 : -1));

    // ---- 漂移判定：手刹 + 打方向 + 足够车速 ----
    st.drifting = !!(input.handbrake && Math.abs(st.vF) > 12 && Math.abs(input.steer) > 0.1);

    // ---- 用新车头方向重新分解速度，抓地力衰减侧滑 ----
    sin = Math.sin(st.heading); cos = Math.cos(st.heading);
    st.vF = wx * sin + wz * cos;          // 投影到前向
    st.vL = wx * cos - wz * sin;          // 投影到右向

    var grip = st.drifting ? p.driftGrip : p.grip;
    if (offroad) grip *= 0.5;
    st.vL *= Math.max(0, 1 - grip * dt);

    // ---- 限速 ----
    st.vF = U.clamp(st.vF, -(p.reverseMax || 14), maxSpeed);

    // ---- 位置积分 ----
    wx = sin * st.vF + cos * st.vL;
    wz = cos * st.vF - sin * st.vL;
    st.x += wx * dt;
    st.z += wz * dt;

    st.speed = Math.hypot(wx, wz);        // 合速度（表显用）
  }
};
