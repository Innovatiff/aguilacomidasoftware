/**
 * A QR code, from nothing.
 *
 * The sticker that goes on a container carries a QR that takes the worker to
 * the page where they install their own app. Every way of getting one of those
 * involves something this project does not have: a build step, a package, or a
 * call to somebody's image server at the moment of printing — and that last one
 * would send a worker's address to a stranger and stop working the morning the
 * internet does. So it is written here, and it is about three hundred lines.
 *
 * What it does: byte mode, error correction level M, versions 1 to 10. That
 * covers a URL of up to 213 bytes, which is twice what the sticker needs, and
 * M survives a corner of the label being smudged with adobo.
 *
 * **The tables are the danger.** Everything else here is an algorithm that is
 * either right or obviously wrong; the constants from the standard are the part
 * that can be quietly wrong and produce a beautiful square nobody's phone can
 * read. So there are as few of them as possible — the codeword totals are
 * counted off the matrix rather than copied, and the block split is derived —
 * and what remains is checked against the standard's own numbers on every
 * single build. `qrMatrix` throws rather than hand back a code it cannot
 * account for.
 */

/* --- GF(256), the field the error correction lives in ----------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

for (let i = 0, x = 1; i < 255; i += 1) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  // The primitive polynomial QR uses: x^8 + x^4 + x^3 + x^2 + 1.
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * The generator polynomial for `degree` error-correction codewords: the
 * product of (x - a^0)(x - a^1)...(x - a^(degree-1)).
 *
 * Coefficients run highest power first, which is the order `remainderOf`
 * divides in. Written the other way round it still produces a square, and the
 * square is unreadable.
 */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];                    // multiplied by x
      next[j + 1] ^= mul(poly[j], EXP[i]);   // multiplied by a^i
    }
    poly = next;
  }
  return poly;
}

/** The `degree` check codewords for one block. */
function remainderOf(data, degree) {
  const gen = generator(degree);
  const out = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i += 1) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

/* --- What the standard says ------------------------------------------------- */

/*
 * Two tables, and only two.
 *
 * `EC_PER_BLOCK` is how many check codewords each block carries at level M, and
 * `BLOCKS` is how many blocks there are. Everything else about the split falls
 * out of them: the standard always divides the data as evenly as it can, so the
 * short blocks and the long ones are a division and a remainder, not a lookup.
 *
 * The third table, `TOTAL`, is not used to build anything. It is the standard's
 * own count of codewords per version, kept here only so the module count taken
 * off the matrix can be checked against it.
 */
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** Centres of the alignment patterns, per version. */
const ALIGN = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const MAX_VERSION = 10;
const sizeOf = (version) => 17 + 4 * version;

/* --- The parts of the square that are not data ------------------------------ */

/**
 * Marks every module that belongs to the code itself rather than to the
 * message: the three corners, the little squares that keep a camera oriented on
 * a big code, the two dotted lines, and the strips where the format and version
 * are written.
 *
 * Returns a grid of booleans — true where data may not go.
 */
function functionModules(version) {
  const size = sizeOf(version);
  const taken = Array.from({ length: size }, () => new Uint8Array(size));
  const claim = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) taken[y][x] = 1; };

  // The three finders, with the quiet separator around each.
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) claim(ox + dx, oy + dy);
    }
  }

  // The timing lines.
  for (let i = 0; i < size; i += 1) { claim(6, i); claim(i, 6); }

  // Alignment patterns, except where one would sit on a finder.
  const centres = ALIGN[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const onFinder = (cx <= 8 && cy <= 8)
        || (cx <= 8 && cy >= size - 9)
        || (cx >= size - 9 && cy <= 8);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) claim(cx + dx, cy + dy);
      }
    }
  }

  // The two format strips, and the dark module that is always set.
  for (let i = 0; i < 9; i += 1) { claim(8, i); claim(i, 8); }
  for (let i = 0; i < 8; i += 1) { claim(8, size - 1 - i); claim(size - 1 - i, 8); }

  // Version information, on codes big enough to need it.
  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        claim(size - 11 + j, i);
        claim(i, size - 11 + j);
      }
    }
  }

  return taken;
}

/** How many codewords fit in a version, counted rather than looked up. */
function capacityOf(version) {
  const taken = functionModules(version);
  let free = 0;
  for (const row of taken) for (const cell of row) if (!cell) free += 1;
  return { codewords: Math.floor(free / 8), remainderBits: free % 8 };
}

/* --- Drawing ---------------------------------------------------------------- */

