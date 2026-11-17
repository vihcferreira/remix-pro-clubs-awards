const STORAGE_KEY = 'pca_fixed_device_signature_v1';

function computeHardwareTraits(): string {
  try {
    const nav = window.navigator;
    const scr = window.screen;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    // Canvas fingerprint component (deterministic across tabs on same device/browser)
    let canvasSig = 'no-canvas';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 36;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#EAB308';
        ctx.fillRect(10, 4, 50, 20);
        ctx.fillStyle = '#0B0F17';
        ctx.fillText('ProClubsAwards2026', 6, 8);
        canvasSig = canvas.toDataURL().slice(-48);
      }
    } catch {
      // ignore canvas errors
    }

    const rawTraits = [
      nav.userAgent || '',
      nav.language || '',
      String(nav.hardwareConcurrency || 0),
      String(scr.width || 0),
      String(scr.height || 0),
      String(scr.colorDepth || 0),
      tz,
      canvasSig,
    ].join('|');

    // Simple deterministic DJB2 hash
    let hash = 5381;
    for (let i = 0; i < rawTraits.length; i++) {
      hash = (hash * 33) ^ rawTraits.charCodeAt(i);
    }
    return `HW-${(hash >>> 0).toString(16).toUpperCase()}`;
  } catch {
    return 'HW-FALLBACK';
  }
}

export function getOrCreateDeviceSignature(): string {
  const hwHash = computeHardwareTraits();
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim().length > 0) {
      return existing;
    }
    // Use hardware deterministic signature so even if localStorage is cleared on the same IP+device,
    // the server derives the exact same token for this user on the same network/device
    window.localStorage.setItem(STORAGE_KEY, hwHash);
    return hwHash;
  } catch {
    return hwHash;
  }
}
