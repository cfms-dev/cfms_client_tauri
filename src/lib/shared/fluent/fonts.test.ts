import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fluentTheme, SERIF_FONT } from './theme';

const directory = resolve('static/fonts');
const css = readFileSync(resolve(directory, 'fonts.css'), 'utf8');
const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]);

const WOFF2_KNOWN_TAGS = [
	'cmap',
	'head',
	'hhea',
	'hmtx',
	'maxp',
	'name',
	'OS/2',
	'post',
	'cvt ',
	'fpgm',
	'glyf',
	'loca',
	'prep',
	'CFF ',
	'VORG',
	'EBDT',
	'EBLC',
	'gasp',
	'hdmx',
	'kern',
	'LTSH',
	'PCLT',
	'VDMX',
	'vhea',
	'vmtx',
	'BASE',
	'GDEF',
	'GPOS',
	'GSUB',
	'EBSC',
	'JSTF',
	'MATH',
	'CBDT',
	'CBLC',
	'COLR',
	'CPAL',
	'SVG ',
	'sbix',
	'acnt',
	'avar',
	'bdat',
	'bloc',
	'bsln',
	'cvar',
	'fdsc',
	'feat',
	'fmtx',
	'fvar',
	'gvar',
	'hsty',
	'just',
	'lcar',
	'mort',
	'morx',
	'opbd',
	'prop',
	'trak',
	'Zapf',
	'Silf',
	'Glat',
	'Gloc',
	'Feat',
	'Sill'
];

function parseWoff2Metadata(filename: string) {
	const buf = readFileSync(resolve(directory, filename));
	const numTables = buf.readUInt16BE(12);
	const totalCompressedSize = buf.readUInt32BE(20);
	let offset = 48;
	const readBase128 = () => {
		let value = 0;
		for (let index = 0; index < 5; index++) {
			const byte = buf[offset++];
			value = (value << 7) | (byte & 0x7f);
			if ((byte & 0x80) === 0) return value;
		}
		throw new Error(`Invalid UIntBase128 in ${filename}`);
	};
	const entries: Array<{ tag: string; length: number }> = [];
	for (let index = 0; index < numTables; index++) {
		const flags = buf[offset++];
		const tagIndex = flags & 0x3f;
		const tag =
			tagIndex === 63
				? ((offset += 4), buf.toString('ascii', offset - 4, offset))
				: WOFF2_KNOWN_TAGS[tagIndex];
		const origLength = readBase128();
		const transformVersion = (flags >> 6) & 0x03;
		const isTransformed =
			tag === 'glyf' || tag === 'loca' ? transformVersion !== 3 : transformVersion !== 0;
		const transformLength = isTransformed ? readBase128() : origLength;
		entries.push({ tag, length: transformLength });
	}
	const decompressed = brotliDecompressSync(buf.subarray(offset, offset + totalCompressedSize));
	const tables: Record<string, Buffer> = {};
	let cursor = 0;
	for (const entry of entries) {
		tables[entry.tag] = decompressed.subarray(cursor, cursor + entry.length);
		cursor += entry.length;
	}

	const fvar = tables.fvar;
	const axes: Array<{ tag: string; min: number; def: number; max: number }> = [];
	if (fvar) {
		const axesOffset = fvar.readUInt16BE(4);
		const axisCount = fvar.readUInt16BE(8);
		const axisSize = fvar.readUInt16BE(10);
		for (let index = 0; index < axisCount; index++) {
			const pos = axesOffset + index * axisSize;
			axes.push({
				tag: fvar.toString('ascii', pos, pos + 4),
				min: fvar.readInt32BE(pos + 4) / 65536,
				def: fvar.readInt32BE(pos + 8) / 65536,
				max: fvar.readInt32BE(pos + 12) / 65536
			});
		}
	}

	const readFeatureTags = (table: Buffer | undefined) => {
		if (!table) return [];
		const featureListOffset = table.readUInt16BE(6);
		const count = table.readUInt16BE(featureListOffset);
		const tags = new Set<string>();
		for (let index = 0; index < count; index++) {
			tags.add(
				table.toString(
					'ascii',
					featureListOffset + 2 + index * 6,
					featureListOffset + 6 + index * 6
				)
			);
		}
		return [...tags];
	};

	return {
		tableTags: Object.keys(tables),
		axes,
		gsubFeatures: readFeatureTags(tables.GSUB),
		gposFeatures: readFeatureTags(tables.GPOS)
	};
}

