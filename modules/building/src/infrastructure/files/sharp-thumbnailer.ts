import sharp from 'sharp'
import type { Thumbnailer } from '../../application/ports'

/**
 * A WebP at quality 80 whose longest side is `width`, never enlarged, rotated by its EXIF orientation, without metadata
 * (DOC-37 §10). `sharp` 0.35.5 on Bun is the compatibility check U8 of DOC-37 §12.
 */
export class SharpThumbnailer implements Thumbnailer {
  async resize(image: Uint8Array, width: number): Promise<Uint8Array | null> {
    try {
      const out = await sharp(image)
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer()
      return new Uint8Array(out)
    } catch {
      // A truncated or corrupt image that passed the magic check: no thumbnail, the DTO falls back to the original (FS-22).
      return null
    }
  }
}
