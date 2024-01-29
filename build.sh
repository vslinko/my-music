#!/bin/bash

set -e

docker build . --tag docker-registry.vslinko.xyz/vslinko/my-music:latest
docker push docker-registry.vslinko.xyz/vslinko/my-music:latest
