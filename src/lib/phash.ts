/**
 * Perceptual hashing (dHash) for duplicate-report detection.
 *
 * A dHash reduces a photo to 64 bits describing its brightness gradients:
 * scale to 9×8 grayscale, then each bit = "is this pixel brighter than its
 * right neighbor?". Two photos of the same animal from similar angles land
 * within a small hamming distance (≤ ~12 bits differing) even across
 * different phones, lighting, and mild crops. It's free, runs on-device in
 * milliseconds, and needs no AI API — the right cost/benefit for a soft
 * duplicate flag. The database compares hashes with bit_count(a # b).
 *
 * Returned as a SIGNED 64-bit decimal string so it fits Postgres `bigint`.
 */

export async function computeDHash(file: File | Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const W = 9;
  const H = 8;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, W, H);

  // Luma per pixel (Rec. 601 weights).
  const gray: number[] = [];
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    gray.push(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
  }

  // 8 comparisons per row × 8 rows = 64 bits.
  let hash = 0n;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      hash = (hash << 1n) | (gray[y * W + x] > gray[y * W + x + 1] ? 1n : 0n);
    }
  }

  // Reinterpret as signed 64-bit so it round-trips through Postgres bigint.
  return BigInt.asIntN(64, hash).toString();
}
