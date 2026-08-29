# Family Arcade

Play the arcade at:

https://to-shreds.github.io/arcade/

The playable web arcade lives at the repository root so GitHub Pages can serve it directly. Each game has its own folder with an `index.html`, icon, and metadata, while `catalog.json` powers the centralized game menu.

## Repository layout

- `index.html`: centralized tablet and PC game menu
- `catalog.json`: game catalog and filters
- game folders: self-contained browser games and activities
- `android-wrapper/`: Android wrapper source, without private signing keys or generated build files
- `licenses/`: project and third-party notices
- `archive/legacy-2026-03-09/`: the previous arcade version preserved exactly as it existed before this update

Open the Pages link above to play. No installation is required. The Android wrapper uses the same Pages build by default and keeps a web cache for offline recovery.
