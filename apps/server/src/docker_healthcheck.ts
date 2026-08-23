import { probeHealth, resolveHealthcheckTarget } from "./services/healthcheck.js";

probeHealth(resolveHealthcheckTarget()).then((code) => process.exit(code));
