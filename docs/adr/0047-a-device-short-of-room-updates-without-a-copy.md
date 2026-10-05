# A Device short of room updates without an offline copy

A new version's worker saves its copy of the app beside the one in use, so for a while the Device holds two ([ADR-0012](0012-the-app-is-a-precached-shell.md)). A phone short of storage has no room for the second. The install failed, failed again on every retry, and the phone stayed on the old version for good. After a protocol bump it could not send either: a phone on 1.32.0 sat behind the 1.33.0 bump with *Update now* doing nothing.

Short of room, the install now succeeds without a copy. The worker waits and takes over at the same moments as before. Once it is active it deletes the old copy, serves from the network, and fills its own copy in the background.

## Consequences

- **The copy in use is never deleted while the old worker serves from it.** That was tried first. On a full phone the old worker cannot recreate its cache, so it fails every navigation and the app does not open at all.
- **The rescue lives in the worker.** A stuck Device downloads the new worker but keeps running its old page code, so a fix in the page alone could never reach it.
- **Until the background fill completes, opening the app needs the network.** Chrome keeps counting a deleted cache against the quota for a while, so the first fill can fail. It is tried again at the first navigation after the worker restarts, and each try downloads the whole copy again. ADR-0012's promise that a new version is fully on disk before it takes over does not hold on a Device short of room.
- **A cache that cannot be opened or written never costs the network's answer.** Navigations and assets fall back to the network instead of failing.
- **Any other install failure still fails the install** and keeps the old copy, because deleting it would also delete the offline app. *Update now* then loads the new version straight from the server. It checks the server answers, unregisters the worker and drops only the app's caches. The replica and the outbox live in IndexedDB and are untouched.
- **Update now waits for a download still running,** for up to thirty seconds, instead of reloading onto the old copy mid-install. When it cannot finish, it says whether the download is still running or the server cannot be reached.
