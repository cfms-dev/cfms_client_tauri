import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'src', 'lib', 'release-highlights', 'animations', 'v0.43');
const FRAME_RATE = 30;
const END_FRAME = 120;
const WIDTH = 960;
const HEIGHT = 600;

const palettes = {
  dark: {
    workspace: '#0f1115', surface: '#17191d', raised: '#20232a', hover: '#292d35', selected: '#343840',
    border: '#4c515a', text: '#f5f5f5', muted: '#b4b8c1', accent: '#60cdff', accentSoft: '#214453',
    success: '#6ccb8e', warning: '#f5d47a', danger: '#ff99a4',
  },
  light: {
    workspace: '#f3f3f3', surface: '#fafafa', raised: '#ffffff', hover: '#ececec', selected: '#e3e3e3',
    border: '#c8c8c8', text: '#1a1a1a', muted: '#6a6a6a', accent: '#0067c0', accentSoft: '#d8eaff',
    success: '#0f7b3e', warning: '#8a5d00', danger: '#c42b1c',
  },
};

const easeIn = { x: [0.16], y: [1] };
const easeOut = { x: [0.3], y: [0] };
const constant = (value) => ({ a: 0, k: value });
const property = (value) => (
  value && typeof value === 'object' && 'a' in value ? value : constant(value)
);

const curve = (x1, y1, x2, y2) => ({
  i: { x: [x2], y: [y2] },
  o: { x: [x1], y: [y1] },
});
const motionCurves = {
  entrance: curve(0.2, 0.75, 0.34, 0.94),
  settle: curve(0, 0.65, 0.51, 0.99),
  travel: curve(1, 0.49, 0, 0.55),
  exit: curve(1, 0.02, 0.54, 0.42),
};

