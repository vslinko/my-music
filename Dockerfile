FROM docker-registry.vslinko.xyz/vslinko/nodejs:latest as builder
ADD . /my-music
WORKDIR /my-music
RUN npm ci

FROM docker-registry.vslinko.xyz/vslinko/nodejs:latest
COPY --from=builder /my-music /my-music
WORKDIR /my-music
ENTRYPOINT ["node", "server.mjs"]
EXPOSE 8080
VOLUME /my-music/data
