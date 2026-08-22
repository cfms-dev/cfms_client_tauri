import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve(
  'src/lib/release-highlights/animations/v0.46',
);

const themes = {
  light: {
    background: [0.953, 0.953, 0.953],
    shell: [0.98, 0.98, 0.98],
    surface: [1, 1, 1],
    raised: [0.925, 0.925, 0.925],
    field: [0.965, 0.965, 0.965],
    line: [0.784, 0.784, 0.784],
    text: [0.102, 0.102, 0.102],
    muted: [0.365, 0.365, 0.365],
    accent: [0, 0.404, 0.753],
    accentSoft: [0.847, 0.918, 1],
    success: [0.102, 0.55, 0.322],
    successSoft: [0.82, 0.95, 0.87],
    danger: [0.72, 0.12, 0.12],
    dangerSoft: [1, 0.87, 0.86],
  },
  dark: {
    background: [0.055, 0.059, 0.067],
    shell: [0.078, 0.086, 0.102],
    surface: [0.094, 0.102, 0.118],
    raised: [0.12, 0.13, 0.15],
    field: [0.105, 0.115, 0.132],
    line: [0.27, 0.29, 0.33],
    text: [0.94, 0.95, 0.97],
    muted: [0.67, 0.69, 0.73],
    accent: [0.47, 0.68, 0.96],
    accentSoft: [0.12, 0.25, 0.42],
    success: [0.45, 0.85, 0.61],
    successSoft: [0.1, 0.28, 0.17],
    danger: [1, 0.55, 0.52],
    dangerSoft: [0.38, 0.12, 0.12],
  },
};

const ease = {
  entrance: { i: { x: [0.34], y: [0.94] }, o: { x: [0.2], y: [0.75] } },
  settle: { i: { x: [0.51], y: [0.99] }, o: { x: [0], y: [0.65] } },
  travel: { i: { x: [0], y: [0.55] }, o: { x: [1], y: [0.49] } },
};

function staticProperty(value) {
  return { a: 0, k: value };
}

function hold(t, value) {
  return { t, s: value, e: value, h: 1 };
}

function tween(t, start, end, curve = ease.entrance) {
  return { t, s: start, e: end, i: curve.i, o: curve.o };
}

function terminal(t, value) {
  return { t, s: value };
}

function animatedProperty(keyframes) {
  return { a: 1, k: keyframes };
}

function groupTransform({ position = [0, 0], scale = [100, 100], opacity = 100 } = {}) {
  return {
    ty: 'tr',
    p: Array.isArray(position) ? staticProperty(position) : position,
    a: staticProperty([0, 0]),
    s: Array.isArray(scale) ? staticProperty(scale) : scale,
    r: staticProperty(0),
    o: typeof opacity === 'number' ? staticProperty(opacity) : opacity,
    sk: staticProperty(0),
    sa: staticProperty(0),
  };
}

function fill(color, opacity = 100) {
  return {
    ty: 'fl',
    c: staticProperty(color),
    o: staticProperty(opacity),
    r: 1,
  };
}

function stroke(color, width = 2, opacity = 100) {
  return {
    ty: 'st',
    c: staticProperty(color),
    o: staticProperty(opacity),
    w: staticProperty(width),
    lc: 2,
    lj: 2,
    ml: 4,
  };
}

function rectangle(
  name,
  size,
  position,
  radius,
  color,
  { opacity = 100, outline, outlineWidth = 2, transform } = {},
) {
  const items = [
    {
      ty: 'rc',
      d: 1,
      s: Array.isArray(size) ? staticProperty(size) : size,
      p: staticProperty([0, 0]),
      r: typeof radius === 'number' ? staticProperty(radius) : radius,
    },
    fill(color, opacity),
  ];
  if (outline) items.push(stroke(outline, outlineWidth));
  items.push(transform ?? groupTransform({ position }));
  return { ty: 'gr', nm: name, it: items };
}

function ellipse(name, size, position, color, options = {}) {
  const items = [
    { ty: 'el', d: 1, s: staticProperty(size), p: staticProperty([0, 0]) },
    fill(color, options.opacity ?? 100),
  ];
  if (options.outline) items.push(stroke(options.outline, options.outlineWidth ?? 2));
  items.push(options.transform ?? groupTransform({ position }));
  return { ty: 'gr', nm: name, it: items };
}

