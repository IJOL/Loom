// @vitest-environment jsdom
// Characterisation tests for createSelectControl's DOM contract: the radio
// strip (≤4 options), the native <select> fallback (>4 / forceSelect), and the
// showLabel caption wrapper. Pins what the lit-html migration could break —
// classes, titles, data-value-norm, and the onChange(value, fromUser) protocol.
import { describe, it, expect, vi } from 'vitest';
import { createSelectControl } from './select-control';

const OPTS3 = [
  { value: 'a', label: 'Aa' },
  { value: 'b', label: 'Bb' },
  { value: 'c', label: 'Cc' },
];

describe('radio strip (≤4 options)', () => {
  it('renders one .radio-btn per option, titled by label, initial active', () => {
    const c = createSelectControl({
      id: 'x', options: OPTS3, initialValue: 'b', onChange: () => {},
    });
    expect(c.el.classList.contains('radio-strip')).toBe(true);
    const btns = [...c.el.querySelectorAll<HTMLButtonElement>('button.radio-btn')];
    expect(btns.map((b) => b.title)).toEqual(['Aa', 'Bb', 'Cc']);
    expect(btns.map((b) => b.textContent?.trim())).toEqual(['Aa', 'Bb', 'Cc']);
    expect(btns.map((b) => b.classList.contains('active'))).toEqual([false, true, false]);
    // initial norm = idx / (N-1)
    expect(c.el.getAttribute('data-value-norm')).toBe('0.5');
  });

  it('waveform-named options paint an SVG glyph instead of text', () => {
    const c = createSelectControl({
      id: 'x',
      options: [{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }],
      initialValue: 'sine',
      onChange: () => {},
    });
    const btn = c.el.querySelector('button.radio-btn')!;
    expect(btn.querySelector('svg.radio-glyph')).not.toBeNull();
    expect(btn.textContent?.trim()).toBe('');
  });

  it('click fires onChange(value, true), moves .active and data-value-norm', () => {
    const onChange = vi.fn();
    const c = createSelectControl({
      id: 'x', options: OPTS3, initialValue: 'a', onChange,
    });
    const onValueChanged = vi.fn();
    c.handle.onValueChanged = onValueChanged;
    const btns = [...c.el.querySelectorAll<HTMLButtonElement>('button.radio-btn')];
    btns[2].click();
    expect(onChange).toHaveBeenCalledWith('c', true);
    expect(btns[2].classList.contains('active')).toBe(true);
    expect(btns[0].classList.contains('active')).toBe(false);
    expect(c.el.getAttribute('data-value-norm')).toBe('1');
    // mid-bucket normalized value for index 2 of 3
    expect(onValueChanged).toHaveBeenCalledWith((2 + 0.5) / 3, true);
  });

  it('setValue quantises 0..1, fires onChange(value, false), no-ops on same option', () => {
    const onChange = vi.fn();
    const c = createSelectControl({
      id: 'x', options: OPTS3, initialValue: 'a', onChange,
    });
    c.handle.setValue(0.99); // → index 2
    expect(onChange).toHaveBeenCalledWith('c', false);
    expect(c.el.getAttribute('data-value-norm')).toBe('1');
    onChange.mockClear();
    c.handle.setValue(0.8); // still index 2 → no onChange
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('native <select> fallback', () => {
  const OPTS5 = ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: `L${v}` }));

  it('renders a .select-control <select> with all options and the initial value', () => {
    const c = createSelectControl({
      id: 'x', options: OPTS5, initialValue: '3', onChange: () => {},
    });
    const sel = c.el as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    expect(sel.classList.contains('select-control')).toBe(true);
    expect([...sel.querySelectorAll('option')].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5']);
    expect(sel.value).toBe('3');
    expect(sel.getAttribute('data-value-norm')).toBe('0.5');
  });

  it('forceSelect renders a <select> even with ≤4 options', () => {
    const c = createSelectControl({
      id: 'x', options: OPTS3, initialValue: 'a', onChange: () => {}, forceSelect: true,
    });
    expect((c.el as HTMLElement).tagName).toBe('SELECT');
  });

  it('a user change event fires onChange(value, true) and updates data-value-norm', () => {
    const onChange = vi.fn();
    const c = createSelectControl({
      id: 'x', options: OPTS5, initialValue: '1', onChange,
    });
    const sel = c.el as HTMLSelectElement;
    sel.value = '5';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('5', true);
    expect(sel.getAttribute('data-value-norm')).toBe('1');
  });
});

describe('showLabel wrapper', () => {
  it('wraps in .select-labeled with a .ctl-label caption; handle.el stays the control', () => {
    const c = createSelectControl({
      id: 'x', label: 'CHOKE', showLabel: true,
      options: OPTS3, initialValue: 'a', onChange: () => {},
    });
    expect(c.el.classList.contains('select-labeled')).toBe(true);
    expect(c.el.querySelector('.ctl-label')?.textContent).toBe('CHOKE');
    const strip = c.el.querySelector('.radio-strip');
    expect(strip).not.toBeNull();
    expect(c.handle.el).toBe(strip);
  });
});
