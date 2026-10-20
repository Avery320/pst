import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenNumber } from '../src/presentation/design.ts';
import { clampSplit, splitBounds, splitKeyValue } from '../src/ui/splitter.ts';

test('split bounds reserve the divider and timeline while keeping narrow containers usable', () => {
  const divider = tokenNumber('splitter-width');
  assert.deepEqual(splitBounds(1024, 140, 584, 120), { min: 140, max: 584 });
  assert.deepEqual(splitBounds(300, 140, 584, 120), { min: 140, max: 300 - divider - 120 });
  assert.deepEqual(splitBounds(0, 140, 584, 120), { min: 0, max: 0 });
  for (const width of [1, 79, 128, 249, 320, 981, 1274]) {
    const available = Math.max(0, width - divider);
    const bounds = splitBounds(width, 140, 584, 120);
    assert.ok(bounds.min >= 0 && bounds.max >= bounds.min && bounds.max <= available);
    assert.ok(available - bounds.max >= Math.min(120, available / 2));
  }
});

test('a requested panel width can adapt to a narrow container and recover on expansion', () => {
  const preferred = 400;
  const narrow = splitBounds(700, tokenNumber('inspector-min'), tokenNumber('inspector-max'), tokenNumber('canvas-min'));
  const wide = splitBounds(1274, tokenNumber('inspector-min'), tokenNumber('inspector-max'), tokenNumber('canvas-min'));
  assert.ok(clampSplit(preferred, narrow) < preferred);
  assert.equal(clampSplit(preferred, wide), preferred);
  assert.equal(clampSplit(100, { min: 36.5, max: 36.5 }), 36.5);
});

test('both splitters share key steps and reverse direction for the right sidebar', () => {
  const bounds = { min: 140, max: 400 };
  assert.equal(splitKeyValue(250, 'ArrowRight', false, 1, bounds, 300), 262);
  assert.equal(splitKeyValue(250, 'ArrowRight', false, -1, bounds, 300), 238);
  assert.equal(splitKeyValue(250, 'ArrowLeft', true, -1, bounds, 300), 298);
  assert.equal(splitKeyValue(395, 'ArrowRight', true, 1, bounds, 300), 400);
  assert.equal(splitKeyValue(145, 'ArrowLeft', true, 1, bounds, 300), 140);
});

test('splitter shortcuts reset or reach bounds and leave unrelated keys untouched', () => {
  const bounds = { min: 140, max: 400 };
  assert.equal(splitKeyValue(250, 'Home', false, 1, bounds, 300), 140);
  assert.equal(splitKeyValue(250, 'End', false, -1, bounds, 300), 400);
  assert.equal(splitKeyValue(250, 'Enter', false, 1, bounds, 450), 400);
  assert.equal(splitKeyValue(250, 'Enter', false, 1, bounds, 300), 300);
  assert.equal(splitKeyValue(250, 'Tab', false, 1, bounds, 300), undefined);
  assert.equal(splitKeyValue(250, 'Escape', false, 1, bounds, 300), undefined);
});
