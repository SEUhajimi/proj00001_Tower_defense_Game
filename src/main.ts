import Phaser from 'phaser';
import { BaseScene } from './game/BaseScene';
import { BattleScene } from './game/BattleScene';
import './style.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a2433',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [BaseScene, BattleScene], // 第一个是开场场景
});

// 开发模式下暴露出来，方便浏览器自动化测试定位格子
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
