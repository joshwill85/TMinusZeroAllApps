import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type MobileToastTone = 'info' | 'success' | 'warning';

type MobileToastPayload = {
  id?: string;
  message: string;
  tone?: MobileToastTone;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => Promise<void> | void;
};

type MobileToastState = Required<Pick<MobileToastPayload, 'message'>> &
  Pick<MobileToastPayload, 'actionLabel' | 'onAction'> & {
    id: string;
    tone: MobileToastTone;
    durationMs: number;
  };

type MobileToastContextValue = {
  showToast: (payload: MobileToastPayload) => void;
  hideToast: () => void;
};

const DEFAULT_TOAST_DURATION_MS = 5000;
const MobileToastContext = createContext<MobileToastContextValue | null>(null);

export function MobileToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { theme } = useMobileBootstrap();
  const [toast, setToast] = useState<MobileToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibility = useRef(new Animated.Value(0)).current;

  const hideToast = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    Animated.timing(visibility, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) {
        setToast(null);
      }
    });
  }, [visibility]);

  const showToast = useCallback((payload: MobileToastPayload) => {
    const nextToast: MobileToastState = {
      id: payload.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: payload.message,
      tone: payload.tone ?? 'info',
      durationMs: payload.durationMs ?? DEFAULT_TOAST_DURATION_MS,
      actionLabel: payload.actionLabel,
      onAction: payload.onAction
    };

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    visibility.stopAnimation();
    visibility.setValue(0);
    setToast(nextToast);
  }, [visibility]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    Animated.spring(visibility, {
      toValue: 1,
      damping: 18,
      stiffness: 220,
      mass: 0.85,
      useNativeDriver: true
    }).start();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      hideToast();
    }, toast.durationMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [hideToast, toast, visibility]);

  const value = useMemo(
    () => ({
      showToast,
      hideToast
    }),
    [hideToast, showToast]
  );

  return (
    <MobileToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: Math.max(insets.top + 8, 12),
            right: 16,
            left: 16,
            zIndex: 1000
          }}
        >
          <Animated.View
            style={{
              opacity: visibility,
              transform: [
                {
                  translateY: visibility.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-28, 0]
                  })
                }
              ],
              borderRadius: 18,
              borderWidth: 1,
              borderColor:
                toast.tone === 'warning'
                  ? 'rgba(255, 154, 171, 0.28)'
                  : toast.tone === 'success'
                    ? 'rgba(52, 211, 153, 0.28)'
                    : theme.stroke,
              backgroundColor: 'rgba(8, 12, 26, 0.96)',
              paddingHorizontal: 14,
              paddingVertical: 12,
              shadowColor: '#000000',
              shadowOpacity: 0.3,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 },
              elevation: 12
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Text style={{ flex: 1, color: theme.foreground, fontSize: 13, lineHeight: 19 }}>{toast.message}</Text>
              <Pressable onPress={hideToast} hitSlop={8}>
                <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>Dismiss</Text>
              </Pressable>
            </View>
            {toast.actionLabel && toast.onAction ? (
              <View style={{ marginTop: 10 }}>
                <Pressable
                  onPress={() => {
                    const action = toast.onAction;
                    if (!action) return;
                    hideToast();
                    void Promise.resolve(action());
                  }}
                  hitSlop={8}
                >
                  <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '800' }}>{toast.actionLabel}</Text>
                </Pressable>
              </View>
            ) : null}
          </Animated.View>
        </View>
      ) : null}
    </MobileToastContext.Provider>
  );
}

export function useMobileToast() {
  const context = useContext(MobileToastContext);
  if (!context) {
    throw new Error('useMobileToast must be used within MobileToastProvider.');
  }
  return context;
}
