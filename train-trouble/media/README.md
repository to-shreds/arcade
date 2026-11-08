# Train Trouble crash clips

These three original cartoon cutscenes belong to Dispatcher mode. They show the
trains crumpling into accordions, wheels and cargo flying, and a safe conductor.
Their reassuring ending does not belong in Trolley mode, whose consequences are
described separately.

Each clip contains 135 frames at 960 × 540 and 30 frames per second. The primary
MP4 runs for 4.5 seconds and uses H.264 Constrained Baseline, level 3.1, with
`yuv420p` pixels, a fast-start header, and AAC LC audio. The alternative WebM uses
VP9 video and Opus audio so Chromium builds without H.264 support can play the
same clip. Both versions include every frame and the sound effects. The matching
`.jpg` file is the poster and fallback. The three MP4 files together are about
1.3 MB; the three WebM alternatives add about 1 MB. WebM duration includes
12 milliseconds of audio codec padding after the 4.5-second animation.

Artwork and sound effects are generated locally by
`python3 tools/render-train-crashes.py`. The script needs Pillow, FFmpeg with
libx264, and the system DejaVu Sans Bold font. It contains all drawing and audio
source. Use `--kind head-on`, `--kind rear-end`, or `--kind cargo` to rebuild one
clip. There are no external media requests, stock footage, or downloaded sound
effects.
