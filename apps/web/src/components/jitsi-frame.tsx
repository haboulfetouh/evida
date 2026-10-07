'use client';
import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { useI18n } from '@/i18n';

declare global {
  interface Window { JitsiMeetExternalAPI?: any; }
}

/**
 * Jitsi IFrame API embed. EVIDA never builds media infrastructure: it loads external_api.js from the
 * deployment's own Jitsi domain and joins with a short-lived, room-scoped JWT issued by the API.
 */
export function JitsiFrame({ domain, roomName, jwt, displayName, onLeave, toolbar }: { domain: string; roomName: string; jwt: string; displayName: string; onLeave?: () => void; toolbar?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  const { t, locale } = useI18n();

  useEffect(() => {
    let cancelled = false;
    const init = () => {
      if (cancelled || !ref.current || !window.JitsiMeetExternalAPI) return;
      apiRef.current = new window.JitsiMeetExternalAPI(domain, {
        roomName,
        jwt,
        parentNode: ref.current,
        width: '100%',
        height: '100%',
        lang: locale,
        userInfo: { displayName },
        configOverwrite: { prejoinPageEnabled: false, disableDeepLinking: true, startWithAudioMuted: false, enableWelcomePage: false, disableThirdPartyRequests: true, analytics: { disabled: true } },
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: toolbar ?? ['microphone', 'camera', 'desktop', 'fullscreen', 'tileview', 'settings', 'hangup'], SHOW_JITSI_WATERMARK: false, SHOW_BRAND_WATERMARK: false },
      });
      apiRef.current.addListener('readyToClose', () => onLeave?.());
    };
    if (window.JitsiMeetExternalAPI) init();
    else {
      const s = document.createElement('script');
      s.src = `https://${domain}/external_api.js`;
      s.async = true;
      s.onload = init;
      s.onerror = () => !cancelled && setFailed(true);
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
      apiRef.current?.dispose?.();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, roomName, jwt]);

  if (failed) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 rounded-md bg-ink/[0.04] p-6 text-center text-sm text-muted">
        <VideoOff className="h-6 w-6" aria-hidden />
        <p className="max-w-xs">{t('room.videoUnavailable')}</p>
      </div>
    );
  }
  return <div ref={ref} className="h-full min-h-[280px] overflow-hidden rounded-md bg-black" />;
}
