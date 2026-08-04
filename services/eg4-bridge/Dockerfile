# Our own Dockerfile, not upstream's. Upstream's own Dockerfile
# (https://github.com/jaredmauch/eg4-bridge/blob/main/Dockerfile) has two
# problems, confirmed against the pinned commit's actual build output:
# 1. It only copies the compiled binary into the runtime stage, but the
#    binary hard-falls-back to a relative path "doc/eg4_registers.json"
#    (see src/config.rs's register_schema()) whenever config.yaml doesn't
#    set register_file — a file that lives in the source repo's doc/
#    directory and is never copied into their runtime image.
# 2. It still names the compiled binary `lxp-bridge` (the project's old
#    name before this fork renamed itself to eg4-bridge) — `cargo install`
#    at the pinned commit actually produces a binary named `eg4-bridge`,
#    so upstream's own COPY/ENTRYPOINT lines don't match reality.
# Built and run as upstream intends, their own container fails outright
# (step 2) or panics on startup (step 1). See README's "Fixed: Upstream's
# Dockerfile Doesn't Match Its Own Build Output" for the full story.
#
# Build context is expected to be a fresh checkout of
# https://github.com/jaredmauch/eg4-bridge at the pinned commit documented
# in README.md — NOT this repo. See README's "Build" section for the exact
# clone + build command.
#
# Also expects a second, named build context called "patches" pointing at
# this service's own patches/ directory (docker buildx's --build-context
# flag) — see README's "Patched: Upstream Never Starts Its Own Scheduler".

FROM rust:1-bookworm AS builder
WORKDIR /usr/src/eg4-bridge
COPY Cargo.toml Cargo.lock ./
COPY src src
COPY db db
COPY --from=patches scheduler-spawn.rs /tmp/scheduler-spawn.rs
RUN sed -i '/\/\/ Verify subscribers are ready/r /tmp/scheduler-spawn.rs' src/coordinator/mod.rs
RUN cargo install --path .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /usr/local/cargo/bin/eg4-bridge /usr/local/bin/eg4-bridge
COPY doc/eg4_registers.json /app/doc/eg4_registers.json
ENTRYPOINT ["eg4-bridge", "-c", "/etc/config.yaml"]
