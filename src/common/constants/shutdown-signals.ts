import { ShutdownSignal } from '@nestjs/common';

// Synchronous native faults must retain the OS default action so the supervisor
// can restart the process. A JS shutdown hook can leave the V8 worker spinning.
export const GRACEFUL_SHUTDOWN_SIGNALS = Object.values(ShutdownSignal).filter(
    (signal) => signal !== ShutdownSignal.SIGSEGV,
);
