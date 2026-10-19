# Release boundary

This repository initially supports source builds only. No automatic deployment, installer publication, private artifact upload or private repository access runs in CI. The historical daemon pin 0.7.15-local.browser.1 is not a public release artifact. Do not expect dist, dist:win, dist:mac or stage:daemon to produce a working public installer yet.

A future installer release must pin a compatible public Dinobot release, preserve stage-daemon checksum and browser-protocol validation, generate its icon from source, retain runtime/Chromium/font notices, test on each target OS, and document source-to-artifact provenance. Do not substitute a private vendor tarball.

Public core source
https://github.com/dinobot-labs/dinobot

The root build command needs none of those packaging inputs.
