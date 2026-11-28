// Build-time only: the application ships every referenced font locally.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

if (
	(process.env.HTTPS_PROXY ||
		process.env.HTTP_PROXY ||
		process.env.https_proxy ||
		process.env.http_proxy) &&
	process.env.NODE_USE_ENV_PROXY !== '1' &&
	!process.execArgv.includes('--use-env-proxy')
) {
	const { stdout, stderr } = await execFileAsync(
		process.execPath,
		['--use-env-proxy', ...process.execArgv, ...process.argv.slice(1)],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	if (stdout) process.stdout.write(stdout);
	if (stderr) process.stderr.write(stderr);
	process.exit(0);
}

const rootDir = path.resolve(import.meta.dirname, '..');
const fontsDir = path.join(rootDir, 'static', 'fonts');
// Google Fonts negotiates WOFF2 + unicode-range with modern browsers (used to derive CJK frequency buckets).
const userAgent =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const rawBaseUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl';

const fullFamilies = [
	{
		name: 'noto-sans',
		family: 'Noto Sans',
		repoDir: 'notosans',
		faces: [
			{
				suffix: 'regular',
				file: 'NotoSans[wdth,wght].ttf',
				style: 'normal',
				weight: '100 900',
				stretch: '62.5% 100%'
			},
			{
				suffix: 'italic',
				file: 'NotoSans-Italic[wdth,wght].ttf',
				style: 'italic',
				weight: '100 900',
				stretch: '62.5% 100%'
			}
		]
	},
	{
		name: 'noto-serif',
		family: 'Noto Serif',
		repoDir: 'notoserif',
		faces: [
			{
				suffix: 'regular',
				file: 'NotoSerif[wdth,wght].ttf',
				style: 'normal',
				weight: '100 900',
				stretch: '62.5% 100%'
			},
			{
				suffix: 'italic',
				file: 'NotoSerif-Italic[wdth,wght].ttf',
				style: 'italic',
				weight: '100 900',
				stretch: '62.5% 100%'
			}
		]
	},
	{
		name: 'jetbrains-mono',
		family: 'JetBrains Mono',
		repoDir: 'jetbrainsmono',
		faces: [
			{
				suffix: 'regular',
				file: 'JetBrainsMono[wght].ttf',
				style: 'normal',
				weight: '100 800'
			},
			{
				suffix: 'italic',
				file: 'JetBrainsMono-Italic[wght].ttf',
				style: 'italic',
				weight: '100 800'
			}
		]
	},
	{
		name: 'google-sans-flex',
		family: 'Google Sans Flex',
		repoDir: 'googlesansflex',
		faces: [
			{
				suffix: null,
				file: 'GoogleSansFlex[ROND,opsz,slnt,wdth,wght].ttf',
				style: 'oblique 0deg 10deg',
				weight: '1 1000',
				stretch: '25% 151%'
			}
		]
	}
];

const cjkSlicedFamilies = [
	{
		name: 'noto-sans-sc',
		family: 'Noto Sans SC',
		repoDir: 'notosanssc',
		file: 'NotoSansSC[wght].ttf',
		weightRange: '100..900'
	},
	{
		name: 'noto-serif-sc',
		family: 'Noto Serif SC',
		repoDir: 'notoserifsc',
		file: 'NotoSerifSC[wght].ttf',
		weightRange: '200..900'
	}
];

async function assertFontToolsAvailable() {
	try {
		await execFileAsync('fonttools', ['ttLib.woff2', '--help']);
		await execFileAsync('pyftsubset', ['--help']);
	} catch (error) {
		throw new Error(
			`fonttools and pyftsubset (pip install fonttools brotli) are required to bundle lossless WOFF2 fonts: ${error.message}`
		);
	}
}

async function fetchBytes(url) {
	const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
	if (!response.ok) throw new Error(`${response.status}: ${url}`);
	return Buffer.from(await response.arrayBuffer());
}

function assertValidWoff2(bytes, label) {
	if (bytes.toString('ascii', 0, 4) !== 'wOF2') {
		throw new Error(`Invalid WOFF2: ${label}`);
	}
}

function formatFontFace({ family, style, weight, stretch, filename }) {
	const lines = [
		'@font-face {',
		`  font-family: '${family}';`,
		`  font-style: ${style};`,
		`  font-weight: ${weight};`
	];
	if (stretch) lines.push(`  font-stretch: ${stretch};`);
	lines.push('  font-display: swap;', `  src: url(./${filename}) format('woff2');`, '}');
	return lines.join('\n');
}

async function runPool(items, concurrency, worker) {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			await worker(items[index], index);
		}
	});
	await Promise.all(runners);
}

await assertFontToolsAvailable();

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cfms-fonts-'));
const assets = new Map();
const chunks = [];

