# 基地守卫 · 给 Claude 的项目说明

2.5D 策略塔防：基地里摆塔布防、经营生产、生产部队，在世界地图上进攻 AI 据点，打光守备就征服它。
设计文档（Claude Docs）：https://claude.ai/code/artifact/2a212339-159c-4e25-864d-d7cfc65ce1a2

## 和用户协作

- 用户说中文，不懂游戏引擎；回复用中文，讲清楚做了什么、玩家能看到什么。
- 基础数值、价格这类由我来定，定完在回复里说明，并写进设计文档。会推翻已有规则或改动玩法方向的，先给方案让用户拍板。
- 只有用户说“提交”“推送”时才 git commit / push。提交信息用中文，末尾加
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 每做完一块就同步设计文档（改动的规则、数值表、开发进度）。
- 美术只用免费素材（CC0）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 同时启动后端（8787）和前端（5173），开发时用这个 |
| `npm test` | 全部自动测试（vitest） |
| `npm run typecheck` | 类型检查 |
| `npm run build` | 类型检查 + 打包前端 |
| `python art/fetch_textures.py` | 下载渲染用的 CC0 贴图到 `art/textures/`（不进 git） |
| `E:/tools/blender/blender.exe -b -P art/render.py -- <任务>` | 渲染美术，任务见 render.py 的 JOBS（`all`、`ground`、各建筑名如 `hall`（能升级的建筑出 1–5 级各一张，带受损图）、`airfield`（两个朝向 × 5 级）、`tank1`…`bomber4`、`rifle` `smg` `mg` `sniper` `sapper`、树丛 `trees-0`…`trees-3`、石堆 `rocks-0`…`rocks-3`、不能升级的建筑只出受损图 `damaged` 或 `barracks-damaged`、废墟 `ruins`、特效 `explosion` `smoke` `fire` `flash`、资源图标 `icons`；检查用 `preview` `bpreview` `spreview` `afpreview` `lpreview`（各建筑 1–5 级快速图）） |

改完代码至少跑 `npx tsc --noEmit` 和 `npx vitest run`；动到画面的，用浏览器自动化（playwright-core 驱动本机 Chrome）截图看一眼。

## 目录

| 目录 | 内容 |
| --- | --- |
| `shared/data/` | 数值：兵种（units.ts）、经济建筑（economy.ts）、征兵（army.ts）、科技（tech.ts）、AI 据点（ai.ts）、克制（combat.ts） |
| `shared/sim/` | 纯逻辑，前后端共用：战斗（battle.ts，确定性模拟）、基地经济（base/）、据点和出击（world/） |
| `server/` | 后端：账号（auth.ts）、存档和基地操作、出击结算（game.ts）、接口（app.ts）、SQLite（db.ts） |
| `src/game/` | Phaser 场景：BootScene（加载美术）、BaseScene（基地）、WorldScene（世界地图）、BattleScene（战斗） |
| `src/ui/` | 盖在画面上的界面：baseUi（基地）、worldHud（世界地图）、hud（战斗右侧栏）、login |
| `art/` | Blender 建模渲染脚本：kit.py（通用工具）、vehicles.py（坦克飞机）、buildings.py（兵营、战车工厂、机场、塔、工事、敌方建筑）、levels.py（能升级的建筑，每级一个样子）、props.py（树木岩石）、icons.py（资源图标）、damage.py（受损和废墟）、fx.py（爆炸烟火）、render.py（入口） |
| `public/assets/rendered/` | 渲染出的图片和 manifest.json（尺寸、锚点） |
| `public/assets/kenney/` | 早期的 Kenney CC0 素材，现在只在渲染图缺失时顶上 |

## 关键约定

- **服务器说了算**：基地操作在前端先执行（`session.act`），同时发给服务器，服务器用同一份 `shared` 代码执行并保存，结果回来后以服务器为准。出击时服务器发种子，结束后前端交上部署和指挥记录，服务器重打一遍结算（`shared/sim/world/replay.ts`）。所以战斗模拟必须保持确定性（固定步长、种子随机数）。
- **存档版本**：`BaseState.version`，改存档结构要在 `shared/sim/base/save.ts` 的 `parseSave` 里写升级，服务器读档也走它。
- **距离尺度**：`units.ts` 里的射程、速度按旧的小格子写，再统一乘 `RANGE_SCALE`（4）。
- **坐标**：格子坐标 (x, y)，等角投影 `toScreen(x,y) = ((x-y)*32, (x+y)*16)`。Blender 里游戏的 y 对应 -y。
- **美术**：渲染图按 2 倍分辨率出，游戏里缩小一半；建筑、单位按 manifest 里的锚点对位；坦克和飞机 16 个朝向换图，不旋转图片。新渲染的东西加进 render.py 的 JOBS，游戏里 `art.ts` 有图就自动用。
- 代码注释和界面文字用中文，风格跟周围代码一致。

## 踩过的坑

- Windows 上用 `sed -i` 改文件，Vite 的文件监听可能收不到变化（浏览器拿到旧代码）。改代码用编辑工具或 Python 读写，别用 `sed -i`。
- Bash 里很长的 heredoc 偶尔会解析失败；复杂的批量修改写成 Python 脚本放在临时目录再执行。
- 后台启动的开发服务器，停任务后 node 进程可能还在，占着文件导致 `git mv` 失败；需要时用 PowerShell 结束对应的 node 进程。
