import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as path from 'node:path';

/**
 * A file stream that rotates when the file exceeds a configured size.
 * Rotated files are renamed with a timestamp suffix and gzip-compressed asynchronously.
 */
export class RotatingFileStream {
  private readonly filePath: string;
  private readonly maxSizeBytes: number;
  private currentSize: number = 0;
  private fd: number | null = null;

  constructor(filePath: string, maxSizeBytes: number) {
    this.filePath = filePath;
    this.maxSizeBytes = maxSizeBytes;
    this.openFile();
  }

  private openFile(): void {
    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open in append mode, creating if needed
    this.fd = fs.openSync(this.filePath, 'a');

    // Track current file size
    try {
      const stat = fs.fstatSync(this.fd);
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
    }
  }

  /**
   * Write data to the file. Rotates if the file would exceed maxSizeBytes.
   */
  write(data: string): void {
    const bytes = Buffer.byteLength(data, 'utf8');

    if (this.currentSize + bytes > this.maxSizeBytes) {
      this.rotate();
    }

    if (this.fd === null) {
      this.openFile();
    }

    fs.writeSync(this.fd!, data);
    this.currentSize += bytes;
  }

  /**
   * Rotate the current log file: rename it with a timestamp, then gzip it asynchronously.
   */
  private rotate(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // ignore close errors
      }
      this.fd = null;
    }

    if (!fs.existsSync(this.filePath)) {
      this.openFile();
      return;
    }

    const ext = path.extname(this.filePath);
    const base = this.filePath.slice(0, this.filePath.length - ext.length);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${base}.${timestamp}${ext}`;

    try {
      fs.renameSync(this.filePath, rotatedPath);
    } catch {
      // If rename fails, just open a new file
      this.openFile();
      return;
    }

    // Gzip the rotated file asynchronously
    this.gzipAsync(rotatedPath);

    // Open a fresh file
    this.openFile();
    this.currentSize = 0;
  }

  private gzipAsync(filePath: string): void {
    // Check file exists before attempting compression
    if (!fs.existsSync(filePath)) return;

    const gzPath = filePath + '.gz';
    const readStream = fs.createReadStream(filePath);
    const writeStream = fs.createWriteStream(gzPath);
    const gzip = zlib.createGzip();

    readStream.on('error', () => {
      // Source file gone (e.g. temp dir cleaned up) — abort silently
      writeStream.destroy();
    });

    readStream
      .pipe(gzip)
      .pipe(writeStream)
      .on('finish', () => {
        // Remove the uncompressed rotated file after successful compression
        fs.unlink(filePath, () => {
          // ignore unlink errors
        });
      })
      .on('error', () => {
        // If compression fails, leave the uncompressed file in place
      });
  }

  /**
   * Close the underlying file descriptor.
   */
  close(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // ignore
      }
      this.fd = null;
    }
  }
}
