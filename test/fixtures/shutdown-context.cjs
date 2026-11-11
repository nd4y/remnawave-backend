require('reflect-metadata');

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const { Module: NestModule } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');

const policyPath = path.resolve(__dirname, '../../src/common/constants/shutdown-signals.ts');
const policy = new Module(policyPath, module);
policy.paths = Module._nodeModulePaths(path.dirname(policyPath));
policy._compile(
    ts.transpileModule(fs.readFileSync(policyPath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    policyPath,
);

class ShutdownModule {
    onApplicationShutdown(signal) {
        return new Promise((resolve) => process.send({ event: 'shutdown', signal }, resolve));
    }
}
NestModule({})(ShutdownModule);

async function main() {
    const app = await NestFactory.createApplicationContext(ShutdownModule, { logger: false });
    app.enableShutdownHooks(policy.exports.GRACEFUL_SHUTDOWN_SIGNALS);
    process.on('message', (message) => {
        if (message === 'fault') {
            require(process.env.SHUTDOWN_NATIVE_ADDON).schedule();
        }
    });
    process.send({
        event: 'ready',
        segvListeners: process.listenerCount('SIGSEGV'),
        termListeners: process.listenerCount('SIGTERM'),
        intListeners: process.listenerCount('SIGINT'),
    });
}
main().catch((error) => {
    process.stderr.write(String(error.stack ?? error) + '\n');
    process.exit(1);
});
