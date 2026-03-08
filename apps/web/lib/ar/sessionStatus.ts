export type ArSessionStatusTone = 'neutral' | 'warning' | 'danger';
export type ArTelemetryFallbackReason = 'camera_denied' | 'motion_denied' | 'no_heading' | 'camera_error';

export type ArSessionStatusView = {
  tone: ArSessionStatusTone;
  eyebrow: string;
  title: string;
  body: string;
  footnote: string | null;
  actions: {
    enableMotion: boolean;
    retrySensors: boolean;
  };
};

export type ArTelemetryEntryState = {
  modeEntered: 'ar' | 'sky_compass';
  fallbackReason: ArTelemetryFallbackReason | null;
};

type SessionStatusInput = {
  cameraErrorInfo:
    | {
        title: string;
        hint: string;
        detail?: string | null;
      }
    | null;
  locationError: string | null;
  showSensorAssistOverlay: boolean;
  sensorAssistView: {
    title: string;
    body: string;
    footnote: string | null;
  };
  motionPermission: 'unknown' | 'granted' | 'denied';
  trajectoryBelowHorizon: boolean;
};

type TelemetryEntryInput = {
  cameraError: string | null;
  motionPermission: 'unknown' | 'granted' | 'denied';
  adjustedHeading: number | null;
  showSensorAssistOverlay: boolean;
};

function cleanFootnote(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function deriveArTelemetryEntryState(input: TelemetryEntryInput): ArTelemetryEntryState {
  const { cameraError, motionPermission, adjustedHeading, showSensorAssistOverlay } = input;

  if (cameraError) {
    return {
      modeEntered: 'sky_compass',
      fallbackReason: 'camera_denied'
    };
  }

  if (!showSensorAssistOverlay) {
    return {
      modeEntered: 'ar',
      fallbackReason: null
    };
  }

  if (motionPermission === 'denied') {
    return {
      modeEntered: 'sky_compass',
      fallbackReason: 'motion_denied'
    };
  }

  if (adjustedHeading == null) {
    return {
      modeEntered: 'sky_compass',
      fallbackReason: 'no_heading'
    };
  }

  return {
    modeEntered: 'sky_compass',
    fallbackReason: 'camera_error'
  };
}

export function deriveArSessionStatusView(input: SessionStatusInput): ArSessionStatusView | null {
  const { cameraErrorInfo, locationError, showSensorAssistOverlay, sensorAssistView, motionPermission, trajectoryBelowHorizon } = input;

  if (cameraErrorInfo) {
    return {
      tone: 'danger',
      eyebrow: 'Camera',
      title: cameraErrorInfo.title,
      body: cameraErrorInfo.hint,
      footnote: cleanFootnote(cameraErrorInfo.detail),
      actions: {
        enableMotion: false,
        retrySensors: true
      }
    };
  }

  if (locationError) {
    return {
      tone: 'warning',
      eyebrow: 'Location',
      title: 'Location needed',
      body: 'Allow location so the trajectory can be placed from your viewing position.',
      footnote: cleanFootnote(locationError),
      actions: {
        enableMotion: false,
        retrySensors: true
      }
    };
  }

  if (showSensorAssistOverlay) {
    return {
      tone: motionPermission === 'denied' ? 'warning' : 'neutral',
      eyebrow: motionPermission === 'granted' ? 'Heading' : 'Sensors',
      title: sensorAssistView.title,
      body: sensorAssistView.body,
      footnote: cleanFootnote(sensorAssistView.footnote),
      actions: {
        enableMotion: motionPermission !== 'granted',
        retrySensors: true
      }
    };
  }

  if (trajectoryBelowHorizon) {
    return {
      tone: 'warning',
      eyebrow: 'Visibility',
      title: 'Trajectory is below your horizon',
      body: 'You may still catch the pad marker, but the ascent track will stay below your local horizon.',
      footnote: null,
      actions: {
        enableMotion: false,
        retrySensors: false
      }
    };
  }

  return null;
}
