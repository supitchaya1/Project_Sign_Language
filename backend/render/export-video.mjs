import fs from "fs/promises";
import puppeteer from "puppeteer";

const [, , appUrl, outputWebmPath, payloadJsonPath] = process.argv;

if (!appUrl || !outputWebmPath || !payloadJsonPath) {
  console.error(
    "Usage: node export-video.mjs <appUrl> <outputWebmPath> <payloadJsonPath>"
  );
  process.exit(1);
}

const payload = JSON.parse(await fs.readFile(payloadJsonPath, "utf-8"));

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({
    width: payload.width ?? 960,
    height: payload.height ?? 540,
    deviceScaleFactor: 1,
  });

  let doneResolve;
  let doneReject;

  const donePromise = new Promise((resolve, reject) => {
    doneResolve = resolve;
    doneReject = reject;
  });

  await page.exposeFunction("__nodeExportDone", async (base64Webm) => {
    const buf = Buffer.from(base64Webm, "base64");
    await fs.writeFile(outputWebmPath, buf);
    doneResolve();
  });

  await page.exposeFunction("__nodeExportError", async (message) => {
    doneReject(new Error(message));
  });

  await page.goto(`${appUrl}/export-video`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });

  await page.waitForFunction(() => typeof window.startExport === "function", {
    timeout: 15000,
  });

  await page.evaluate(() => {
    window.__EXPORT_DONE__ = (base64Webm) => window.__nodeExportDone(base64Webm);
    window.__EXPORT_ERROR__ = (message) => window.__nodeExportError(message);
  });

  await page.evaluate(async (payloadArg) => {
    await window.startExport(payloadArg);
  }, payload);

  await donePromise;
} finally {
  await browser.close();
}