function color(value) {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function animated(points) {
  return {
    a: 1,
    k: points.map(([time, value], index) => {
      const next = points[index + 1];
      return next
        ? { t: time, s: value, e: next[1], i: easeIn, o: easeOut }
        : { t: time, s: value };
    }),
  };
}

function motion(points, defaultCurve = motionCurves.settle) {
  return {
    a: 1,
    k: points.map(([time, value, easing = defaultCurve], index) => {
      const next = points[index + 1];
      if (!next) return { t: time, s: value };
      if (easing === 'hold') return { t: time, s: value, e: next[1], h: 1 };
      return { t: time, s: value, e: next[1], ...easing };
    }),
  };
}

function transform({ position = [0, 0, 0], scale = [100, 100, 100], opacity = 100, rotation = 0, anchor = [0, 0, 0] } = {}) {
  return {
    o: typeof opacity === 'object' ? opacity : constant(opacity),
    r: typeof rotation === 'object' ? rotation : constant(rotation),
    p: typeof position === 'object' && 'a' in position ? position : constant(position),
    a: constant(anchor),
    s: typeof scale === 'object' && 'a' in scale ? scale : constant(scale),
  };
}

function group(name, items, position = [0, 0]) {
  return {
    ty: 'gr', nm: name,
    it: [...items, { ty: 'tr', p: property(position), a: constant([0, 0]), s: constant([100, 100]), r: constant(0), o: constant(100), sk: constant(0), sa: constant(0) }],
  };
}

const fill = (value, opacity = 100) => ({ ty: 'fl', c: constant(color(value)), o: constant(opacity), r: 1 });
const stroke = (value, width = 4, opacity = 100) => ({ ty: 'st', c: constant(color(value)), o: constant(opacity), w: constant(width), lc: 2, lj: 2, ml: 4 });

function rectangle(name, size, position, radius, fillColor, strokeColor, strokeWidth = 0, opacity = 100) {
  const styles = [fill(fillColor, opacity)];
  if (strokeColor && strokeWidth) styles.push(stroke(strokeColor, strokeWidth));
  return group(name, [{ ty: 'rc', d: 1, s: property(size), p: constant([0, 0]), r: constant(radius) }, ...styles], position);
}

function ellipse(name, size, position, fillColor, strokeColor, strokeWidth = 0, opacity = 100) {
  const styles = fillColor ? [fill(fillColor, opacity)] : [];
  if (strokeColor && strokeWidth) styles.push(stroke(strokeColor, strokeWidth, opacity));
  return group(name, [{ ty: 'el', d: 1, s: constant(size), p: constant([0, 0]) }, ...styles], position);
}

function vectorPath(name, vertices, closed, position, strokeColor, strokeWidth, fillColor = null, opacity = 100) {
  const zeroTangents = vertices.map(() => [0, 0]);
  const styles = [];
  if (fillColor) styles.push(fill(fillColor, opacity));
  if (strokeColor) styles.push(stroke(strokeColor, strokeWidth, opacity));
  return group(name, [{ ty: 'sh', d: 1, ks: constant({ i: zeroTangents, o: zeroTangents, v: vertices, c: closed }) }, ...styles], position);
}

function trimPath(name, end) {
  return { ty: 'tm', nm: name, s: constant(0), e: end, o: constant(0), m: 1 };
}

function shapeLayer(name, shapes, layerTransform = transform()) {
  return { ddd: 0, ind: 0, ty: 4, nm: name, sr: 1, ks: layerTransform, ao: 0, shapes, ip: 0, op: END_FRAME, st: 0, bm: 0 };
}

function composition(name, layers) {
  return { v: '5.13.0', fr: FRAME_RATE, ip: 0, op: END_FRAME, w: WIDTH, h: HEIGHT, nm: name, ddd: 0, assets: [], markers: [], layers: layers.map((layer, index) => ({ ...layer, ind: index + 1 })) };
}

function appFrame(palette, selectedRow = 1) {
  const navRows = [0, 1, 2, 3].map((row) => rectangle(
    `Navigation row ${row + 1}`, [116, 12], [158, 222 + row * 42], 6,
    row === selectedRow ? palette.accent : palette.muted, null, 0, row === selectedRow ? 100 : 48,
  ));
  return [
    rectangle('Application window', [836, 500], [480, 300], 22, palette.surface, palette.border, 3),
    rectangle('Title bar', [800, 52], [480, 94], 12, palette.raised),
    ellipse('Window control one', [13, 13], [116, 94], palette.danger),
    ellipse('Window control two', [13, 13], [141, 94], palette.warning),
    ellipse('Window control three', [13, 13], [166, 94], palette.success),
    rectangle('Application title', [132, 10], [286, 94], 5, palette.text, null, 0, 82),
    rectangle('Navigation surface', [174, 400], [161, 326], 14, palette.raised),
    ...navRows,
  ];
}

function documentDownload(palette) {
  const completedPosition = motion([
    [0, [540, 440, 0], 'hold'], [8, [540, 440, 0], motionCurves.exit], [18, [540, 462, 0], 'hold'],
    [100, [540, 462, 0], motionCurves.settle], [112, [540, 440, 0], 'hold'], [120, [540, 440, 0]],
  ]);
  const completedOpacity = motion([
    [0, [100], 'hold'], [8, [100], motionCurves.exit], [17, [0], 'hold'], [100, [0], motionCurves.entrance],
    [109, [100], 'hold'], [120, [100]],
  ]);
  const entryOpacity = motion([
    [0, [0], 'hold'], [17, [0], motionCurves.entrance], [25, [100], 'hold'], [34, [100], motionCurves.exit],
    [41, [0], 'hold'], [120, [0]],
  ]);
  const entryScale = motion([
    [0, [100, 100, 100], 'hold'], [26, [100, 100, 100], motionCurves.exit], [29, [97, 97, 100], motionCurves.settle],
    [34, [100, 100, 100], 'hold'], [120, [100, 100, 100]],
  ]);
  const dialogOpacity = motion([
    [0, [0], 'hold'], [36, [0], motionCurves.entrance], [45, [100], 'hold'], [91, [100], motionCurves.exit],
    [101, [0], 'hold'], [120, [0]],
  ]);
  const dialogScale = motion([
    [0, [98, 98, 100], 'hold'], [36, [98, 98, 100], motionCurves.settle], [48, [100, 100, 100], 'hold'],
    [91, [100, 100, 100], motionCurves.exit], [101, [99, 99, 100], 'hold'], [104, [98, 98, 100], 'hold'],
    [120, [98, 98, 100]],
  ]);
  const dialogPosition = motion([
    [0, [540, 310, 0], 'hold'], [36, [540, 310, 0], motionCurves.settle], [48, [540, 300, 0], 'hold'],
    [91, [540, 300, 0], motionCurves.exit], [101, [540, 288, 0], 'hold'], [104, [540, 310, 0], 'hold'],
    [120, [540, 310, 0]],
  ]);
  const typedOpacity = (start) => motion([
    [0, [0], 'hold'], [start, [0], motionCurves.entrance], [start + 4, [100], 'hold'], [88, [100], motionCurves.exit],
    [97, [0], 'hold'], [120, [0]],
  ]);
  const typedScale = (start) => motion([
    [0, [18, 100, 100], 'hold'], [start, [18, 100, 100], motionCurves.settle], [start + 5, [100, 100, 100], 'hold'],
    [97, [100, 100, 100], 'hold'], [100, [18, 100, 100], 'hold'], [120, [18, 100, 100]],
  ]);
  const downloadFeedbackOpacity = motion([
    [0, [0], 'hold'], [70, [0], motionCurves.entrance], [73, [100], 'hold'], [76, [100], motionCurves.exit],
    [79, [0], 'hold'], [120, [0]],
  ]);
  const downloadFeedbackScale = motion([
    [0, [100, 100, 100], 'hold'], [70, [100, 100, 100], motionCurves.exit], [73, [97, 97, 100], motionCurves.settle],
    [79, [100, 100, 100], 'hold'], [120, [100, 100, 100]],
  ]);
  const verificationOpacity = motion([
    [0, [0], 'hold'], [77, [0], motionCurves.entrance], [84, [100], 'hold'], [91, [100], motionCurves.exit],
    [99, [0], 'hold'], [120, [0]],
  ]);
  const verificationPosition = motion([
    [0, [8, 0, 0], 'hold'], [77, [8, 0, 0], motionCurves.settle], [87, [0, 0, 0], 'hold'],
    [99, [0, 0, 0], 'hold'], [102, [8, 0, 0], 'hold'], [120, [8, 0, 0]],
  ]);
  const verificationScale = motion([
    [0, [96, 96, 100], 'hold'], [77, [96, 96, 100], motionCurves.settle], [87, [100, 100, 100], 'hold'],
    [99, [100, 100, 100], 'hold'], [102, [96, 96, 100], 'hold'], [120, [96, 96, 100]],
  ]);
  const verificationTrim = motion([
    [0, [0], 'hold'], [80, [0], motionCurves.settle], [87, [100], 'hold'], [91, [100], motionCurves.exit],
    [97, [0], 'hold'], [120, [0]],
  ]);

  return composition('CFMS — Download by document ID', [
    shapeLayer('Completed transfer', [
      vectorPath('Completed check', [[-7, 0], [-1, 7], [10, -8]], false, [176, 0], palette.surface, 4),
      ellipse('Completed status', [30, 30], [176, 0], palette.success),
      rectangle('Transfer metadata', [116, 8], [-69, 13], 4, palette.muted, null, 0, 62),
      rectangle('File name', [158, 10], [-48, -13], 5, palette.text, null, 0, 86),
      rectangle('File symbol', [38, 46], [-170, 0], 7, palette.accentSoft, palette.accent, 3),
      rectangle('Transfer row', [430, 70], [0, 0], 12, palette.selected, palette.border, 2),
    ], transform({ position: completedPosition, opacity: completedOpacity })),
    shapeLayer('Verification check', [
      group('Verification check mark', [
        { ty: 'sh', d: 1, ks: constant({ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-9, 0], [-2, 8], [12, -10]], c: false }) },
        stroke(palette.surface, 5), trimPath('Verification draw', verificationTrim),
      ], [660, 346]),
    ], transform({ position: [660, 346, 0], anchor: [660, 346, 0], scale: verificationScale, opacity: verificationOpacity })),
    shapeLayer('Verification badge', [ellipse('Verification badge surface', [42, 42], [660, 346], palette.success)], transform({
      position: [660, 346, 0], anchor: [660, 346, 0], scale: verificationScale, opacity: verificationOpacity,
    })),
    shapeLayer('Verification content', [
      rectangle('Verified metadata', [112, 8], [540, 359], 4, palette.muted, null, 0, 58),
      rectangle('Verified document', [150, 9], [559, 337], 5, palette.text, null, 0, 82),
    ], transform({ position: verificationPosition, opacity: verificationOpacity })),
    shapeLayer('Download action feedback', [rectangle('Download action press', [118, 38], [660, 390], 8, palette.text, null, 0, 12)], transform({
      position: [660, 390, 0], anchor: [660, 390, 0], scale: downloadFeedbackScale, opacity: downloadFeedbackOpacity,
    })),
    shapeLayer('Typed segment three', [rectangle('ID segment three', [54, 12], [573, 275], 6, palette.accent)], transform({
      position: [573, 275, 0], anchor: [573, 275, 0], scale: typedScale(60), opacity: typedOpacity(60),
    })),
    shapeLayer('Typed segment two', [rectangle('ID segment two', [42, 12], [516, 275], 6, palette.accent)], transform({
      position: [516, 275, 0], anchor: [516, 275, 0], scale: typedScale(55), opacity: typedOpacity(55),
    })),
    shapeLayer('Typed segment one', [rectangle('ID segment one', [64, 12], [449, 275], 6, palette.accent)], transform({
      position: [449, 275, 0], anchor: [449, 275, 0], scale: typedScale(50), opacity: typedOpacity(50),
    })),
    shapeLayer('Download dialog', [
      vectorPath('Download arrow head', [[-7, -1], [0, 6], [7, -1]], false, [630, 390], palette.workspace, 4),
      vectorPath('Download arrow shaft', [[0, -9], [0, 6]], false, [630, 390], palette.workspace, 4),
      rectangle('Download button', [118, 38], [660, 390], 8, palette.accent),
      rectangle('ID field', [330, 52], [540, 276], 11, palette.surface, palette.border, 2),
      rectangle('Field label', [88, 8], [390, 251], 4, palette.muted),
      rectangle('Dialog close', [18, 18], [718, 210], 6, palette.muted),
      rectangle('Dialog title', [184, 13], [440, 210], 7, palette.text, null, 0, 90),
      rectangle('Dialog surface', [430, 270], [540, 300], 18, palette.raised, palette.border, 3),
    ], transform({ position: dialogPosition, scale: dialogScale, opacity: dialogOpacity, anchor: [540, 300, 0] })),
    shapeLayer('Download entry highlight', [
      vectorPath('Entry arrow head', [[-7, -1], [0, 6], [7, -1]], false, [720, 139], palette.accent, 4),
      vectorPath('Entry arrow shaft', [[0, -8], [0, 6]], false, [720, 139], palette.accent, 4),
      rectangle('Download entry', [126, 36], [761, 139], 8, palette.accentSoft, palette.accent, 2),
    ], transform({ position: [761, 139, 0], anchor: [761, 139, 0], scale: entryScale, opacity: entryOpacity })),
    shapeLayer('Application shell', [
      rectangle('Content row three', [492, 48], [534, 346], 10, palette.hover),
      rectangle('Content row two', [492, 48], [534, 282], 10, palette.hover),
      rectangle('Content row one', [492, 48], [534, 218], 10, palette.hover),
      rectangle('Content heading', [206, 14], [393, 154], 7, palette.text, null, 0, 86),
      ...appFrame(palette, 2).reverse(),
    ]),
  ]);
}

