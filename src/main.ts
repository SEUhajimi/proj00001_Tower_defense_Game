import Phaser from 'phaser';
import { api, setCurrentUser } from './game/api';
import { BaseScene } from './game/BaseScene';
import { BattleScene } from './game/BattleScene';
import { BootScene } from './game/BootScene';
import { WorldScene } from './game/WorldScene';
import { watchConnection } from './ui/connection';
import { showLogin } from './ui/login';
import './style.css';

// 先确认登录：已登录（cookie 里的会话还有效）直接进游戏，否则先显示登录界面
function start(username: string): void {
  setCurrentUser(username);
  watchConnection();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1a2433',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [BootScene, BaseScene, WorldScene, BattleScene], // 第一个是开场场景
  });
  // 开发模式下暴露出来，方便浏览器自动化测试定位格子
  if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
}

api<{ username: string }>('me').then(me => {
  if (typeof me !== 'string') start(me.username);
  else showLogin(start, me === '没有登录' ? '' : me);
});
