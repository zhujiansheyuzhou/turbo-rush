/* =========================================================
 * menu.js —— 菜单系统（标题 → 模式 → 赛道 → 车辆 → 开赛）
 * 纯 DOM 界面；赛道预览图用 TrackData 采样点画在 canvas 上。
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.Menu = function (onStart) {
  this.onStart = onStart;
  this.mode = null;
  this.trackIdx = 0;
  this.carIdx = 0;

  this.screens = {
    title: document.getElementById('menu-title'),
    mode: document.getElementById('menu-mode'),
    track: document.getElementById('menu-track'),
    car: document.getElementById('menu-car'),
    help: document.getElementById('menu-help')
  };

  this._buildTrackCards();
  this._buildCarCards();
  this._buildHelp();
  this._bind();
  this.show('title');
};

RACER.Menu.prototype = {

  show: function (name) {
    for (var k in this.screens) this.screens[k].classList.add('hidden');
    if (name) this.screens[name].classList.remove('hidden');
    // 进入赛道选择时绘制预览（需要等 canvas 可见）
    if (name === 'track') this._drawPreviews();
    // 双人模式提示 P1/P2 分车规则
    if (name === 'car') {
      var h2 = document.querySelector('#menu-car h2');
      if (h2) h2.textContent = this.mode === 'duel'
        ? 'P1 选择赛车（P2 自动使用下一款）' : '选择赛车';
    }
  },

  hideAll: function () { this.show(null); },

  _bind: function () {
    var self = this;
    function on(id, fn) { document.getElementById(id).addEventListener('click', fn); }

    on('btn-start', function () { self.show('mode'); });
    on('btn-help', function () { self.show('help'); });
    on('btn-help-back', function () { self.show('title'); });

    on('btn-mode-race', function () { self.mode = 'race'; self.show('track'); });
    on('btn-mode-time', function () { self.mode = 'time'; self.show('track'); });
    on('btn-mode-duel', function () { self.mode = 'duel'; self.show('track'); });
    on('btn-mode-back', function () { self.show('title'); });

    on('btn-track-back', function () { self.show('mode'); });
    on('btn-track-next', function () { self.show('car'); });

    on('btn-car-back', function () { self.show('track'); });
    on('btn-race-start', function () {
      self.hideAll();
      self.onStart({ mode: self.mode, trackIdx: self.trackIdx, carIdx: self.carIdx });
    });

    // 结算 / 暂停按钮（由 index.html 提供，转发给 game）
    on('btn-retry', function () { self.hideAll(); self.onStart(self._lastCfg || { mode: self.mode, trackIdx: self.trackIdx, carIdx: self.carIdx }); });
    on('btn-results-menu', function () { self.onMenu && self.onMenu(); });
    on('btn-resume', function () { self.onResume && self.onResume(); });
    on('btn-pause-retry', function () {
      document.getElementById('pause').classList.add('hidden');
      self.hideAll(); self.onStart(self._lastCfg);
    });
    on('btn-pause-menu', function () { self.onMenu && self.onMenu(); });
  },

  /** 记录最近一次配置（供"再来一局"） */
  setLastConfig: function (cfg) { this._lastCfg = cfg; },

  _buildTrackCards: function () {
    var self = this;
    var wrap = document.getElementById('track-cards');
    RACER.CONFIG.tracks.forEach(function (t, i) {
      var card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<canvas width="220" height="130"></canvas>' +
        '<h3>' + t.name + '</h3><p>' + t.desc + '</p>';
      card.addEventListener('click', function () {
        wrap.querySelectorAll('.card').forEach(function (c) { c.classList.remove('sel'); });
        card.classList.add('sel');
        self.trackIdx = i;
      });
      if (i === 0) card.classList.add('sel');
      wrap.appendChild(card);
    });
  },

  _drawPreviews: function () {
    var wrap = document.getElementById('track-cards');
    var cards = wrap.querySelectorAll('.card canvas');
    RACER.CONFIG.tracks.forEach(function (t, i) {
      var td = new RACER.TrackData(t.points, t.halfWidth);
      var cv = cards[i];
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#12233a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      RACER.Utils.drawTrackOutline(ctx, td.samples, cv.width, cv.height, '#ffb84d', 4);
    });
  },

  _buildCarCards: function () {
    var self = this;
    var wrap = document.getElementById('car-cards');
    var maxTop = 70, maxAcc = 22, maxGrip = 11;
    RACER.CONFIG.cars.forEach(function (c, i) {
      var card = document.createElement('div');
      card.className = 'card';
      function bar(label, v, max) {
        var pct = Math.round(100 * v / max);
        return '<div class="stat"><span>' + label + '</span>' +
          '<div class="bar"><div style="width:' + pct + '%"></div></div></div>';
      }
      card.innerHTML =
        '<div class="car-swatch" style="background:#' + ('000000' + c.color.toString(16)).slice(-6) + '"></div>' +
        '<h3>' + c.name + '</h3><p>' + c.desc + '</p>' +
        bar('极速', c.topSpeed, maxTop) + bar('加速', c.accel, maxAcc) + bar('抓地', c.grip, maxGrip);
      card.addEventListener('click', function () {
        wrap.querySelectorAll('.card').forEach(function (x) { x.classList.remove('sel'); });
        card.classList.add('sel');
        self.carIdx = i;
      });
      if (i === 0) card.classList.add('sel');
      wrap.appendChild(card);
    });
  },

  _buildHelp: function () {
    var table = document.getElementById('help-keys');
    var html = '';
    RACER.CONFIG.keys.forEach(function (kv) {
      html += '<tr><td class="key">' + kv[0] + '</td><td>' + kv[1] + '</td></tr>';
    });
    table.innerHTML = html;
  }
};
