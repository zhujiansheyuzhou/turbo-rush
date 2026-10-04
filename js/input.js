/* =========================================================
 * input.js —— 键盘输入采集
 * 支持两名玩家：
 *   P1（pid 0）—— W/A/S/D 驾驶，空格手刹，左Shift 氮气；
 *                 R 重置 / Esc 暂停 / M 静音 / C 视角 全局快捷键
 *   P2（pid 1）—— 方向键驾驶，Enter 手刹，右Shift 氮气
 * 持续状态以轮询方式读取；瞬时按键通过 onAction 回调通知。
 * ========================================================= */
window.RACER = window.RACER || {};

/* 每位玩家的键位映射 */
RACER.INPUT_MAPS = [
  { L: 'KeyA', R: 'KeyD', U: 'KeyW', D: 'KeyS', HB: 'Space', NA: 'ShiftLeft' },
  { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown', HB: 'Enter', NA: 'ShiftRight' }
];

RACER.Input = function (playerId) {
  this.pid = playerId || 0;
  this.map = RACER.INPUT_MAPS[this.pid];
  this.keys = {};
  this.onAction = null;   // function(actionName)

  var self = this;
  window.addEventListener('keydown', function (e) {
    self.keys[e.code] = true;
    // 防止方向键/空格/回车滚动页面或误触按钮
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].indexOf(e.code) >= 0) {
      e.preventDefault();
    }
    // 全局快捷键只挂在 P1 上，避免双人模式重复触发
    if (self.pid === 0 && !e.repeat && self.onAction) {
      if (e.code === 'KeyR') self.onAction('reset');
      else if (e.code === 'Escape') self.onAction('pause');
      else if (e.code === 'KeyM') self.onAction('mute');
      else if (e.code === 'KeyC') self.onAction('camera');
    }
  });
  window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
  // 失焦时清空，防止按键"卡住"
  window.addEventListener('blur', function () { self.keys = {}; });
};

RACER.Input.prototype = {
  /** 读取当前驾驶输入（与 AI 输入结构一致） */
  read: function () {
    var k = this.keys, m = this.map;
    var steer = 0;
    // 物理约定：steer>0 → 车头转向 +x；追尾相机里 +x 在屏幕左侧，
    // 故左转键给 +1、右转键给 -1，实现"左键左转、右键右转"
    if (k[m.L]) steer += 1;
    if (k[m.R]) steer -= 1;
    // 玩家转向灵敏度（只影响玩家，不碰 AI 共用的 p.steer）
    steer *= 0.72;
    return {
      steer: steer,
      throttle: k[m.U] ? 1 : 0,
      brake: k[m.D] ? 1 : 0,
      handbrake: !!k[m.HB],
      nitro: !!k[m.NA]
    };
  }
};