try {
	// Compress non-CJK families directly from upstream TTFs so all variable axes,
	// italic styles, OpenType features (zero/tnum/calt/etc.), STAT, HVAR/MVAR, and glyphs stay intact.
	for (const spec of fullFamilies) {
		const faceCss = [];
		for (const face of spec.faces) {
			const ttfUrl = `${rawBaseUrl}/${spec.repoDir}/${encodeURIComponent(face.file)}`;
			const ttfBytes = await fetchBytes(ttfUrl);
			const ttfPath = path.join(tmpDir, `${spec.name}-${face.suffix ?? 'full'}.ttf`);
			const woff2Name = face.suffix ? `${spec.name}-${face.suffix}.woff2` : `${spec.name}.woff2`;
			const woff2Path = path.join(tmpDir, woff2Name);
			await writeFile(ttfPath, ttfBytes);
			await execFileAsync('fonttools', ['ttLib.woff2', 'compress', '-q', '-o', woff2Path, ttfPath]);
			const woff2Bytes = await readFile(woff2Path);
			assertValidWoff2(woff2Bytes, ttfUrl);
			assets.set(woff2Name, woff2Bytes);
			faceCss.push(
				formatFontFace({
					family: spec.family,
					style: face.style,
					weight: face.weight,
					stretch: face.stretch,
					filename: woff2Name
				})
			);
		}
		chunks.push(faceCss.join('\n'));
		assets.set(`${spec.name}-OFL.txt`, await fetchBytes(`${rawBaseUrl}/${spec.repoDir}/OFL.txt`));
		console.log(`Prepared ${spec.family}: ${spec.faces.length} full variable WOFF2 file(s)`);
	}

	// Keep Google Fonts's frequency-bucketed unicode-range partitioning for CJK so browser decoding stays incremental,
	// while slicing locally from upstream TTFs to preserve full OpenType features and metadata.
	const subsetConcurrency = Math.max(2, Math.min(8, os.cpus().length));
	for (const spec of cjkSlicedFamilies) {
		const cssUrl = new URL('https://fonts.googleapis.com/css2');
		cssUrl.searchParams.set('family', `${spec.family}:wght@${spec.weightRange}`);
		cssUrl.searchParams.set('display', 'swap');
		let css = (await fetchBytes(cssUrl)).toString('utf8');

		const blockRegex =
			/@font-face\s*\{[^}]*src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s+format\('woff2'\);[^}]*unicode-range:\s*([^;]+);[^}]*\}/g;
		const blocks = [...css.matchAll(blockRegex)];
		if (!blocks.length || /format\('(?!woff2)/.test(css)) {
			throw new Error(`Expected WOFF2 @font-face blocks for ${spec.family}`);
		}

		const ttfUrl = `${rawBaseUrl}/${spec.repoDir}/${encodeURIComponent(spec.file)}`;
		const ttfPath = path.join(tmpDir, `${spec.name}.ttf`);
		await writeFile(ttfPath, await fetchBytes(ttfUrl));

		const sliceInfos = blocks.map((match, index) => ({
			remoteUrl: match[1],
			unicodeRange: match[2].replace(/\s+/g, ''),
			filename: `${spec.name}-${index + 1}.woff2`
		}));

		await runPool(sliceInfos, subsetConcurrency, async (slice) => {
			const outPath = path.join(tmpDir, slice.filename);
			await execFileAsync('pyftsubset', [
				ttfPath,
				`--unicodes=${slice.unicodeRange}`,
				'--layout-features=*',
				'--name-IDs=*',
				'--name-legacy',
				'--name-languages=*',
				'--notdef-glyph',
				'--notdef-outline',
				'--recommended-glyphs',
				'--symbol-cmap',
				'--legacy-cmap',
				'--drop-tables=',
				'--passthrough-tables',
				'--flavor=woff2',
				`--output-file=${outPath}`
			]);
			const woff2Bytes = await readFile(outPath);
			assertValidWoff2(woff2Bytes, `${spec.family} (${slice.filename})`);
			assets.set(slice.filename, woff2Bytes);
		});

		for (const slice of sliceInfos) {
			css = css.replaceAll(slice.remoteUrl, `./${slice.filename}`);
		}
		chunks.push(css.trim());
		assets.set(`${spec.name}-OFL.txt`, await fetchBytes(`${rawBaseUrl}/${spec.repoDir}/OFL.txt`));
		console.log(
			`Prepared ${spec.family}: ${sliceInfos.length} local WOFF2 slices (full features & metadata)`
		);
	}

	// Only replace the known generated directory after all downloads and conversions succeed.
	if (fontsDir !== path.resolve(rootDir, 'static/fonts'))
		throw new Error('Unexpected font output directory');
	await rm(fontsDir, { recursive: true, force: true });
	await mkdir(fontsDir, { recursive: true });
	await Promise.all(
		[...assets].map(([name, bytes]) => writeFile(path.join(fontsDir, name), bytes))
	);
	await writeFile(
		path.join(fontsDir, 'fonts.css'),
		'/* Generated by scripts/embed-font-assets.mjs. Do not edit by hand. */\n\n' +
			chunks.join('\n\n') +
			'\n'
	);
	const totalMiB = (
		[...assets.values()].reduce((sum, value) => sum + value.length, 0) /
		1024 /
		1024
	).toFixed(1);
	console.log(
		`Embedded ${fullFamilies.length + cjkSlicedFamilies.length} font families, ${totalMiB} MiB. No runtime CDN requests.`
	);
} finally {
	await rm(tmpDir, { recursive: true, force: true });
}
