import Phaser from 'phaser';
import { buildArt, preloadArt } from './art';
import { loadSession } from './session';

// 开场：加载美术素材、拼好贴图，从服务器读档，然后进入基地
export class BootScene extends Phaser.Scene {
  private text!: Phaser.GameObjects.Text;

  constructor() {
    super('boot');
  }

  preload(): void {
    const { width, height } = this.scale;
    this.text = this.add.text(width / 2, height / 2, '加载中…', {
      fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '20px', color: '#cfd8e3',
    }).setOrigin(0.5);
    this.load.on('progress', (p: number) => this.text.setText(`加载中… ${Math.round(p * 100)}%`));
    preloadArt(this);
  }

  create(): void {
    buildArt(this);
    this.text.setText('读取存档…');
    void loadSession().then(err => {
      if (err) this.text.setText(`读取存档失败：${err}\n刷新页面重试`).setAlign('center');
      else this.scene.start('base');
    });
  }
}
