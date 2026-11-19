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
  window.innerWidth = 1000;
  const { input, run } = vm.runInNewContext(source +
    '\n;({ input: makeInput(window), run: makePhysics(42) })', { window, THREE });
  function send(type, fields = {}) {
    window.dispatchEvent(Object.assign(new Event(type), fields));
    input.update();
    return input.steer;
  }
  return { send, input, run };
}

test('changing direction keeps the newest held key, even with repeats and aliases', () => {
  const { send } = game();
  assert.equal(send('keydown', { key: 'ArrowLeft' }), -1);
  assert.equal(send('keydown', { key: 'D' }), 1);
  assert.equal(send('keydown', { key: 'ArrowLeft', repeat: true }), 1);
  assert.equal(send('keyup', { key: 'ArrowLeft' }), 1);
  assert.equal(send('keydown', { key: 'ArrowRight' }), 1);
  assert.equal(send('keyup', { key: 'd' }), 1);
  assert.equal(send('keydown', { key: 'a' }), -1);
  assert.equal(send('keyup', { key: 'A' }), 1);
  assert.equal(send('keyup', { key: 'ArrowRight' }), 0);
});

test('releasing the keyboard does not reactivate a parked mouse', () => {
  const { send } = game();
  assert.equal(send('mousemove', { clientX: 0 }), -1);
  assert.equal(send('keydown', { key: 'ArrowRight' }), 1);
  assert.equal(send('keyup', { key: 'ArrowRight' }), 0);
  assert.equal(send('mousemove', { clientX: 1000 }), 1);
  assert.equal(send('blur'), 0);
});

test('lifting one finger keeps steering with the remaining finger', () => {
  const { send } = game();
  const left = { clientX: 0 }, right = { clientX: 1000 };
  assert.equal(send('touchstart', { touches: [left, right] }), -1);
  assert.equal(send('touchend', { touches: [right] }), 1);
  assert.equal(send('touchcancel', { touches: [] }), 0);
});

test('letting go after a carve returns the skis downhill', () => {
  const { run } = game();
  for (let tick = 0; tick < 60; tick++) run.step(1 / 120, 1);
  assert.ok(run.st.heading < -0.5);
  for (let tick = 0; tick < 180; tick++) run.step(1 / 120, 0);
  assert.ok(Math.abs(run.st.heading) < 0.12);
});

// Place a trunk on the straight line after 90 seconds of downhill physics.
// Send overlapping key events through the game input, then check the entire
// trajectory against the trunk, including the skier collision allowance.
for (const fps of [20, 60, 120]) {
  test('late-run avoidance in both directions at ' + fps + ' FPS', () => {
    for (const direction of [-1, 0, 1]) {
      const { input, run, send } = game();
      const dt = 1 / 120, st = run.st;
      for (let tick = 0; tick < 90 * 120; tick++) run.step(dt, 0);
      assert.ok(st.speed > 28 && st.dist > 1800);
      const tree = { x: st.x, z: st.z - 18, r: 0.8 };
      const key = direction < 0 ? 'ArrowLeft' : 'ArrowRight';
      const old = direction < 0 ? 'ArrowRight' : 'ArrowLeft';
      let closest = Infinity;
      for (let frame = 0; st.z > tree.z - 2; frame++) {
        assert.ok(frame < fps * 2);
        if (direction && frame === 0) { send('keydown', { key: old }); send('keydown', { key }); }
        if (direction && frame === 1) send('keyup', { key: old });
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
