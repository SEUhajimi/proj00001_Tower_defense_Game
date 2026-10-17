import Phaser from 'phaser';
import { buildArt, preloadArt } from './art';

// 开场：加载美术素材、拼好贴图，然后进入基地
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const { width, height } = this.scale;
    const text = this.add.text(width / 2, height / 2, '加载中…', {
      fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '20px', color: '#cfd8e3',
    }).setOrigin(0.5);
    this.load.on('progress', (p: number) => text.setText(`加载中… ${Math.round(p * 100)}%`));
    preloadArt(this);
  }

  create(): void {
    buildArt(this);
    this.scene.start('base');
  }
}
