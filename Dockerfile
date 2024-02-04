FROM docker-registry.vslinko.xyz/vslinko/nodejs:latest
RUN mkdir /my-music
WORKDIR /my-music
ADD package.json /my-music/package.json
ADD package-lock.json /my-music/package-lock.json
RUN npm ci
ADD . /my-music
ENTRYPOINT ["node", "server.mjs"]
EXPOSE 8080
VOLUME /my-music/data
