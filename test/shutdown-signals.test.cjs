const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');

async function startContext(t) {
    const child = fork(path.join(__dirname, 'fixtures/shutdown-context.cjs'), {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    t.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
        }
    });
    const messages = [];
    child.on('message', (message) => messages.push(message));
    const ready = await Promise.race([
        once(child, 'message').then(([message]) => message),
        once(child, 'exit').then(([code, signal]) => {
            throw new Error(`Context exited before ready: ${code} ${signal}`);
        }),
    ]);
    assert.equal(ready.event, 'ready');
    assert.equal(ready.segvListeners, 0);
    assert.ok(ready.termListeners > 0);
    assert.ok(ready.intListeners > 0);
    return { child, messages };
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    test(`${signal} executes the Nest shutdown hook`, { timeout: 10_000 }, async (t) => {
        const { child, messages } = await startContext(t);
        const exited = once(child, 'exit');
        child.kill(signal);
        const [code, received] = await exited;
        assert.equal(code, null);
        assert.equal(received, signal);
        assert.ok(
            messages.some((message) => message.event === 'shutdown' && message.signal === signal),
        );
    });
}

test('SIGSEGV retains its fatal default action', { timeout: 10_000 }, async (t) => {
    const { child, messages } = await startContext(t);
    const exited = once(child, 'exit');
    child.kill('SIGSEGV');
    const [code, signal] = await exited;
    assert.equal(code, null);
    assert.equal(signal, 'SIGSEGV');
    assert.equal(
        messages.some((message) => message.event === 'shutdown'),
        false,
    );
});

for (let trial = 1; trial <= 3; trial++) {
    test(
        `native V8 worker fault terminates instead of spinning (trial ${trial})`,
        { timeout: 10_000, skip: !process.env.SHUTDOWN_NATIVE_ADDON },
        async (t) => {
            const { child, messages } = await startContext(t);
            const exited = once(child, 'exit');
            child.send('fault');
            const [code, signal] = await exited;
            assert.equal(code, null);
            assert.equal(signal, 'SIGSEGV');
            assert.equal(
                messages.some((message) => message.event === 'shutdown'),
                false,
            );
        },
    );
}
