#!/usr/bin/env bash

npm run test

if [ $? -ne 0 ]; then
  echo "Tests failed. Aborting build."
  exit 1
fi

npm run build

if [ $? -ne 0 ]; then
  echo "Build failed. Aborting build."
  exit 1
fi

echo "Health check passed. Proceeding with deployment."
exit 0
