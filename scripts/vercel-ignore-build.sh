#!/usr/bin/env bash
set -u

if [ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ] || [ -z "${VERCEL_GIT_COMMIT_SHA:-}" ]; then
  exit 1
fi

git diff --quiet   "$VERCEL_GIT_PREVIOUS_SHA"   "$VERCEL_GIT_COMMIT_SHA"   -- .   ':(exclude)data/fragments/**'   ':(exclude)generated/**'
