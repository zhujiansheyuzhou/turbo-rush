/* =========================================================
 * ai.js —— AI 车手（纯逻辑）
 *
 * 采用经典的 Pure Pursuit（纯追踪）算法：
 *   1. 在车辆前方取一个"预瞄点"（随车速变远），沿各自车道偏移；
 *   2. 计算车头与预瞄点的夹角 → 转向输入；
 *   3. 根据前方弯道的最大曲率反推安全过弯速度 → 油门/刹车；
 *   4. 长直道且氮气充足时自动开氮气。
 * 另带"橡皮筋"机制：落后玩家太多会略微提速，领先太多会放水，
 * 保证比赛始终有悬念（可配置难度）。
 * ========================================================= */
window.RACER = window.RACER || {};

/**
 * @param {RACER.TrackData} trackData
 * @param {number} laneOffset 常驻车道偏移（米，右为正），让 AI 不全挤在一条线上
 * @param {number} skill      0.85~1.05，基础水平系数
 */
RACER.AIDriver = function (trackData, laneOffset, skill) {
  this.td = trackData;
  this.lane = laneOffset;
  this.skill = skill || 1;
  this.wobbleT = Math.random() * 100;   // 车道轻微摆动相位
};

RACER.AIDriver.prototype = {

  /**
   * 计算本帧驾驶输入。
   * @param {Object} st        车辆状态（含 x,z,heading,vF,speed）
   * @param {Object} p         车辆参数（用到 aiLat / topSpeed）
   * @param {number} u01       当前赛道进度 [0,1)
   * @param {number} rubber    橡皮筋系数（1 = 正常；>1 提速追赶）
   * @param {number} nitro     当前氮气量 0~100
   */
  compute: function (st, p, u01, rubber, nitro, dt) {
    var U = RACER.Utils, td = this.td;

    // ---- 预瞄点 ----
    var look = U.clamp(10 + Math.abs(st.vF) * 0.5, 12, 42);
    var uT = u01 + look / td.length;
    var tp = td.pointAt(uT);
    var tn = td.normalAt(uT);
    // 车道偏移带轻微正弦摆动，显得更"活"
    this.wobbleT += dt;
    var lane = this.lane + Math.sin(this.wobbleT * 0.7) * 0.8;
    var tx = tp.x + tn.x * lane, tz = tp.z + tn.z * lane;

    // ---- 转向：车头朝向与目标方向的夹角 ----
    var targetAngle = Math.atan2(tx - st.x, tz - st.z);
    var diff = U.wrapAngle(targetAngle - st.heading);
    var steer = U.clamp(diff * 2.4, -1, 1);

    // ---- 目标速度：前方弯道曲率 → 安全速度 ----
    var kappa = td.maxCurvature(u01 + 0.004, u01 + (look * 1.6) / td.length);
    var vCorner = Math.sqrt((p.aiLat * this.skill) / Math.max(kappa, 1e-4));
    var vTarget = U.clamp(vCorner, 16, p.topSpeed * this.skill * rubber);

    var throttle = 0, brake = 0, handbrake = false;
    if (st.vF < vTarget - 1) throttle = 1;
    else if (st.vF > vTarget + 2) brake = U.clamp((st.vF - vTarget) / 10, 0.2, 1);

    // 急弯且车速过高 → 拉手刹甩尾过弯（既有观赏性又实用）
    if (vCorner < 24 && st.vF > 30 && Math.abs(diff) > 0.25) handbrake = true;

    // ---- 氮气：前方较直且存量充足时使用 ----
    var useNitro = nitro > 55 && kappa < 0.008 && st.vF > p.topSpeed * 0.55;

    return { steer: steer, throttle: throttle, brake: brake, handbrake: handbrake, nitro: useNitro };
  }
};
