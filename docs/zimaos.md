# ZimaOS Notes

## HOME Directory

ZimaOS sets HOME=/DATA.

However, /DATA is not writable by non-root users.

## Developer Bootstrap

To provide a standard Linux developer experience, this project redirects developer tooling using:

- GIT_CONFIG_GLOBAL
- DOCKER_CONFIG
- XDG_CONFIG_HOME
- XDG_CACHE_HOME
- XDG_STATE_HOME

The bootstrap script is located at:

/DATA/Infrastructure/developer/bootstrap.sh
