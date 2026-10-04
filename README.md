# 极速狂飙 Turbo Rush

一款基于 **Three.js** 的 3D 街机赛车游戏 —— 软件工程课程期末大作业。

![Tech](https://img.shields.io/badge/Three.js-r147-blue) ![Platform](https://img.shields.io/badge/platform-Web-green) ![NoBuild](https://img.shields.io/badge/build-零依赖-orange)

## 功能特性

- **三种模式**：竞速赛（与 7 名 AI 同场，8 车 3 圈）/ 单人计时（刷新最佳圈速，本地存档）/ 双人对战（同屏上下分屏，P1 vs P2）
- **两条赛道**：阳光海岸环道（高速流畅）、峡谷盘山道（连续发卡弯）
- **三辆赛车**：猎鹰（均衡）、雷霆（极速）、蜂鸟（灵活），性能差异显著
- **驾驶系统**：街机物理、手刹漂移、氮气加速（漂移集气）、真实撞墙反弹
- **AI 车手**：Pure Pursuit 路径追踪 + 曲率预判刹车 + 橡皮筋难度平衡
- **双视角**：C 键随时切换车外追尾 / 车内第一人称
- **完整体验**：倒计时发车、实时名次、圈速统计、小地图、弯道路缘石、碰撞/漂移烟雾/氮气火焰特效、程序化引擎音效

## 如何运行

**无需安装任何东西** —— 直接用浏览器打开 `index.html` 即可（推荐 Chrome / Edge）。

> 本项目使用经典脚本 + 本地 Three.js 库，不依赖网络与构建工具，
> 双击打开就能玩。如果浏览器限制了 file:// 协议，也可以在项目目录执行
> `python -m http.server 8000` 后访问 `http://localhost:8000`。

## 操作说明

| 按键 | 功能 |
|------|------|
| W / ↑ | 油门 |
| S / ↓ | 刹车 / 倒车 |
| A D / ← → | 转向 |
| 空格 | 手刹（漂移） |
| Shift | 氮气加速 |
| R | 重置回赛道 |
| C | 切换视角（车外 / 车内） |
| Esc | 暂停 |
| M | 静音 |
| 双人 P2 | 方向键驾驶 · Enter 手刹 · 右Shift 氮气 |

## 项目结构

```
├── index.html          # 入口页面（菜单/HUD/结算的 DOM 结构）
├── css/style.css       # 全部界面样式
├── lib/three.min.js    # Three.js r147（UMD 本地化）
├── js/
│   ├── utils.js        # 通用工具
│   ├── config.js       # 赛车/赛道静态配置
│   ├── trackdata.js    # 【逻辑层】赛道数学：样条采样、曲率、进度反查
│   ├── physics.js      # 【逻辑层】街机车辆物理
│   ├── ai.js           # 【逻辑层】AI 车手（Pure Pursuit）
│   ├── racecore.js     # 【逻辑层】比赛核心：圈数/名次/碰撞/氮气/状态机
│   ├── input.js        # 【表现层】键盘输入
│   ├── audio.js        # 【表现层】WebAudio 程序化音效
│   ├── track.js        # 【表现层】赛道 3D 场景生成
│   ├── car.js          # 【表现层】车模/烟雾/火焰/假阴影
│   ├── hud.js          # 【表现层】HUD 与小地图
│   ├── menu.js         # 【表现层】菜单系统
│   ├── game.js         # 【表现层】游戏编排：相机/事件/主循环
│   └── main.js         # 入口装配
├── test/sim.js         # 无头仿真测试（Node 运行，20 项断言）
└── docs/               # 软件工程文档（需求/设计/测试/手册）
```

## 运行测试

逻辑层与渲染完全解耦，可在 Node 中无头仿真整场比赛：

```bash
node test/sim.js
```

## 文档

- [01 需求分析报告](docs/01-需求分析报告.md)
- [02 概要设计说明书](docs/02-概要设计说明书.md)
- [03 详细设计说明书](docs/03-详细设计说明书.md)
- [04 测试计划与报告](docs/04-测试计划与报告.md)
- [05 用户手册](docs/05-用户手册.md)
