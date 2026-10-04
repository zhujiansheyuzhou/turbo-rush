/* =========================================================
 * hud.js —— 比赛 HUD（抬头显示）
 * 速度表、氮气条、圈数、名次、计时、小地图、中央提示语。
 * 全部基于 DOM + 一个 minimap canvas，零 Three.js 开销。
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.HUD = function () {
  this.root = document.getElementById('hud');
  this.elSpeed = document.getElementById('speed-num');
  this.elNitro = document.getElementById('nitro-fill');
  this.elLap = document.getElementById('hud-lap');
  this.elTime = document.getElementById('hud-time');
  this.elPos = document.getElementById('hud-pos');
  this.elTimes = document.getElementById('hud-laptimes');
  this.elMsg = document.getElementById('hud-msg');
  this.mapCanvas = document.getElementById('minimap');
  this.mapCtx = this.mapCanvas.getContext('2d');
  this.mapTransform = null;
  this.msgTimer = null;
  // 双人模式 P2 简报
  this.elP2 = document.getElementById('hud-p2');
  this.elP2Pos = document.getElementById('p2-pos');
  this.elP2Lap = document.getElementById('p2-lap');
  this.elP2Speed = document.getElementById('p2-speed');
};

RACER.HUD.prototype = {

  show: function () { this.root.classList.remove('hidden'); },
  hide: function () { this.root.classList.add('hidden'); },

  /** 比赛开始时初始化小地图 */
  setupMinimap: function (trackData) {
    this.trackData = trackData;
    this.mapTransform = RACER.Utils.drawTrackOutline(
      this.mapCtx, trackData.samples, this.mapCanvas.width, this.mapCanvas.height,
      'rgba(255,255,255,0.9)', 4);
  },

  /**
   * 每帧刷新。
   * @param {RACER.RaceCore} core
   * @param {Array} carViews  与 core.cars 一一对应（取颜色用）
   */
  update: function (core, carViews) {
    var U = RACER.Utils;
    var player = core.cars[0];

    // 速度（km/h）
    this.elSpeed.textContent = Math.round(player.state.speed * 3.6);
    // 氮气
    this.elNitro.style.width = player.nitro.toFixed(0) + '%';
    this.elNitro.classList.toggle('boosting', player.input && player.state.vF > 5 && player.nitro > 0 && core.playerInput && core.playerInput.nitro);
    // 圈数 & 比赛时间
    var lapShow = Math.min(player.lap + 1, core.totalLaps);
    this.elLap.textContent = '第 ' + lapShow + ' / ' + core.totalLaps + ' 圈';
    this.elTime.textContent = U.formatTime(core.raceTime);
    // 名次
    if (core.mode === 'race') {
      var rank = core.getStandings().indexOf(player) + 1;
      this.elPos.innerHTML = rank + '<small>/' + core.cars.length + '</small>';
      this.elPos.parentElement.style.display = '';
    } else {
      this.elPos.parentElement.style.display = 'none';
    }
    // 圈速
    var html = '本圈 ' + U.formatTime(core.raceTime - player.lapStartTime);
    if (player.lastLap) html += '<br>上圈 ' + U.formatTime(player.lastLap);
    if (player.bestLap) html += '<br>最佳 ' + U.formatTime(player.bestLap);
    this.elTimes.innerHTML = html;

    // 双人模式：P2 简报 + 分屏 HUD 布局
    var isDuel = core.mode === 'duel' && core.cars.length > 1 &&
      core.cars[1] && core.cars[1].isPlayer;
    this.elP2.classList.toggle('hidden', !isDuel);
    this.root.classList.toggle('split', isDuel);
    if (isDuel) {
      var p2 = core.cars[1];
      this.elP2Pos.innerHTML = (core.getStandings().indexOf(p2) + 1) +
        '<small>/' + core.cars.length + '</small>';
      this.elP2Lap.textContent = '第 ' + Math.min(p2.lap + 1, core.totalLaps) +
        ' / ' + core.totalLaps + ' 圈';
      this.elP2Speed.innerHTML = Math.round(p2.state.speed * 3.6) + '<small> km/h</small>';
    }

    this._drawMinimap(core, carViews);
  },

  _drawMinimap: function (core, carViews) {
    if (!this.mapTransform) return;
    var ctx = this.mapCtx, t = this.mapTransform;
    RACER.Utils.drawTrackOutline(ctx, this.trackData.samples,
      this.mapCanvas.width, this.mapCanvas.height, 'rgba(255,255,255,0.85)', 4);
    for (var i = 0; i < core.cars.length; i++) {
      var c = core.cars[i];
      var px = c.state.x * t.scale + t.offX;
      var py = c.state.z * t.scale + t.offY;
      ctx.beginPath();
      ctx.arc(px, py, c.isPlayer ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = c.isPlayer ? '#ffffff' : '#' + carViews[i].colorHex;
      // 双人模式：P1 橙圈 / P2 蓝圈
      ctx.strokeStyle = c.isPlayer
        ? (c.playerSlot === 1 ? '#2e9df2' : '#ff7a1a')
        : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
    }
  },

  /** 中央大提示（自动淡出） */
  showMessage: function (text, color, holdMs) {
    var el = this.elMsg;
    el.textContent = text;
    el.style.color = color || '#fff';
    el.classList.remove('msg-anim');
    void el.offsetWidth;           // 强制重排以重启动画
    el.classList.add('msg-anim');
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(function () { el.textContent = ''; }, holdMs || 1600);
  }
};