function flexibleWorkspace(palette) {
  const dividerPosition = motion([
    [0, [602, 314, 0], 'hold'], [12, [602, 314, 0], motionCurves.travel], [24, [658, 314, 0], 'hold'],
    [36, [658, 314, 0], motionCurves.travel], [60, [602, 314, 0], 'hold'], [120, [602, 314, 0]],
  ]);
  const handleOpacity = motion([
    [0, [0], 'hold'], [24, [0], motionCurves.entrance], [30, [100], 'hold'], [60, [100], motionCurves.exit],
    [68, [0], 'hold'], [120, [0]],
  ]);
  const pointerPosition = motion([
    [0, [735, 238, 0], 'hold'], [20, [735, 238, 0], motionCurves.travel], [26, [658, 316, 0], 'hold'],
    [32, [658, 316, 0], motionCurves.travel], [36, [662, 316, 0], motionCurves.travel], [60, [602, 316, 0], 'hold'],
    [66, [602, 316, 0], motionCurves.travel], [78, [783, 272, 0], motionCurves.travel], [83, [783, 274, 0], motionCurves.travel],
    [103, [735, 238, 0], 'hold'], [120, [735, 238, 0]],
  ]);
  const pointerOpacity = motion([
    [0, [0], 'hold'], [26, [0], motionCurves.entrance], [32, [100], 'hold'], [96, [100], motionCurves.exit],
    [104, [0], 'hold'], [120, [0]],
  ]);
  const pointerScale = motion([
    [0, [100, 100, 100], 'hold'], [32, [100, 100, 100], motionCurves.exit], [36, [97, 97, 100], motionCurves.settle],
    [42, [100, 100, 100], 'hold'], [78, [100, 100, 100], motionCurves.exit], [83, [97, 97, 100], motionCurves.settle],
    [89, [100, 100, 100], 'hold'], [120, [100, 100, 100]],
  ]);
  const detailSurfaceSize = motion([
    [0, [226, 354], 'hold'], [12, [226, 354], motionCurves.travel], [24, [170, 354], 'hold'],
    [36, [170, 354], motionCurves.travel], [60, [226, 354], 'hold'], [120, [226, 354]],
  ]);
  const detailPosition = motion([
    [0, [715, 314, 0], 'hold'], [12, [715, 314, 0], motionCurves.travel], [24, [743, 314, 0], 'hold'],
    [36, [743, 314, 0], motionCurves.travel], [60, [715, 314, 0], 'hold'], [120, [715, 314, 0]],
  ]);
  const modalOpacity = motion([
    [0, [100], 'hold'], [10, [100], motionCurves.exit], [20, [0], 'hold'], [66, [0], motionCurves.entrance],
    [78, [100], 'hold'], [120, [100]],
  ]);
  const modalScale = motion([
    [0, [112, 112, 100], 'hold'], [10, [112, 112, 100], motionCurves.exit], [22, [96, 96, 100], 'hold'],
    [66, [96, 96, 100], motionCurves.settle], [78, [100, 100, 100], 'hold'], [83, [100, 100, 100], motionCurves.settle],
    [103, [112, 112, 100], 'hold'], [120, [112, 112, 100]],
  ]);
  const modalPosition = motion([
    [0, [620, 310, 0], 'hold'], [10, [620, 310, 0], motionCurves.exit], [22, [680, 336, 0], 'hold'],
    [83, [680, 336, 0], motionCurves.travel], [103, [620, 310, 0], 'hold'], [120, [620, 310, 0]],
  ]);

  return composition('CFMS — Flexible workspace', [
    shapeLayer('Interaction pointer', [vectorPath('Pointer', [[0, 0], [0, 26], [8, 19], [15, 32], [22, 28], [15, 15], [25, 14]], true, [0, 0], palette.workspace, 2, palette.text)], transform({ position: pointerPosition, scale: pointerScale, opacity: pointerOpacity })),
    shapeLayer('Resizable window', [
      rectangle('Window action', [84, 30], [76, 58], 7, palette.accent),
      rectangle('Window line two', [202, 10], [-8, 15], 5, palette.muted, null, 0, 48),
      rectangle('Window line one', [174, 10], [-22, -18], 5, palette.muted, null, 0, 62),
      rectangle('Maximize control', [22, 22], [103, -64], 5, palette.accentSoft, palette.accent, 2),
      rectangle('Window title', [104, 9], [-52, -64], 5, palette.text, null, 0, 78),
      rectangle('Window title bar', [254, 36], [0, -64], 9, palette.surface),
      rectangle('Window surface', [286, 196], [0, 0], 16, palette.raised, palette.accent, 3),
    ], transform({ position: modalPosition, scale: modalScale, opacity: modalOpacity })),
    shapeLayer('Resize handle', [
      rectangle('Divider', [5, 354], [0, 0], 3, palette.accent),
      ellipse('Handle', [18, 42], [0, 0], palette.accentSoft, palette.accent, 3),
    ], transform({ position: dividerPosition, opacity: handleOpacity })),
    shapeLayer('Details content', [
      rectangle('Details heading', [116, 11], [-28, -137], 6, palette.text, null, 0, 82),
      rectangle('Preview', [148, 96], [0, -61], 12, palette.selected),
      rectangle('Detail line one', [142, 9], [-3, 18], 5, palette.muted, null, 0, 56),
      rectangle('Detail line two', [118, 9], [-15, 47], 5, palette.muted, null, 0, 46),
      rectangle('Detail line three', [152, 9], [2, 76], 5, palette.muted, null, 0, 52),
    ], transform({ position: detailPosition })),
    shapeLayer('Details pane', [
      rectangle('Details surface', detailSurfaceSize, [0, 0], 14, palette.raised, palette.border, 2),
    ], transform({ position: detailPosition })),
    shapeLayer('Workspace content', [
      rectangle('File row one', [340, 44], [420, 214], 8, palette.hover), rectangle('File row two', [340, 44], [420, 274], 8, palette.hover),
      rectangle('Selected file row', [340, 44], [420, 334], 8, palette.selected), rectangle('File row four', [340, 44], [420, 394], 8, palette.hover),
      rectangle('Selected marker', [4, 30], [252, 334], 2, palette.accent),
    ]),
    shapeLayer('Application shell', appFrame(palette, 1)),
  ]);
}

