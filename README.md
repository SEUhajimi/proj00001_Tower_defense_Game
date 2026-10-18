# 基地守卫

2.5D 策略塔防：在基地里摆塔布防、经营生产，带兵出击 AI 基地掠夺资源，买地扩张直到一统地图。
设计文档见 claude.ai 上的「基地守卫 · 游戏设计文档」。

## 运行

需要 Node.js 24 或更新版本。第一次先装依赖：

```
npm install
```

然后一个命令同时启动后端和前端：

```
npm start
```

等几秒，打开 http://localhost:5173 ，注册一个账号就能玩。按 Ctrl+C 关闭。

存档在服务器上（`server/data/baseguard.db`，不进 git）。删掉这个文件等于清空所有账号和存档。

## 其他命令

| 命令 | 作用 |
| --- | --- |
| `npm test` | 跑全部自动测试 |
| `npm run typecheck` | 类型检查 |
| `npm run build` | 类型检查并打包前端到 `dist/` |
| `npm run server` / `npm run dev` | 分别单独启动后端、前端 |

## 目录

| 目录 | 内容 |
| --- | --- |
| `shared/` | 前后端共用：数值（`data/`）、战斗和经济模拟（`sim/`） |
| `server/` | 后端：账号、存档、基地操作、出击结算（Node.js + SQLite） |
| `src/` | 前端：Phaser 画面（`game/`）、右侧面板和登录界面（`ui/`） |
| `public/assets/rendered/` | Blender 渲染的美术（由 `art/render.py` 生成） |
| `public/assets/kenney/` | 还没渲染的部分先用 Kenney 的 CC0 素材，来源见其中的 CREDITS.md |
| `art/` | 美术工具：下载 CC0 贴图、在 Blender 里建模渲染 |
| `tests/` | 自动测试 |
| `legacy/` | 最早的 HTML 原型 |

## 重新渲染美术

需要 Blender 4.5（免安装版即可）。先下载贴图，再渲染：

```
python art/fetch_textures.py
E:/tools/blender/blender.exe -b -P art/render.py -- all
```

只渲染其中几样：把 `all` 换成 `ground`、`barracks`、`tank2`、`rifle` 等（见 render.py 里的 JOBS）。
