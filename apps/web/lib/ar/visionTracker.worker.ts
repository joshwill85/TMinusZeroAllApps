/// <reference lib="webworker" />

import { VisionTrackerCore } from './visionTrackerCore';
import type { VisionTrackerFrameMessage, VisionTrackerHostMessage, VisionTrackerWorkerMessage } from './visionTrackerProtocol';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

let frameWidth = 0;
let frameHeight = 0;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
const tracker = new VisionTrackerCore();

function post(message: VisionTrackerHostMessage) {
  workerScope.postMessage(message);
}

function resetTracker() {
  tracker.reset();
}

function init(widthRaw: number, heightRaw: number) {
  frameWidth = Math.max(1, Math.floor(widthRaw || 0));
  frameHeight = Math.max(1, Math.floor(heightRaw || 0));
  canvas = new OffscreenCanvas(frameWidth, frameHeight);
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  resetTracker();
}

function handleFrame(message: VisionTrackerFrameMessage) {
  const { id, tsMs, bitmap, cropRect } = message;
  try {
    const bitmapWidth = Math.max(1, Math.floor(bitmap.width || frameWidth || 0));
    const bitmapHeight = Math.max(1, Math.floor(bitmap.height || frameHeight || 0));
    if (!ctx || !canvas || bitmapWidth <= 0 || bitmapHeight <= 0) {
      post({ type: 'error', message: 'vision tracker not initialized' });
      return;
    }

    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }
    ctx.clearRect(0, 0, bitmapWidth, bitmapHeight);
    ctx.drawImage(bitmap, 0, 0, bitmapWidth, bitmapHeight);
    const imageData = ctx.getImageData(0, 0, bitmapWidth, bitmapHeight);
    post(tracker.processFrame(id, tsMs, imageData, cropRect ?? null));
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'vision tracker frame error' });
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

workerScope.addEventListener('message', (event: MessageEvent<VisionTrackerWorkerMessage>) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || !('type' in message)) return;

  if (message.type === 'init') {
    init(message.width, message.height);
    post({ type: 'ready' });
    return;
  }

  if (message.type === 'reset') {
    resetTracker();
    return;
  }

  if (message.type === 'dispose') {
    resetTracker();
    workerScope.close();
    return;
  }

  if (message.type === 'frame') {
    handleFrame(message);
  }
});

export {};
