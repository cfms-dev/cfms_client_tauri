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
    it: [...items, { ty: 'tr', p: constant(position), a: constant([0, 0]), s: constant([100, 100]), r: constant(0), o: constant(100), sk: constant(0), sa: constant(0) }],
  };
}

const fill = (value, opacity = 100) => ({ ty: 'fl', c: constant(color(value)), o: constant(opacity), r: 1 });
const stroke = (value, width = 4, opacity = 100) => ({ ty: 'st', c: constant(color(value)), o: constant(opacity), w: constant(width), lc: 2, lj: 2, ml: 4 });

function rectangle(name, size, position, radius, fillColor, strokeColor, strokeWidth = 0, opacity = 100) {
  const styles = [fill(fillColor, opacity)];
  if (strokeColor && strokeWidth) styles.push(stroke(strokeColor, strokeWidth));
  return group(name, [{ ty: 'rc', d: 1, s: constant(size), p: constant([0, 0]), r: constant(radius) }, ...styles], position);
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
  const dialogOpacity = animated([[0, [0]], [15, [0]], [30, [100]], [120, [100]]]);
  const dialogScale = animated([[0, [94, 94, 100]], [15, [94, 94, 100]], [34, [100, 100, 100]], [120, [100, 100, 100]]]);
  const typedOne = animated([[0, [0]], [34, [0]], [44, [100]], [120, [100]]]);
  const typedTwo = animated([[0, [0]], [43, [0]], [53, [100]], [120, [100]]]);
  const typedThree = animated([[0, [0]], [52, [0]], [62, [100]], [120, [100]]]);
  const verificationOpacity = animated([[0, [0]], [66, [0]], [80, [100]], [120, [100]]]);
  const taskPosition = animated([[0, [540, 480, 0]], [82, [540, 480, 0]], [100, [540, 440, 0]], [120, [540, 440, 0]]]);
  const taskOpacity = animated([[0, [0]], [82, [0]], [98, [100]], [120, [100]]]);

  return composition('CFMS — Download by document ID', [
    shapeLayer('Completed transfer', [
      rectangle('Transfer row', [430, 70], [0, 0], 12, palette.selected, palette.border, 2),
      rectangle('File symbol', [38, 46], [-170, 0], 7, palette.accentSoft, palette.accent, 3),
      rectangle('File name', [158, 10], [-48, -13], 5, palette.text, null, 0, 86),
      rectangle('Transfer metadata', [116, 8], [-69, 13], 4, palette.muted, null, 0, 62),
      ellipse('Completed status', [30, 30], [176, 0], palette.success),
      vectorPath('Completed check', [[-7, 0], [-1, 7], [10, -8]], false, [176, 0], palette.surface, 4),
    ], transform({ position: taskPosition, opacity: taskOpacity })),
    shapeLayer('Verification', [
      ellipse('Verification badge', [42, 42], [660, 346], palette.success),
      vectorPath('Verification check', [[-9, 0], [-2, 8], [12, -10]], false, [660, 346], palette.surface, 5),
      rectangle('Verified document', [150, 9], [559, 337], 5, palette.text, null, 0, 82),
      rectangle('Verified metadata', [112, 8], [540, 359], 4, palette.muted, null, 0, 58),
    ], transform({ opacity: verificationOpacity })),
    shapeLayer('Typed segment three', [rectangle('ID segment three', [54, 12], [573, 275], 6, palette.accent)], transform({ opacity: typedThree })),
    shapeLayer('Typed segment two', [rectangle('ID segment two', [42, 12], [516, 275], 6, palette.accent)], transform({ opacity: typedTwo })),
    shapeLayer('Typed segment one', [rectangle('ID segment one', [64, 12], [449, 275], 6, palette.accent)], transform({ opacity: typedOne })),
    shapeLayer('Download dialog', [
      rectangle('Dialog surface', [430, 270], [540, 300], 18, palette.raised, palette.border, 3),
      rectangle('Dialog title', [184, 13], [440, 210], 7, palette.text, null, 0, 90),
      rectangle('Dialog close', [18, 18], [718, 210], 6, palette.muted),
      rectangle('Field label', [88, 8], [390, 251], 4, palette.muted),
      rectangle('ID field', [330, 52], [540, 276], 11, palette.surface, palette.border, 2),
      rectangle('Download button', [118, 38], [660, 390], 8, palette.accent),
      vectorPath('Download arrow', [[0, -9], [0, 7], [-7, 0], [0, 7], [7, 0]], false, [630, 390], palette.workspace, 4),
    ], transform({ scale: dialogScale, opacity: dialogOpacity, anchor: [540, 300, 0] })),
    shapeLayer('Download entry highlight', [
      rectangle('Download entry', [126, 36], [761, 139], 8, palette.accentSoft, palette.accent, 2),
      vectorPath('Entry arrow', [[0, -7], [0, 7], [-7, 0], [0, 7], [7, 0]], false, [720, 139], palette.accent, 4),
    ]),
    shapeLayer('Application shell', [
      ...appFrame(palette, 2),
      rectangle('Content heading', [206, 14], [393, 154], 7, palette.text, null, 0, 86),
      rectangle('Content row one', [492, 48], [534, 218], 10, palette.hover),
      rectangle('Content row two', [492, 48], [534, 282], 10, palette.hover),
      rectangle('Content row three', [492, 48], [534, 346], 10, palette.hover),
    ]),
  ]);
}

