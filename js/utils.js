/* =========================================================
 * utils.js —— 通用工具函数
 * 所有模块挂载到全局命名空间 RACER 上（经典脚本，无模块依赖，
 * 因此 index.html 可以直接双击打开运行，无需本地服务器）。
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.Utils = {
  /** 将 v 限制在 [a, b] */
  clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },

  /** 线性插值 */
  lerp: function (a, b, t) { return a + (b - a) * t; },

  /** 帧率无关的指数平滑（用于相机跟随等） */
  damp: function (a, b, lambda, dt) { return RACER.Utils.lerp(a, b, 1 - Math.exp(-lambda * dt)); },

  /** 把角度规范到 (-PI, PI] */
  wrapAngle: function (a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a <= -Math.PI) a += Math.PI * 2;
    return a;
  },

  /** 把进度比例规范到 [0, 1) */
  wrap01: function (u) { u = u % 1; return u < 0 ? u + 1 : u; },

  /**
   * 秒 → "分:秒.毫秒" 字符串，如 83.456 → "1:23.456"
   * 传入 null/Infinity 显示 "--:--.---"
   */
  formatTime: function (sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '--:--.---';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.floor((sec * 1000) % 1000);
    return m + ':' + (s < 10 ? '0' : '') + s + '.' + ('00' + ms).slice(-3);
  },

  /**
   * 在给定 canvas 2D 上下文上绘制赛道俯视图（小地图/菜单预览共用）。
   * samples: TrackData.samples 数组（含 pos.x / pos.z）
   */
  drawTrackOutline: function (ctx, samples, w, h, lineColor, lineWidth) {
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < samples.length; i++) {
      var p = samples[i].pos;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    var margin = 12;
    var scale = Math.min((w - margin * 2) / (maxX - minX), (h - margin * 2) / (maxZ - minZ));
    var offX = (w - (maxX - minX) * scale) / 2 - minX * scale;
    var offY = (h - (maxZ - minZ) * scale) / 2 - minZ * scale;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = lineColor || '#ffffff';
    ctx.lineWidth = lineWidth || 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (i = 0; i <= samples.length; i++) {
      var s = samples[i % samples.length].pos;
      var px = s.x * scale + offX, py = s.z * scale + offY;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    // 返回变换参数，供小地图绘制车辆位置使用
    return { scale: scale, offX: offX, offY: offY };
  }
};
