/* =========================================================
 * game.js —— 游戏编排层（表现层总控）
 *
 * 负责：Three.js 渲染器/相机/灯光、比赛生命周期
 * （创建→倒计时→进行→结算）、追逐相机、
 * 把 RaceCore 的事件翻译成音效与 HUD 提示、暂停/重开。
 *
 * 状态机： menu → countdown → racing → finished
 * （倒计时/比赛逻辑全部在 RaceCore 中，本层只做表现）
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.Game = function (container) {
  this.container = container;

  /* ---------- 颜色管理（hex 颜色按 sRGB→线性 正确转换，否则整车整景发白） ---------- */
  if (THREE.ColorManagement) THREE.ColorManagement.enabled = true;

  /* ---------- 渲染器（电影级色调映射 + 软阴影） ---------- */
  this.renderer = new THREE.WebGLRenderer({ antialias: true });
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  this.renderer.setSize(window.innerWidth, window.innerHeight);
  this.renderer.outputEncoding = THREE.sRGBEncoding;
  this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure = 1.06;
  this.renderer.shadowMap.enabled = true;
  this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(this.renderer.domElement);

  this.scene = new THREE.Scene();
  this.scene.fog = new THREE.Fog(0xd2dfec, 220, 1350);

  this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
  this.camera.position.set(0, 60, 120);
  // 双人模式第二相机（下半屏）
  this.camera2 = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
  this.camera2.position.set(0, 60, 120);

  /* ---------- 天穹（渐变穹顶 + 云朵），跨赛道持久 ---------- */
  this._buildSky();

  /* ---------- PBR 环境反射（车漆/路面光泽的来源） ---------- */
  this._buildEnvironment();

  /* ---------- 灯光（金色暖阳 + 天光补光） ---------- */
  this.scene.add(new THREE.HemisphereLight(0xa8c8f0, 0x5d7d4f, 0.6));
  var sun = new THREE.DirectionalLight(0xffdfae, 1.95);
  sun.position.set(120, 95, 60);          // 较低角度 → 长影子，地平线4式暖调
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 500;
  sun.shadow.camera.left = -75;
  sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 75;
  sun.shadow.camera.bottom = -75;
  sun.shadow.bias = -0.0006;
  this.scene.add(sun);
  this.scene.add(sun.target);
  this.sun = sun;
  // 反向冷色补光，避免暗部死黑
  var fill = new THREE.DirectionalLight(0x8fb4e8, 0.3);
  fill.position.set(-110, 70, -90);
  this.scene.add(fill);

  /* ---------- 子系统 ---------- */
  this.input = new RACER.Input(0);
  this.input2 = new RACER.Input(1);
  this.input2.onAction = null;   // 全局快捷键只挂在 P1 上
  this.audio = new RACER.Audio();
  this.hud = new RACER.HUD();

  this.state = 'menu';       // menu | racing | finished
  this.paused = false;
  this.track = null;
  this.core = null;
  this.carViews = [];
  this.camShake = 0;
  this.camMode = 'chase';    // chase 车外追尾 | cockpit 车内第一人称
  this.finishTimer = -1;
  this.raceConfig = null;

  var self = this;
  this.input.onAction = function (a) { self._onAction(a); };
  window.addEventListener('resize', function () {
    self.camera.aspect = window.innerWidth / window.innerHeight;
    self.camera.updateProjectionMatrix();
    self.camera2.aspect = self.camera.aspect;
    self.camera2.updateProjectionMatrix();
    self.renderer.setSize(window.innerWidth, window.innerHeight);
  });

  this.clock = new THREE.Clock();
  this._loop = this._loop.bind(this);
  requestAnimationFrame(this._loop);
};