function flexibleWorkspace(palette) {
  const dividerPosition = animated([[0, [690, 314, 0]], [14, [690, 314, 0]], [52, [602, 314, 0]], [120, [602, 314, 0]]]);
  const pointerPosition = animated([[0, [690, 316, 0]], [14, [690, 316, 0]], [52, [602, 316, 0]], [67, [602, 316, 0]], [78, [770, 178, 0]], [120, [770, 178, 0]]]);
  const detailScale = animated([[0, [78, 100, 100]], [14, [78, 100, 100]], [52, [126, 100, 100]], [120, [126, 100, 100]]]);
  const modalOpacity = animated([[0, [0]], [62, [0]], [76, [100]], [120, [100]]]);
  const modalScale = animated([[0, [72, 72, 100]], [62, [72, 72, 100]], [84, [100, 100, 100]], [96, [100, 100, 100]], [120, [132, 132, 100]]]);
  const modalPosition = animated([[0, [680, 336, 0]], [62, [680, 336, 0]], [96, [680, 336, 0]], [120, [620, 310, 0]]]);

  return composition('CFMS — Flexible workspace', [
    shapeLayer('Interaction pointer', [vectorPath('Pointer', [[0, 0], [0, 26], [8, 19], [15, 32], [22, 28], [15, 15], [25, 14]], true, [0, 0], palette.workspace, 2, palette.text)], transform({ position: pointerPosition })),
    shapeLayer('Resizable window', [
      rectangle('Window surface', [286, 196], [0, 0], 16, palette.raised, palette.accent, 3),
      rectangle('Window title bar', [254, 36], [0, -64], 9, palette.surface),
      rectangle('Window title', [104, 9], [-52, -64], 5, palette.text, null, 0, 78),
      rectangle('Maximize control', [22, 22], [103, -64], 5, palette.accentSoft, palette.accent, 2),
      rectangle('Window line one', [174, 10], [-22, -18], 5, palette.muted, null, 0, 62),
      rectangle('Window line two', [202, 10], [-8, 15], 5, palette.muted, null, 0, 48),
      rectangle('Window action', [84, 30], [76, 58], 7, palette.accent),
    ], transform({ position: modalPosition, scale: modalScale, opacity: modalOpacity })),
    shapeLayer('Resize handle', [
      rectangle('Divider', [5, 354], [0, 0], 3, palette.accent),
      ellipse('Handle', [18, 42], [0, 0], palette.accentSoft, palette.accent, 3),
    ], transform({ position: dividerPosition })),
    shapeLayer('Details pane', [
      rectangle('Details surface', [216, 354], [0, 0], 14, palette.raised, palette.border, 2),
      rectangle('Details heading', [116, 11], [-28, -137], 6, palette.text, null, 0, 82),
      rectangle('Preview', [148, 96], [0, -61], 12, palette.selected),
      rectangle('Detail line one', [142, 9], [-3, 18], 5, palette.muted, null, 0, 56),
      rectangle('Detail line two', [118, 9], [-15, 47], 5, palette.muted, null, 0, 46),
      rectangle('Detail line three', [152, 9], [2, 76], 5, palette.muted, null, 0, 52),
    ], transform({ position: [720, 314, 0], scale: detailScale, anchor: [108, 0, 0] })),
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
  const selectionPosition = animated([[0, [0, 0, 0]], [14, [0, 0, 0]], [34, [0, 50, 0]], [120, [0, 50, 0]]]);
  const contextOpacity = animated([[0, [0]], [34, [0]], [52, [100]], [120, [100]]]);
  const modalOpacity = animated([[0, [0]], [70, [0]], [85, [100]], [120, [100]]]);
  const modalScale = animated([[0, [94, 94, 100]], [70, [94, 94, 100]], [88, [100, 100, 100]], [120, [100, 100, 100]]]);
  const confirmOpacity = animated([[0, [0]], [96, [0]], [110, [100]], [120, [100]]]);

  return composition('CFMS — Clearer account management', [
    shapeLayer('Confirmation state', [ellipse('Confirmation badge', [46, 46], [675, 370], palette.success), vectorPath('Confirmation check', [[-10, 0], [-2, 9], [13, -11]], false, [675, 370], palette.surface, 5)], transform({ opacity: confirmOpacity })),
    shapeLayer('Password reset dialog', [
      rectangle('Reset dialog surface', [382, 228], [628, 314], 17, palette.raised, palette.border, 3),
      ellipse('Reset key ring', [44, 44], [500, 271], null, palette.warning, 7), rectangle('Reset key shaft', [50, 8], [464, 271], 4, palette.warning),
      rectangle('Reset heading', [156, 12], [632, 248], 6, palette.text, null, 0, 86), rectangle('Reset explanation one', [250, 9], [628, 299], 5, palette.muted, null, 0, 52),
      rectangle('Reset explanation two', [206, 9], [606, 323], 5, palette.muted, null, 0, 42), rectangle('Confirm action', [112, 36], [728, 387], 8, palette.accent),
      rectangle('Cancel action', [82, 36], [616, 387], 8, palette.hover),
    ], transform({ scale: modalScale, opacity: modalOpacity, anchor: [628, 314, 0] })),
    shapeLayer('Account context', [
      rectangle('Account heading', [166, 13], [565, 190], 7, palette.text, null, 0, 88), rectangle('Status label', [74, 8], [470, 236], 4, palette.muted),
      rectangle('Disabled status', [82, 28], [650, 236], 14, palette.danger, null, 0, 22), ellipse('Disabled marker', [12, 12], [626, 236], palette.danger),
      rectangle('Reason panel', [334, 86], [565, 306], 12, palette.hover, palette.border, 2), rectangle('Reason heading', [104, 9], [445, 286], 5, palette.text, null, 0, 74),
      rectangle('Reason line one', [252, 8], [565, 313], 4, palette.muted, null, 0, 52), rectangle('Reason line two', [194, 8], [536, 337], 4, palette.muted, null, 0, 42),
      rectangle('Reset password action', [152, 36], [650, 396], 8, palette.accentSoft, palette.accent, 2),
    ], transform({ opacity: contextOpacity })),
    shapeLayer('Selected account', [
      rectangle('Selected account row', [204, 54], [320, 235], 10, palette.selected), rectangle('Selected account marker', [4, 38], [220, 235], 2, palette.accent),
      ellipse('Selected avatar', [32, 32], [252, 235], palette.accentSoft, palette.accent, 2), rectangle('Selected name', [82, 9], [321, 224], 5, palette.text, null, 0, 78),
      rectangle('Selected metadata', [66, 7], [313, 246], 4, palette.muted, null, 0, 48),
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

await mkdir(outputDirectory, { recursive: true });
for (const [sceneName, createScene] of scenes) {
  for (const [theme, palette] of Object.entries(palettes)) {
    await writeFile(path.join(outputDirectory, `${sceneName}.${theme}.json`), `${JSON.stringify(createScene(palette))}\n`, 'utf8');
  }
}

console.log(`Generated ${scenes.size * Object.keys(palettes).length} release-highlight animations in ${outputDirectory}`);
