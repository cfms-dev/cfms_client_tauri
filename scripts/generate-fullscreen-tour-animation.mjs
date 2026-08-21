#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(
  root,
  'src',
  'lib',
  'release-highlights',
  'animations',
  'v0.45',
);

const themes = {
  light: {
    workspace: [0.953, 0.953, 0.953],
    shell: [0.98, 0.98, 0.98],
    surface: [1, 1, 1],
    raised: [0.925, 0.925, 0.925],
    selected: [0.89, 0.89, 0.89],
    text: [0.102, 0.102, 0.102],
    muted: [0.365, 0.365, 0.365],
    border: [0.784, 0.784, 0.784],
    accent: [0, 0.404, 0.753],
    accentSoft: [0.847, 0.918, 1],
  },
  dark: {
    workspace: [0.059, 0.067, 0.082],
    shell: [0.09, 0.098, 0.114],
    surface: [0.125, 0.137, 0.165],
    raised: [0.204, 0.22, 0.251],
    selected: [0.255, 0.275, 0.31],
    text: [0.961, 0.961, 0.961],
    muted: [0.706, 0.722, 0.757],
    border: [0.31, 0.325, 0.353],
    accent: [0.376, 0.804, 1],
    accentSoft: [0.12, 0.25, 0.33],
  },
};

const hold = (t, s) => ({ t, s, e: s, h: 1 });
const move = (t, s, e, easing = 'travel') => {
  const handles = easing === 'entrance'
    ? { i: { x: [0.34], y: [0.94] }, o: { x: [0.2], y: [0.75] } }
    : easing === 'exit'
      ? { i: { x: [0.54], y: [0.42] }, o: { x: [1], y: [0.02] } }
      : { i: { x: [0], y: [0.55] }, o: { x: [1], y: [0.49] } };
  return { t, s, e, ...handles };
};
const terminal = (t, s) => ({ t, s });
const fixed = (k) => ({ a: 0, k });
const animated = (k) => ({ a: 1, k });

function transform({ opacity = fixed(100), position = fixed([0, 0, 0]), scale = fixed([100, 100, 100]) } = {}) {
  return {
    o: opacity,
    r: fixed(0),
    p: position,
    a: fixed([0, 0, 0]),
    s: scale,
  };
}

function groupTransform(position = [0, 0]) {
  return {
    ty: 'tr',
    p: fixed(position),
    a: fixed([0, 0]),
    s: fixed([100, 100]),
    r: fixed(0),
    o: fixed(100),
    sk: fixed(0),
    sa: fixed(0),
  };
}

function rectGroup(name, { size, position, radius = 6, color, opacity = 100, stroke, strokeWidth = 0 }) {
  const items = [
    { ty: 'rc', d: 1, s: size, p: fixed([0, 0]), r: radius },
    { ty: 'fl', c: fixed(color), o: fixed(opacity), r: 1 },
  ];
  if (stroke && strokeWidth > 0) {
    items.push({
      ty: 'st',
      c: fixed(stroke),
      o: fixed(100),
      w: fixed(strokeWidth),
      lc: 2,
      lj: 2,
      ml: 4,
    });
  }
  items.push({
    ...groupTransform(),
    p: position,
  });
  return { ty: 'gr', nm: name, it: items };
}

function pathGroup(name, vertices, color, width) {
  return {
    ty: 'gr',
    nm: name,
    it: [
      {
        ty: 'sh',
        d: 1,
        ks: fixed({
          i: vertices.map(() => [0, 0]),
          o: vertices.map(() => [0, 0]),
          v: vertices,
          c: false,
        }),
      },
      { ty: 'st', c: fixed(color), o: fixed(100), w: fixed(width), lc: 2, lj: 2, ml: 4 },
      groupTransform(),
    ],
  };
}

function shapeLayer(index, name, shapes, ks = transform()) {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: name,
    sr: 1,
    ks,
    ao: 0,
    shapes,
    ip: 0,
    op: 120,
    st: 0,
    bm: 0,
  };
}

