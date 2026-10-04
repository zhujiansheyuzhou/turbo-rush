/* =========================================================
 * audio.js —— WebAudio 程序化音效（无任何音频文件）
 * 引擎声 = 锯齿波 + 低通滤波，音调随车速变化；
 * 另提供倒计时哔声、撞墙闷响、氮气呼啸。
 * 浏览器自动播放策略要求：必须在首次用户手势后 init()。
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.Audio = function () {
  this.ctx = null;
  this.muted = false;
  this.engineOsc = null;
  this.engineGain = null;
  this.engineFilter = null;
};

RACER.Audio.prototype = {

  /** 在菜单点击等用户手势中调用 */
  init: function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    // 引擎：锯齿波 → 低通 → 增益
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();
  },

  /** 每帧更新引擎声；ratio = 车速/极速，boosting = 氮气中 */
  setEngine: function (ratio, boosting, running) {
    if (!this.ctx || this.muted) return;
    var f = 55 + ratio * 165 + (boosting ? 40 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + ratio * 900, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(running ? 0.045 + ratio * 0.035 : 0, this.ctx.currentTime, 0.1);
  },

  /** 短促哔声（倒计时 440Hz / GO 880Hz） */
  beep: function (freq, dur) {
    if (!this.ctx || this.muted) return;
    var o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  },

  /** 撞墙/碰撞闷响（噪声爆发） */
  thud: function (vol) {
    if (!this.ctx || this.muted) return;
    var len = 0.15, sr = this.ctx.sampleRate;
    var buf = this.ctx.createBuffer(1, sr * len, sr);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var flt = this.ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 500;
    var g = this.ctx.createGain(); g.gain.value = vol || 0.18;
    src.connect(flt); flt.connect(g); g.connect(this.ctx.destination);
    src.start();
  },

  toggleMute: function () {
    this.muted = !this.muted;
    if (this.muted && this.engineGain) this.engineGain.gain.value = 0;
    return this.muted;
  }
};
