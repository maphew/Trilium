import config from "./services/config.js";
import { probeHealth } from "./services/healthcheck.js";
import host from "./services/host.js";
import port from "./services/port.js";

probeHealth({ https: config.Network.https, port, host }).then((code) => process.exit(code));
