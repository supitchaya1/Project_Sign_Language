import GIF from "gif.js";

export async function downloadCanvasAsGif(
  canvas: HTMLCanvasElement,
  filename = "sentence.gif",
  durationMs = 6000,
  fps = 6
) {
  const gif = new GIF({
    workers: 2,
    quality: 1,
    width: canvas.width,
    height: canvas.height,
    workerScript: "/gif.worker.js",
  });

  const delay = 1000 / fps;
  const totalFrames = Math.floor(durationMs / delay);

  for (let i = 0; i < totalFrames; i++) {
    gif.addFrame(canvas, {
      copy: true,
      delay,
      dispose: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  gif.on("finished", (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".gif") ? filename : `${filename}.gif`;
    a.click();
    URL.revokeObjectURL(url);
  });

  gif.render();
}