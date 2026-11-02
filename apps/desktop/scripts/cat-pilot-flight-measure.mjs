/** Runs in the actual SVG document. Samples computed geometry, not animation/keyframe names. */
/* global document, getComputedStyle, DOMMatrixReadOnly, DOMPoint, Node */
export function measureCatPilotFlight() {
  const element = (selector) => {
    const value = document.querySelector(selector);
    if (!value) throw new Error(`Required storyboard element is absent: ${selector}`);
    return value;
  };
  const animations = document.getAnimations();
  for (const animation of animations) animation.pause();
  const selectors = [
    '#cat-walk',
    '#cat-walk-body',
    '#cat-walk-head',
    '#cat-walk-tail',
    '#cat-walk-leg-front-near',
    '#cat-walk-leg-front-far',
    '#suitcase',
    '#cat-pilot',
    '#cat-pilot-goggles',
    '#pilot-tail',
    '#plane',
    '#propeller',
    '#cat-pilot-scarf-ends',
  ];
  const opacity = (target) => {
    let value = 1;
    while (target && target.id !== 'stage') {
      value *= Number(getComputedStyle(target).opacity);
      target = target.parentElement;
    }
    return value;
  };
  const state = (selector) => {
    const target = element(selector);
    const matrix = new DOMMatrixReadOnly(getComputedStyle(target).transform);
    const anchor = new DOMPoint(selector === '#plane' ? 1000 : 100, 720).matrixTransform(
      target.getCTM(),
    );
    return {
      x: anchor.x,
      y: anchor.y,
      opacity: opacity(target),
      transform: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
      angle: Math.atan2(matrix.b, matrix.a),
      scale: Math.hypot(matrix.a, matrix.b),
    };
  };
  const sample = (percent) => {
    for (const animation of animations) animation.currentTime = percent * 100;
    return {
      percent,
      stageOpacity: Number(getComputedStyle(element('#stage')).opacity),
      targets: Object.fromEntries(selectors.map((selector) => [selector, state(selector)])),
      eyes: [...document.querySelectorAll('#cat-walk .cat-eye')].map((eye) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(eye).transform);
        return Math.min(opacity(eye), Math.hypot(matrix.c, matrix.d));
      }),
    };
  };
  const at = new Map();
  for (const percent of [
    0, 5, 10, 16, 19.5, 20, 20.5, 21, 25, 30, 35, 36, 37.5, 39, 40, 42, 43.9, 44, 44.2, 44.5, 45,
    48, 50, 50.2, 50.21, 59.5, 59.51, 60, 64, 68, 68.5, 69.5, 72, 80, 89.5, 90, 99.99, 100.01,
  ])
    at.set(percent, sample(percent));
  const hops = Array.from({ length: 41 }, (_, index) => sample(50 + index / 4));
  const target = (percent, selector) => at.get(percent).targets[selector];
  const different = (left, right) =>
    left.some((value, index) => Math.abs(value - right[index]) > 0.01);
  const changed = (selector, first, second) =>
    different(target(first, selector).transform, target(second, selector).transform);
  const legNames = [...document.querySelectorAll('.cat-walk-leg')].map((item) => `#${item.id}`);
  const failures = [];
  const criterion = (number, ok, detail) => {
    if (!ok) failures.push({ number, detail });
  };
  // Static leg IDs vary only in the documented front/hind naming; measure all actual legs.
  const walk = element('#cat-walk');
  const legAngles = [];
  for (const percent of [10, 10.5, 11, 11.5, 12]) {
    sample(percent);
    legAngles.push(
      legNames.map((selector) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element(selector)).transform);
        return Math.atan2(matrix.b, matrix.a);
      }),
    );
  }
  const stride = legAngles.some(
    (angles, index) =>
      index && angles.some((value, leg) => Math.abs(value - legAngles[0][leg]) > 0.05),
  );
  const alternating = legAngles.some((angles) => Math.max(...angles) - Math.min(...angles) > 0.1);
  criterion(
    1,
    [10, 20, 35].every(
      (percent) => target(percent, '#cat-walk').opacity > 0.9 && at.get(percent).stageOpacity > 0.9,
    ) &&
      target(5, '#cat-walk').x < target(35, '#cat-walk').x - 400 &&
      Math.abs(target(35, '#cat-walk').x - target(35, '#plane').x) < 400 &&
      stride &&
      alternating &&
      changed('#cat-walk-body', 10, 21) &&
      changed('#cat-walk-tail', 10, 21),
    'Approach, alternating strides, body bob and tail motion must all be visible during 5–35%',
  );
  criterion(
    2,
    changed('#cat-walk-head', 16, 20) &&
      [19.5, 20, 20.5, 21].some((percent) => at.get(percent).eyes.some((value) => value < 0.5)),
    'The head must turn and the eyes must blink near 20%',
  );
  const bag = target(35, '#suitcase'),
    bagArc = target(37.5, '#suitcase');
  criterion(
    3,
    bag.opacity > 0.9 &&
      bagArc.y < bag.y - 10 &&
      Math.abs(bagArc.x - bag.x) > 10 &&
      target(40, '#suitcase').opacity < 0.05,
    'The visible suitcase must travel upward along an arc and disappear by 40%',
  );
  criterion(
    4,
    target(42, '#cat-walk').y < target(40, '#cat-walk').y - 10 &&
      target(44.2, '#cat-walk').opacity < 0.05 &&
      target(44.2, '#cat-pilot').opacity > 0.9 &&
      target(43.9, '#cat-pilot').opacity < 0.05 &&
      changed('#cat-pilot-goggles', 45, 50) &&
      target(50, '#pilot-tail').opacity > 0.9 &&
      changed('#pilot-tail', 48, 50),
    'The jump/pilot switch must happen at 44%, then goggles and tail move during 45–50%',
  );
  const cyclic = animations.filter((animation) =>
    ['cat-walk', 'plane'].includes(animation.effect.target?.id),
  );
  criterion(
    5,
    cyclic.length >= 2 &&
      cyclic.every((animation) => {
        const timing = animation.effect.getTiming();
        return timing.duration === 10000 && timing.iterations === Infinity && timing.delay === 0;
      }),
    'Cat and plane story arcs must use the shared infinite 10s cycle; individual timing is checked by the other criteria',
  );
  criterion(
    6,
    [44, 44.2, 44.5].some(
      (percent) => target(percent, '#plane').y > target(43.9, '#plane').y + 0.5,
    ),
    'The plane must dip under the landing cat around 44%',
  );
  const angleDelta = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  const slow = angleDelta(target(50.2, '#propeller').angle, target(50.21, '#propeller').angle);
  const fast = angleDelta(target(59.5, '#propeller').angle, target(59.51, '#propeller').angle);
  const extrema = hops.filter(
    (item, index) =>
      index > 0 &&
      index < hops.length - 1 &&
      item.targets['#plane'].y < hops[index - 1].targets['#plane'].y &&
      item.targets['#plane'].y <= hops[index + 1].targets['#plane'].y &&
      item.targets['#plane'].y < hops[0].targets['#plane'].y - 0.5,
  );
  criterion(
    7,
    fast > slow * 1.5 && fast > 0.001 && extrema.length >= 2 && extrema.length <= 3,
    'Propeller angular speed must increase and the plane must make 2–3 small hops during 50–60%',
  );
  const plane60 = target(60, '#plane'),
    plane64 = target(64, '#plane'),
    plane68 = target(68, '#plane');
  criterion(
    8,
    plane64.x > plane60.x &&
      plane68.x - plane64.x > (plane64.x - plane60.x) * 1.05 &&
      [68.5, 69.5].some((percent) => target(percent, '#plane').y < plane60.y - 1) &&
      target(72, '#plane').angle *
        Math.sign(
          element('#propeller').getBBox().x -
            element('#plane').getBBox().x -
            element('#plane').getBBox().width / 2,
        ) <
        -0.02 &&
      changed('#cat-pilot-scarf-ends', 68, 69.5),
    'Run-up must accelerate, lift near 68%, raise the nose and animate the scarf',
  );
  const plane72 = target(72, '#plane'),
    plane90 = target(90, '#plane');
  criterion(
    9,
    plane90.x < plane72.x &&
      plane90.y < plane72.y &&
      plane90.scale >= 0.06 &&
      plane90.scale <= 0.15 &&
      Boolean(
        element('#plane').compareDocumentPosition(element('#clouds-far')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    'Flight must recede up-left to scale ~0.1 and draw behind the far clouds',
  );
  criterion(
    10,
    at.get(0).stageOpacity < 0.01 &&
      at.get(99.99).stageOpacity < 0.01 &&
      Math.abs(target(0, '#plane').x - target(100.01, '#plane').x) < 1 &&
      Math.abs(target(0, '#plane').y - target(100.01, '#plane').y) < 1,
    'Loop reset must restore the plane while the stage is faded out',
  );
  sample(0);
  return {
    kind: 'cat-pilot-flight-geometry',
    failures,
    sampledPercentages: [...at.keys()],
    samples: [...at.values()],
    hops: extrema.map((item) => item.percent),
    legAngles,
    walkingCatPresent: Boolean(walk),
  };
}
