export type VisionPredictionHorizonSec = 1 | 2 | 5;

export type VisionNormPoint = {
  xNorm: number;
  yNorm: number;
};

export type VisionSearchWindow = {
  centerXNorm: number;
  centerYNorm: number;
  widthNorm: number;
  heightNorm: number;
};

export type VisionFrameCropRect = {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  fullWidthPx: number;
  fullHeightPx: number;
};

export type VisionPredictionPoint = VisionNormPoint & {
  dtSec: VisionPredictionHorizonSec;
  confidence: number;
};

export type VisionTrackerInitMessage = {
  type: 'init';
  width: number;
  height: number;
};

export type VisionTrackerFrameMessage = {
  type: 'frame';
  id: number;
  tsMs: number;
  bitmap: ImageBitmap;
  cropRect?: VisionFrameCropRect | null;
};

export type VisionTrackerResetMessage = {
  type: 'reset';
};

export type VisionTrackerDisposeMessage = {
  type: 'dispose';
};

export type VisionTrackerWorkerMessage =
  | VisionTrackerInitMessage
  | VisionTrackerFrameMessage
  | VisionTrackerResetMessage
  | VisionTrackerDisposeMessage;

export type VisionTrackerReadyMessage = {
  type: 'ready';
};

export type VisionTrackerTrackMessage = {
  type: 'track';
  id: number;
  tsMs: number;
  status: 'searching' | 'tracking' | 'lost';
  confidence: number;
  centerNorm: VisionNormPoint | null;
  predictions: VisionPredictionPoint[];
};

export type VisionTrackerErrorMessage = {
  type: 'error';
  message: string;
};

export type VisionTrackerHostMessage = VisionTrackerReadyMessage | VisionTrackerTrackMessage | VisionTrackerErrorMessage;
