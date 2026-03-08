import type {
  VisionFrameCropRect,
  VisionTrackerFrameMessage,
  VisionTrackerHostMessage,
  VisionSearchWindow,
  VisionTrackerTrackMessage,
  VisionTrackerWorkerMessage
} from '@/lib/ar/visionTrackerProtocol';
import {
  advanceVisionTrackerAdaptiveState,
  DEFAULT_VISION_TRACKER_ADAPTIVE_STATE,
  deriveAdaptiveVisionTrackerBudget
} from '@/lib/ar/visionTrackerBudget';
import { VisionTrackerCore } from '@/lib/ar/visionTrackerCore';
import { buildVisionCropRect } from '@/lib/ar/visionTrackerWindow';

export type VisionTrackerBackend = 'worker_roi' | 'main_thread_roi';
export type VisionTrackerRuntimeBudget = {
  targetFps?: number;
  captureWidth?: number;
  maxFramesInFlight?: number;
};

type VisionTrackerClientOptions = {
  video: HTMLVideoElement;
  getViewportSize: () => { width: number; height: number };
  getSearchWindow?: () => VisionSearchWindow | null;
  getRuntimeBudget?: () => VisionTrackerRuntimeBudget | null;
  onTrack: (message: VisionTrackerTrackMessage) => void;
  onError?: (message: string) => void;
  backend?: VisionTrackerBackend;
  targetFps?: number;
  maxFramesInFlight?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function isWorkerVisionTrackerSupported() {
  if (typeof window === 'undefined') return false;
  return (
    typeof Worker !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

export function isMainThreadVisionTrackerSupported() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d', { willReadFrequently: true }) != null;
  } catch {
    return false;
  }
}

export function isVisionTrackerSupported(backend?: VisionTrackerBackend) {
  if (backend === 'main_thread_roi') return isMainThreadVisionTrackerSupported();
  if (backend === 'worker_roi') return isWorkerVisionTrackerSupported();
  return isWorkerVisionTrackerSupported() || isMainThreadVisionTrackerSupported();
}

function drawVideoCover(video: HTMLVideoElement, ctx: CanvasRenderingContext2D, width: number, height: number) {
  const vw = Math.max(1, Math.floor(video.videoWidth || 0));
  const vh = Math.max(1, Math.floor(video.videoHeight || 0));
  if (vw <= 1 || vh <= 1) return false;
  const scale = Math.max(width / vw, height / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const dx = (width - drawW) / 2;
  const dy = (height - drawH) / 2;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, dx, dy, drawW, drawH);
  return true;
}

function captureSizeForViewport(viewport: { width: number; height: number }, targetWidthRaw: number) {
  const viewWidth = Math.max(1, Math.floor(viewport.width || 0));
  const viewHeight = Math.max(1, Math.floor(viewport.height || 0));
  const targetWidth = clamp(Math.floor(targetWidthRaw || 0), 160, 480);
  const aspect = viewHeight / viewWidth;
  const rawHeight = Math.round(targetWidth * aspect);
  const targetHeight = clamp(rawHeight, 180, 480);
  return { width: targetWidth, height: targetHeight };
}

export class VisionTrackerClient {
  private readonly video: HTMLVideoElement;

  private readonly getViewportSize: () => { width: number; height: number };

  private readonly getSearchWindow?: () => VisionSearchWindow | null;

  private readonly getRuntimeBudget?: () => VisionTrackerRuntimeBudget | null;

  private readonly onTrack: (message: VisionTrackerTrackMessage) => void;

  private readonly onError?: (message: string) => void;

  private readonly backend: VisionTrackerBackend;

  private readonly defaultTargetFps: number;

  private readonly defaultMaxFramesInFlight: number;

  private worker: Worker | null = null;

  private trackerCore: VisionTrackerCore | null = null;

  private captureCanvas: HTMLCanvasElement | null = null;

  private captureCtx: CanvasRenderingContext2D | null = null;

  private running = false;

  private rafId: number | null = null;

  private frameId = 0;

  private framesInFlight = 0;

  private lastCaptureAtMs = 0;

  private adaptiveState = { ...DEFAULT_VISION_TRACKER_ADAPTIVE_STATE };

  private lastSaturationSampleAtMs = 0;

  constructor(options: VisionTrackerClientOptions) {
    this.video = options.video;
    this.getViewportSize = options.getViewportSize;
    this.getSearchWindow = options.getSearchWindow;
    this.getRuntimeBudget = options.getRuntimeBudget;
    this.onTrack = options.onTrack;
    this.onError = options.onError;
    this.backend = options.backend ?? 'worker_roi';
    this.defaultTargetFps = clamp(Math.floor(options.targetFps ?? 18), 6, 30);
    this.defaultMaxFramesInFlight = clamp(Math.floor(options.maxFramesInFlight ?? 2), 1, 4);
  }

  start() {
    if (this.running) return true;
    if (!isVisionTrackerSupported(this.backend)) return false;

    const viewport = this.getViewportSize();
    const runtimeBudget = this.readRuntimeBudget();
    const captureSize = captureSizeForViewport(viewport, runtimeBudget.captureWidth);
    const canvas = document.createElement('canvas');
    canvas.width = captureSize.width;
    canvas.height = captureSize.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return false;

    this.captureCanvas = canvas;
    this.captureCtx = ctx;
    this.running = true;
    this.framesInFlight = 0;
    this.lastCaptureAtMs = 0;
    this.frameId = 0;
    this.adaptiveState = { ...DEFAULT_VISION_TRACKER_ADAPTIVE_STATE };
    this.lastSaturationSampleAtMs = 0;

    if (this.backend === 'worker_roi') {
      const worker = new Worker(new URL('./visionTracker.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<VisionTrackerHostMessage>) => {
        const message = event.data;
        if (!message || typeof message !== 'object' || !('type' in message)) return;

        if (message.type === 'track') {
          this.framesInFlight = Math.max(0, this.framesInFlight - 1);
          const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const baseBudget = this.readBaseRuntimeBudget();
          this.adaptiveState = advanceVisionTrackerAdaptiveState({
            backend: this.backend,
            baseBudget,
            state: this.adaptiveState,
            latencyMs: Math.max(0, nowMs - message.tsMs),
            trackStatus: message.status,
            trackConfidence: message.confidence
          });
          this.onTrack(message);
          return;
        }

        if (message.type === 'error') {
          this.framesInFlight = Math.max(0, this.framesInFlight - 1);
          this.adaptiveState = advanceVisionTrackerAdaptiveState({
            backend: this.backend,
            baseBudget: this.readBaseRuntimeBudget(),
            state: this.adaptiveState,
            saturated: true
          });
          this.onError?.(message.message);
        }
      };
      worker.onerror = (event) => {
        this.onError?.(event.message || 'vision tracker worker error');
      };

      const initMessage: VisionTrackerWorkerMessage = {
        type: 'init',
        width: captureSize.width,
        height: captureSize.height
      };
      worker.postMessage(initMessage);
      this.worker = worker;
    } else {
      this.trackerCore = new VisionTrackerCore();
    }

    this.loop();
    return true;
  }

  stop() {
    this.running = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.worker) {
      try {
        const disposeMessage: VisionTrackerWorkerMessage = { type: 'dispose' };
        this.worker.postMessage(disposeMessage);
      } catch {
        // ignore
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.trackerCore?.reset();
    this.trackerCore = null;
    this.captureCanvas = null;
    this.captureCtx = null;
    this.framesInFlight = 0;
    this.adaptiveState = { ...DEFAULT_VISION_TRACKER_ADAPTIVE_STATE };
    this.lastSaturationSampleAtMs = 0;
  }

  reset() {
    if (this.worker) {
      const resetMessage: VisionTrackerWorkerMessage = { type: 'reset' };
      this.worker.postMessage(resetMessage);
    }
    this.trackerCore?.reset();
    this.framesInFlight = 0;
    this.lastCaptureAtMs = 0;
    this.adaptiveState = {
      ...DEFAULT_VISION_TRACKER_ADAPTIVE_STATE,
      loadTier: this.adaptiveState.loadTier
    };
    this.lastSaturationSampleAtMs = 0;
  }

  private loop = () => {
    if (!this.running) return;
    const runtimeBudget = this.readRuntimeBudget();
    const frameIntervalMs = 1000 / runtimeBudget.targetFps;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    this.syncCaptureCanvas(runtimeBudget);

    if (
      this.backend === 'worker_roi' &&
      this.framesInFlight >= runtimeBudget.maxFramesInFlight &&
      now - this.lastSaturationSampleAtMs >= Math.max(80, frameIntervalMs)
    ) {
      this.lastSaturationSampleAtMs = now;
      this.adaptiveState = advanceVisionTrackerAdaptiveState({
        backend: this.backend,
        baseBudget: this.readBaseRuntimeBudget(),
        state: this.adaptiveState,
        saturated: true
      });
    }

    if (
      this.captureCanvas &&
      this.captureCtx &&
      (this.backend !== 'worker_roi' || this.framesInFlight < runtimeBudget.maxFramesInFlight) &&
      now - this.lastCaptureAtMs >= frameIntervalMs &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0
    ) {
      const drawn = drawVideoCover(this.video, this.captureCtx, this.captureCanvas.width, this.captureCanvas.height);
      const cropRect = this.getCropRect(this.captureCanvas.width, this.captureCanvas.height);
      if (drawn && this.backend === 'worker_roi') {
        this.lastCaptureAtMs = now;
        const frameId = ++this.frameId;
        this.framesInFlight += 1;
        const bitmapPromise = cropRect
          ? createImageBitmap(
              this.captureCanvas,
              cropRect.xPx,
              cropRect.yPx,
              cropRect.widthPx,
              cropRect.heightPx
            )
          : createImageBitmap(this.captureCanvas);
        bitmapPromise
          .then((bitmap) => {
            if (!this.running || !this.worker) {
              this.framesInFlight = Math.max(0, this.framesInFlight - 1);
              bitmap.close();
              return;
            }
            const frameMessage: VisionTrackerFrameMessage = {
              type: 'frame',
              id: frameId,
              tsMs: now,
              bitmap,
              cropRect
            };
            this.worker.postMessage(frameMessage, [bitmap]);
          })
          .catch((error) => {
            this.framesInFlight = Math.max(0, this.framesInFlight - 1);
            this.onError?.(error instanceof Error ? error.message : 'vision tracker frame capture failed');
          });
      }
      if (drawn && this.backend === 'main_thread_roi' && this.trackerCore) {
        try {
          this.lastCaptureAtMs = now;
          const frameId = ++this.frameId;
          const processStartedAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const imageData = cropRect
            ? this.captureCtx.getImageData(cropRect.xPx, cropRect.yPx, cropRect.widthPx, cropRect.heightPx)
            : this.captureCtx.getImageData(0, 0, this.captureCanvas.width, this.captureCanvas.height);
          const message = this.trackerCore.processFrame(frameId, now, imageData, cropRect);
          const processEndedAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          this.adaptiveState = advanceVisionTrackerAdaptiveState({
            backend: this.backend,
            baseBudget: this.readBaseRuntimeBudget(),
            state: this.adaptiveState,
            processingMs: Math.max(0, processEndedAtMs - processStartedAtMs),
            trackStatus: message.status,
            trackConfidence: message.confidence
          });
          this.onTrack(message);
        } catch (error) {
          this.adaptiveState = advanceVisionTrackerAdaptiveState({
            backend: this.backend,
            baseBudget: this.readBaseRuntimeBudget(),
            state: this.adaptiveState,
            saturated: true
          });
          this.onError?.(error instanceof Error ? error.message : 'vision tracker frame capture failed');
        }
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private getCropRect(frameWidth: number, frameHeight: number): VisionFrameCropRect | null {
    return buildVisionCropRect(frameWidth, frameHeight, this.getSearchWindow?.() ?? null);
  }

  private readRuntimeBudget() {
    const base = this.readBaseRuntimeBudget();
    return deriveAdaptiveVisionTrackerBudget({
      backend: this.backend,
      baseBudget: base,
      state: this.adaptiveState
    });
  }

  private readBaseRuntimeBudget() {
    const raw = this.getRuntimeBudget?.() ?? null;
    return {
      targetFps: clamp(Math.floor(raw?.targetFps ?? this.defaultTargetFps), 6, 30),
      captureWidth: clamp(Math.floor(raw?.captureWidth ?? 320), 160, 480),
      maxFramesInFlight: clamp(Math.floor(raw?.maxFramesInFlight ?? this.defaultMaxFramesInFlight), 1, 4)
    };
  }

  private syncCaptureCanvas(runtimeBudget: { captureWidth: number }) {
    if (!this.captureCanvas) return;
    const viewport = this.getViewportSize();
    const nextSize = captureSizeForViewport(viewport, runtimeBudget.captureWidth);
    if (this.captureCanvas.width === nextSize.width && this.captureCanvas.height === nextSize.height) return;
    this.captureCanvas.width = nextSize.width;
    this.captureCanvas.height = nextSize.height;
  }
}

export function createVisionTrackerClient(options: VisionTrackerClientOptions) {
  return new VisionTrackerClient(options);
}