function drawFunctionPatterns(grid, version) {
  const size = sizeOf(version);
  const set = (x, y, on) => { if (x >= 0 && y >= 0 && x < size && y < size) grid[y][x] = on ? 1 : 0; };

  /*
   * Order matters here, and it is the opposite of the order these are usually
   * described in. The dotted lines run the whole width and height, straight
   * through where the corner squares are — so they go down first and the
   * squares are painted over them. Drawn the other way round, every corner
   * square comes out with a dotted edge, which is exactly the part a reader
   * uses to find the code at all.
   */
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(ox + dx, oy + dy, ring !== 2 && ring <= 3);
      }
    }
  }

  const centres = ALIGN[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const onFinder = (cx <= 8 && cy <= 8)
        || (cx <= 8 && cy >= size - 9)
        || (cx >= size - 9 && cy <= 8);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Always dark, always here.
  set(8, size - 8, true);
}

/** BCH check bits, used by both the format strip and the version strip. */
function bch(value, generatorPoly, bits) {
  const width = 32 - Math.clz32(generatorPoly);
  let rest = value << bits;
  while (32 - Math.clz32(rest) >= width) {
    rest ^= generatorPoly << ((32 - Math.clz32(rest)) - width);
  }
  return rest;
}

/**
 * The fifteen bits that say "level M, mask N" — written twice, so a code with
 * one corner destroyed can still be read.
 */
function drawFormat(grid, version, mask) {
  const size = sizeOf(version);
  // 00 is level M in the format's own numbering, which is not the same order
  // the levels are usually named in.
  const data = (0b00 << 3) | mask;
  const bits = ((data << 10) | bch(data, 0b10100110111, 10)) ^ 0b101010000010010;

  // Written as (x, y) in the standard; this grid is [y][x].
  const at = (i) => (bits >> i) & 1;
  for (let i = 0; i <= 5; i += 1) grid[i][8] = at(i);
  grid[7][8] = at(6);
  grid[8][8] = at(7);
  grid[8][7] = at(8);
  for (let i = 9; i <= 14; i += 1) grid[8][14 - i] = at(i);

  // The second copy, so a code with one corner gone is still readable.
  for (let i = 0; i <= 7; i += 1) grid[8][size - 1 - i] = at(i);
  for (let i = 8; i <= 14; i += 1) grid[size - 15 + i][8] = at(i);
}

/** The eighteen bits that say which version this is. Only versions 7 and up. */
function drawVersion(grid, version) {
  if (version < 7) return;
  const size = sizeOf(version);
  const bits = (version << 12) | bch(version, 0b1111100100101, 12);
  for (let i = 0; i < 18; i += 1) {
    const bit = (bits >> i) & 1;
    const a = Math.floor(i / 3);
    const b = size - 11 + (i % 3);
    grid[a][b] = bit;
    grid[b][a] = bit;
  }
}

/** The zigzag: two columns at a time, right to left, skipping the timing line. */
function drawData(grid, taken, version, bytes, remainderBits) {
  const size = sizeOf(version);
  let bit = 0;
  const total = bytes.length * 8 + remainderBits;
  const next = () => {
    if (bit >= total) return 0;
    const value = bit < bytes.length * 8
      ? (bytes[bit >> 3] >> (7 - (bit & 7))) & 1
      : 0;
    bit += 1;
    return value;
  };

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing line; the pairs step over it.
    if (right === 6) right = 5;
    // Which way this pair of columns runs, taken from the column itself rather
    // than from a flag that flips — the skip above would put a flag out of step.
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (taken[y][x]) continue;
        grid[y][x] = next();
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (unused, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0,
  (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
];

function applyMask(grid, taken, mask) {
  const size = grid.length;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (taken[y][x]) continue;
      if (MASKS[mask](x, y)) grid[y][x] ^= 1;
    }
  }
}

/**
 * How bad a masked code looks to a scanner.
 *
 * Four penalties from the standard: long runs of one colour, blocks of four,
 * anything that looks like a finder pattern, and being too far from half dark.
 * The lowest score wins.
 */
function penalty(grid) {
  const size = grid.length;
  let score = 0;

  const lines = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(grid[i]);
    lines.push(grid.map((row) => row[i]));
  }

  for (const line of lines) {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
    // The finder-lookalike, either way round, with its quiet space.
    const text = line.join('');
    for (const pattern of ['10111010000', '00001011101']) {
      let from = text.indexOf(pattern);
      while (from !== -1) { score += 40; from = text.indexOf(pattern, from + 1); }
    }
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = grid[y][x];
      if (v === grid[y][x + 1] && v === grid[y + 1][x] && v === grid[y + 1][x + 1]) score += 3;
    }
  }

  let dark = 0;
  for (const row of grid) for (const cell of row) dark += cell;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* --- Putting the message in ------------------------------------------------- */

