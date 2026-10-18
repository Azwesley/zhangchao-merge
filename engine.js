/* Local, fixed-step physics. No wall-clock timers: pausing also pauses danger. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.MergeEngine = factory(root.Matter);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMergeEngine(Matter) {
  'use strict';
  if (!Matter) throw new Error('Matter.js must load before engine.js');
  var Engine = Matter.Engine, Bodies = Matter.Bodies, Body = Matter.Body;
  var Composite = Matter.Composite, Events = Matter.Events;
  var STEP = 1000 / 60;
  var clamp = function (v, min, max) { return Math.max(min, Math.min(max, v)); };

  return class MergeEngine {
    constructor(options) {
      options = options || {};
      this.width = options.width || 400;
      this.height = options.height || 540;
      this.radii = (options.radii || [19,24,29,34,40,46,52,59,66,74,84]).slice();
      this.onMerge = options.onMerge || function () {};
      this.onGameOver = options.onGameOver || function () {};
      this.onWin = options.onWin || function () {};
      this.onChange = options.onChange || function () {};
      this._engine = Engine.create({ enableSleeping: false });
      this._engine.gravity.y = 1;
      this._engine.positionIterations = 8;
      this._engine.velocityIterations = 8;
      this._engine.constraintIterations = 2;
      this._handleCollisions = (event) => {
        for (var i = 0; i < event.pairs.length; i++) {
          var pair = event.pairs[i];
          var a = pair.bodyA, b = pair.bodyB;
          if (!a.isStatic && !b.isStatic && a.level === b.level &&
              a.level < this.radii.length - 1) this._pairs.push([a, b]);
        }
      };
      Events.on(this._engine, 'collisionStart', this._handleCollisions);
      Events.on(this._engine, 'collisionActive', this._handleCollisions);
      this.reset();
    }

    get score() { return this._score; }
    get maxLevel() { return this._maxLevel; }
    get canDrop() { return !this._over && !this._destroyed && this._time >= this._nextDropAt; }
    get danger() { return clamp(this._overflow / 2000, 0, 1); }
    get gameOver() { return this._over; }
    getBodies() { return this._balls.slice(); }

    reset() {
      if (this._destroyed) return;
      Composite.clear(this._engine.world, false);
      Engine.clear(this._engine);
      this._engine.timing.timestamp = 0;
      this._balls = [];
      this._pairs = [];
      this._time = 0;
      this._accumulator = 0;
      this._score = 0;
      this._maxLevel = 0;
      this._overflow = 0;
      this._nextDropAt = 0;
      this._lastMergeAt = -Infinity;
      this._chain = 0;
      this._over = false;
      this._won = false;
      var wall = { isStatic: true, friction: 0.15, restitution: 0.08 };
      Composite.add(this._engine.world, [
        Bodies.rectangle(-42, this.height / 2 - 150, 100, this.height + 600, wall),
        Bodies.rectangle(this.width + 42, this.height / 2 - 150, 100, this.height + 600, wall),
        Bodies.rectangle(this.width / 2, this.height + 42, this.width + 200, 100, wall)
      ]);
      this.onChange();
    }

    _makeBall(level, x, y, entered, bornAt) {
      var radius = this.radii[level];
      var ball = Bodies.circle(clamp(x, 8 + radius, this.width - 8 - radius), y, radius, {
        restitution: 0.12, friction: 0.32, frictionStatic: 0.65,
        frictionAir: 0.005, density: 0.0014, slop: 0.025,
        label: 'hero-' + level
      });
      ball.level = level;
      ball.plugin.merge = { entered: !!entered, bornAt: bornAt == null ? this._time : bornAt };
      this._balls.push(ball);
      Composite.add(this._engine.world, ball);
      this._maxLevel = Math.max(this._maxLevel, level);
      return ball;
    }

    drop(level, x) {
      if (!this.canDrop || !Number.isFinite(level) || !Number.isFinite(x)) return false;
      level = clamp(Math.floor(level), 0, this.radii.length - 1);
      this._makeBall(level, x, 45, false);
      this._nextDropAt = this._time + 360;
      this.onChange();
      return true;
    }

    update(deltaMs) {
      if (this._over || this._destroyed || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
      // A resumed tab never simulates seconds of missing frames or instant defeat.
      this._accumulator += Math.min(deltaMs, 100);
      var steps = 0;
      while (this._accumulator + 0.001 >= STEP && steps < 6 && !this._over) {
        this._accumulator -= STEP;
        this._time += STEP;
        this._pairs.length = 0;
        Engine.update(this._engine, STEP);
        this._mergePairs();
        this._keepInBounds();
        this._checkDanger();
        steps++;
      }
    }

    _mergePairs() {
      if (!this._pairs.length) return;
      var removed = new Set();
      // Stable ordering prevents a ball touching two peers from being consumed twice.
      this._pairs.sort(function (a, b) { return a[0].id - b[0].id || a[1].id - b[1].id; });
      for (var i = 0; i < this._pairs.length; i++) {
        var a = this._pairs[i][0], b = this._pairs[i][1];
        if (removed.has(a.id) || removed.has(b.id) || a.level !== b.level) continue;
        if (this._balls.indexOf(a) === -1 || this._balls.indexOf(b) === -1) continue;
        removed.add(a.id);
        removed.add(b.id);
        var level = a.level + 1;
        var x = (a.position.x + b.position.x) / 2;
        var radius = this.radii[level];
        var y = Math.min((a.position.y + b.position.y) / 2, this.height - 8 - radius);
        var entered = a.plugin.merge.entered || b.plugin.merge.entered;
        var bornAt = Math.min(a.plugin.merge.bornAt, b.plugin.merge.bornAt);
        Composite.remove(this._engine.world, [a, b]);
        this._balls = this._balls.filter(function (ball) { return ball !== a && ball !== b; });
        var merged = this._makeBall(level, x, y, entered, bornAt);
        Body.setVelocity(merged, {
          x: clamp((a.velocity.x + b.velocity.x) / 2, -4, 4),
          y: clamp((a.velocity.y + b.velocity.y) / 2, -3, 3)
        });
        Body.setAngularVelocity(merged, clamp((a.angularVelocity + b.angularVelocity) / 2, -0.03, 0.03));
        this._chain = this._time - this._lastMergeAt <= 900 ? this._chain + 1 : 1;
        this._lastMergeAt = this._time;
        var points = Math.pow(2, level + 1);
        this._score += points;
        this.onMerge({ level: level, x: merged.position.x, y: merged.position.y, points: points, chain: this._chain });
        if (level === this.radii.length - 1 && !this._won) {
          this._won = true;
          this.onWin();
        }
        this.onChange();
      }
    }

    _keepInBounds() {
      for (var i = 0; i < this._balls.length; i++) {
        var ball = this._balls[i], radius = ball.circleRadius;
        var x = clamp(ball.position.x, radius + 8, this.width - 8 - radius);
        var y = Math.min(ball.position.y, this.height - 8 - radius);
        if (x !== ball.position.x || y !== ball.position.y) {
          var vx = x !== ball.position.x ? 0 : ball.velocity.x;
          var vy = y !== ball.position.y ? Math.min(0, ball.velocity.y) : ball.velocity.y;
          Body.setPosition(ball, { x: x, y: y });
          Body.setVelocity(ball, { x: vx, y: vy });
        }
        if (ball.position.y + radius >= 100) ball.plugin.merge.entered = true;
      }
    }

    _checkDanger() {
      var overflow = false;
      for (var i = 0; i < this._balls.length; i++) {
        var ball = this._balls[i], meta = ball.plugin.merge;
        if (meta.entered && this._time - meta.bornAt >= 1300 &&
            ball.position.y - ball.circleRadius < 90) { overflow = true; break; }
      }
      this._overflow = overflow ? this._overflow + STEP : 0;
      if (this._overflow + 0.001 >= 2000) {
        this._overflow = 2000;
        this._over = true;
        this.onGameOver();
        this.onChange();
      }
    }

    clearSmallest() {
      if (this._destroyed || !this._balls.length) return 0;
      var selected = this._balls.slice().sort(function (a, b) {
        return a.level - b.level || a.position.y - b.position.y;
      }).slice(0, 3);
      Composite.remove(this._engine.world, selected);
      this._balls = this._balls.filter(function (ball) { return selected.indexOf(ball) === -1; });
      this._pairs.length = 0;
      this._overflow = 0;
      this._over = false;
      this._nextDropAt = this._time;
      // Give the newly freed pile time to settle after rescue.
      for (var i = 0; i < this._balls.length; i++) this._balls[i].plugin.merge.bornAt = this._time;
      this.onChange();
      return selected.length;
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      Events.off(this._engine, 'collisionStart', this._handleCollisions);
      Events.off(this._engine, 'collisionActive', this._handleCollisions);
      Composite.clear(this._engine.world, false);
      Engine.clear(this._engine);
      this._balls.length = 0;
      this._pairs.length = 0;
    }
  };
});
