# Release Guide

## Create a release

1. Update version numbers in `package.json` and `package-lock.json`.
2. Commit the changes.
3. Create a Git tag in the form `vX.Y.Z`.
4. Push the branch and the tag.

Example:

```bash
git commit -am "Release v0.1.1"
git tag v0.1.1
git push origin main --tags
```

## What happens next

The GitHub Actions workflow in `.github/workflows/release.yml` will:

1. install dependencies with `npm ci`
2. run `npm pack`
3. create a GitHub release for the tag
4. upload the generated `.tgz` package as a release asset

## Install from a release asset

Example:

```bash
npm --prefix "/var/lib/homebridge" add "https://github.com/luisbozz/homebridge-yamaha-wxc/releases/download/v0.1.1/homebridge-yamaha-wxc-wxa-50-0.1.1.tgz"
```
