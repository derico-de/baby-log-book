<script>
  // @ts-nocheck — impeccable's live-preview mount, dev-only tooling outside
  // the app's strictness; it talks to window globals the helper defines.
  import { onMount } from 'svelte';

  const LIVE_URL = '/live.js';
  const HOST_ID = 'impeccable-live-root';

  onMount(() => {
    let host = document.querySelector('impeccable-live-root#' + HOST_ID) || document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('impeccable-live-root');
      host.id = HOST_ID;
      document.body.appendChild(host);
    }

    host.dataset.impeccableLiveAdapter = 'sveltekit';
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('top', '0', 'important');
    host.style.setProperty('left', '0', 'important');
    host.style.setProperty('width', '0', 'important');
    host.style.setProperty('height', '0', 'important');
    host.style.setProperty('overflow', 'visible', 'important');
    host.style.setProperty('z-index', '2147483000', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');

    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (!root.querySelector('style[data-impeccable-live-reset]')) {
      const reset = document.createElement('style');
      reset.dataset.impeccableLiveReset = 'true';
      reset.textContent = ':host, :host *, * { box-sizing: border-box; }';
      root.appendChild(reset);
    }

    window.__IMPECCABLE_LIVE_ADAPTER__ = 'sveltekit';
    window.__IMPECCABLE_LIVE_UI_ROOT__ = root;
    window.__IMPECCABLE_LIVE_CHROME_MOUNT__ = {
      adapter: 'sveltekit',
      version: 1,
      host,
      root,
    };

    const script = document.createElement('script');
    script.src = LIVE_URL;
    script.async = true;
    script.dataset.impeccableLiveScript = 'true';
    document.head.appendChild(script);

    return () => {
      script.remove();
      if (window.__IMPECCABLE_LIVE_UI_ROOT__ === root) delete window.__IMPECCABLE_LIVE_UI_ROOT__;
      if (window.__IMPECCABLE_LIVE_CHROME_MOUNT__?.root === root) delete window.__IMPECCABLE_LIVE_CHROME_MOUNT__;
      if (window.__IMPECCABLE_LIVE_ADAPTER__ === 'sveltekit') delete window.__IMPECCABLE_LIVE_ADAPTER__;
    };
  });
</script>
