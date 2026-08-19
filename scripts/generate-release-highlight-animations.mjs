import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'static', 'release-highlights', 'v0.43');
const FRAME_RATE = 60;
const END_FRAME = 180;

const palette = {
  cyan: '#60cdff',
  blue: '#4d8dff',
  periwinkle: '#a9c7ff',
  mint: '#6ccb8e',
  gold: '#ffca4b',
  rose: '#ff99a4',
  ink: '#253343',
  inkRaised: '#34465a',
  slate: '#8b9aac',
  cloud: '#dce8f5',
};

const easeIn = { x: [0.2], y: [1] };
const easeOut = { x: [0.4], y: [0] };

function color(value) {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function constant(value) {
  return { a: 0, k: value };
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

function transform({
  position = [0, 0, 0],
  scale = [100, 100, 100],
  opacity = 100,
  rotation = 0,
  anchor = [0, 0, 0],
} = {}) {
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
    ty: 'gr',
    nm: name,
    it: [
      ...items,
      {
        ty: 'tr',
        p: constant(position),
        a: constant([0, 0]),
        s: constant([100, 100]),
        r: constant(0),
        o: constant(100),
        sk: constant(0),
        sa: constant(0),
      },
    ],
  };
}

function fill(value, opacity = 100) {
  return { ty: 'fl', c: constant(color(value)), o: constant(opacity), r: 1 };
}

function stroke(value, width = 4, opacity = 100) {
  return {
    ty: 'st',
    c: constant(color(value)),
    o: constant(opacity),
    w: constant(width),
    lc: 2,
    lj: 2,
    ml: 4,
  };
}

function rectangle(name, size, position, radius, fillColor, strokeColor, strokeWidth = 0, opacity = 100) {
  const styles = [fill(fillColor, opacity)];
  if (strokeColor && strokeWidth) styles.push(stroke(strokeColor, strokeWidth));
  return group(name, [
    { ty: 'rc', d: 1, s: constant(size), p: constant([0, 0]), r: constant(radius) },
    ...styles,
  ], position);
}

function ellipse(name, size, position, fillColor, strokeColor, strokeWidth = 0, opacity = 100) {
  const styles = fillColor ? [fill(fillColor, opacity)] : [];
  if (strokeColor && strokeWidth) styles.push(stroke(strokeColor, strokeWidth, opacity));
  return group(name, [
    { ty: 'el', d: 1, s: constant(size), p: constant([0, 0]) },
    ...styles,
  ], position);
}

function vectorPath(name, vertices, closed, position, strokeColor, strokeWidth, fillColor = null, opacity = 100) {
  const zeroTangents = vertices.map(() => [0, 0]);
  const styles = [];
  if (fillColor) styles.push(fill(fillColor, opacity));
  if (strokeColor) styles.push(stroke(strokeColor, strokeWidth, opacity));
  return group(name, [
    {
      ty: 'sh',
      d: 1,
      ks: constant({ i: zeroTangents, o: zeroTangents, v: vertices, c: closed }),
    },
    ...styles,
  ], position);
}

function shapeLayer(name, shapes, layerTransform = transform()) {
  return {
    ddd: 0,
    ind: 0,
    ty: 4,
    nm: name,
    sr: 1,
    ks: layerTransform,
    ao: 0,
    shapes,
    ip: 0,
    op: END_FRAME,
    st: 0,
    bm: 0,
  };
}

function composition(name, layers) {
  return {
    v: '5.13.0',
    fr: FRAME_RATE,
    ip: 0,
    op: END_FRAME,
    w: 512,
    h: 512,
    nm: name,
    ddd: 0,
    assets: [],
    markers: [],
    layers: layers.map((layer, index) => ({ ...layer, ind: index + 1 })),
  };
}

function documentDownload() {
  const documentPosition = animated([
    [0, [256, 176, 0]],
    [48, [256, 176, 0]],
    [105, [256, 278, 0]],
    [132, [256, 278, 0]],
    [180, [256, 176, 0]],
  ]);
  const documentScale = animated([
    [0, [100, 100, 100]],
    [48, [100, 100, 100]],
    [105, [92, 92, 100]],
    [132, [92, 92, 100]],
    [180, [100, 100, 100]],
  ]);
  const arrowPosition = animated([
    [0, [256, 222, 0]],
    [55, [256, 222, 0]],
    [112, [256, 312, 0]],
    [180, [256, 222, 0]],
  ]);
  const arrowOpacity = animated([
    [0, [0]],
    [28, [100]],
    [122, [100]],
    [150, [0]],
    [180, [0]],
  ]);

  return composition('CFMS — Document ID download', [
    shapeLayer('Download arrow', [
      vectorPath('Arrow shaft', [[0, -24], [0, 22]], false, [0, 0], palette.cyan, 8),
      vectorPath('Arrow head', [[-18, 7], [0, 25], [18, 7]], false, [0, 0], palette.cyan, 8),
    ], transform({ position: arrowPosition, opacity: arrowOpacity })),
    shapeLayer('Document', [
      rectangle('Document body', [176, 216], [0, 0], 18, palette.ink, palette.periwinkle, 5),
      rectangle('Document line 1', [92, 9], [-17, -51], 5, palette.cloud),
      rectangle('Document line 2', [116, 9], [-5, -25], 5, palette.slate),
      rectangle('Document line 3', [78, 9], [-24, 1], 5, palette.slate),
      ellipse('ID seal', [54, 54], [45, 62], palette.blue),
      rectangle('ID notch', [22, 8], [45, 62], 4, palette.cloud),
    ], transform({ position: documentPosition, scale: documentScale })),
    shapeLayer('Download tray', [
      vectorPath('Tray outline', [[-98, -10], [-80, 45], [80, 45], [98, -10]], false, [256, 350], palette.mint, 9),
      rectangle('Tray base', [170, 18], [256, 398], 9, palette.mint),
      ellipse('Tray signal', [20, 20], [256, 382], palette.gold),
    ]),
    shapeLayer('Ground shadow', [ellipse('Shadow', [246, 38], [256, 418], palette.ink, null, 0, 28)]),
  ]);
}

function flexibleWorkspace() {
  const dividerPosition = animated([
    [0, [226, 256, 0]],
    [70, [296, 256, 0]],
    [110, [296, 256, 0]],
    [180, [226, 256, 0]],
  ]);
  const modalScale = animated([
    [0, [72, 72, 100]],
    [48, [72, 72, 100]],
    [96, [104, 104, 100]],
    [126, [100, 100, 100]],
    [180, [72, 72, 100]],
  ]);
  const modalPosition = animated([
    [0, [330, 292, 0]],
    [48, [330, 292, 0]],
    [96, [310, 270, 0]],
    [126, [310, 270, 0]],
    [180, [330, 292, 0]],
  ]);

  return composition('CFMS — Flexible workspace', [
    shapeLayer('Floating window', [
      rectangle('Window body', [190, 142], [0, 0], 14, palette.inkRaised, palette.cyan, 5),
      rectangle('Window title', [94, 8], [-32, -48], 4, palette.cloud),
      rectangle('Window row', [132, 8], [-10, -13], 4, palette.slate),
      rectangle('Window row short', [92, 8], [-30, 12], 4, palette.slate),
      ellipse('Window control', [13, 13], [68, -49], palette.mint),
    ], transform({ position: modalPosition, scale: modalScale })),
    shapeLayer('Divider', [
      rectangle('Divider line', [6, 244], [0, 0], 3, palette.cyan),
      ellipse('Handle top', [12, 12], [0, -13], palette.cloud),
      ellipse('Handle bottom', [12, 12], [0, 13], palette.cloud),
    ], transform({ position: dividerPosition })),
    shapeLayer('Workspace shell', [
      rectangle('Window frame', [372, 278], [256, 256], 20, palette.ink, palette.periwinkle, 5),
      rectangle('Toolbar', [338, 42], [256, 157], 10, palette.inkRaised),
      ellipse('Control one', [13, 13], [126, 157], palette.rose),
      ellipse('Control two', [13, 13], [150, 157], palette.gold),
      ellipse('Control three', [13, 13], [174, 157], palette.mint),
      rectangle('Left navigation', [84, 194], [165, 275], 11, palette.inkRaised),
      rectangle('Nav item', [54, 9], [165, 229], 4, palette.periwinkle),
      rectangle('Nav item 2', [48, 9], [162, 258], 4, palette.slate),
      rectangle('Content line', [98, 9], [328, 210], 4, palette.cloud),
      rectangle('Content line 2', [124, 9], [341, 238], 4, palette.slate),
      rectangle('Content block', [118, 56], [338, 318], 10, palette.blue, null, 0, 62),
    ]),
  ]);
}

function serverDiagnostics() {
  const scanPosition = animated([
    [0, [256, 174, 0]],
    [20, [256, 174, 0]],
    [135, [256, 352, 0]],
    [155, [256, 352, 0]],
    [180, [256, 174, 0]],
  ]);
  const pulseScale = animated([
    [0, [72, 72, 100]],
    [45, [118, 118, 100]],
    [90, [72, 72, 100]],
    [135, [118, 118, 100]],
    [180, [72, 72, 100]],
  ]);
  const pulseOpacity = animated([
    [0, [78]],
    [45, [18]],
    [90, [78]],
    [135, [18]],
    [180, [78]],
  ]);

  return composition('CFMS — Server diagnostics', [
    shapeLayer('Signal pulse', [ellipse('Pulse ring', [128, 128], [0, 0], null, palette.cyan, 7)], transform({
      position: [362, 192, 0],
      scale: pulseScale,
      opacity: pulseOpacity,
    })),
    shapeLayer('Scan line', [
      rectangle('Scanner', [304, 7], [0, 0], 4, palette.cyan),
      ellipse('Scanner head', [18, 18], [150, 0], palette.cloud),
    ], transform({ position: scanPosition })),
    shapeLayer('Diagnostics panel', [
      rectangle('Panel', [356, 278], [256, 264], 20, palette.ink, palette.periwinkle, 5),
      rectangle('Rack 1', [226, 52], [222, 210], 10, palette.inkRaised),
      rectangle('Rack 2', [226, 52], [222, 275], 10, palette.inkRaised),
      rectangle('Rack 3', [226, 52], [222, 340], 10, palette.inkRaised),
      ellipse('Rack light 1', [18, 18], [295, 210], palette.mint),
      ellipse('Rack light 2', [18, 18], [295, 275], palette.gold),
      ellipse('Rack light 3', [18, 18], [295, 340], palette.mint),
      rectangle('Rack slot 1', [88, 8], [190, 210], 4, palette.slate),
      rectangle('Rack slot 2', [88, 8], [190, 275], 4, palette.slate),
      rectangle('Rack slot 3', [88, 8], [190, 340], 4, palette.slate),
      ellipse('Status core', [60, 60], [362, 192], palette.blue),
      vectorPath('Status check', [[-12, 0], [-3, 10], [16, -12]], false, [362, 192], palette.cloud, 7),
      vectorPath('Metric line', [[-45, 17], [-18, -4], [6, 8], [30, -19], [54, -8]], false, [362, 315], palette.gold, 6),
      ellipse('Metric point 1', [12, 12], [317, 332], palette.gold),
      ellipse('Metric point 2', [12, 12], [392, 296], palette.gold),
    ]),
  ]);
}

function accountAdministration() {
  const shieldScale = animated([
    [0, [92, 92, 100]],
    [55, [106, 106, 100]],
    [90, [100, 100, 100]],
    [145, [106, 106, 100]],
    [180, [92, 92, 100]],
  ]);
  const keyPosition = animated([
    [0, [405, 300, 0]],
    [45, [405, 300, 0]],
    [102, [352, 300, 0]],
    [134, [352, 300, 0]],
    [180, [405, 300, 0]],
  ]);
  const keyRotation = animated([
    [0, [-16]],
    [45, [-16]],
    [102, [0]],
    [134, [0]],
    [180, [-16]],
  ]);

  return composition('CFMS — Account administration', [
    shapeLayer('Access key', [
      ellipse('Key ring', [54, 54], [0, 0], null, palette.gold, 9),
      rectangle('Key shaft', [82, 10], [-54, 0], 5, palette.gold),
      rectangle('Key tooth one', [10, 28], [-82, 10], 4, palette.gold),
      rectangle('Key tooth two', [10, 22], [-64, 8], 4, palette.gold),
    ], transform({ position: keyPosition, rotation: keyRotation })),
    shapeLayer('Security shield', [
      vectorPath('Shield', [[0, -72], [65, -44], [56, 34], [0, 82], [-56, 34], [-65, -44]], true, [0, 0], palette.periwinkle, 5, palette.blue),
      vectorPath('Shield check', [[-24, 2], [-7, 21], [29, -25]], false, [0, 0], palette.cloud, 10),
    ], transform({ position: [340, 272, 0], scale: shieldScale })),
    shapeLayer('Account card', [
      rectangle('Card', [258, 286], [198, 256], 20, palette.ink, palette.periwinkle, 5),
      ellipse('Avatar head', [76, 76], [198, 202], palette.cyan),
      vectorPath('Avatar shoulders', [[-58, 45], [-42, 4], [0, -8], [42, 4], [58, 45]], true, [198, 280], null, 0, palette.inkRaised),
      rectangle('Identity line', [112, 10], [198, 344], 5, palette.cloud),
      rectangle('Context line', [154, 9], [198, 373], 5, palette.slate),
      ellipse('Audit marker', [18, 18], [104, 373], palette.mint),
    ]),
    shapeLayer('Context trail', [
      rectangle('Trail 1', [56, 8], [407, 199], 4, palette.slate),
      rectangle('Trail 2', [78, 8], [418, 223], 4, palette.cloud),
      ellipse('Trail status', [16, 16], [374, 223], palette.mint),
    ]),
  ]);
}

const animations = new Map([
  ['document-download.json', documentDownload()],
  ['flexible-workspace.json', flexibleWorkspace()],
  ['server-diagnostics.json', serverDiagnostics()],
  ['account-administration.json', accountAdministration()],
]);

await mkdir(outputDirectory, { recursive: true });
for (const [filename, animation] of animations) {
  await writeFile(path.join(outputDirectory, filename), `${JSON.stringify(animation)}\n`, 'utf8');
}

console.log(`Generated ${animations.size} release-highlight animations in ${outputDirectory}`);