describe('bundled offline typography', () => {
	it('ships every referenced WOFF2 slice and each family license without a runtime CDN', () => {
		expect(css).not.toMatch(/https?:\/\//);
		const urls = [...css.matchAll(/url\(\.\/([^)]*)\)/g)].map((match) => match[1]);
		expect(urls.length).toBeGreaterThan(0);
		for (const filename of urls) {
			expect(readFileSync(resolve(directory, filename)).toString('ascii', 0, 4)).toBe('wOF2');
		}
		for (const family of [
			'noto-sans',
			'noto-sans-sc',
			'noto-serif',
			'noto-serif-sc',
			'jetbrains-mono',
			'google-sans-flex'
		]) {
			expect(existsSync(resolve(directory, `${family}-OFL.txt`))).toBe(true);
		}
	});

	it.each([
		{ family: 'Noto Sans', weight: '100 900', stretch: '62.5% 100%', styles: ['normal', 'italic'] },
		{ family: 'Noto Sans SC', weight: '100 900', stretch: null, styles: ['normal'] },
		{
			family: 'Noto Serif',
			weight: '100 900',
			stretch: '62.5% 100%',
			styles: ['normal', 'italic']
		},
		{ family: 'Noto Serif SC', weight: '200 900', stretch: null, styles: ['normal'] },
		{ family: 'JetBrains Mono', weight: '100 800', stretch: null, styles: ['normal', 'italic'] },
		{
			family: 'Google Sans Flex',
			weight: '1 1000',
			stretch: '25% 151%',
			styles: ['oblique 0deg 10deg']
		}
	])(
		'$family preserves its full weight, stretch, and style descriptors',
		({ family, weight, stretch, styles }) => {
			const familyFaces = faces.filter((face) => face.includes(`font-family: '${family}';`));
			expect(familyFaces.length).toBeGreaterThan(0);
			expect(familyFaces.every((face) => face.includes(`font-weight: ${weight};`))).toBe(true);
			if (stretch) {
				expect(familyFaces.every((face) => face.includes(`font-stretch: ${stretch};`))).toBe(true);
			}
			for (const style of styles) {
				expect(familyFaces.some((face) => face.includes(`font-style: ${style};`))).toBe(true);
			}
		}
	);

	it('preserves variable axes (including wdth, opsz, ROND, slnt) and OpenType metadata in bundled WOFF2 binaries', () => {
		const gsf = parseWoff2Metadata('google-sans-flex.woff2');
		expect(gsf.axes).toEqual([
			{ tag: 'opsz', min: 1, def: 18, max: 144 },
			{ tag: 'wdth', min: 25, def: 100, max: 151 },
			{ tag: 'wght', min: 1, def: 400, max: 1000 },
			{ tag: 'ROND', min: 0, def: 0, max: 100 },
			{ tag: 'slnt', min: -10, def: 0, max: 0 }
		]);
		expect(gsf.tableTags).toEqual(expect.arrayContaining(['STAT', 'HVAR', 'MVAR', 'GSUB', 'GPOS']));
		expect(gsf.gsubFeatures).toEqual(
			expect.arrayContaining(['tnum', 'calt', 'zero', 'ss01', 'ss02', 'ss09', 'dlig'])
		);

		for (const filename of [
			'noto-sans-regular.woff2',
			'noto-sans-italic.woff2',
			'noto-serif-regular.woff2',
			'noto-serif-italic.woff2'
		]) {
			const meta = parseWoff2Metadata(filename);
			expect(meta.axes).toEqual([
				{ tag: 'wght', min: 100, def: 400, max: 900 },
				{ tag: 'wdth', min: 62.5, def: 100, max: 100 }
			]);
			expect(meta.tableTags).toEqual(expect.arrayContaining(['STAT', 'avar', 'HVAR']));
			expect(meta.gsubFeatures).toEqual(expect.arrayContaining(['tnum', 'onum', 'smcp', 'zero']));
		}

		for (const filename of ['jetbrains-mono-regular.woff2', 'jetbrains-mono-italic.woff2']) {
			const meta = parseWoff2Metadata(filename);
			expect(meta.axes).toEqual([{ tag: 'wght', min: 100, def: 400, max: 800 }]);
			expect(meta.tableTags).toEqual(expect.arrayContaining(['STAT', 'avar', 'HVAR']));
			expect(meta.gsubFeatures).toEqual(expect.arrayContaining(['calt', 'zero', 'case']));
		}

		const notoSansSc = parseWoff2Metadata('noto-sans-sc-101.woff2');
		expect(notoSansSc.tableTags).toEqual(
			expect.arrayContaining(['STAT', 'avar', 'HVAR', 'vhea', 'vmtx'])
		);
		expect(notoSansSc.gsubFeatures).toEqual(
			expect.arrayContaining(['aalt', 'dlig', 'fwid', 'hwid', 'pwid', 'vert', 'vrt2'])
		);
		expect(notoSansSc.gposFeatures).toEqual(
			expect.arrayContaining(['halt', 'kern', 'palt', 'vhal', 'vpal'])
		);
	});

	it.each(['Noto Sans SC', 'Noto Serif SC'])(
		'%s includes dynamic Chinese text beyond fixed interface copy',
		(family) => {
			const ranges = faces
				.filter((face) => face.includes(`font-family: '${family}';`))
				.flatMap((face) => face.match(/unicode-range: ([^;]+);/)?.[1].split(',') ?? []);
			for (const character of '龘罕见文件名') {
				const codepoint = character.codePointAt(0)!;
				expect(
					ranges.some((range) => {
						const [start, end = start] = range
							.trim()
							.replace(/^U\+/i, '')
							.split('-')
							.map((value) => parseInt(value, 16));
						return codepoint >= start && codepoint <= end;
					}),
					character
				).toBe(true);
			}
		}
	);

	it('uses the same Noto base and numeric stacks in both Fluent themes and preserves a separate serif stack', () => {
		for (const theme of [fluentTheme({ mode: 'light' }), fluentTheme({ mode: 'dark' })]) {
			expect(theme.fontFamilyBase).toBe('"Noto Sans", "Noto Sans SC", sans-serif');
			expect(theme.fontFamilyNumeric).toBe(theme.fontFamilyBase);
			expect(theme.fontFamilyMonospace).toContain('JetBrains Mono');
		}
		expect(SERIF_FONT).toBe('"Noto Serif", "Noto Serif SC", serif');
	});
});
