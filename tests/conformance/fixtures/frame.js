window.fixture = {
  mount(root, config) {
    this.root = root;
    this.config = config;
    root.style.cssText = `position:relative;width:${config.width}px;height:${config.height}px;background:#14283c;overflow:hidden`;
    this.box = document.createElement('div');
    this.box.style.cssText = 'position:absolute;width:160px;height:120px;background:#f0b040;top:200px';
    root.append(this.box);
  },
  async seek(frame) {
    this.box.style.left = `${40 + frame * 17}px`;
    this.box.style.background = frame >= 10 && frame < 20 ? '#40c080' : '#f0b040';
    await document.fonts.ready;
  },
  dispose() { this.root.replaceChildren(); }
};
