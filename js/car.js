/* =========================================================
 * car.js —— 赛车视觉层
 * 低多边形盒体拼装车模（车身/座舱/尾翼/四轮），
 * 前轮随转向偏摆、四轮随车速滚动；
 * 漂移时后轮冒烟（Sprite 粒子池），氮气时尾部喷焰。
 * 阴影采用"贴片假阴影"（径向渐变贴图），零性能开销。
 * ========================================================= */
window.RACER = window.RACER || {};

/* 共享粒子贴图（懒加载一次） */
RACER._smokeTex = null;
RACER._flameTex = null;
RACER._shadowTex = null;

RACER._makeRadialTex = function (inner, outer) {
  var cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  var ctx = cv.getContext('2d');
  var g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
};

/**
 * @param {THREE.Scene} scene
 * @param {Object} spec   车辆参数（config.cars 项）
 * @param {number} color  车身颜色
 */
RACER.CarView = function (scene, spec, color) {
  this.scene = scene;
  this.spec = spec;
  this.colorHex = ('000000' + color.toString(16)).slice(-6);
  this.group = new THREE.Group();
  scene.add(this.group);

  if (!RACER._smokeTex) {
    RACER._smokeTex = RACER._makeRadialTex('rgba(220,220,220,0.55)', 'rgba(220,220,220,0)');
    RACER._flameTex = RACER._makeRadialTex('rgba(255,190,60,0.95)', 'rgba(255,80,0,0)');
    RACER._shadowTex = RACER._makeRadialTex('rgba(0,0,0,0.42)', 'rgba(0,0,0,0)');
  }

  /* ---------- 车模（GT/耐力赛风格：低趴车身 + 碳纤大尾翼 + 涂装条纹） ---------- */
  // hex 颜色按 sRGB→线性 转换（否则渲染输出时会系统性发白）
  var srgb = function (hex) { return new THREE.Color(hex).convertSRGBToLinear(); };

  // 车身涂装贴图：底色 + 双 racing 条纹（经线方向贯穿车身顶部）
  function makeLivery(hexColor) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#' + ('000000' + hexColor.toString(16)).slice(-6);
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(245,248,252,0.92)';
    [0.125, 0.625].forEach(function (u) { ctx.fillRect(u * 512 - 13, 0, 26, 256); });
    ctx.fillStyle = 'rgba(20,24,30,0.85)';
    [0.375, 0.875].forEach(function (u) { ctx.fillRect(u * 512 - 9, 0, 18, 256); });
    var g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  var paint = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: makeLivery(color), metalness: 0.15, roughness: 0.38,
    clearcoat: 1.0, clearcoatRoughness: 0.16, envMapIntensity: 0.45
  });
  var glass = new THREE.MeshPhysicalMaterial({
    color: srgb(0x0a0e13), metalness: 0.1, roughness: 0.08,
    clearcoat: 0.8, envMapIntensity: 1.1
  });
  var carbon = new THREE.MeshPhysicalMaterial({
    color: srgb(0x101318), metalness: 0.5, roughness: 0.42, envMapIntensity: 0.9
  });
  var chrome = new THREE.MeshPhysicalMaterial({
    color: srgb(0xd6d9de), metalness: 1.0, roughness: 0.16, envMapIntensity: 1.5
  });

  // 主车体（低趴修长）
  var body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), paint);
  body.scale.set(0.92, 0.34, 2.15);
  body.position.y = 0.5;
  body.castShadow = true;

  // 车头（收窄下压的独立车鼻）
  var nose = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), paint);
  nose.scale.set(0.55, 0.2, 0.78);
  nose.position.set(0, 0.42, 1.72);
  nose.castShadow = true;

  // 座舱（后掠气泡玻璃）
  var cabin = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), glass);
  cabin.scale.set(0.5, 0.2, 0.78);
  cabin.position.set(0, 0.75, -0.05);
  cabin.castShadow = true;
  this.cabin = cabin;   // 车内视角时需要隐藏

  // 引擎盖进气口
  var hoodIntake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.55), carbon);
  hoodIntake.position.set(0, 0.7, 0.85);

  // 侧箱（车身两侧导流结构）
  var podGeo = new THREE.BoxGeometry(0.26, 0.24, 1.5);
  var podL = new THREE.Mesh(podGeo, carbon);
  podL.position.set(-0.86, 0.4, -0.15);
  var podR = podL.clone();
  podR.position.x = 0.86;

  // 前唇分流器
  var splitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.7), carbon);
  splitter.position.set(0, 0.2, 2.0);
  splitter.castShadow = true;

  // 尾部扩散器（上翘）
  var diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.55), carbon);
  diffuser.position.set(0, 0.32, -2.02);
  diffuser.rotation.x = -0.32;

  // 大尾翼（双支柱 + 端板）
  var wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.5), carbon);
  wing.position.set(0, 1.06, -1.92);
  wing.rotation.x = 0.22;
  wing.castShadow = true;
  var epGeo = new THREE.BoxGeometry(0.05, 0.34, 0.58);
  var epL = new THREE.Mesh(epGeo, carbon);
  epL.position.set(-0.9, 1.0, -1.92);
  var epR = epL.clone();
  epR.position.x = 0.9;
  var pyGeo = new THREE.BoxGeometry(0.07, 0.44, 0.28);
  var pyL = new THREE.Mesh(pyGeo, carbon);
  pyL.position.set(-0.4, 0.82, -1.92);
  var pyR = pyL.clone();
  pyR.position.x = 0.4;

  // 细长 LED 大灯
  var hlMat = new THREE.MeshBasicMaterial({ color: srgb(0xfffbe0) });
  var hlGeo = new THREE.BoxGeometry(0.34, 0.05, 0.08);
  var hlL = new THREE.Mesh(hlGeo, hlMat);
  hlL.position.set(-0.26, 0.5, 2.06);
  var hlR = hlL.clone();
  hlR.position.x = 0.26;

  // 贯穿式尾灯
  var tail = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.06),
    new THREE.MeshBasicMaterial({ color: srgb(0xff2018) }));
  tail.position.set(0, 0.56, -2.12);

  // 中置双出排气
  var exhGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.26, 10).rotateX(Math.PI / 2);
  var exhL = new THREE.Mesh(exhGeo, chrome);
  exhL.position.set(-0.18, 0.36, -2.1);
  var exhR = exhL.clone();
  exhR.position.x = 0.18;

  // 后视镜（细杆）
  var mirL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.1), carbon);
  mirL.position.set(-0.95, 0.72, 0.55);
  var mirR = mirL.clone();
  mirR.position.x = 0.95;

  this.group.add(body, nose, cabin, hoodIntake, podL, podR, splitter, diffuser,
    wing, epL, epR, pyL, pyR, hlL, hlR, tail, exhL, exhR, mirL, mirR);

  /* ---------- 车轮（转向枢轴 + 滚动，合金轮毂） ---------- */
  var tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 20);
  tireGeo.rotateZ(Math.PI / 2);
  var rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 16);
  rimGeo.rotateZ(Math.PI / 2);
  var capGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.34, 10);
  capGeo.rotateZ(Math.PI / 2);
  var spokeGeo = new THREE.BoxGeometry(0.33, 0.3, 0.05);
  var tireMat = new THREE.MeshPhysicalMaterial({
    color: srgb(0x0e0e0f), metalness: 0.1, roughness: 0.75, envMapIntensity: 0.3
  });
  var rimMat = new THREE.MeshPhysicalMaterial({
    color: srgb(0xc9cdd3), metalness: 1.0, roughness: 0.22, envMapIntensity: 1.4
  });
  var capMat = new THREE.MeshPhysicalMaterial({
    color: srgb(color), metalness: 0.6, roughness: 0.3, envMapIntensity: 1.2
  });
  this.wheels = [];
  var positions = [[-0.82, 1.4, true], [0.82, 1.4, true], [-0.84, -1.4, false], [0.84, -1.4, false]];
  for (var i = 0; i < 4; i++) {
    var pivot = new THREE.Group();
    pivot.position.set(positions[i][0], 0.36, positions[i][1]);
    var wheel = new THREE.Mesh(tireGeo, tireMat);
    wheel.castShadow = true;
    // 合金轮毂：辐条绕轴排列，随车轮一起转动
    var rim = new THREE.Mesh(rimGeo, rimMat);
    wheel.add(rim);
    var cap = new THREE.Mesh(capGeo, capMat);
    wheel.add(cap);
    for (var s = 0; s < 5; s++) {
      var spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (s / 5) * Math.PI * 2;
      spoke.position.y = Math.cos((s / 5) * Math.PI * 2) * 0.15;
      spoke.position.z = Math.sin((s / 5) * Math.PI * 2) * 0.15;
      wheel.add(spoke);
    }
    pivot.add(wheel);
    this.group.add(pivot);
    this.wheels.push({ pivot: pivot, wheel: wheel, front: positions[i][2], spin: 0 });
  }

  /* ---------- 贴片假阴影（真实阴影的补强，减淡） ---------- */
  var shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 5.2),
    new THREE.MeshBasicMaterial({
      map: RACER._shadowTex, transparent: true, opacity: 0.5, depthWrite: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  this.group.add(shadow);

  /* ---------- 烟雾粒子池 ---------- */
  this.smoke = [];
  for (i = 0; i < 26; i++) {
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: RACER._smokeTex, transparent: true, opacity: 0, depthWrite: false
    }));
    sp.visible = false;
    scene.add(sp);
    this.smoke.push({ sprite: sp, life: 0, vx: 0, vy: 0, vz: 0 });
  }
  this.smokeAcc = 0;

  /* ---------- 氮气火焰 ---------- */
  this.flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: RACER._flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  this.flame.position.set(0, 0.45, -2.1);
  this.flame.visible = false;
  this.group.add(this.flame);
};

