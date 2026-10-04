/* =========================================================
 * track.js —— 赛道视觉层（Three.js 场景搭建）
 * 基于 TrackData 的采样点生成：
 *   路面（程序化沥青贴图）、土路肩、起点棋盘格、护墙（红白条纹）、
 *   草地、树木/灌木/岩石、远山环、看台、广告牌、弯道轮胎堆、
 *   起点龙门架、天空与雾由 game.js 管理。
 * 所有贴图均由 Canvas 程序生成，无外部图片资源，
 * 因此 file:// 协议直接打开也不会触发跨域问题。
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.Track = function (scene, trackDef) {
  this.scene = scene;
  this.def = trackDef;
  this.data = new RACER.TrackData(trackDef.points, trackDef.halfWidth);
  this.group = new THREE.Group();
  scene.add(this.group);

  this._buildGround();
  this._buildShoulder();
  this._buildRoad();
  this._buildStartLine();
  this._buildCurbs();
  this._buildWalls();
  this._buildGantry();
  this._buildTrees(trackDef.treeCount || 120);
  this._buildBushes();
  this._buildPowerLines();
  this._buildRidges();
  this._buildGrandstands();
  this._buildBillboards();
  this._buildTireStacks();
};

RACER.Track.prototype = {

  /* ---------- 颜色/贴图工具 ---------- */
  // hex 颜色按 sRGB→线性 转换（否则渲染输出时系统性发白）
  _col: function (hex) { return new THREE.Color(hex).convertSRGBToLinear(); },

  /**
   * 净距检查：世界坐标 (x,z) 是否离赛道【所有】路段都足够远。
   * 赛道是闭环，相邻路段可能贴得很近——路侧物若只按自己那一段偏移，
   * 会落到另一段赛道路面上。所有路侧物放置前都必须过这一关。
   * @param {number} margin 相对路缘的额外净距（米）
   */
  _clearOfTrack: function (x, z, margin) {
    var s = this.data.samples, N = this.data.N;
    var min = this.data.halfWidth + margin;
    var minD2 = min * min;
    for (var i = 0; i < N; i++) {
      var dx = x - s[i].pos.x, dz = z - s[i].pos.z;
      if (dx * dx + dz * dz < minD2) return false;
    }
    return true;
  },

  /* ---------- 程序化贴图 ---------- */
  _canvasTexture: function (w, h, draw, repeatX, repeatY) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (repeatX) tex.repeat.set(repeatX, repeatY);
    return tex;
  },

  /* ---------- 草地（暖调 + 割草条纹） ---------- */
  _buildGround: function () {
    var tex = this._canvasTexture(512, 512, function (ctx, w, h) {
      ctx.fillStyle = '#579244'; ctx.fillRect(0, 0, w, h);
      // 割草条纹（宽窄交替的明暗带，很淡）
      for (var s = 0; s < 8; s++) {
        ctx.fillStyle = s % 2 ? 'rgba(255,255,210,0.035)' : 'rgba(20,60,20,0.045)';
        ctx.fillRect(s * (w / 8), 0, w / 8, h);
      }
      // 大块深浅草斑（自然色块）
      for (var i = 0; i < 60; i++) {
        var x = Math.random() * w, y = Math.random() * h;
        var r = 20 + Math.random() * 60;
        var g = ctx.createRadialGradient(x, y, 2, x, y, r);
        var c = Math.random() < 0.5 ? 'rgba(72,132,52,0.5)' : 'rgba(122,180,86,0.45)';
        g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      // 细碎草叶噪点
      for (i = 0; i < 2600; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(64,122,46,0.55)' : 'rgba(132,188,102,0.5)';
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 3);
      }
    }, 60, 60);
    // 顶点色：大尺度草色起伏，打破贴图平铺感
    var geo = new THREE.PlaneGeometry(3400, 3400, 48, 48);
    var posAttr = geo.attributes.position;
    var colors = [];
    for (var vi = 0; vi < posAttr.count; vi++) {
      var vx = posAttr.getX(vi), vz = posAttr.getZ(vi);
      var nv = Math.sin(vx * 0.011 + 1.7) * Math.cos(vz * 0.009 + 0.6) +
        0.5 * Math.sin(vx * 0.023 + 0.4) * Math.sin(vz * 0.019 + 2.1);
      var v = 0.86 + 0.11 * nv;
      colors.push(v, v, v * 0.97);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    var ground = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ map: tex, vertexColors: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.group.add(ground);
  },

  /* ---------- 通用：沿赛道展开的带状几何 ---------- */
  _ribbonGeometry: function (latOffset, y, vScale) {
    var td = this.data, N = td.N, hw = td.halfWidth + latOffset;
    var pos = [], uv = [], idx = [];
    var cum = 0;
    for (var i = 0; i <= N; i++) {
      var s = td.samples[i % N];
      if (i > 0) {
        var p = td.samples[(i - 1) % N];
        if (i < N) cum += Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
        else cum = td.length;
      }
      pos.push(s.pos.x - s.rx * hw, y, s.pos.z - s.rz * hw);
      pos.push(s.pos.x + s.rx * hw, y, s.pos.z + s.rz * hw);
      uv.push(0, cum / vScale, 1, cum / vScale);
    }
    for (i = 0; i < N; i++) {
      var a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  },

  /* ---------- 土路肩（紧贴路面两侧的沙土带） ---------- */
  _buildShoulder: function () {
    var tex = this._canvasTexture(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#a8916b'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 700; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(140,118,84,0.6)' : 'rgba(196,176,138,0.6)';
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }, 1, 1);
    tex.repeat.set(8, this.data.length / 10);
    var mesh = new THREE.Mesh(
      this._ribbonGeometry(2.6, -0.03, 10),
      new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);
  },

  /* ---------- 路面 ---------- */
  _buildRoad: function () {
    var tex = this._canvasTexture(512, 512, function (ctx, w, h) {
      ctx.fillStyle = '#41444b'; ctx.fillRect(0, 0, w, h);
      // 沥青颗粒
      for (var i = 0; i < 5200; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(56,58,64,0.7)' : 'rgba(78,82,90,0.6)';
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      // 两条行车磨亮带（细微）
      ctx.fillStyle = 'rgba(30,32,36,0.22)';
      ctx.fillRect(w * 0.22, 0, w * 0.13, h);
      ctx.fillRect(w * 0.65, 0, w * 0.13, h);
      // 两侧白实线
      ctx.fillStyle = '#eef0f2';
      ctx.fillRect(14, 0, 9, h); ctx.fillRect(w - 23, 0, 9, h);
      // 中央双黄虚线
      ctx.fillStyle = '#f0c814';
      ctx.fillRect(w / 2 - 9, 30, 6, 130); ctx.fillRect(w / 2 + 3, 30, 6, 130);
      ctx.fillRect(w / 2 - 9, 286, 6, 130); ctx.fillRect(w / 2 + 3, 286, 6, 130);
    });

    var road = new THREE.Mesh(
      this._ribbonGeometry(0, 0.0, 18),
      new THREE.MeshStandardMaterial({
        map: tex, side: THREE.DoubleSide,
        roughness: 0.82, metalness: 0.0, envMapIntensity: 0.4
      })
    );
    road.receiveShadow = true;
    this.group.add(road);
  },

  /* ---------- 起点线 ---------- */
  _buildStartLine: function () {
    var tex = this._canvasTexture(128, 32, function (ctx, w, h) {
      for (var x = 0; x < 16; x++) for (var y = 0; y < 4; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#141414' : '#f4f4f4';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    });
    var td = this.data, hw = td.halfWidth;
    var c = td.pointAt(0), t = td.tangentAt(0);
    var line = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 3.2),
      new THREE.MeshPhongMaterial({ map: tex, shininess: 6 })
    );
    line.rotation.x = -Math.PI / 2;
    // Euler XYZ 下先绕自身 z 转再放平：正号才能让线宽轴严格垂直于切线
    line.rotation.z = Math.atan2(t.x, t.z);
    line.position.set(c.x, 0.02, c.z);
    line.receiveShadow = true;
    this.group.add(line);
  },

  /* ---------- 护墙 ---------- */
  _buildWalls: function () {
    var tex = this._canvasTexture(64, 16, function (ctx, w, h) {
      ctx.fillStyle = '#c8342a'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, w / 2, h);
      // 做旧污渍
      for (var i = 0; i < 30; i++) {
        ctx.fillStyle = 'rgba(70,60,50,0.18)';
        ctx.fillRect(Math.random() * w, Math.random() * h, 3, 2);
      }
    });

    for (var side = -1; side <= 1; side += 2) {
      var geo = this._wallGeometry(side);
      var mesh = new THREE.Mesh(geo,
        new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  },

  _wallGeometry: function (side) {
    var td = this.data, N = td.N;
    var off = td.halfWidth + 1.6, hgt = 1.15;
    var pos = [], uv = [], idx = [], cum = 0;
    for (var i = 0; i <= N; i++) {
      var s = td.samples[i % N];
      if (i > 0) {
        var p = td.samples[(i - 1) % N];
        cum = (i < N) ? cum + Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z) : td.length;
      }
      var bx = s.pos.x + s.rx * off * side, bz = s.pos.z + s.rz * off * side;
      pos.push(bx, 0, bz); pos.push(bx, hgt, bz);
      uv.push(cum / 6, 0, cum / 6, 1);
    }
    for (i = 0; i < N; i++) {
      var a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  },

  /* ---------- 起点龙门架（横幅写字） ---------- */
  _buildGantry: function () {
    var td = this.data, hw = td.halfWidth;
    var c = td.pointAt(0), n = td.normalAt(0), t = td.tangentAt(0);
    var mat = new THREE.MeshPhongMaterial({ color: 0x33414f, shininess: 30 });
    for (var side = -1; side <= 1; side += 2) {
      var post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 9.6, 0.55), mat);
      post.position.set(c.x + n.x * (hw + 3.8) * side, 4.8, c.z + n.z * (hw + 3.8) * side);
      post.castShadow = true;
      this.group.add(post);
    }
    var bannerTex = this._canvasTexture(768, 128, function (ctx, w, h) {
      ctx.fillStyle = '#20303f'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#141d26'; ctx.fillRect(0, 0, w, 12); ctx.fillRect(0, h - 12, w, 12);
      ctx.font = 'italic 900 58px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ff9a2e';
      ctx.fillText('TURBO RUSH 极速狂飙', w / 2, h / 2 + 2);
    });
    var banner = new THREE.Mesh(new THREE.BoxGeometry((hw + 3.8) * 2, 1.9, 0.35),
      new THREE.MeshLambertMaterial({ map: bannerTex }));
    banner.position.set(c.x, 8.4, c.z);
    banner.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
    banner.castShadow = true;
    this.group.add(banner);
  },

  /* ---------- 树木（交叉面片 + 手绘镂空贴图，接近真实树形） ---------- */
  _treeTexture: function (kind) {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 512;
    var ctx = cv.getContext('2d');
    var cx = 128;
    if (kind === 0) {
      // 针叶树（松）：分层枝叶
      ctx.fillStyle = '#54401f';
      ctx.beginPath();
      ctx.moveTo(cx - 9, 512); ctx.lineTo(cx - 3, 300);
      ctx.lineTo(cx + 3, 300); ctx.lineTo(cx + 9, 512);
      ctx.closePath(); ctx.fill();
      for (var i = 0; i < 6; i++) {
        var ly = 442 - i * 64;
        var lw = 116 - i * 16;
        var g = ctx.createLinearGradient(cx - lw, ly - 90, cx + lw, ly);
        g.addColorStop(0, '#24471f');
        g.addColorStop(0.55, '#3a702c');
        g.addColorStop(1, '#1d3b1a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, ly - 128);
        ctx.lineTo(cx + lw, ly);
        ctx.lineTo(cx - lw, ly);
        ctx.closePath(); ctx.fill();
      }
    } else {
      // 阔叶树：树干 + 不规则团状树冠（无整体椭圆底，边缘破碎自然）
      ctx.fillStyle = '#5f4626';
      ctx.beginPath();
      ctx.moveTo(118, 512); ctx.lineTo(122, 330);
      ctx.lineTo(136, 330); ctx.lineTo(140, 512);
      ctx.closePath(); ctx.fill();
      for (var i = 0; i < 150; i++) {
        var a = Math.random() * Math.PI * 2;
        var r = Math.pow(Math.random(), 0.7) * 88;
        var bx = cx + Math.cos(a) * r * 1.05;
        var by = 195 + Math.sin(a) * r * 0.68;
        var tone = Math.random();
        ctx.fillStyle = tone < 0.34 ? '#2b5723' :
          tone < 0.68 ? '#3a702c' : tone < 0.9 ? '#4c8a38' : '#5d9c44';
        ctx.beginPath();
        ctx.arc(bx, by, 9 + Math.random() * 16, 0, Math.PI * 2);
        ctx.fill();
      }
      // 树冠底部暗部（体积感）
      for (i = 0; i < 30; i++) {
        var bx2 = cx + (Math.random() - 0.5) * 170;
        var by2 = 250 + Math.random() * 40;
        ctx.fillStyle = 'rgba(24,48,20,0.55)';
        ctx.beginPath();
        ctx.arc(bx2, by2, 10 + Math.random() * 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  },

  _buildTrees: function (count) {
    var td = this.data;
    // 两种树形贴图 + 对应的镂空深度材质（让树影也是树形）
    var kinds = [this._treeTexture(0), this._treeTexture(1)];
    var mats = [], depthMats = [];
    for (var k = 0; k < kinds.length; k++) {
      mats.push(new THREE.MeshLambertMaterial({
        map: kinds[k], alphaTest: 0.5, side: THREE.DoubleSide
      }));
      depthMats.push(new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking, map: kinds[k], alphaTest: 0.5
      }));
    }
    var treeGeo = new THREE.PlaneGeometry(9, 16);

    var tmp = {};
    // 簇状分布：真实树林是成片成林的，而不是均匀撒点
    var clusters = Math.max(4, Math.round(count / 6));
    for (var ci = 0; ci < clusters; ci++) {
      var ccx = 0, ccz = 0, ok = false;
      for (var attempt = 0; attempt < 10 && !ok; attempt++) {
        var uu = Math.random();
        var sside = Math.random() < 0.5 ? -1 : 1;
        var llat = td.halfWidth + 14 + Math.random() * 46;
        var pp = td.pointAt(uu, tmp), nn = td.normalAt(uu, {});
        ccx = pp.x + nn.x * llat * sside;
        ccz = pp.z + nn.z * llat * sside;
        ok = this._clearOfTrack(ccx, ccz, 8);
      }
      if (!ok) continue;
      var members = 3 + ((Math.random() * 6) | 0);
      for (var m = 0; m < members; m++) {
        var ang2 = Math.random() * Math.PI * 2;
        var rr = 4 + Math.random() * 26;
        var wx = ccx + Math.cos(ang2) * rr, wz = ccz + Math.sin(ang2) * rr;
        if (!this._clearOfTrack(wx, wz, 3.5)) continue;
        var scale = 0.7 + Math.random() * 0.85;
        var ki = (Math.random() * 2) | 0;
        var rot = Math.random() * Math.PI;
        var tree = new THREE.Group();
        for (var f = 0; f < 2; f++) {
          var plane = new THREE.Mesh(treeGeo, mats[ki]);
          plane.rotation.y = rot + f * Math.PI / 2;
          plane.customDepthMaterial = depthMats[ki];
          plane.castShadow = true;
          tree.add(plane);
        }
        tree.position.set(wx, 8 * scale, wz);
        tree.scale.setScalar(scale);
        this.group.add(tree);
      }
    }
  },

  /* ---------- 灌木（远处点缀，低矮不抢镜） ---------- */
  _buildBushes: function () {
    var td = this.data;
    var geo = new THREE.SphereGeometry(1, 7, 5);
    var mats = [
      new THREE.MeshLambertMaterial({ color: this._col(0x2f5f2a) }),
      new THREE.MeshLambertMaterial({ color: this._col(0x3a6e31) }),
      new THREE.MeshLambertMaterial({ color: this._col(0x447a38) })
    ];
    var tmp = {};
    for (var i = 0; i < 60; i++) {
      for (var attempt = 0; attempt < 6; attempt++) {
        var u = Math.random();
        var side = Math.random() < 0.5 ? -1 : 1;
        var lat = td.halfWidth + 9 + Math.random() * 26;
        var p = td.pointAt(u, tmp), n = td.normalAt(u, {});
        var wx = p.x + n.x * lat * side, wz = p.z + n.z * lat * side;
        if (!this._clearOfTrack(wx, wz, 3)) continue;
        var b = new THREE.Mesh(geo, mats[(Math.random() * 3) | 0]);
        var s = 0.35 + Math.random() * 0.7;
        b.scale.set(s * (1 + Math.random()), s * 0.65, s * (1 + Math.random()));
        b.position.set(wx, s * 0.35, wz);
        b.rotation.y = Math.random() * Math.PI;
        b.castShadow = true;
        this.group.add(b);
        break;
      }
    }
  },

  /* ---------- 远山：全景山脊剪影环（三层大气透视，替代卡通金字塔） ---------- */
  _buildRidges: function () {
    var td = this.data;
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (var i = 0; i < td.N; i++) {
      var p = td.samples[i].pos;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    var cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    var rad = Math.max(maxX - minX, maxZ - minZ) / 2 + 950;

    // 2048 宽全景：三层山脊剪影 + 山脚雾带，山脊以上镂空透出天空
    var W = 2048, H = 512;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');

    // 画一层山脊：baseY 基线、amp 起伏、color 颜色
    function ridge(baseY, amp, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      var y = baseY;
      for (var x = 0; x <= W; x += 16) {
        y += (Math.random() - 0.5) * amp;
        // 偶尔出现尖峰
        var peak = Math.random() < 0.08 ? amp * 1.6 : 0;
        ctx.lineTo(x, Math.min(H - 4, y - peak));
      }
      ctx.lineTo(W, H);
      ctx.closePath(); ctx.fill();
    }
    // 雾状渐变底（山脚与草地衔接）
    var fogBand = ctx.createLinearGradient(0, H * 0.62, 0, H);
    fogBand.addColorStop(0, 'rgba(190,206,220,0)');
    fogBand.addColorStop(1, 'rgba(168,186,178,0.95)');
    ridge(H * 0.52, 26, '#a9bccd');     // 远山（最淡）
    ridge(H * 0.60, 34, '#8aa2b5');     // 中山
    ridge(H * 0.70, 40, '#6b8296');     // 近山（最深）
    ctx.fillStyle = fogBand;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);

    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = THREE.RepeatWrapping;

    var ring = new THREE.Mesh(
      new THREE.CylinderGeometry(rad, rad, 430, 72, 1, true),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.BackSide, fog: false,
        depthWrite: false
      })
    );
    ring.position.set(cx, 175, cz);
    this.group.add(ring);
  },

  /* ---------- 看台（起点直道两侧） ---------- */
  _buildGrandstands: function () {
    var td = this.data, hw = td.halfWidth;
    var c = td.pointAt(0), n = td.normalAt(0), t = td.tangentAt(0);
    var rot = Math.atan2(t.x, t.z);

      // 观众席贴图：一排排座椅 + 成排观众点（低饱和，避免远景闪烁）
    var crowdTex = this._canvasTexture(256, 128, function (ctx, w, h) {
      ctx.fillStyle = '#2c3540'; ctx.fillRect(0, 0, w, h);
      var colors = ['#aab4be', '#c0392b', '#d4ac0d', '#2874a6', '#1e8449', '#ca6f1e', '#95a5a6'];
      var rows = 8;
      for (var r = 0; r < rows; r++) {
        // 座椅台阶横带
        ctx.fillStyle = r % 2 ? '#39434e' : '#333d48';
        ctx.fillRect(0, r * (h / rows), w, h / rows);
        // 成排观众（小圆点，整齐排列）
        for (var x = 4; x < w - 4; x += 6) {
          if (Math.random() < 0.16) continue;   // 少量空座
          ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
          ctx.globalAlpha = 0.7 + Math.random() * 0.3;
          ctx.fillRect(x + (Math.random() - 0.5) * 1.5, r * (h / rows) + 2 + Math.random() * 3, 4, 5);
        }
      }
      ctx.globalAlpha = 1;
    });

    for (var side = -1; side <= 1; side += 2) {
      var stand = new THREE.Group();
      var base = new THREE.Mesh(new THREE.BoxGeometry(26, 1, 9),
        new THREE.MeshLambertMaterial({ color: this._col(0x39414a) }));
      base.position.y = 0.5;
      stand.add(base);
      for (var row = 0; row < 4; row++) {
        var step = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, 2.1),
          new THREE.MeshLambertMaterial({ map: crowdTex }));
        step.position.set(0, 1.4 + row * 1.15, -2.4 + row * 2.0);
        step.castShadow = true;
        stand.add(step);
      }
      var roof = new THREE.Mesh(new THREE.BoxGeometry(27, 0.4, 10),
        new THREE.MeshPhongMaterial({ color: 0x8c3630, shininess: 25 }));
      roof.position.set(0, 6.3, -1.3);
      roof.rotation.x = 0.1;
      roof.castShadow = true;
      stand.add(roof);
      for (row = 0; row < 2; row++) {
        var pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), new THREE.MeshPhongMaterial({ color: 0x33414f, shininess: 30 }));
        pillar.position.set(row === 0 ? -11.5 : 11.5, 3.4, -1.3);
        stand.add(pillar);
      }
      stand.position.set(c.x + n.x * (hw + 17) * side, 0, c.z + n.z * (hw + 17) * side);
      stand.rotation.y = rot + (side > 0 ? Math.PI : 0);
      if (!this._clearOfTrack(stand.position.x, stand.position.z, 3)) continue;
      this.group.add(stand);
    }
  },

  /* ---------- 广告牌（分布在赛道沿线） ---------- */
  _buildBillboards: function () {
    var td = this.data, hw = td.halfWidth;
    var texts = [
      { t: 'NITRO+ 氮气燃油', bg: '#20303f', fg: '#6ee7ff' },
      { t: '闪电轮胎 LIGHTNING', bg: '#f4f4f4', fg: '#d23b2e' },
      { t: '极速驾校 招生中', bg: '#2e6b2e', fg: '#ffe98a' },
      { t: 'TURBO RUSH', bg: '#141414', fg: '#ff9a2e' },
      { t: '漂移公园 DRIFT PARK', bg: '#4a2a5e', fg: '#ffd34d' },
      { t: '弯道见真章', bg: '#b03a2e', fg: '#ffffff' }
    ];
    var us = [0.12, 0.38, 0.63, 0.88];
    var postMat = new THREE.MeshPhongMaterial({ color: this._col(0x33414f), shininess: 30 });
    var tmp = {};
    for (var i = 0; i < us.length; i++) {
      var u = us[i];
      var side = i % 2 === 0 ? 1 : -1;
      var p = td.pointAt(u, tmp), n = td.normalAt(u, tmp), t = td.tangentAt(u, tmp);
      var tex = RACER.Track._billboardTex(texts[i]);
      var panel = new THREE.Mesh(new THREE.BoxGeometry(10.5, 2.8, 0.28),
        new THREE.MeshLambertMaterial({ map: tex }));
      panel.position.y = 5.2;
      panel.castShadow = true;
      var g = new THREE.Group();
      var p1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), postMat);
      p1.position.set(-3.6, 2, 0);
      p1.castShadow = true;
      var p2 = p1.clone(); p2.position.x = 3.6;
      g.add(panel, p1, p2);
      g.position.set(p.x + n.x * (hw + 10) * side, 0, p.z + n.z * (hw + 10) * side);
      g.rotation.y = Math.atan2(t.x, t.z) + (side > 0 ? 0 : Math.PI);
      if (!this._clearOfTrack(g.position.x, g.position.z, 3)) continue;
      this.group.add(g);
    }
  },

  /* ---------- 弯道路缘石（红白相间，赛道标准元素） ---------- */
  _buildCurbs: function () {
    var td = this.data, N = td.N;
    var indices = [];
    for (var i = 0; i < N; i++) {
      if (Math.abs(td.samples[i].kappa) > 0.010) indices.push(i);
    }
    if (!indices.length) return;

    var geo = new THREE.BoxGeometry(1.25, 0.09, 4.6);   // 长轴沿局部 Z = 切线方向
    var mesh = new THREE.InstancedMesh(geo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }), indices.length * 2);
    var m4 = new THREE.Matrix4();
    var qt = new THREE.Quaternion();
    var eul = new THREE.Euler();
    var v3 = new THREE.Vector3();
    var sc1 = new THREE.Vector3(1, 1, 1);
    var col = new THREE.Color();
    var red = this._col(0xc23b30), white = this._col(0xd9d9d4);
    var idx = 0;
    for (var k = 0; k < indices.length; k++) {
      var si = indices[k];
      var s = td.samples[si];
      // 与其它路段的净距（排除自身附近采样，闭环防串位）
      var clear = true;
      for (var j = 0; j < N; j++) {
        var dj = Math.abs(j - si); dj = Math.min(dj, N - dj);
        if (dj <= 10) continue;
        var dx = s.pos.x - td.samples[j].pos.x;
        var dz = s.pos.z - td.samples[j].pos.z;
        if (dx * dx + dz * dz < (td.halfWidth + 1) * (td.halfWidth + 1)) { clear = false; break; }
      }
      if (!clear) continue;
      for (var side = -1; side <= 1; side += 2) {
        var bx = s.pos.x + s.rx * (td.halfWidth + 0.55) * side;
        var bz = s.pos.z + s.rz * (td.halfWidth + 0.55) * side;
        eul.set(0, Math.atan2(s.tx, s.tz), 0);
        qt.setFromEuler(eul);
        v3.set(bx, 0.055, bz);
        m4.compose(v3, qt, sc1);
        mesh.setMatrixAt(idx, m4);
        col.copy((si % 2) ? red : white);
        mesh.setColorAt(idx, col);
        idx++;
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  },

  /* ---------- 电线杆 + 电线（路边真实感参照物） ---------- */
  _buildPowerLines: function () {
    var td = this.data;
    var poleMat = new THREE.MeshLambertMaterial({ color: this._col(0x574f42) });
    var crossMat = new THREE.MeshLambertMaterial({ color: this._col(0x4a443a) });
    var poleGeo = new THREE.CylinderGeometry(0.13, 0.19, 9, 6);
    var crossGeo = new THREE.BoxGeometry(2.4, 0.15, 0.15);
    var tops = [];
    var tmp = {};
    var nPoles = 14;
    for (var i = 0; i < nPoles; i++) {
      var u = i / nPoles;
      var p = td.pointAt(u, tmp), n = td.normalAt(u, {}), t = td.tangentAt(u, {});
      var bx = p.x + n.x * (td.halfWidth + 6), bz = p.z + n.z * (td.halfWidth + 6);
      if (!this._clearOfTrack(bx, bz, 2)) continue;
      var g = new THREE.Group();
      var pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4.5;
      pole.castShadow = true;
      var cross = new THREE.Mesh(crossGeo, crossMat);
      cross.position.y = 8.55;
      cross.rotation.y = Math.atan2(t.x, t.z);
      g.add(pole, cross);
      g.position.set(bx, 0, bz);
      this.group.add(g);
      tops.push({ x: bx, z: bz, ry: Math.atan2(t.x, t.z) });
    }
    if (tops.length < 2) return;
    // 电线：相邻杆顶连线，中点下垂模拟弧垂
    var pts = [];
    for (i = 0; i < tops.length - 1; i++) {
      var a = tops[i], b = tops[i + 1];
      var ax = Math.cos(a.ry), az = -Math.sin(a.ry);   // 横担方向
      var bx2 = Math.cos(b.ry), bz2 = -Math.sin(b.ry);
      for (var w = -1; w <= 1; w += 2) {
        var x1 = a.x + ax * 1.0 * w, z1 = a.z + az * 1.0 * w;
        var x2 = b.x + bx2 * 1.0 * w, z2 = b.z + bz2 * 1.0 * w;
        var mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        pts.push(x1, 8.5, z1, mx, 8.1, mz);
        pts.push(mx, 8.1, mz, x2, 8.5, z2);
      }
    }
    var wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(wireGeo,
      new THREE.LineBasicMaterial({ color: this._col(0x22252a) })));
  },

  /* ---------- 弯道轮胎堆（高曲率处，缓冲墙外） ---------- */
  _buildTireStacks: function () {
    var td = this.data, N = td.N;
    var thresh = 0.012;
    var spots = [];
    for (var i = 0; i < N; i++) {
      var k = Math.abs(td.samples[i].kappa);
      if (k < thresh) continue;
      // 局部极大值 + 间隔去重
      var near = false;
      for (var j = 0; j < spots.length; j++) {
        var d = Math.abs(spots[j].i - i);
        d = Math.min(d, N - d);
        if (d < 30 || (spots[j].k >= k && d < 60)) { near = true; break; }
      }
      if (!near) spots.push({ i: i, k: k });
    }

    var tireGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 12);
    var tireMat = new THREE.MeshLambertMaterial({ color: this._col(0x1c1c1e) });
    var tireTopMat = new THREE.MeshLambertMaterial({ color: this._col(0xd8d8d8) });
    var tmp = {};
    for (i = 0; i < spots.length && i < 10; i++) {
      var s = td.samples[spots[i].i];
      for (var side = -1; side <= 1; side += 2) {
        var bx = s.pos.x + s.rx * (td.halfWidth + 3.4) * side;
        var bz = s.pos.z + s.rz * (td.halfWidth + 3.4) * side;
        if (!this._clearOfTrack(bx, bz, 1.5)) continue;   // 贴近别段赛道则放弃
        var n = 2 + ((Math.random() * 2) | 0);
        for (var t = 0; t < n; t++) {
          var tire = new THREE.Mesh(tireGeo, t === n - 1 && Math.random() < 0.5 ? tireTopMat : tireMat);
          tire.position.set(bx + (Math.random() - 0.5) * 0.3, 0.21 + t * 0.42, bz + (Math.random() - 0.5) * 0.3);
          tire.castShadow = true;
          this.group.add(tire);
        }
      }
    }
  },

  dispose: function () {
    this.scene.remove(this.group);
  }
};

/* 广告牌贴图（静态工具方法） */
RACER.Track._billboardTex = function (def) {
  var cv = document.createElement('canvas');
  cv.width = 512; cv.height = 134;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = def.bg; ctx.fillRect(0, 0, 512, 134);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 118);
  ctx.font = '900 54px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = def.fg;
  ctx.fillText(def.t, 256, 70);
  var tex = new THREE.CanvasTexture(cv);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
};
