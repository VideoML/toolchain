window.fixture = {
  mount(root, config) {
    this.root = root;
    root.style.cssText = `position:relative;width:${config.width}px;height:${config.height}px;background:#14283c;overflow:hidden`;
    const style = document.createElement('style');
    style.textContent = '@keyframes ambient-motion { from { transform: translateX(0px); } to { transform: translateX(1000px); } }';
    this.box = document.createElement('div');
    this.box.style.cssText = 'position:absolute;top:200px;width:160px;height:120px;background:#f0b040;animation:ambient-motion 20s linear infinite';
    root.append(style, this.box);
  },
  async seek() {
    // Intentionally leaves CSS animation controlled by wall clock instead of the requested frame.
    await new Promise(resolve => setTimeout(resolve, 120));
  },
  dispose() { this.root.replaceChildren(); }
};