RACER.CarView.prototype = {

  /** 车内视角：隐藏座舱玻璃罩，让出驾驶视线 */
  setCockpit: function (on) {
    if (this.cabin) this.cabin.visible = !on;
  },

  /**
   * 每帧同步视觉。
   * @param {Object} st      车辆物理状态
   * @param {Object} input   本帧输入（用于前轮偏摆/喷焰）
   * @param {boolean} offroad
   */
  update: function (st, input, offroad, dt) {
    this.group.position.set(st.x, 0, st.z);
    this.group.rotation.y = st.heading;
    // 漂移时车身侧倾一点点，更有动感
    this.group.rotation.z = RACER.Utils.damp(this.group.rotation.z, -input.steer * 0.04, 8, dt);

    for (var i = 0; i < 4; i++) {
      var w = this.wheels[i];
      w.spin += st.vF * dt / 0.38;
      w.wheel.rotation.x = w.spin;
      if (w.front) w.pivot.rotation.y = input.steer * 0.42;
    }

    // 氮气火焰（随机闪烁）
    var boosting = input.nitro && st.vF > 5;
    this.flame.visible = boosting;
    if (boosting) {
      var s = 0.7 + Math.random() * 0.5;
      this.flame.scale.set(s, s * 1.4, 1);
    }

    // 漂移 / 草地打滑 → 冒烟
    var smoking = (st.drifting || (offroad && st.speed > 10));
    if (smoking) {
      this.smokeAcc += dt * 40;
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        this._emitSmoke(st);
      }
    }
    this._updateSmoke(dt);
  },

  _emitSmoke: function (st) {
    for (var i = 0; i < this.smoke.length; i++) {
      var p = this.smoke[i];
      if (p.life <= 0) {
        // 在后轮附近生成
        var side = Math.random() < 0.5 ? -1 : 1;
        var sin = Math.sin(st.heading), cos = Math.cos(st.heading);
        var lx = side * 0.95, lz = -1.35;
        p.sprite.position.set(
          st.x + cos * lx + sin * lz, 0.3,
          st.z - sin * lx + cos * lz
        );
        p.life = 0.55 + Math.random() * 0.25;
        p.maxLife = p.life;
        p.vx = (Math.random() - 0.5) * 2;
        p.vy = 2.2 + Math.random() * 1.5;
        p.vz = (Math.random() - 0.5) * 2;
        p.sprite.visible = true;
        return;
      }
    }
  },

  _updateSmoke: function (dt) {
    for (var i = 0; i < this.smoke.length; i++) {
      var p = this.smoke[i];
      if (p.life > 0) {
        p.life -= dt;
        var k = Math.max(p.life / p.maxLife, 0);
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.y += p.vy * dt;
        p.sprite.position.z += p.vz * dt;
        var s = 1 + (1 - k) * 2.2;
        p.sprite.scale.set(s, s, 1);
        p.sprite.material.opacity = k * 0.5;
        if (p.life <= 0) p.sprite.visible = false;
      }
    }
  },

  dispose: function () {
    this.scene.remove(this.group);
    for (var i = 0; i < this.smoke.length; i++) this.scene.remove(this.smoke[i].sprite);
  }
};
