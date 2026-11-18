# Release process

Publishing is a maintainer action. Ordinary builds and package workflows create
artifacts without publishing them.

1. Update the root, decoder and demo encoder crate versions and npm metadata.
2. Run formatting/lint, native/core/CLI tests, all 63 Wasm profiles, byte/error
   comparisons, and browser/demo checks. Rebuild and commit `dist/`.
3. Record new benchmark evidence separately from historical measurements. Keep
   raw observations in the release archive and compact results in the repo.
4. Push each coherent addition as NeoX and wait for GitHub CI and Pages tests.
5. Run the manual **packages** workflow on the final commit. It tests static
   Linux x86_64/aarch64 CLIs and packages browser modules with licenses.
6. Download its Actions artifacts, verify their checksums, retain benchmark results,
   and create one `SHA256SUMS` covering the final release assets.
7. Tag that tested commit with the maintainer's identity, then publish the GitHub
   release with those exact assets. Download the published assets and check them
   against the checksum manifest.
8. Publish the exact tested npm tarball, using an authenticated maintainer for
   the initial release. Later releases can use the manual **npm** workflow and a
   configured npm trusted publisher for this repository's `npm.yml`. It checks
   the GitHub release checksum before publishing, and refuses conflicting versions.
   npm credentials stay outside the repository. Trusted publishing uses GitHub
   OIDC rather than a stored long-lived token and adds npm provenance.
9. Verify the registry version/integrity, install it into a clean consumer, and
   confirm the hosted workbench matches the release commit.

Package builds never publish automatically. This separates reviewable build
artifacts from publishing the release and keeps the final tag tied to green CI.
Do not reuse an npm version: publishing is immutable. The initial local bootstrap
does not claim CI provenance; later OIDC publications use the workflow identity.
