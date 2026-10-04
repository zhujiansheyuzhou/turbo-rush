/* =========================================================
 * main.js —— 入口：装配菜单与游戏，处理界面间跳转
 * ========================================================= */
(function () {
  var game = new RACER.Game(document.getElementById('game-container'));
  window.RACER.game = game;   // 调试句柄（自动化测试/排查用）

  var menu = new RACER.Menu(function (cfg) {
    menu.setLastConfig(cfg);
    game.audio.init();          // 用户点击"开赛"手势中初始化音频
    game.startRace(cfg);
  });

  // 结算/暂停面板 → 主菜单
  menu.onMenu = function () {
    game.backToMenu();
    document.getElementById('pause').classList.add('hidden');
    menu.show('title');
  };
  menu.onResume = function () {
    game.paused = false;
    document.getElementById('pause').classList.add('hidden');
  };
})();
