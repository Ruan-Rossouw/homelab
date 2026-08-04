        // Start the periodic register-read scheduler — patched in at build
        // time, see services/eg4-bridge/README.md's "Patched: Upstream
        // Never Starts Its Own Scheduler". Upstream constructs a Scheduler
        // (whose start() loop is what periodically calls
        // read_input_registers()) but never spawns it anywhere in the
        // actual running program — confirmed by exhaustive search of
        // main.rs/lib.rs/coordinator/mod.rs at the pinned commit. Without
        // this, the only telemetry ever received is whatever the dongle
        // pushes unprompted at the initial connection; nothing after.
        {
            let scheduler = crate::scheduler::Scheduler::new((*self.config).clone(), self.channels.clone());
            tokio::spawn(async move {
                if let Err(e) = scheduler.start().await {
                    error!("Scheduler task failed: {}", e);
                }
            });
        }