function linePath(name, vertices, position, color, width = 3, transform) {
  return {
    ty: 'gr',
    nm: name,
    it: [
      {
        ty: 'sh',
        d: 1,
        ks: staticProperty({
          i: vertices.map(() => [0, 0]),
          o: vertices.map(() => [0, 0]),
          v: vertices,
          c: false,
        }),
      },
      stroke(color, width),
      transform ?? groupTransform({ position }),
    ],
  };
}

function layerTransform({ opacity = 100, position = [0, 0, 0], scale = [100, 100, 100] } = {}) {
  return {
    o: typeof opacity === 'number' ? staticProperty(opacity) : opacity,
    r: staticProperty(0),
    p: Array.isArray(position) ? staticProperty(position) : position,
    a: staticProperty([0, 0, 0]),
    s: Array.isArray(scale) ? staticProperty(scale) : scale,
  };
}

function shapeLayer(index, name, shapes, transform = {}) {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: name,
    sr: 1,
    ks: layerTransform(transform),
    ao: 0,
    // Bodymovin renders shape groups in reverse stack order.
    shapes: [...shapes].reverse(),
    ip: 0,
    op: 120,
    st: 0,
    bm: 0,
  };
}

function buildAnimation(colors) {
  const completionOpacity = animatedProperty([
    hold(0, [0]),
    tween(96, [0], [100], ease.entrance),
    hold(108, [100]),
    terminal(120, [100]),
  ]);
  const completionScale = animatedProperty([
    hold(0, [82, 82, 100]),
    tween(96, [82, 82, 100], [100, 100, 100], ease.settle),
    hold(112, [100, 100, 100]),
    terminal(120, [100, 100, 100]),
  ]);

  const newRuleOpacity = animatedProperty([
    hold(0, [0]),
    tween(78, [0], [100], ease.entrance),
    hold(92, [100]),
    terminal(120, [100]),
  ]);
  const newRulePosition = animatedProperty([
    hold(0, [0, 18, 0]),
    tween(78, [0, 18, 0], [0, 0, 0], ease.settle),
    hold(96, [0, 0, 0]),
    terminal(120, [0, 0, 0]),
  ]);

  const effectHighlightPosition = animatedProperty([
    hold(0, [733, 324]),
    tween(60, [733, 324], [572, 324], ease.travel),
    hold(80, [572, 324]),
    terminal(120, [572, 324]),
  ]);
  const effectHighlightScale = animatedProperty([
    hold(0, [94, 94]),
    tween(60, [94, 94], [100, 100], ease.settle),
    hold(80, [100, 100]),
    terminal(120, [100, 100]),
  ]);

  const editorOpacity = animatedProperty([
    hold(0, [0]),
    tween(34, [0], [100], ease.entrance),
    hold(52, [100]),
    terminal(120, [100]),
  ]);
  const editorPosition = animatedProperty([
    hold(0, [18, 0, 0]),
    tween(34, [18, 0, 0], [0, 0, 0], ease.settle),
    hold(54, [0, 0, 0]),
    terminal(120, [0, 0, 0]),
  ]);

  const selectionOpacity = animatedProperty([
    hold(0, [0]),
    tween(48, [0], [100], ease.entrance),
    hold(60, [100]),
    terminal(120, [100]),
  ]);
  const selectionScale = animatedProperty([
    hold(0, [96, 96, 100]),
    tween(48, [96, 96, 100], [100, 100, 100], ease.settle),
    hold(64, [100, 100, 100]),
    terminal(120, [100, 100, 100]),
  ]);

  const listOpacity = animatedProperty([
    hold(0, [0]),
    tween(26, [0], [100], ease.entrance),
    hold(42, [100]),
    terminal(120, [100]),
  ]);
  const listPosition = animatedProperty([
    hold(0, [0, 16, 0]),
    tween(26, [0, 16, 0], [0, 0, 0], ease.settle),
    hold(46, [0, 0, 0]),
    terminal(120, [0, 0, 0]),
  ]);

  const chromeDetailOpacity = animatedProperty([
    hold(0, [0]),
    tween(20, [0], [100], ease.entrance),
    hold(36, [100]),
    terminal(120, [100]),
  ]);
  const surfaceOpacity = animatedProperty([
    hold(0, [0]),
    tween(4, [0], [100], ease.entrance),
    hold(18, [100]),
    terminal(120, [100]),
  ]);
  const surfaceSize = animatedProperty([
    hold(0, [660, 420]),
    tween(8, [660, 420], [900, 540], ease.settle),
    hold(32, [900, 540]),
    terminal(120, [900, 540]),
  ]);
  const surfaceRadius = animatedProperty([
    hold(0, [18]),
    tween(8, [18], [8], ease.settle),
    hold(32, [8]),
    terminal(120, [8]),
  ]);

  const pageOpacity = animatedProperty([
    hold(0, [100]),
    tween(8, [100], [28], ease.settle),
    hold(24, [28]),
    terminal(120, [28]),
  ]);
  const pageScale = animatedProperty([
    hold(0, [100, 100, 100]),
    tween(8, [100, 100, 100], [97, 97, 100], ease.settle),
    hold(28, [97, 97, 100]),
    terminal(120, [97, 97, 100]),
  ]);

  return {
    v: '5.13.0',
    fr: 30,
    ip: 0,
    op: 120,
    w: 960,
    h: 600,
    nm: 'CFMS — Permission rule workspace',
    ddd: 0,
    assets: [],
    markers: [],
    layers: [
      shapeLayer(
        1,
        'Completion badge',
        [
          ellipse('Completion halo', [58, 58], [852, 70], colors.successSoft),
          ellipse('Completion mark surface', [40, 40], [852, 70], colors.success),
          linePath('Completion check', [[-9, 0], [-2, 7], [11, -7]], [852, 70], colors.surface, 4),
        ],
        { opacity: completionOpacity, scale: completionScale },
      ),
      shapeLayer(
        2,
        'New permission rule',
        [
          rectangle('New rule surface', [314, 58], [247, 438], 9, colors.accentSoft),
          rectangle('New rule marker', [4, 34], [100, 438], 2, colors.accent),
          ellipse('New rule add button', [30, 30], [374, 438], colors.accent),
          linePath('New rule plus horizontal', [[-6, 0], [6, 0]], [374, 438], colors.surface, 3),
          linePath('New rule plus vertical', [[0, -6], [0, 6]], [374, 438], colors.surface, 3),
          rectangle('New rule name', [116, 10], [185, 430], 5, colors.text, { opacity: 78 }),
          rectangle('New rule schedule', [84, 7], [169, 449], 4, colors.muted, { opacity: 58 }),
          rectangle('New rule state chip', [52, 18], [310, 438], 9, colors.successSoft),
          ellipse('New rule state dot', [7, 7], [294, 438], colors.success),
          rectangle('New rule state label', [22, 6], [316, 438], 3, colors.success),
        ],
        { opacity: newRuleOpacity, position: newRulePosition },
      ),
      shapeLayer(
        3,
        'Permission effect control',
        [
          rectangle('Effect selected segment', [142, 42], [0, 0], 8, colors.accentSoft, {
            transform: groupTransform({
              position: effectHighlightPosition,
              scale: effectHighlightScale,
            }),
          }),
          ellipse('Grant effect icon', [16, 16], [543, 324], colors.accent),
          linePath('Grant effect check', [[-4, 0], [-1, 3], [5, -4]], [543, 324], colors.surface, 2),
          rectangle('Grant effect label', [58, 8], [589, 324], 4, colors.accent),
          ellipse('Revoke effect icon', [16, 16], [704, 324], colors.danger),
          linePath('Revoke effect slash', [[-4, 4], [4, -4]], [704, 324], colors.surface, 2),
          rectangle('Revoke effect label', [54, 8], [748, 324], 4, colors.muted, { opacity: 70 }),
        ],
        { opacity: editorOpacity, position: editorPosition },
      ),
      shapeLayer(
        4,
        'Permission editor',
        [
          rectangle('Editor heading', [156, 13], [570, 154], 6, colors.text, { opacity: 90 }),
          rectangle('Editor autosave hint', [208, 7], [596, 176], 4, colors.muted, { opacity: 54 }),
          rectangle('Permission name label', [96, 8], [536, 220], 4, colors.text, { opacity: 74 }),
          rectangle('Permission name field', [322, 44], [643, 260], 9, colors.field, {
            outline: colors.line,
            outlineWidth: 2,
          }),
          rectangle('Permission name value', [162, 9], [578, 260], 4, colors.text, { opacity: 72 }),
          rectangle('Effect label', [92, 8], [534, 296], 4, colors.text, { opacity: 74 }),
          rectangle('Effect segmented field', [322, 44], [643, 324], 9, colors.field, {
            outline: colors.line,
            outlineWidth: 2,
          }),
          rectangle('Start time label', [102, 8], [539, 370], 4, colors.text, { opacity: 74 }),
          rectangle('Immediate schedule field', [322, 42], [643, 400], 9, colors.raised),
          ellipse('Immediate schedule icon', [14, 14], [508, 400], colors.accent),
          rectangle('Immediate schedule text', [112, 8], [584, 400], 4, colors.muted, { opacity: 68 }),
          rectangle('Validity label', [86, 8], [531, 446], 4, colors.text, { opacity: 74 }),
          rectangle('Never expires text', [116, 8], [556, 476], 4, colors.text, { opacity: 68 }),
          rectangle('Validity switch track', [48, 28], [780, 476], 14, colors.accentSoft),
          ellipse('Validity switch thumb', [20, 20], [790, 476], colors.accent),
        ],
        { opacity: editorOpacity, position: editorPosition },
      ),
      shapeLayer(
        5,
        'Selected permission rule',
        [
          rectangle('Selected rule surface', [314, 58], [247, 340], 9, colors.accentSoft),
          rectangle('Selected rule marker', [4, 34], [100, 340], 2, colors.accent),
          rectangle('Selected rule name', [132, 10], [192, 330], 5, colors.text, { opacity: 82 }),
          rectangle('Selected rule time', [106, 7], [179, 350], 4, colors.muted, { opacity: 56 }),
          rectangle('Selected grant chip', [58, 19], [310, 340], 10, colors.successSoft),
          ellipse('Selected grant dot', [7, 7], [292, 340], colors.success),
          rectangle('Selected grant label', [26, 6], [316, 340], 3, colors.success),
        ],
        { opacity: selectionOpacity, scale: selectionScale },
      ),
      shapeLayer(
        6,
        'Permission rule list',
        [
          rectangle('Rule list heading', [146, 12], [170, 154], 6, colors.text, { opacity: 88 }),
          rectangle('Rule list description', [196, 7], [195, 176], 4, colors.muted, { opacity: 52 }),
          rectangle('Add rule button', [102, 34], [355, 164], 17, colors.accentSoft),
          ellipse('Add rule icon surface', [18, 18], [327, 164], colors.accent),
          linePath('Add rule icon horizontal', [[-4, 0], [4, 0]], [327, 164], colors.surface, 2),
          linePath('Add rule icon vertical', [[0, -4], [0, 4]], [327, 164], colors.surface, 2),
          rectangle('Add rule label', [46, 7], [364, 164], 4, colors.accent),
          rectangle('Search field', [314, 38], [247, 216], 9, colors.field, {
            outline: colors.line,
            outlineWidth: 2,
          }),
          ellipse('Search lens', [13, 13], [112, 216], colors.field, {
            outline: colors.muted,
            outlineWidth: 2,
          }),
          linePath('Search handle', [[0, 0], [6, 6]], [117, 221], colors.muted, 2),
          rectangle('Search hint', [92, 7], [174, 216], 4, colors.muted, { opacity: 48 }),
          rectangle('All filter', [48, 24], [114, 250], 12, colors.accentSoft),
          rectangle('All filter label', [18, 6], [108, 250], 3, colors.accent),
          ellipse('All filter count', [13, 13], [127, 250], colors.accent),
          rectangle('Active filter', [64, 24], [177, 250], 12, colors.raised),
          rectangle('Active filter label', [34, 6], [170, 250], 3, colors.muted, { opacity: 62 }),
          ellipse('Active filter count', [13, 13], [196, 250], colors.line),
          rectangle('Changed filter', [72, 24], [254, 250], 12, colors.raised),
          rectangle('Changed filter label', [40, 6], [245, 250], 3, colors.muted, { opacity: 62 }),
          ellipse('Changed filter count', [13, 13], [278, 250], colors.line),
          rectangle('Rule row one', [314, 58], [247, 290], 9, colors.field),
          rectangle('Rule row one name', [118, 10], [184, 281], 5, colors.text, { opacity: 72 }),
          rectangle('Rule row one meta', [92, 7], [171, 301], 4, colors.muted, { opacity: 50 }),
          rectangle('Rule row one state', [54, 18], [310, 290], 9, colors.successSoft),
          ellipse('Rule row one dot', [7, 7], [293, 290], colors.success),
          rectangle('Rule row one state label', [24, 6], [315, 290], 3, colors.success),
          rectangle('Rule row three', [314, 58], [247, 390], 9, colors.field),
          rectangle('Rule row three name', [104, 10], [177, 381], 5, colors.text, { opacity: 66 }),
          rectangle('Rule row three meta', [82, 7], [166, 401], 4, colors.muted, { opacity: 48 }),
          rectangle('Rule row three state', [60, 18], [307, 390], 9, colors.dangerSoft),
          ellipse('Rule row three dot', [7, 7], [287, 390], colors.danger),
          rectangle('Rule row three state label', [28, 6], [312, 390], 3, colors.danger),
        ],
        { opacity: listOpacity, position: listPosition },
      ),
      shapeLayer(7, 'Permission workspace chrome', [
        rectangle(
          'Permission workspace surface',
          surfaceSize,
          [480, 300],
          surfaceRadius,
          colors.surface,
          {
            outline: colors.line,
            outlineWidth: 2,
            transform: groupTransform({ position: [480, 300], opacity: surfaceOpacity }),
          },
        ),
        rectangle('Permission workspace toolbar', [860, 54], [480, 60], 9, colors.surface, {
          transform: groupTransform({ position: [480, 60], opacity: chromeDetailOpacity }),
        }),
        rectangle('Toolbar account avatar', [30, 30], [79, 60], 15, colors.accentSoft, {
          transform: groupTransform({ position: [79, 60], opacity: chromeDetailOpacity }),
        }),
        rectangle('Toolbar account name', [120, 10], [164, 55], 5, colors.text, {
          opacity: 78,
          transform: groupTransform({ position: [164, 55], opacity: chromeDetailOpacity }),
        }),
        rectangle('Toolbar context', [78, 7], [143, 72], 4, colors.muted, {
          opacity: 54,
          transform: groupTransform({ position: [143, 72], opacity: chromeDetailOpacity }),
        }),
        linePath('Workspace toolbar divider', [[50, 90], [910, 90]], [0, 0], colors.line, 2,
          groupTransform({ opacity: chromeDetailOpacity })),
        linePath('Workspace pane divider', [[450, 90], [450, 570]], [0, 0], colors.line, 2,
          groupTransform({ opacity: chromeDetailOpacity })),
      ]),
      shapeLayer(
        8,
        'Underlying management page',
        [
          rectangle('Application frame', [900, 540], [480, 300], 18, colors.shell, {
            outline: colors.line,
            outlineWidth: 2,
          }),
          rectangle('Application navigation', [176, 438], [128, 323], 10, colors.surface),
          rectangle('Selected management navigation', [136, 36], [128, 214], 8, colors.accentSoft),
          rectangle('Selected management marker', [4, 24], [62, 214], 2, colors.accent),
          rectangle('Navigation label one', [86, 9], [126, 214], 4, colors.text, { opacity: 64 }),
          rectangle('Navigation label two', [102, 9], [134, 260], 4, colors.muted, { opacity: 48 }),
          rectangle('Navigation label three', [92, 9], [129, 306], 4, colors.muted, { opacity: 48 }),
          rectangle('Management heading', [178, 14], [380, 146], 7, colors.text, { opacity: 72 }),
          rectangle('Account row one', [574, 58], [574, 232], 10, colors.raised),
          rectangle('Account row two', [574, 58], [574, 306], 10, colors.raised),
          rectangle('Account row three', [574, 58], [574, 380], 10, colors.raised),
        ],
        { opacity: pageOpacity, scale: pageScale },
      ),
      shapeLayer(9, 'Scene background', [
        rectangle('Background', [960, 600], [480, 300], 0, colors.background),
      ]),
    ],
  };
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  Object.entries(themes).map(async ([theme, colors]) => {
    const outputPath = path.join(outputDirectory, `permission-management.${theme}.json`);
    await writeFile(outputPath, `${JSON.stringify(buildAnimation(colors))}\n`, 'utf8');
  }),
);