/**
 * The longest message that fits at all: version 10, level M, minus the four
 * bits of mode and the sixteen of length. Computed rather than written down,
 * so it cannot drift away from the tables above.
 */
export function qrCapacity() {
  const data = capacityOf(MAX_VERSION).codewords
    - EC_PER_BLOCK[MAX_VERSION] * BLOCKS[MAX_VERSION];
  return Math.floor((data * 8 - (4 + 16)) / 8);
}

/** The smallest version this many bytes fits in, at level M. */
function versionFor(byteCount) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const { codewords } = capacityOf(version);
    const data = codewords - EC_PER_BLOCK[version] * BLOCKS[version];
    const header = 4 + (version <= 9 ? 8 : 16);
    if (byteCount * 8 + header <= data * 8) return version;
  }
  return 0;
}

/** Mode, length, message, terminator, padding — the data codewords. */
function dataCodewords(bytes, version, dataCount) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                                   // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const room = dataCount * 8;
  push(0, Math.min(4, room - bits.length));          // terminator
  while (bits.length % 8) bits.push(0);

  const out = new Uint8Array(dataCount);
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i]) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  // The standard's two pad bytes, alternating, for whatever room is left.
  for (let i = bits.length / 8; i < dataCount; i += 1) {
    out[i] = (i - bits.length / 8) % 2 === 0 ? 0xec : 0x11;
  }
  return out;
}

/**
 * Splits the message into blocks, adds the check codewords, and interleaves
 * them the way a reader expects to find them.
 */
function interleave(data, version) {
  const blocks = BLOCKS[version];
  const ecPer = EC_PER_BLOCK[version];
  const shortLen = Math.floor(data.length / blocks);
  const longCount = data.length % blocks;

  const dataBlocks = [];
  const ecBlocks = [];
  let from = 0;
  for (let i = 0; i < blocks; i += 1) {
    const length = shortLen + (i >= blocks - longCount ? 1 : 0);
    const block = data.slice(from, from + length);
    from += length;
    dataBlocks.push(block);
    ecBlocks.push(remainderOf(block, ecPer));
  }

  const out = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPer; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return Uint8Array.from(out);
}

/* --- The one thing this file exports ---------------------------------------- */

/**
 * Builds the code for a string.
 *
 * @param {string} text
 * @returns {{ size: number, modules: number[][], version: number, mask: number }}
 *   `modules[y][x]` is 1 for a dark square. There is no quiet zone in here;
 *   whatever draws it has to leave four modules of white around the outside or
 *   no reader will find it.
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const version = versionFor(bytes.length);
  if (!version) {
    throw new Error(`No cabe en un QR: ${bytes.length} bytes, el máximo son ${qrCapacity()}.`);
  }

  const { codewords, remainderBits } = capacityOf(version);

  /*
   * The check that makes the tables above safe to trust.
   *
   * `codewords` was counted off the matrix this file builds; TOTAL is what the
   * standard says it should be. If those two ever disagree, either the pattern
   * layout or the table is wrong, and the code that came out would be a square
   * that no phone can read — which is a bug nobody would find by looking at it.
   * So it is a build error instead.
   */
  if (codewords !== TOTAL[version]) {
    throw new Error(`QR versión ${version}: conté ${codewords} palabras y la norma dice ${TOTAL[version]}.`);
  }

  const dataCount = codewords - EC_PER_BLOCK[version] * BLOCKS[version];
  const payload = interleave(dataCodewords(bytes, version, dataCount), version);
  if (payload.length !== codewords) {
    throw new Error(`QR versión ${version}: armé ${payload.length} palabras de ${codewords}.`);
  }

  const size = sizeOf(version);
  const taken = functionModules(version);

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = Array.from({ length: size }, () => new Uint8Array(size));
    drawFunctionPatterns(grid, version);
    drawVersion(grid, version);
    drawData(grid, taken, version, payload, remainderBits);
    applyMask(grid, taken, mask);
    drawFormat(grid, version, mask);

    const score = penalty(grid);
    if (!best || score < best.score) best = { score, mask, grid };
  }

  return {
    size,
    version,
    mask: best.mask,
    modules: best.grid.map((row) => Array.from(row)),
  };
}
