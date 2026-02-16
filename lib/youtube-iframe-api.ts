/**
 * Singleton loader for the YouTube IFrame Player API.
 * Shared between VideoPlayer (main) and SideVideoPanel.
 */

let _loading = false;
const _callbacks: (() => void)[] = [];

export function ensureYTApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));

  // Already loaded (possibly by another module)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).YT?.Player) return Promise.resolve();

  return new Promise((resolve) => {
    _callbacks.push(resolve);
    if (_loading) return;
    _loading = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).onYouTubeIframeAPIReady = () => {
      _callbacks.forEach(cb => cb());
      _callbacks.length = 0;
    };

    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
}