function buildAnimation(colors) {
  const expansion = [
    hold(0, [620, 370]),
    move(18, [620, 370], [608, 360], 'exit'),
    move(24, [608, 360], [900, 540]),
    hold(70, [900, 540]),
    terminal(120, [900, 540]),
  ];
  const radius = [
    hold(0, [18]),
    move(24, [18], [0]),
    hold(70, [0]),
    terminal(120, [0]),
  ];
  const contentOpacity = animated([
    hold(0, [100]),
    move(18, [100], [28], 'exit'),
    move(30, [28], [100], 'entrance'),
    hold(66, [100]),
    terminal(120, [100]),
  ]);
  const reflow = (from, to) => animated([
    hold(0, from),
    move(24, from, to),
    hold(66, to),
    terminal(120, to),
  ]);

  const layers = [
    shapeLayer(1, 'Fullscreen boundary accents', [
      pathGroup('Top left corner', [[30, 72], [30, 30], [72, 30]], colors.accent, 4),
      pathGroup('Top right corner', [[888, 30], [930, 30], [930, 72]], colors.accent, 4),
      pathGroup('Bottom right corner', [[930, 528], [930, 570], [888, 570]], colors.accent, 4),
      pathGroup('Bottom left corner', [[72, 570], [30, 570], [30, 528]], colors.accent, 4),
    ], transform({
      opacity: animated([
        hold(0, [0]),
        move(44, [0], [100], 'entrance'),
        move(62, [100], [64], 'travel'),
        hold(76, [64]),
        terminal(120, [64]),
      ]),
    })),
    shapeLayer(2, 'Fullscreen tour content', [
      rectGroup('Primary action', {
        size: fixed([118, 34]),
        position: reflow([655, 438], [850, 535]),
        radius: fixed(6),
        color: colors.accent,
      }),
      rectGroup('Back action', {
        size: fixed([70, 10]),
        position: reflow([226, 438], [112, 535]),
        radius: fixed(5),
        color: colors.muted,
        opacity: 58,
      }),
      rectGroup('Progress rail', {
        size: reflow([186, 3], [250, 3]),
        position: reflow([410, 438], [355, 535]),
        radius: fixed(2),
        color: colors.accent,
      }),
      rectGroup('Body line three', {
        size: fixed([166, 8]),
        position: reflow([626, 350], [718, 358]),
        radius: fixed(4),
        color: colors.muted,
        opacity: 42,
      }),
      rectGroup('Body line two', {
        size: fixed([212, 8]),
        position: reflow([649, 324], [741, 326]),
        radius: fixed(4),
        color: colors.muted,
        opacity: 48,
      }),
      rectGroup('Body line one', {
        size: fixed([224, 8]),
        position: reflow([655, 298], [747, 294]),
        radius: fixed(4),
        color: colors.muted,
        opacity: 54,
      }),
      rectGroup('Feature heading', {
        size: reflow([156, 18], [202, 22]),
        position: reflow([621, 258], [716, 246]),
        radius: fixed(6),
        color: colors.text,
        opacity: 92,
      }),
      rectGroup('Feature count', {
        size: fixed([54, 7]),
        position: reflow([570, 226], [647, 203]),
        radius: fixed(4),
        color: colors.accent,
      }),
      rectGroup('Scene accent', {
        size: reflow([116, 70], [170, 104]),
        position: reflow([350, 300], [315, 298]),
        radius: fixed(14),
        color: colors.accentSoft,
      }),
      rectGroup('Scene line three', {
        size: fixed([132, 8]),
        position: reflow([350, 357], [315, 390]),
        radius: fixed(4),
        color: colors.muted,
        opacity: 38,
      }),
      rectGroup('Scene line two', {
        size: fixed([176, 8]),
        position: reflow([350, 337], [315, 368]),
        radius: fixed(4),
        color: colors.muted,
        opacity: 46,
      }),
      rectGroup('Scene line one', {
        size: fixed([194, 9]),
        position: reflow([350, 188], [315, 156]),
        radius: fixed(5),
        color: colors.text,
        opacity: 68,
      }),
      rectGroup('Animation stage', {
        size: reflow([330, 220], [510, 330]),
        position: reflow([350, 292], [315, 300]),
        radius: reflow([12], [8]),
        color: colors.raised,
        stroke: colors.border,
        strokeWidth: 2,
      }),
      rectGroup('Release label', {
        size: fixed([178, 9]),
        position: reflow([284, 145], [154, 60]),
        radius: fixed(5),
        color: colors.text,
        opacity: 72,
      }),
      rectGroup('Skip action', {
        size: fixed([70, 9]),
        position: reflow([722, 145], [856, 60]),
        radius: fixed(5),
        color: colors.muted,
        opacity: 66,
      }),
    ], transform({ opacity: contentOpacity })),
    shapeLayer(3, 'Tour chrome', [
      rectGroup('Footer divider', {
        size: reflow([580, 2], [860, 2]),
        position: reflow([480, 415], [480, 505]),
        radius: fixed(1),
        color: colors.border,
        opacity: 62,
      }),
      rectGroup('Toolbar divider', {
        size: reflow([580, 2], [860, 2]),
        position: reflow([480, 175], [480, 92]),
        radius: fixed(1),
        color: colors.border,
        opacity: 62,
      }),
      rectGroup('Tour surface', {
        size: animated(expansion),
        position: fixed([480, 300]),
        radius: animated(radius),
        color: colors.surface,
        stroke: colors.border,
        strokeWidth: 2,
      }),
    ]),
    shapeLayer(4, 'Window state cue', [
      pathGroup('Expand northeast', [[466, 292], [492, 266], [492, 280], [492, 266], [478, 266]], colors.accent, 4),
      pathGroup('Expand southwest', [[466, 308], [440, 334], [454, 334], [440, 334], [440, 320]], colors.accent, 4),
    ], transform({
      opacity: animated([
        hold(0, [0]),
        move(8, [0], [100], 'entrance'),
        hold(18, [100]),
        move(24, [100], [0], 'exit'),
        hold(36, [0]),
        terminal(120, [0]),
      ]),
      scale: animated([
        hold(0, [82, 82, 100]),
        move(8, [82, 82, 100], [100, 100, 100], 'entrance'),
        move(18, [100, 100, 100], [112, 112, 100]),
        hold(30, [112, 112, 100]),
        terminal(120, [112, 112, 100]),
      ]),
    })),
    shapeLayer(5, 'Workspace scrim', [
      rectGroup('Focus scrim', {
        size: fixed([900, 540]),
        position: fixed([480, 300]),
        radius: fixed(18),
        color: colors.workspace,
        opacity: 58,
      }),
    ], transform({
      opacity: animated([
        hold(0, [100]),
        move(24, [100], [0], 'exit'),
        hold(62, [0]),
        terminal(120, [0]),
      ]),
    })),
    shapeLayer(6, 'Underlying workspace', [
      rectGroup('Selected navigation row', {
        size: fixed([134, 34]),
        position: fixed([145, 228]),
        radius: fixed(6),
        color: colors.selected,
      }),
      rectGroup('Navigation marker', {
        size: fixed([4, 24]),
        position: fixed([84, 228]),
        radius: fixed(2),
        color: colors.accent,
      }),
      rectGroup('Navigation row three', {
        size: fixed([92, 9]),
        position: fixed([145, 292]),
        radius: fixed(5),
        color: colors.muted,
        opacity: 42,
      }),
      rectGroup('Navigation row two', {
        size: fixed([106, 9]),
        position: fixed([152, 260]),
        radius: fixed(5),
        color: colors.muted,
        opacity: 42,
      }),
      rectGroup('Navigation row one', {
        size: fixed([96, 9]),
        position: fixed([147, 228]),
        radius: fixed(5),
        color: colors.text,
        opacity: 66,
      }),
      rectGroup('Content row three', {
        size: fixed([570, 50]),
        position: fixed([575, 386]),
        radius: fixed(8),
        color: colors.raised,
      }),
      rectGroup('Content row two', {
        size: fixed([570, 50]),
        position: fixed([575, 318]),
        radius: fixed(8),
        color: colors.raised,
      }),
      rectGroup('Content row one', {
        size: fixed([570, 50]),
        position: fixed([575, 250]),
        radius: fixed(8),
        color: colors.raised,
      }),
      rectGroup('Workspace heading', {
        size: fixed([170, 13]),
        position: fixed([398, 152]),
        radius: fixed(6),
        color: colors.text,
        opacity: 72,
      }),
    ], transform({
      opacity: animated([
        hold(0, [100]),
        move(18, [100], [72], 'exit'),
        move(24, [72], [0], 'exit'),
        hold(62, [0]),
        terminal(120, [0]),
      ]),
      scale: animated([
        hold(0, [100, 100, 100]),
        move(18, [100, 100, 100], [97, 97, 100], 'exit'),
        hold(42, [97, 97, 100]),
        terminal(120, [97, 97, 100]),
      ]),
      position: fixed([14, 9, 0]),
    })),
    shapeLayer(7, 'Application shell', [
      rectGroup('Application frame', {
        size: fixed([900, 540]),
        position: fixed([480, 300]),
        radius: fixed(18),
        color: colors.shell,
        stroke: colors.border,
        strokeWidth: 2,
      }),
      rectGroup('Application toolbar', {
        size: fixed([860, 52]),
        position: fixed([480, 62]),
        radius: fixed(9),
        color: colors.surface,
      }),
      rectGroup('Application navigation', {
        size: fixed([180, 438]),
        position: fixed([130, 323]),
        radius: fixed(10),
        color: colors.surface,
      }),
    ]),
    shapeLayer(8, 'Scene background', [
      rectGroup('Background', {
        size: fixed([960, 600]),
        position: fixed([480, 300]),
        radius: fixed(0),
        color: colors.workspace,
      }),
    ]),
  ];

  return {
    v: '5.13.0',
    fr: 30,
    ip: 0,
    op: 120,
    w: 960,
    h: 600,
    nm: 'CFMS — Full-screen feature tour',
    ddd: 0,
    assets: [],
    markers: [],
    layers,
  };
}

await mkdir(outputDirectory, { recursive: true });
for (const [theme, colors] of Object.entries(themes)) {
  const outputPath = path.join(outputDirectory, `fullscreen-tour.${theme}.json`);
  await writeFile(outputPath, `${JSON.stringify(buildAnimation(colors))}\n`, 'utf8');
  process.stdout.write(`Generated ${path.relative(root, outputPath)}\n`);
}