function serverDiagnostics(palette) {
  const scanPosition = animated([[0, [570, 195, 0]], [12, [570, 195, 0]], [55, [570, 415, 0]], [66, [570, 415, 0]], [120, [570, 415, 0]]]);
  const scanOpacity = animated([[0, [0]], [8, [100]], [55, [100]], [68, [0]], [120, [0]]]);
  const loadingScale = animated([[0, [0, 100, 100]], [8, [0, 100, 100]], [62, [100, 100, 100]], [120, [100, 100, 100]]]);
  const statusOne = animated([[0, [0]], [42, [0]], [57, [100]], [120, [100]]]);
  const statusTwo = animated([[0, [0]], [53, [0]], [68, [100]], [120, [100]]]);
  const statusThree = animated([[0, [0]], [64, [0]], [79, [100]], [120, [100]]]);
  const statusFour = animated([[0, [0]], [75, [0]], [90, [100]], [120, [100]]]);
  const statusCard = (name, position, opacity, tone) => shapeLayer(name, [
    rectangle(`${name} surface`, [220, 104], [0, 0], 13, palette.raised, palette.border, 2),
    ellipse(`${name} status`, [24, 24], [-78, -27], tone),
    rectangle(`${name} heading`, [84, 9], [9, -27], 5, palette.text, null, 0, 78),
    rectangle(`${name} metric one`, [146, 8], [-11, 8], 4, palette.muted, null, 0, 52),
    rectangle(`${name} metric two`, [112, 8], [-28, 31], 4, palette.muted, null, 0, 42),
  ], transform({ position, opacity }));

  return composition('CFMS — Server diagnostics', [
    statusCard('Extensions status', [694, 386, 0], statusFour, palette.success),
    statusCard('Components status', [448, 386, 0], statusThree, palette.success),
    statusCard('Runtime status', [694, 258, 0], statusTwo, palette.warning),
    statusCard('Server status', [448, 258, 0], statusOne, palette.success),
    shapeLayer('Diagnostics scan', [rectangle('Scan line', [452, 5], [0, 0], 3, palette.accent), ellipse('Scan head', [18, 18], [218, 0], palette.accent)], transform({ position: scanPosition, opacity: scanOpacity })),
    shapeLayer('Loading progress', [rectangle('Progress fill', [448, 5], [0, 0], 3, palette.accent)], transform({ position: [570, 174, 0], scale: loadingScale, anchor: [-224, 0, 0] })),
    shapeLayer('Diagnostics content', [rectangle('Page heading', [194, 14], [410, 142], 7, palette.text, null, 0, 88), rectangle('Refresh action', [92, 34], [758, 142], 8, palette.accentSoft, palette.accent, 2)]),
    shapeLayer('Application shell', appFrame(palette, 3)),
  ]);
}

