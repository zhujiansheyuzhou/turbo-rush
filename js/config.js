/* =========================================================
 * config.js —— 游戏静态配置：赛车参数、赛道数据、AI 名单
 * 赛道由闭合 Catmull-Rom 样条的控制点定义（x, z 平面，单位米）。
 * ========================================================= */
window.RACER = window.RACER || {};

RACER.CONFIG = {

  totalLaps: 3,            // 比赛圈数
  aiCount: 7,              // 竞速赛 AI 数量（玩家 + 7 = 8 车同场）
  aiNames: ['夜枭', '闪电', '飓风', '疾风', '狂狼', '暗影', '赤狐'],
  aiColors: [0xe63b2e, 0xf2a71b, 0x8e44ad, 0x16a085, 0xd35400, 0x34495e, 0x7f8c8d],

  /* ---------------- 赛车参数 ----------------
   * topSpeed    极速 (m/s)
   * accel       加速度 (m/s^2)
   * brake       刹车减速度
   * grip        侧向抓地力（每秒衰减侧滑速度的比例）
   * driftGrip   漂移时的侧向抓地力（越小滑得越厉害）
   * steer       转向角速度 (rad/s)
   * steerLoss   高速转向衰减（0~1）
   * nitroFactor 氮气开启时极速倍率
   * aiLat       AI 过弯允许的最大侧向加速度（AI 水平）
   */
  cars: [
    {
      id: 'falcon', name: '猎鹰', desc: '均衡型 —— 各方面性能均衡，新手首选',
      color: 0x1e6ff2, topSpeed: 60, accel: 17, brake: 34,
      grip: 8.0, driftGrip: 1.7, steer: 2.4, steerLoss: 0.35,
      nitroFactor: 1.35, aiLat: 52, reverseAccel: 9, reverseMax: 16
    },
    {
      id: 'thunder', name: '雷霆', desc: '极速型 —— 直线王者，弯道需要提前刹车',
      color: 0x22b573, topSpeed: 68, accel: 14.5, brake: 32,
      grip: 6.8, driftGrip: 1.5, steer: 2.1, steerLoss: 0.42,
      nitroFactor: 1.32, aiLat: 46, reverseAccel: 8, reverseMax: 15
    },
    {
      id: 'hummer', name: '蜂鸟', desc: '灵活型 —— 加速猛、过弯稳，极速略低',
      color: 0xf2522e, topSpeed: 52, accel: 20, brake: 38,
      grip: 10.0, driftGrip: 2.1, steer: 2.7, steerLoss: 0.30,
      nitroFactor: 1.40, aiLat: 58, reverseAccel: 10, reverseMax: 17
    }
  ],

  /* ---------------- 赛道定义 ----------------
   * points    闭合样条控制点 [x, z]
   * halfWidth 路面半宽（米）
   * treeCount 赛道两侧树木数量
   */
  tracks: [
    {
      id: 'coast', name: '阳光海岸环道', desc: '宽阔流畅的高速环道，适合发挥极速',
      halfWidth: 7.5, treeCount: 170,
      points: [
        [0, -300], [170, -275], [265, -160], [255, -20],
        [300, 105], [235, 220], [95, 265], [-35, 215],
        [-70, 120], [-215, 150], [-290, 40], [-235, -95],
        [-125, -160], [-60, -230]
      ]
    },
    {
      id: 'canyon', name: '峡谷盘山道', desc: '连续发卡弯，考验刹车点与漂移技巧',
      halfWidth: 6.5, treeCount: 130,
      points: [
        [0, -320], [150, -300], [215, -215], [90, -165],
        [200, -85], [140, 20], [-30, -10], [-55, 115],
        [70, 175], [-30, 275], [-195, 265], [-270, 155],
        [-150, 105], [-255, -10], [-190, -140], [-70, -210]
      ]
    }
  ],

  /* 键位说明（同时显示在帮助界面） */
  keys: [
    ['W / ↑', '油门'], ['S / ↓', '刹车 / 倒车'],
    ['A / ←', '左转'], ['D / →', '右转'],
    ['空格', '手刹（漂移）'], ['Shift', '氮气加速'],
    ['R', '重置回赛道'], ['C', '切换视角'], ['Esc', '暂停'],
    ['双人 P2', '方向键 + Enter 手刹 + 右Shift 氮气']
  ]
};
