# Changelog

## [2.37.0] — prepared, unpublished

### Changed

- The v2 release script and manual publish workflow use the npm `v2` channel. The script marks its GitHub release `--latest=false`; the workflow validates the stable 2.x manifest, release branch and immutable tag before publishing.
- Lead, builder and reviewer now proactively use the optional `engineering-code-review` skill for implementation work. If it is missing, they recommend its source without blocking; builder readability changes preserve behavior and reviewer findings follow project requirements and evidence.
