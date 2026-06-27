// Downscale + re-encode an uploaded image to keep templates small enough for
// localStorage. Returns a data URL. `contain` fits within maxW x maxH while
// preserving aspect ratio.
export function downscaleImage(
  file: File,
  maxW: number,
  maxH: number,
  type: "image/webp" | "image/jpeg" | "image/png" = "image/webp",
  quality = 0.85,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas tidak didukung"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(type, quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Gagal memuat gambar"));
    };
    img.src = url;
  });
}

// Natural display size of a downscaled image data URL (for sizing the element).
export function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => reject(new Error("Gagal membaca ukuran gambar"));
    img.src = dataUrl;
  });
}