function accountAdministration(palette) {
  const selectionPosition = motion([
    [0, [0, 50, 0], 'hold'], [18, [0, 50, 0], motionCurves.travel], [30, [0, 0, 0], 'hold'],
    [38, [0, 0, 0], motionCurves.exit], [41, [0, -3, 0], motionCurves.travel], [53, [0, 50, 0], 'hold'], [120, [0, 50, 0]],
  ]);
  const selectedContentPosition = motion([
    [0, [0, 50, 0], 'hold'], [18, [0, 50, 0], motionCurves.travel], [30, [0, 0, 0], 'hold'],
    [40, [0, 0, 0], motionCurves.travel], [53, [0, 50, 0], 'hold'], [120, [0, 50, 0]],
  ]);
  const selectedContentOpacity = motion([
    [0, [100], 'hold'], [14, [100], motionCurves.exit], [18, [0], 'hold'], [27, [0], motionCurves.entrance],
    [32, [100], 'hold'], [36, [100], motionCurves.exit], [40, [0], 'hold'], [51, [0], motionCurves.entrance],
    [56, [100], 'hold'], [120, [100]],
  ]);
  const contextOpacity = motion([
    [0, [100], 'hold'], [12, [100], motionCurves.exit], [24, [0], 'hold'], [54, [0], motionCurves.entrance],
    [66, [100], 'hold'], [120, [100]],
  ]);
  const contextPosition = motion([
    [0, [0, 0, 0], 'hold'], [12, [0, 0, 0], motionCurves.exit], [24, [8, 0, 0], 'hold'],
    [54, [8, 0, 0], motionCurves.settle], [68, [0, 0, 0], 'hold'], [120, [0, 0, 0]],
  ]);
  const resetPressOpacity = motion([
    [0, [0], 'hold'], [67, [0], motionCurves.entrance], [70, [100], 'hold'], [73, [100], motionCurves.exit],
    [76, [0], 'hold'], [120, [0]],
  ]);
  const resetPressScale = motion([
    [0, [100, 100, 100], 'hold'], [67, [100, 100, 100], motionCurves.exit], [71, [97, 97, 100], motionCurves.settle],
    [76, [100, 100, 100], 'hold'], [120, [100, 100, 100]],
  ]);
  const modalOpacity = motion([
    [0, [0], 'hold'], [74, [0], motionCurves.entrance], [84, [100], 'hold'], [100, [100], motionCurves.exit],
    [108, [0], 'hold'], [120, [0]],
  ]);
  const modalScale = motion([
    [0, [98, 98, 100], 'hold'], [74, [98, 98, 100], motionCurves.settle], [88, [100, 100, 100], 'hold'],
    [100, [100, 100, 100], motionCurves.exit], [108, [98, 98, 100], 'hold'], [120, [98, 98, 100]],
  ]);
  const modalPosition = motion([
    [0, [628, 308, 0], 'hold'], [74, [628, 324, 0], motionCurves.settle], [88, [628, 314, 0], 'hold'],
    [100, [628, 314, 0], motionCurves.exit], [108, [628, 308, 0], 'hold'], [120, [628, 308, 0]],
  ]);
  const confirmPressOpacity = motion([
    [0, [0], 'hold'], [92, [0], motionCurves.entrance], [95, [100], 'hold'], [98, [100], motionCurves.exit],
    [101, [0], 'hold'], [120, [0]],
  ]);
  const confirmPressScale = motion([
    [0, [100, 100, 100], 'hold'], [92, [100, 100, 100], motionCurves.exit], [96, [97, 97, 100], motionCurves.settle],
    [101, [100, 100, 100], 'hold'], [120, [100, 100, 100]],
  ]);
  const confirmationOpacity = motion([
    [0, [100], 'hold'], [12, [100], motionCurves.exit], [20, [0], 'hold'], [104, [0], motionCurves.entrance],
    [112, [100], 'hold'], [120, [100]],
  ]);
  const confirmationScale = motion([
    [0, [100, 100, 100], 'hold'], [12, [100, 100, 100], motionCurves.exit], [20, [96, 96, 100], 'hold'],
    [104, [96, 96, 100], motionCurves.settle], [114, [100, 100, 100], 'hold'], [120, [100, 100, 100]],
  ]);
  const confirmationTrim = motion([
    [0, [100], 'hold'], [12, [100], motionCurves.exit], [18, [0], 'hold'], [108, [0], motionCurves.settle],
    [114, [100], 'hold'], [120, [100]],
  ]);

  return composition('CFMS — Clearer account management', [
    shapeLayer('Confirmation check', [
      group('Confirmation check mark', [
        { ty: 'sh', d: 1, ks: constant({ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-10, 0], [-2, 9], [13, -11]], c: false }) },
        stroke(palette.surface, 5), trimPath('Confirmation draw', confirmationTrim),
      ], [650, 396]),
    ], transform({ position: [650, 396, 0], opacity: confirmationOpacity, scale: confirmationScale, anchor: [650, 396, 0] })),
    shapeLayer('Confirmation badge', [ellipse('Confirmation badge surface', [46, 46], [650, 396], palette.success)], transform({ position: [650, 396, 0], opacity: confirmationOpacity, scale: confirmationScale, anchor: [650, 396, 0] })),
    shapeLayer('Confirm action feedback', [rectangle('Confirm action press', [112, 36], [728, 387], 8, palette.text, null, 0, 12)], transform({ position: [728, 387, 0], opacity: confirmPressOpacity, scale: confirmPressScale, anchor: [728, 387, 0] })),
    shapeLayer('Password reset dialog', [
      rectangle('Reset dialog surface', [382, 228], [628, 314], 17, palette.raised, palette.border, 3),
      ellipse('Reset key ring', [44, 44], [500, 271], null, palette.warning, 7), rectangle('Reset key shaft', [50, 8], [464, 271], 4, palette.warning),
      rectangle('Reset heading', [156, 12], [632, 248], 6, palette.text, null, 0, 86), rectangle('Reset explanation one', [250, 9], [628, 299], 5, palette.muted, null, 0, 52),
      rectangle('Reset explanation two', [206, 9], [606, 323], 5, palette.muted, null, 0, 42), rectangle('Confirm action', [112, 36], [728, 387], 8, palette.accent),
      rectangle('Cancel action', [82, 36], [616, 387], 8, palette.hover),
    ], transform({ position: modalPosition, scale: modalScale, opacity: modalOpacity, anchor: [628, 314, 0] })),
    shapeLayer('Reset action feedback', [rectangle('Reset action press', [152, 36], [650, 396], 8, palette.accent, null, 0, 14)], transform({ position: [650, 396, 0], opacity: resetPressOpacity, scale: resetPressScale, anchor: [650, 396, 0] })),
    shapeLayer('Account context', [
      rectangle('Account heading', [166, 13], [565, 190], 7, palette.text, null, 0, 88), rectangle('Status label', [74, 8], [470, 236], 4, palette.muted),
      rectangle('Disabled status', [82, 28], [650, 236], 14, palette.danger, null, 0, 22), ellipse('Disabled marker', [12, 12], [626, 236], palette.danger),
      rectangle('Reason panel', [334, 86], [565, 306], 12, palette.hover, palette.border, 2), rectangle('Reason heading', [104, 9], [445, 286], 5, palette.text, null, 0, 74),
      rectangle('Reason line one', [252, 8], [565, 313], 4, palette.muted, null, 0, 52), rectangle('Reason line two', [194, 8], [536, 337], 4, palette.muted, null, 0, 42),
      rectangle('Reset password action', [152, 36], [650, 396], 8, palette.accentSoft, palette.accent, 2),
    ], transform({ position: contextPosition, opacity: contextOpacity })),
    shapeLayer('Selected account content', [
      ellipse('Selected avatar', [32, 32], [252, 235], palette.accentSoft, palette.accent, 2), rectangle('Selected name', [82, 9], [321, 224], 5, palette.text, null, 0, 78),
      rectangle('Selected metadata', [66, 7], [313, 246], 4, palette.muted, null, 0, 48),
    ], transform({ position: selectedContentPosition, opacity: selectedContentOpacity })),
    shapeLayer('Selection highlight', [
      rectangle('Selected account row', [204, 54], [320, 235], 10, palette.selected), rectangle('Selected account marker', [4, 38], [220, 235], 2, palette.accent),
    ], transform({ position: selectionPosition })),
    shapeLayer('Account list', [
      rectangle('Account list surface', [232, 336], [320, 326], 14, palette.raised, palette.border, 2), rectangle('Account search', [190, 36], [320, 185], 9, palette.surface, palette.border, 2),
      ...[0, 1, 2, 3].flatMap((row) => [
        ellipse(`Avatar ${row + 1}`, [30, 30], [252, 235 + row * 50], palette.hover), rectangle(`Account ${row + 1}`, [88, 9], [323, 227 + row * 50], 5, palette.muted, null, 0, 54),
        rectangle(`Account metadata ${row + 1}`, [60, 7], [309, 245 + row * 50], 4, palette.muted, null, 0, 34),
      ]),
    ]),
    shapeLayer('Application shell', appFrame(palette, 2)),
  ]);
}

const scenes = new Map([
  ['document-download', documentDownload], ['flexible-workspace', flexibleWorkspace],
  ['server-diagnostics', serverDiagnostics], ['account-administration', accountAdministration],
]);

const requestedSceneNames = new Set(process.argv.slice(2));
const selectedScenes = requestedSceneNames.size === 0
  ? scenes
  : new Map([...scenes].filter(([sceneName]) => requestedSceneNames.has(sceneName)));
const unknownSceneNames = [...requestedSceneNames].filter((sceneName) => !scenes.has(sceneName));
if (unknownSceneNames.length > 0) throw new Error(`Unknown scene(s): ${unknownSceneNames.join(', ')}`);

await mkdir(outputDirectory, { recursive: true });
for (const [sceneName, createScene] of selectedScenes) {
  for (const [theme, palette] of Object.entries(palettes)) {
    await writeFile(path.join(outputDirectory, `${sceneName}.${theme}.json`), `${JSON.stringify(createScene(palette))}\n`, 'utf8');
  }
}

console.log(`Generated ${selectedScenes.size * Object.keys(palettes).length} release-highlight animations in ${outputDirectory}`);
