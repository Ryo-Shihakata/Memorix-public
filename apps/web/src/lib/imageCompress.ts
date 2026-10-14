// §9 クライアント画像パイプライン。
// accept 4種: image/jpeg, image/png, image/webp, image/gif
// gif 以外: createImageBitmap → 長辺2048px超なら縮小 → canvas → toBlob('image/webp', 0.85)
// gif: 無変換（2MB超は「GIFは2MB以下にしてください」エラー）
// 変換後も2MB超なら quality 0.7 で再試行 → それでも超過ならエラー

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 2048;

export class ImageCompressError extends Error {}

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

function isAcceptedType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

function computeTargetSize(width: number, height: number): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= MAX_DIMENSION) {
    return { width, height };
  }
  const scale = MAX_DIMENSION / longSide;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encodeWebp(bitmap: ImageBitmap, quality: number): Promise<Blob> {
  const { width, height } = computeTargetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new ImageCompressError('画像の変換に失敗しました。');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', quality);
  });
  if (!blob) {
    throw new ImageCompressError('画像の変換に失敗しました。');
  }
  return blob;
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!isAcceptedType(file.type)) {
    throw new ImageCompressError('対応していない画像形式です。');
  }

  if (file.type === 'image/gif') {
    if (file.size > MAX_BYTES) {
      throw new ImageCompressError('GIFは2MB以下にしてください。');
    }
    // gif は無変換。寸法取得のためだけに bitmap を使う。
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    return { blob: file, width, height };
  }

  const bitmap = await createImageBitmap(file);
  try {
    let blob = await encodeWebp(bitmap, 0.85);
    if (blob.size > MAX_BYTES) {
      blob = await encodeWebp(bitmap, 0.7);
    }
    if (blob.size > MAX_BYTES) {
      throw new ImageCompressError('画像サイズが大きすぎます。2MB以下にしてください。');
    }
    const { width, height } = computeTargetSize(bitmap.width, bitmap.height);
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}
