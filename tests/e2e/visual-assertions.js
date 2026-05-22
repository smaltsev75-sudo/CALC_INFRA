import { expect } from '@playwright/test';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function channelsForColorType(colorType) {
    if (colorType === 0) return 1; // grayscale
    if (colorType === 2) return 3; // RGB
    if (colorType === 4) return 2; // grayscale + alpha
    if (colorType === 6) return 4; // RGBA
    throw new Error(`Unsupported PNG color type ${colorType}`);
}

export function decodePng8(buffer) {
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idatChunks = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        offset += 4;
        const type = buffer.toString('ascii', offset, offset + 4);
        offset += 4;
        const data = buffer.subarray(offset, offset + length);
        offset += length + 4; // skip CRC

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'IDAT') {
            idatChunks.push(data);
        } else if (type === 'IEND') {
            break;
        }
    }

    if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
    if (interlace !== 0) throw new Error('Interlaced PNG screenshots are not supported');
    const channels = channelsForColorType(colorType);
    const stride = width * channels;
    const bpp = Math.max(1, channels);
    const raw = inflateSync(Buffer.concat(idatChunks));
    const pixels = Buffer.alloc(width * height * 4);
    let inOffset = 0;
    let outOffset = 0;
    let previous = Buffer.alloc(stride);

    for (let y = 0; y < height; y += 1) {
        const filter = raw[inOffset];
        inOffset += 1;
        const row = Buffer.from(raw.subarray(inOffset, inOffset + stride));
        inOffset += stride;

        for (let x = 0; x < stride; x += 1) {
            const left = x >= bpp ? row[x - bpp] : 0;
            const up = previous[x] || 0;
            const upLeft = x >= bpp ? previous[x - bpp] || 0 : 0;

            if (filter === 1) row[x] = (row[x] + left) & 0xff;
            else if (filter === 2) row[x] = (row[x] + up) & 0xff;
            else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
            else if (filter === 4) row[x] = (row[x] + paethPredictor(left, up, upLeft)) & 0xff;
            else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
        }

        for (let x = 0; x < width; x += 1) {
            const source = x * channels;
            let r;
            let g;
            let b;
            let a = 255;
            if (colorType === 0) {
                r = g = b = row[source];
            } else if (colorType === 4) {
                r = g = b = row[source];
                a = row[source + 1];
            } else if (colorType === 2) {
                r = row[source];
                g = row[source + 1];
                b = row[source + 2];
            } else {
                r = row[source];
                g = row[source + 1];
                b = row[source + 2];
                a = row[source + 3];
            }
            pixels[outOffset++] = r;
            pixels[outOffset++] = g;
            pixels[outOffset++] = b;
            pixels[outOffset++] = a;
        }

        previous = row;
    }

    return { width, height, pixels };
}

export function getScreenshotSignal(buffer) {
    const png = decodePng8(buffer);
    const buckets = new Set();
    let visiblePixels = 0;
    let nonBlankPixels = 0;

    for (let i = 0; i < png.pixels.length; i += 4) {
        const r = png.pixels[i];
        const g = png.pixels[i + 1];
        const b = png.pixels[i + 2];
        const a = png.pixels[i + 3];
        if (a <= 8) continue;
        visiblePixels += 1;
        buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
        if (!(r >= 246 && g >= 246 && b >= 246) && !(r <= 8 && g <= 8 && b <= 8)) {
            nonBlankPixels += 1;
        }
    }

    return {
        width: png.width,
        height: png.height,
        uniqueColorBuckets: buckets.size,
        visiblePixels,
        nonBlankRatio: nonBlankPixels / Math.max(1, png.width * png.height)
    };
}

export function expectScreenshotSignal(buffer, {
    minWidth = 900,
    minHeight = 500,
    minVisiblePixels = 200_000,
    minUniqueColorBuckets = 16,
    minNonBlankRatio = 0.08
} = {}) {
    const signal = getScreenshotSignal(buffer);
    expect(signal.width).toBeGreaterThanOrEqual(minWidth);
    expect(signal.height).toBeGreaterThanOrEqual(minHeight);
    expect(signal.visiblePixels).toBeGreaterThanOrEqual(minVisiblePixels);
    expect(signal.uniqueColorBuckets).toBeGreaterThanOrEqual(minUniqueColorBuckets);
    expect(signal.nonBlankRatio).toBeGreaterThanOrEqual(minNonBlankRatio);
    return signal;
}

export async function expectPageScreenshotSignal(page, path, options = {}) {
    const buffer = await page.screenshot({ path, fullPage: false });
    return expectScreenshotSignal(buffer, options);
}

export async function expectLocatorScreenshotSignal(locator, path, options = {}) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(options.minBoxWidth || 320);
    expect(box.height).toBeGreaterThanOrEqual(options.minBoxHeight || 220);
    const buffer = await locator.screenshot({ path });
    return expectScreenshotSignal(buffer, {
        minWidth: Math.floor(box.width),
        minHeight: Math.floor(box.height),
        minVisiblePixels: Math.min(80_000, Math.floor(box.width * box.height * 0.35)),
        ...options
    });
}

export async function expectElementsDoNotOverlap(page, selectors, { tolerance = 1 } = {}) {
    const overlaps = await page.evaluate(({ checkedSelectors, allowedTolerance }) => {
        const boxes = checkedSelectors.flatMap(selector => {
            const node = Array.from(document.querySelectorAll(selector)).find(el => {
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    rect.width > 0 &&
                    rect.height > 0;
            });
            if (!node) return [];
            const rect = node.getBoundingClientRect();
            return [{
                selector,
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom
            }];
        });

        const problems = [];
        for (let i = 0; i < boxes.length; i += 1) {
            for (let j = i + 1; j < boxes.length; j += 1) {
                const a = boxes[i];
                const b = boxes[j];
                const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (width > allowedTolerance && height > allowedTolerance) {
                    problems.push(`${a.selector} overlaps ${b.selector} (${Math.round(width)}x${Math.round(height)})`);
                }
            }
        }
        return problems;
    }, { checkedSelectors: selectors, allowedTolerance: tolerance });

    expect(overlaps).toEqual([]);
}