RACER.Game.prototype = {

  /* ================= 天空穹顶 ================= */

  /** PBR 环境贴图：程序化小场景烘焙，供车漆/玻璃反射 */
  _buildEnvironment: function () {
    var envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(90, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fa8d8, side: THREE.BackSide })
    ));
    // 地面（草绿，让车身下缘反射出大地色）
    var eg = new THREE.Mesh(new THREE.CircleGeometry(80, 24),
      new THREE.MeshBasicMaterial({ color: 0x6d9455 }));
    eg.rotation.x = -Math.PI / 2;
    eg.position.y = -14;
    envScene.add(eg);
    // 太阳亮斑（高光来源）
    var sunBall = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
    sunBall.position.set(48, 42, 24);
    envScene.add(sunBall);
    // 两块天光亮板，制造车顶流动高光
    var pMat = new THREE.MeshBasicMaterial({ color: 0xe8f2ff });
    var p1 = new THREE.Mesh(new THREE.PlaneGeometry(26, 60), pMat);
    p1.position.set(-38, 26, -20);
    p1.rotation.y = Math.PI / 3;
    envScene.add(p1);
    var p2 = new THREE.Mesh(new THREE.PlaneGeometry(20, 50), pMat);
    p2.position.set(34, 24, 26);
    p2.rotation.y = -Math.PI / 2.4;
    envScene.add(p2);

    try {
      var pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 300).texture;
      pmrem.dispose();
    } catch (err) {
      /* 老设备不支持时退化为无环境反射 */
    }
  },

  /** 渐变天穹 + 程序化云朵 + 太阳光晕（menu/race 共用，随场景常驻） */
  _buildSky: function () {
    var cv = document.createElement('canvas');
    cv.width = 32; cv.height = 512;
    var ctx = cv.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.0, '#2559ad');    // 天顶深蓝
    g.addColorStop(0.42, '#5e97d8');   // 中层
    g.addColorStop(0.72, '#b3d2ec');   // 浅层
    g.addColorStop(0.88, '#ffe4b8');   // 地平线暖金（落日余晖感）
    g.addColorStop(1.0, '#e8ecf0');    // 地平线下方
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 512);
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;

    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(1900, 24, 18),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
    this.scene.add(dome);

    /* 太阳光晕（贴着太阳方向的大光斑） */
    var glowCv = document.createElement('canvas');
    glowCv.width = glowCv.height = 128;
    var gc = glowCv.getContext('2d');
    var gg = gc.createRadialGradient(64, 64, 4, 64, 64, 62);
    gg.addColorStop(0, 'rgba(255,244,214,0.95)');
    gg.addColorStop(0.25, 'rgba(255,226,168,0.55)');
    gg.addColorStop(1, 'rgba(255,220,160,0)');
    gc.fillStyle = gg;
    gc.fillRect(0, 0, 128, 128);
    var glowTex = new THREE.CanvasTexture(glowCv);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, blending: THREE.AdditiveBlending,
      fog: false, depthWrite: false
    }));
    var sdir = new THREE.Vector3(120, 95, 60).normalize();
    glow.position.copy(sdir.multiplyScalar(1550));
    glow.scale.set(560, 560, 1);
    this.scene.add(glow);

    /* 云朵：几团椭圆白色贴图挂在半空 */
    var cv2 = document.createElement('canvas');
    cv2.width = 256; cv2.height = 128;
    var c2 = cv2.getContext('2d');
    for (var i = 0; i < 14; i++) {
      var rx = 26 + Math.random() * 44, ry = 12 + Math.random() * 16;
      var x = 40 + Math.random() * 176, y = 42 + Math.random() * 40;
      var grd = c2.createRadialGradient(x, y, 2, x, y, rx);
      grd.addColorStop(0, 'rgba(255,255,255,0.92)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = grd;
      c2.save(); c2.translate(x, y); c2.scale(1, ry / rx); c2.translate(-x, -y);
      c2.beginPath(); c2.arc(x, y, rx, 0, Math.PI * 2); c2.fill();
      c2.restore();
    }
    var cloudTex = new THREE.CanvasTexture(cv2);
    cloudTex.encoding = THREE.sRGBEncoding;

    /* 云朵：蓬松簇团（每朵由 3~5 团椭圆云雾叠成） */
    for (i = 0; i < 12; i++) {
      var ang = Math.random() * Math.PI * 2;
      var rad = 500 + Math.random() * 900;
      var h = 170 + Math.random() * 190;
      var cx0 = Math.cos(ang) * rad, cz0 = Math.sin(ang) * rad;
      var puffs = 3 + (Math.random() * 3 | 0);
      var baseS = 180 + Math.random() * 200;
      for (var p = 0; p < puffs; p++) {
        var cl = new THREE.Sprite(new THREE.SpriteMaterial({
          map: cloudTex, transparent: true,
          opacity: (0.4 + Math.random() * 0.35) / puffs * 2.2,
          fog: false, depthWrite: false
        }));
        var scl = baseS * (0.6 + Math.random() * 0.7);
        cl.scale.set(scl, scl * (0.4 + Math.random() * 0.15), 1);
        cl.position.set(
          cx0 + (Math.random() - 0.5) * baseS * 0.9,
          h + (Math.random() - 0.5) * baseS * 0.16,
          cz0 + (Math.random() - 0.5) * baseS * 0.9
        );
        this.scene.add(cl);
      }
    }

    /* 体积光 god rays：太阳方向放射状光束 */
    var rayCv = document.createElement('canvas');
    rayCv.width = 256; rayCv.height = 32;
    var rc = rayCv.getContext('2d');
    var rg = rc.createLinearGradient(0, 0, 256, 0);
    rg.addColorStop(0, 'rgba(255,238,200,0.55)');
    rg.addColorStop(1, 'rgba(255,238,200,0)');
    rc.fillStyle = rg;
    rc.fillRect(0, 0, 256, 32);
    var rayTex = new THREE.CanvasTexture(rayCv);
    for (i = 0; i < 5; i++) {
      var ray = new THREE.Sprite(new THREE.SpriteMaterial({
        map: rayTex, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, fog: false, depthWrite: false,
        rotation: (i - 2) * 0.45
      }));
      var rs = 900 + Math.random() * 500;
      ray.scale.set(rs, rs * 0.16, 1);
      ray.position.copy(new THREE.Vector3(120, 95, 60).normalize().multiplyScalar(1400));
      ray.position.x += (Math.random() - 0.5) * 260;
      ray.position.y += (Math.random() - 0.5) * 200;
      this.scene.add(ray);
    }
  },

  /* ================= 比赛生命周期 ================= */

  /** 由菜单发起：{ mode:'race'|'time', trackIdx, carIdx } */
  startRace: function (cfg) {
    this._clearRace();
    this.raceConfig = cfg;
    var C = RACER.CONFIG;
    var trackDef = C.tracks[cfg.trackIdx];

    this.track = new RACER.Track(this.scene, trackDef);

    var playerSpec = C.cars[cfg.carIdx];
    var aiSpecs = [];
    if (cfg.mode === 'race') {
      // AI 使用与玩家不同的车型，颜色来自配置
      var pool = [0, 1, 2].filter(function (i) { return i !== cfg.carIdx; });
      for (var i = 0; i < C.aiCount; i++) {
        aiSpecs.push({ name: C.aiNames[i], spec: C.cars[pool[i % pool.length]] });
      }
    }
    var coreOpts = { mode: cfg.mode, playerSpec: playerSpec, totalLaps: C.totalLaps };
    if (cfg.mode === 'duel') {
      // 双人模式：P2 自动使用下一款赛车，无 AI
      coreOpts.player2Spec = C.cars[(cfg.carIdx + 1) % C.cars.length];
    } else {
      coreOpts.aiSpecs = aiSpecs;
    }
    this.core = new RACER.RaceCore(this.track.data, coreOpts);

    // 车模
    this.carViews = [];
    for (i = 0; i < this.core.cars.length; i++) {
      var car = this.core.cars[i];
      var color;
      if (cfg.mode === 'duel') color = car.spec.color;
      else if (car.isPlayer) color = playerSpec.color;
      else color = C.aiColors[(i - 1) % C.aiColors.length];
      this.carViews.push(new RACER.CarView(this.scene, car.spec, color));
    }

    this.hud.setupMinimap(this.track.data);
    this.hud.show();
    this.state = 'racing';
    this.paused = false;
    this.finishTimer = -1;
    // 延续当前视角设置（车内视角需隐藏新车模的座舱罩）
    if (this.carViews[0]) this.carViews[0].setCockpit(this.camMode === 'cockpit');
    document.getElementById('results').classList.add('hidden');
  },

  _clearRace: function () {
    if (this.track) { this.track.dispose(); this.track = null; }
    for (var i = 0; i < this.carViews.length; i++) this.carViews[i].dispose();
    this.carViews = [];
    this.core = null;
    this.hud.hide();
  },

  backToMenu: function () {
    this._clearRace();
    this.state = 'menu';
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
  },

  _onAction: function (a) {
    if (a === 'mute') { this.audio.toggleMute(); return; }
    if (a === 'camera') {
      this.camMode = this.camMode === 'chase' ? 'cockpit' : 'chase';
      if (this.carViews[0]) this.carViews[0].setCockpit(this.camMode === 'cockpit');
      this.hud.showMessage(this.camMode === 'chase' ? '车外视角' : '车内视角', '#7dff5a', 1200);
      return;
    }
    if (this.state !== 'racing') return;
    if (a === 'reset' && !this.paused && this.core && this.core.state === 'racing') {
      this.core.resetPlayerToTrack();
      this.hud.showMessage('已重置回赛道', '#ffcc66', 1200);
    } else if (a === 'pause' && this.core && this.core.state !== 'finished') {
      this.paused = !this.paused;
      document.getElementById('pause').classList.toggle('hidden', !this.paused);
      if (this.paused) this.audio.setEngine(0, false, false);
    }
  },

  /* ================= 主循环 ================= */

  _loop: function () {
    requestAnimationFrame(this._loop);
    var dt = Math.min(this.clock.getDelta(), 1 / 20);   // 掉帧保护

    if (this.state === 'menu' || !this.core) { this.renderer.render(this.scene, this.camera); return; }
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }

    // ---- 逻辑 ----
    var duel = this.raceConfig && this.raceConfig.mode === 'duel';
    this.core.setPlayerInput(this.input.read(), 0);
    if (duel) this.core.setPlayerInput(this.input2.read(), 1);
    var events = this.core.step(dt);
    this._handleEvents(events);

    // ---- 视觉同步 ----
    var q = null;
    for (var i = 0; i < this.core.cars.length; i++) {
      var car = this.core.cars[i];
      q = this.track.data.query(car.state.x, car.state.z, car.lastIndex);
      var inp;
      if (car.playerSlot === 1) inp = this.input2.read();
      else if (car.isPlayer) inp = this.input.read();
      else inp = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };
      this.carViews[i].update(car.state, inp, Math.abs(q.lateral) > this.track.data.halfWidth, dt);
    }

    if (this.camShake > 0) this.camShake -= dt;

    // ---- 渲染（双人模式上下分屏） ----
    var w = window.innerWidth, h = window.innerHeight;
    if (duel) {
      var asp = w / (h / 2);
      if (Math.abs(this.camera.aspect - asp) > 0.01) {
        this.camera.aspect = asp; this.camera.updateProjectionMatrix();
        this.camera2.aspect = asp; this.camera2.updateProjectionMatrix();
      }
      this.renderer.setScissorTest(true);
      this._updateCameraFor(0, this.camera, dt);
      this.renderer.setViewport(0, h / 2, w, h / 2);
      this.renderer.setScissor(0, h / 2, w, h / 2);
      this.renderer.render(this.scene, this.camera);
      this._updateCameraFor(1, this.camera2, dt);
      this.renderer.setViewport(0, 0, w, h / 2);
      this.renderer.setScissor(0, 0, w, h / 2);
      this.renderer.render(this.scene, this.camera2);
      this.renderer.setScissorTest(false);
    } else {
      var asp2 = w / h;
      if (Math.abs(this.camera.aspect - asp2) > 0.01) {
        this.camera.aspect = asp2; this.camera.updateProjectionMatrix();
      }
      this._updateCameraFor(0, this.camera, dt);
      this.renderer.render(this.scene, this.camera);
    }

    // 阴影相机跟随玩家（覆盖世界坐标）
    var pst = this.core.cars[0].state;
    this.sun.position.set(pst.x + 110, 87, pst.z + 55);
    this.sun.target.position.set(pst.x, 0, pst.z);
    this.sun.target.updateMatrixWorld();

    this.hud.update(this.core, this.carViews);

    // 引擎声跟随玩家
    var player = this.core.cars[0];
    this.audio.setEngine(
      RACER.Utils.clamp(player.state.speed / (player.spec.topSpeed * player.spec.nitroFactor), 0, 1),
      this.input.read().nitro && player.nitro > 0,
      this.core.state === 'racing');

    // 结算面板延迟弹出（留 1.6s 看冲线）
    if (this.core.state === 'finished' && this.finishTimer > 0) {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0) this._showResults();
    }
  },

  _handleEvents: function (events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.type) {
        case 'count':
          this.hud.showMessage(String(e.n), '#ffffff', 900);
          this.audio.beep(440, 0.15);
          break;
        case 'go':
          this.hud.showMessage('GO!', '#7dff5a', 1200);
          this.audio.beep(880, 0.35);
          break;
        case 'lap':
          if (e.car.isPlayer) {
            if (e.lap >= this.core.totalLaps) break;
            var msg = e.lap === this.core.totalLaps - 1 ? '最后一圈！' : '第 ' + (e.lap + 1) + ' 圈';
            this.hud.showMessage(msg, '#ffd34d', 1500);
            this.audio.beep(660, 0.2);
          }
          break;
        case 'wall':
          if (e.car.isPlayer) { this.audio.thud(0.2); this.camShake = 0.35; }
          break;
        case 'unstuck':
          if (e.car.isPlayer) this.hud.showMessage('已自动脱困', '#7dff5a', 1500);
          break;
        case 'bump':
          if (e.a.isPlayer || e.b.isPlayer) { this.audio.thud(0.1); this.camShake = 0.2; }
          break;
        case 'finish':
          if (e.car.isPlayer) {
            var prefix = (this.raceConfig && this.raceConfig.mode === 'duel') ? e.car.name + ' ' : '';
            this.hud.showMessage(prefix + '冲线！', '#7dff5a', 2000);
            this.finishTimer = 1.6;
          }
          break;
        case 'raceover':
          break;
      }
    }
  },

  /* ================= 相机（支持双人分屏） ================= */
  _updateCameraFor: function (idx, cam, dt) {
    var player = this.core.cars[idx];
    if (!player) return;
    var st = player.state;
    var U = RACER.Utils;
    var sin = Math.sin(st.heading), cos = Math.cos(st.heading);
    var inp = (idx === 0) ? this.input.read()
      : (this.input2 ? this.input2.read() : { nitro: false });

    // ---- 车内第一人称视角 ----
    if (this.camMode === 'cockpit') {
      cam.position.set(st.x + sin * 0.4, 0.98, st.z + cos * 0.4);
      cam.lookAt(st.x + sin * 30, 0.8, st.z + cos * 30);
      if (this.camShake > 0) {
        cam.position.x += (Math.random() - 0.5) * this.camShake * 0.6;
        cam.position.y += (Math.random() - 0.5) * this.camShake * 0.6;
      }
      if (Math.abs(cam.fov - 70) > 0.1) {
        cam.fov = 70;
        cam.updateProjectionMatrix();
      }
      return;
    }

    // ---- 车外追尾视角 ----
    // 相机目标点：车尾后上方，随速度微微拉远
    var dist = 8.5 + st.speed * 0.06;
    var height = 3.4 + st.speed * 0.012;
    var tx = st.x - sin * dist, tz = st.z - cos * dist, ty = height;

    // 首帧/切场景距离过远时直接吸附，避免从菜单位置长距离滑移
    var ddx = cam.position.x - tx, ddz = cam.position.z - tz;
    if (ddx * ddx + ddz * ddz > 2500) cam.position.set(tx, ty, tz);

    var lam = 6;
    cam.position.x = U.damp(cam.position.x, tx, lam, dt);
    cam.position.y = U.damp(cam.position.y, ty, lam, dt);
    cam.position.z = U.damp(cam.position.z, tz, lam, dt);

    // 撞墙抖动
    if (this.camShake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.camShake;
      cam.position.y += (Math.random() - 0.5) * this.camShake;
    }

    cam.lookAt(st.x + sin * 7, 1.2, st.z + cos * 7);

    // 氮气视野冲击
    var boosting = inp.nitro && player.nitro > 0 && this.core.state === 'racing';
    var targetFov = boosting ? 74 : 62;
    if (Math.abs(cam.fov - targetFov) > 0.1) {
      cam.fov = U.damp(cam.fov, targetFov, 4, dt);
      cam.updateProjectionMatrix();
    }
  },

  /* ================= 结算 ================= */
  _showResults: function () {
    var U = RACER.Utils, core = this.core;
    var panel = document.getElementById('results');
    var title = document.getElementById('results-title');
    var body = document.getElementById('results-body');
    var player = core.cars[0];

    if (core.mode === 'race') {
      var standings = core.getStandings();
      var rank = standings.indexOf(player) + 1;
      title.textContent = rank === 1 ? '🏆 冠军！' : '完赛 —— 第 ' + rank + ' 名';
      var html = '<table><tr><th>名次</th><th>车手</th><th>赛车</th><th>最佳圈速</th><th>总时间</th></tr>';
      for (var i = 0; i < standings.length; i++) {
        var c = standings[i];
        html += '<tr' + (c.isPlayer ? ' class="hl"' : '') + '><td>' + (i + 1) + '</td><td>' + c.name +
          '</td><td>' + c.spec.name + '</td><td>' + U.formatTime(c.bestLap) +
          '</td><td>' + (c.finished ? U.formatTime(c.finishTime) : '未完赛') + '</td></tr>';
      }
      body.innerHTML = html + '</table>';
    } else if (core.mode === 'duel') {
      var duelStandings = core.getStandings();
      title.textContent = '🏆 ' + duelStandings[0].name + ' 获胜！';
      var duelHtml = '<table><tr><th>名次</th><th>车手</th><th>赛车</th><th>最佳圈速</th><th>总时间</th></tr>';
      for (var d = 0; d < duelStandings.length; d++) {
        var dc = duelStandings[d];
        duelHtml += '<tr' + (d === 0 ? ' class="hl"' : '') + '><td>' + (d + 1) + '</td><td>' + dc.name +
          '</td><td>' + dc.spec.name + '</td><td>' + U.formatTime(dc.bestLap) +
          '</td><td>' + (dc.finished ? U.formatTime(dc.finishTime) : '未完赛') + '</td></tr>';
      }
      body.innerHTML = duelHtml + '</table>';
    } else {
      title.textContent = '计时赛成绩';
      var key = 'turborush_best_' + this.raceConfig.trackIdx + '_' + this.raceConfig.carIdx;
      var record = null;
      try {
        var old = parseFloat(localStorage.getItem(key));
        if (player.bestLap && (!isFinite(old) || player.bestLap < old)) {
          localStorage.setItem(key, String(player.bestLap));
          record = '新纪录！';
        } else if (isFinite(old)) {
          record = '历史最佳 ' + U.formatTime(old);
        }
      } catch (err) { /* file:// 下 localStorage 可能不可用，忽略 */ }
      body.innerHTML = '<p class="big-best">最佳圈速 ' + U.formatTime(player.bestLap) + '</p>' +
        '<p>总时间 ' + U.formatTime(player.finishTime) + '</p>' +
        (record ? '<p class="record">' + record + '</p>' : '');
    }
    panel.classList.remove('hidden');
  }
};
