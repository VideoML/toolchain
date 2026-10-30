window.fixture = {
  mount(root, config) {
    this.root = root;
    root.style.cssText = `width:${config.width}px;height:${config.height}px`;
  },
  async seek() {
    // Ambient time violates the frame contract; delay makes the violation visible.
    await new Promise(resolve => setTimeout(resolve, 80));
    this.root.style.background = `rgb(${Math.floor(Date.now() / 20) % 256}, 30, 80)`;
    await document.fonts.ready;
  },
  dispose() { this.root.replaceChildren(); }
};
