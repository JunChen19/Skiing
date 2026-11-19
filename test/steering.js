'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const THREE = require('../vendor/three.min.js');

const source = ['config', 'utils', 'physics'].map(name =>
  readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8')
).join('\n');

function game() {
  const window = new EventTarget();
  window.innerWidth = 390;
  window.innerHeight = 844;
  const canvas = new EventTarget();
  const { input, run } = vm.runInNewContext(source +
    '\n;({ input: makeInput(canvas), run: makePhysics(42) })', { window, canvas, THREE });
  const fingers = new Map();
  function touch(type, id, x, y) {
    const point = { identifier: id, clientX: x, clientY: y };
    if (type === 'touchstart' || type === 'touchmove') fingers.set(id, point);
    else fingers.delete(id);
    const targetTouches = [...fingers.values()];
    canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      changedTouches: [point], touches: targetTouches, targetTouches,
    }));
    input.update();
    return input.steer;
  }
  return { window, canvas, touch, input, run };
}

test('one finger can carve either way, hold its edge, and release to neutral', () => {
  const { touch, input } = game();
  assert.equal(touch('touchstart', 1, 195, 550), 0);
  assert.ok(touch('touchmove', 1, 235, 550) > 0);
  assert.equal(touch('touchmove', 1, 305, 550), 1);
  input.update();
  assert.equal(input.steer, 1);
  assert.equal(touch('touchmove', 1, 84, 550), -1);
  assert.equal(touch('touchend', 1, 84, 550), 0);
  assert.equal(input.consumeJump(), false);
});

test('one upward flick per contact, retained until the next physics step', () => {
  const { touch, input } = game();
  touch('touchstart', 4, 28, 600);
  assert.ok(touch('touchmove', 4, 28, 530) < -0.9);
  assert.equal(input.consumeJump(), true);
  touch('touchmove', 4, 28, 440);
  assert.equal(input.consumeJump(), false);
  touch('touchend', 4, 28, 430);
  assert.equal(input.consumeJump(), false);
  touch('touchstart', 6, 195, 475);
  touch('touchend', 6, 198, 409);
  assert.equal(input.steer, 0);
  assert.equal(input.consumeJump(), true);
  assert.equal(input.consumeJump(), false);
});

test('taps and shallow diagonals do not jump, a later upward flick does', () => {
  const { touch, input } = game();
  touch('touchstart', 2, 195, 490);
  touch('touchend', 2, 197, 479);
  assert.equal(input.consumeJump(), false);
  touch('touchstart', 3, 185, 520);
  touch('touchmove', 3, 212, 503);
  touch('touchmove', 3, 282, 477);
  assert.equal(input.consumeJump(), false);
  touch('touchmove', 3, 290, 417);
  assert.equal(input.consumeJump(), true);
});

test('a second finger neither steals steering nor jumps, lifting the driver hands off', () => {
  const { touch, input } = game();
  assert.equal(touch('touchstart', 5, 4, 640), -1);
  assert.equal(touch('touchstart', 8, 385, 600), -1);
  assert.equal(touch('touchmove', 8, 385, 360), -1);
  assert.equal(input.consumeJump(), false);
  assert.equal(touch('touchend', 5, 4, 640), 1);
  touch('touchend', 8, 385, 360);
  assert.equal(input.consumeJump(), false);
  assert.equal(input.steer, 0);
});

test('cancellation, blur and retry reset discard pending jumps and old contacts', () => {
  for (const cancel of ['touchcancel', 'blur', 'reset']) {
    const { touch, input, window } = game();
    touch('touchstart', 9, 385, 450);
    touch('touchmove', 9, 382, 380);
    if (cancel === 'touchcancel') touch(cancel, 9, 382, 380);
    if (cancel === 'blur') window.dispatchEvent(new Event('blur'));
    if (cancel === 'reset') input.reset();
    assert.equal(input.steer, 0);
    assert.equal(touch('touchmove', 9, 15, 340), 0);
    assert.equal(input.consumeJump(), false);
  }
});

test('gameplay has no mouse or keyboard steering and jumping', () => {
  const { canvas, window, input } = game();
  for (const target of [canvas, window]) {
    for (const [type, fields] of [
      ['mousemove', { clientX: 0 }], ['mousedown', { button: 0 }], ['keydown', { key: 'ArrowRight' }],
      ['keydown', { key: ' ' }], ['keyup', { key: 'ArrowRight' }],
    ]) {
      target.dispatchEvent(Object.assign(new Event(type), fields));
      input.update();
      assert.equal(input.steer, 0);
      assert.equal(input.consumeJump(), false);
    }
  }
});

test('letting go after a carve returns the skis downhill', () => {
  const { run } = game();
  for (let tick = 0; tick < 60; tick++) run.step(1 / 120, 1);
  assert.ok(run.st.heading < -0.5);
  for (let tick = 0; tick < 180; tick++) run.step(1 / 120, 0);
  assert.ok(Math.abs(run.st.heading) < 0.12);
});

// Place a trunk on the straight line after 90 seconds of downhill physics.
// Swipe on the phone-sized game surface, then check the entire
// trajectory against the trunk, including the skier collision allowance.
for (const fps of [20, 60, 120]) {
  test('late-run avoidance in both directions at ' + fps + ' FPS', () => {
    for (const direction of [-1, 0, 1]) {
      const { input, run, touch } = game();
      const dt = 1 / 120, st = run.st;
      for (let tick = 0; tick < 90 * 120; tick++) run.step(dt, 0);
      assert.ok(st.speed > 28 && st.dist > 1800);
      const tree = { x: st.x, z: st.z - 18, r: 0.8 };
      let closest = Infinity;
      for (let frame = 0; st.z > tree.z - 2; frame++) {
        assert.ok(frame < fps * 2);
        if (frame === 0) touch('touchstart', 1, 195, 590);
        if (frame === 1) touch('touchmove', 1, 195 + direction * 115, 590);
        input.update();
        for (let tick = 0; tick < 120 / fps; tick++) {
          run.step(dt, input.steer);
          closest = Math.min(closest, Math.hypot(st.x - tree.x, st.z - tree.z));
        }
      }
      if (direction) {
        assert.ok(closest > tree.r + 0.42 && direction * (st.x - tree.x) > 2);
      } else {
        assert.ok(closest < tree.r + 0.42);
      }
    }
  });
}
