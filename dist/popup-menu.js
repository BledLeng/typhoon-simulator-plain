// Anchored to a button or a map point. CSS handles overflow on short screens.
export class PopupMenu {
  constructor(element, selector, choose, onClose) {
    this.element = element;
    this.onClose = onClose;
    element.addEventListener('click', event => {
      const item = event.target.closest(selector);
      if (!item) return;
      this.close();
      choose(item);
    });
    element.addEventListener('keydown', event => {
      if (event.target.matches('input') || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      const items = [...element.querySelectorAll(selector)], i = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1
        : (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next].focus();
    });
  }
  get isOpen() { return !this.element.hidden; }
  open(x, y, trigger, above = y) {
    const el = this.element, gap = 8;
    this.trigger = trigger;
    el.hidden = false;
    const {width, height} = el.getBoundingClientRect();
    const bound = (v, extent, size) => Math.max(gap, Math.min(v, extent - size - gap));
    el.style.left = bound(x, innerWidth, width) + 'px';
    el.style.top = bound(y + height + gap > innerHeight ? above - height - gap : y + gap, innerHeight, height) + 'px';
    const focus = el.querySelector('[aria-checked="true"],input') || el.querySelector('button');
    focus?.focus({preventScroll:true});
  }
  close() {
    if (!this.isOpen) return;
    const restore = this.element.contains(document.activeElement);
    this.element.hidden = true;
    this.onClose?.();
    if (restore) this.trigger?.focus({preventScroll:true});
  }
}
